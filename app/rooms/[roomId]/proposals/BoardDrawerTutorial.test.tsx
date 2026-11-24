// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProposalsClient from "./ProposalsClient";
import BoardClient, { type BoardConnection } from "../board/BoardClient";
import {
  clearDemoBoardTutorialDone,
  isDemoBoardTutorialDone,
} from "@/lib/demo-board-tutorial";
import { demoFixture } from "@/lib/demo-fixture";
import type { MemberRole, Proposal, RoomSnapshot } from "@/lib/types";

let mockMembershipRole: MemberRole = "family";
let mockIsDemo = false;

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return {
    useAnonymousUser: () => user,
    useAnonymousAuth: () => ({
      user,
      loading: false,
      error: null,
      retry: vi.fn(),
    }),
    getIdToken: vi.fn(async () => "test-token"),
    ensureAnonymousUser: vi.fn(async () => user),
  };
});

vi.mock("@/lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ isDemo: mockIsDemo }),
  })),
}));

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: vi.fn(async () => ({ role: mockMembershipRole })),
  readRoomSnapshot: vi.fn(),
}));

vi.mock("@/lib/plan/client", () => ({
  applyProposal: vi.fn(),
  confirmPlan: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/rooms/test/board" }));
vi.mock("@/components/RoomName", () => ({ default: () => "デモルーム（佐藤家）" }));

const demoSnapshot: RoomSnapshot = {
  people: demoFixture.people,
  placements: demoFixture.troubledPlan.placements,
  constraints: demoFixture.constraints,
  hopes: demoFixture.hopes,
  unknowns: demoFixture.unknowns,
  careWindows: demoFixture.careWindows,
  copayRate: demoFixture.copayRate,
  revision: 0,
};

const sampleProposal: Proposal = {
  ...demoFixture.fixedProposal,
  baseRevision: 0,
  validation: demoFixture.acceptedPlan.expectedValidationResult,
};

function stubMatchMedia(isDesktop: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("1024px") ? isDesktop : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("ボードと代替案ドロワーの統合チュートリアル", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMembershipRole = "family";
    mockIsDemo = false;
    clearDemoBoardTutorialDone();
    stubMatchMedia(true);
    Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = false;
      },
    });
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proposals: [sampleProposal] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    clearDemoBoardTutorialDone();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
    global.fetch = originalFetch;
  });

  it("通常ルーム・ケアマネ・非埋め込みページでは表示しない", async () => {
    // 1. 通常ルーム（embedded）
    mockIsDemo = false;
    const { unmount: u1 } = render(
      <ProposalsClient roomId="normal-1" loadSnapshot={async () => demoSnapshot} embedded />,
    );
    await screen.findByRole("region", { name: "現在のプランの状態" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    u1();

    // 2. ケアマネ（デモ・embedded）
    mockIsDemo = true;
    mockMembershipRole = "careManager";
    const { unmount: u2 } = render(
      <ProposalsClient roomId="demo-cm" loadSnapshot={async () => demoSnapshot} embedded />,
    );
    await screen.findByRole("region", { name: "現在のプランの状態" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    u2();

    // 3. 単独ページ（embedded=false）
    mockMembershipRole = "family";
    render(<ProposalsClient roomId="demo-page" loadSnapshot={async () => demoSnapshot} />);
    await screen.findByRole("region", { name: "現在のプランの状態" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
  });

  it("ドロワーだけ開いても初回に一度だけ案内し、取得で比較ステップへ進み、再訪時はボタンから再生する", async () => {
    const drawer = <ProposalsClient roomId="drawer-first-visit" initialIsDemo embedded loadSnapshot={async () => demoSnapshot} />;
    const page = render(drawer);
    const tutorial = await screen.findByTestId("demo-drawer-tutorial-dialog");
    expect(tutorial.dataset.tutorialStep).toBe("1");
    expect(tutorial.dataset.tutorialStepId).toBe("proposal-fetch");
    fireEvent.click(screen.getByRole("button", { name: "代替案を取得する" }));
    await waitFor(() => {
      expect(tutorial.dataset.tutorialStep).toBe("2");
      expect(tutorial.dataset.tutorialStepId).toBe("proposal-compare");
    });
    expect(tutorial.textContent).toContain("代替案を比較する");
    fireEvent.click(within(tutorial).getByRole("button", { name: "次へ" }));
    expect(tutorial.dataset.tutorialStep).toBe("3");
    expect(tutorial.dataset.tutorialStepId).toBe("proposal-apply");
    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    page.unmount();
    render(drawer);
    const replay = await screen.findByRole("button", { name: "チュートリアルをもう一度見る" });
    expect(screen.queryByTestId("demo-drawer-tutorial-dialog")).toBeNull();
    fireEvent.click(replay);
    expect(screen.getByTestId("demo-drawer-tutorial-dialog").dataset.tutorialStep).toBe("1");
  });

  it("操作成功でのみ5・6・8を進み、7で代替案を比較し、ボードで9を完了する", async () => {
    mockIsDemo = true;
    const { readRoomSnapshot } = await import("@/lib/rooms");
    vi.mocked(readRoomSnapshot).mockResolvedValue(demoSnapshot);

    const connection: BoardConnection = {
      load: vi.fn(async () => ({
        snapshot: structuredClone(demoSnapshot),
        role: "family" as const,
        isDemo: true,
      })),
      save: vi.fn(async () => 1),
    };

    render(<BoardClient roomId="demo-overlap-check" connection={connection} />);

    const tutorial = () => screen.getByTestId("demo-board-tutorial-dialog");
    const next = () => within(tutorial()).getByRole("button", { name: "次へ" });
    const step = (n: number) => waitFor(() =>
      expect(tutorial().getAttribute("data-tutorial-step")).toBe(String(n)),
    );
    await step(1);
    fireEvent.click(next());
    fireEvent.click(screen.getByRole("button", { name: "土曜 8:00 介護の空白" }));
    fireEvent.click(within(screen.getByTestId("placement-popup")).getByRole("button", { name: "保存" }));
    await step(3);
    for (let i = 3; i < 5; i++) fireEvent.click(next());
    await step(5);
    expect(within(tutorial()).queryByRole("button", { name: "次へ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /代替案を見る/ }));
    await step(6);
    expect(tutorial().getAttribute("data-tutorial-step-id")).toBe("proposal-fetch");
    expect(within(tutorial()).queryByRole("button", { name: "次へ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ボードへ戻る" }));
    await step(5);
    fireEvent.click(screen.getByRole("button", { name: /代替案を見る/ }));
    await step(6);
    const fetchButton = screen.getByRole("button", { name: "代替案を取得する" });
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "demo_snapshot_mismatch", message: "デモの予定や設定が変更されています",
    }), { status: 422 }));
    fireEvent.click(fetchButton);
    await within(tutorial()).findByText(/ルームトップで「デモをリセット」/, { selector: "p" });
    const recovery = screen.getByRole("link", { name: /ルームトップへ戻る（デモをリセット/ });
    expect(recovery.getAttribute("href")).toBe("/rooms/demo-overlap-check");
    expect(recovery.getAttribute("data-proposals-tutorial-target")).toBe("proposal-recovery");
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({proposals: []})));
    fireEvent.click(fetchButton);
    await screen.findByText("代替案は提示されませんでした。");
    expect(within(tutorial()).queryByRole("button", { name: "次へ" })).toBeNull();
    // 取得成功で自動的にステップ 8（proposal-compare）へ進む
    fireEvent.click(fetchButton);
    await step(7);
    expect(tutorial().getAttribute("data-tutorial-step-id")).toBe("proposal-compare");
    expect(tutorial().textContent).toContain("代替案を比較する");
    expect(tutorial().textContent).toContain("変更の内訳を見る（12件）");
    // 比較ステップのハイライト対象は要約・参考・変更の内訳をまとめて囲む
    const proposalCardTarget = document.querySelector<HTMLElement>(
      '[data-proposals-tutorial-target="proposal-card"]',
    );
    expect(proposalCardTarget).not.toBeNull();
    expect(within(proposalCardTarget!).getByText("変更の要約")).toBeTruthy();
    expect(within(proposalCardTarget!).getByText(/参考：希望への沿い具合/)).toBeTruthy();
    expect(proposalCardTarget!.querySelector("details")).not.toBeNull();
    expect(within(proposalCardTarget!).getByText(/変更の内訳を見る（12件）/)).toBeTruthy();
    // 戻る→次へで比較ステップへ戻れる
    fireEvent.click(within(tutorial()).getByRole("button", { name: "戻る" }));
    await step(6);
    expect(tutorial().getAttribute("data-tutorial-step-id")).toBe("proposal-fetch");
    fireEvent.click(next());
    await step(7);
    expect(tutorial().getAttribute("data-tutorial-step-id")).toBe("proposal-compare");
    // 比較ステップから「次へ」でステップ 9（proposal-apply）へ進む
    fireEvent.click(next());
    await step(8);
    expect(tutorial().getAttribute("data-tutorial-step-id")).toBe("proposal-apply");
    expect(within(tutorial()).queryByRole("button", { name: "次へ" })).toBeNull();
    const { applyProposal } = await import("@/lib/plan/client");
    vi.mocked(applyProposal).mockRejectedValueOnce(new Error("採用失敗")).mockResolvedValueOnce({ revision: 1, validation: demoFixture.acceptedPlan.expectedValidationResult });
    const apply = screen.getAllByRole("button", { name: "採用する" })[0];
    fireEvent.click(apply);
    await waitFor(() => expect(apply.hasAttribute("disabled")).toBe(false));
    await step(8);
    vi.mocked(connection.load).mockResolvedValueOnce({
      snapshot: { ...demoSnapshot, revision: 1, placements: demoFixture.acceptedPlan.placements },
      role: "family",
      isDemo: true,
    });
    fireEvent.click(apply);
    await step(9);
    expect(screen.queryByRole("dialog", { name: "代替案の取得・比較・採用" })).toBeNull();
    expect(tutorial().textContent).toContain("プランの確定");
    fireEvent.click(screen.getByRole("button", { name: "チュートリアルを完了" }));
    expect(isDemoBoardTutorialDone("demo-overlap-check")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /代替案を見る/ }));
    await screen.findByRole("region", { name: "現在のプランの状態" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    const drawer = within(screen.getByRole("dialog", { name: "代替案の取得・比較・採用" }));
    expect(drawer.queryByTestId("demo-drawer-tutorial-dialog")).toBeNull();
    fireEvent.click(drawer.getByRole("button", { name: "チュートリアルをもう一度見る" }));
    const replay = drawer.getByTestId("demo-drawer-tutorial-dialog");
    expect(replay.dataset.tutorialStep).toBe("1");
    expect(replay.dataset.tutorialStepId).toBe("proposal-fetch");
    expect(within(replay).queryByRole("button", { name: "次へ" })).toBeNull();
    vi.mocked(global.fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "demo_snapshot_mismatch", message: "見本の予定は編集済みです",
    }), { status: 422 }));
    fireEvent.click(drawer.getByRole("button", { name: "代替案を取得する" }));
    fireEvent.click(await within(replay).findByRole("button", { name: "次へ" }));
    expect(replay.dataset.tutorialStepId).toBe("proposal-compare");
    fireEvent.click(within(replay).getByRole("button", { name: "次へ" }));
    expect(replay.dataset.tutorialStepId).toBe("proposal-apply");
    fireEvent.click(within(replay).getByRole("button", { name: "チュートリアルを完了" }));
    expect(drawer.queryByTestId("demo-drawer-tutorial-dialog")).toBeNull();
    expect(isDemoBoardTutorialDone("demo-overlap-check")).toBe(true);
  });
});
