// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProposalsClient from "./ProposalsClient";
import { demoFixture as fixture } from "@/lib/demo-fixture";
import type { Proposal, RoomSnapshot } from "@/lib/types";

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return {
    useAnonymousUser: () => user,
    getIdToken: vi.fn(async () => "test-token"),
    ensureAnonymousUser: vi.fn(async () => user),
  };
});

vi.mock("@/lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(async () => ({
    exists: () => false,
    data: () => ({ isDemo: false }),
  })),
}));

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: vi.fn(async () => ({ role: "family" })),
  readRoomSnapshot: vi.fn(),
}));

const mockApplyProposal = vi.fn();
const mockConfirmPlan = vi.fn();
vi.mock("@/lib/plan/client", () => ({
  applyProposal: (...args: unknown[]) => mockApplyProposal(...args),
  confirmPlan: (...args: unknown[]) => mockConfirmPlan(...args),
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/rooms/test/proposals" }));

const initialSnapshot: RoomSnapshot = {
  people: fixture.people,
  placements: fixture.troubledPlan.placements,
  constraints: fixture.constraints,
  hopes: fixture.hopes,
  unknowns: fixture.unknowns,
  careWindows: fixture.careWindows,
  copayRate: fixture.copayRate,
  revision: 0,
};

const updatedSnapshot: RoomSnapshot = {
  people: fixture.people,
  placements: fixture.acceptedPlan.placements,
  constraints: fixture.constraints,
  hopes: fixture.hopes,
  unknowns: fixture.unknowns,
  careWindows: fixture.careWindows,
  copayRate: fixture.copayRate,
  revision: 1,
};

const sampleProposal: Proposal = {
  ...fixture.fixedProposal,
  baseRevision: 0,
  validation: fixture.acceptedPlan.expectedValidationResult,
};

describe("ProposalsClient: 代替案の採用と現在のプラン更新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ proposals: [sampleProposal] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
  });

  afterEach(cleanup);

  it("代替案を採用すると、サーバーから最新プランを再取得して表示を更新し、完了メッセージを表示する", async () => {
    let currentSnap = initialSnapshot;
    const loadSnapshot = vi.fn(async () => currentSnap);
    const onRoomChanged = vi.fn();

    mockApplyProposal.mockImplementation(async () => {
      // サーバー上でプランが更新された状態を模擬
      currentSnap = updatedSnapshot;
      return {
        revision: 1,
        validation: fixture.acceptedPlan.expectedValidationResult,
      };
    });

    render(<ProposalsClient roomId="test-room" loadSnapshot={loadSnapshot} embedded onRoomChanged={onRoomChanged} />);
    expect(screen.queryByRole("navigation")).toBeNull();

    // 初期状態：揉めるプラン（問題あり、版0、月換算単位28,131）
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("入力の版：0")).toBeTruthy();
    expect(screen.getByText("問題あり（要調整）")).toBeTruthy();
    expect(screen.getByText(/28,131/)).toBeTruthy();
    // 注意点カードが常時表示されていること
    expect(screen.getAllByText("+1,083 単位").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/枠超過/)).toBeTruthy();
    expect(screen.getByText(/介護が必要な時間の空白/)).toBeTruthy();
    expect(screen.getByText(/付き添いの負担集中/)).toBeTruthy();

    // 代替案を取得（上部・下部の両方にボタンが存在することを確認）
    const fetchButtons = screen.getAllByRole("button", { name: "代替案を取得する" });
    expect(fetchButtons).toHaveLength(2);
    fireEvent.click(fetchButtons[0]);

    // 代替案が表示されるのを待つ（上部・下部の両方に採用ボタンが存在する）
    const applyButtons = await screen.findAllByRole("button", { name: "採用する" });
    expect(applyButtons).toHaveLength(2);

    // 上部の「採用する」をクリック
    fireEvent.click(applyButtons[0]);

    // 採用APIが呼ばれたことを確認
    await waitFor(() => {
      expect(mockApplyProposal).toHaveBeenCalledWith("test-room", sampleProposal);
    });

    // 採用完了メッセージが表示されること（重複なく1件のみ表示される）
    await waitFor(() => {
      expect(
        screen.getAllByText("代替案を採用しました。現在のプランに反映されました。"),
      ).toHaveLength(1);
    });

    // 再取得が行われ、「現在のプラン」欄が新しい状態（問題なし、版1、問題なしメッセージ）に更新されること
    await waitFor(() => {
      expect(screen.getByText("入力の版：1")).toBeTruthy();
    });
    expect(screen.getByText("問題なし（確定できます）")).toBeTruthy();
    expect(screen.getByText("問題なし（基準を満たしています）")).toBeTruthy();
    expect(onRoomChanged).toHaveBeenCalledOnce();
  });

  it("デモモードの採用経路でも同様にサーバーから最新プランを再取得して表示を更新する", async () => {
    let currentSnap = initialSnapshot;
    const loadSnapshot = vi.fn(async () => currentSnap);

    const { getDocFromServer } = await import("firebase/firestore");
    vi.mocked(getDocFromServer).mockImplementation(async () => ({
      exists: () => true,
      data: () => ({ isDemo: true }),
    }) as unknown as Awaited<ReturnType<typeof getDocFromServer>>);

    mockApplyProposal.mockImplementation(async () => {
      currentSnap = updatedSnapshot;
      return {
        revision: 1,
        validation: fixture.acceptedPlan.expectedValidationResult,
      };
    });

    render(<ProposalsClient roomId="demo-room" loadSnapshot={loadSnapshot} />);

    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("デモモード：サンプル家族に合わせた固定の代替案が返ります。")).toBeTruthy();
    expect(screen.getByText("入力の版：0")).toBeTruthy();

    // 代替案を取得（上部・下部の両方にボタンが存在することを確認）
    const fetchButtons = screen.getAllByRole("button", { name: "代替案を取得する" });
    expect(fetchButtons).toHaveLength(2);
    fireEvent.click(fetchButtons[0]);

    const applyButtons = await screen.findAllByRole("button", { name: "採用する" });
    expect(applyButtons).toHaveLength(2);
    // 下部ボタンで採用できることも確認
    fireEvent.click(applyButtons[1]);

    await waitFor(() => {
      expect(mockApplyProposal).toHaveBeenCalledWith("demo-room", sampleProposal);
    });

    await waitFor(() => {
      expect(screen.getByText("入力の版：1")).toBeTruthy();
    });
    expect(
      screen.getAllByText("代替案を採用しました。現在のプランに反映されました。").length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("問題なし（確定できます）")).toBeTruthy();
    expect(screen.getByText("問題なし（基準を満たしています）")).toBeTruthy();
  });

  it("プラン確定後にまとめシートで確認・印刷するボタンが表示される", async () => {
    let currentSnap = updatedSnapshot;
    const loadSnapshot = vi.fn(async () => currentSnap);
    const onRoomChanged = vi.fn();

    const { getDocFromServer } = await import("firebase/firestore");
    let isConfirmed = false;
    vi.mocked(getDocFromServer).mockImplementation(async (docRef: unknown) => {
      // summary doc check
      if (isConfirmed) {
        return {
          exists: () => true,
          data: () => ({ confirmedRevision: 1 }),
        } as unknown as Awaited<ReturnType<typeof getDocFromServer>>;
      }
      return {
        exists: () => false,
        data: () => ({ isDemo: false }),
      } as unknown as Awaited<ReturnType<typeof getDocFromServer>>;
    });

    mockConfirmPlan.mockImplementation(async () => {
      isConfirmed = true;
    });

    render(<ProposalsClient roomId="test-room" loadSnapshot={loadSnapshot} embedded onRoomChanged={onRoomChanged} />);

    // 初期表示：確定前なのでまとめシートへのボタンはない
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.queryByRole("link", { name: /まとめシートで確認・印刷する/ })).toBeNull();

    // 「このプランで確定する」をクリック
    const confirmButton = screen.getByRole("button", { name: "このプランで確定する" });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockConfirmPlan).toHaveBeenCalledWith("test-room", 1);
    });

    // 確定後：まとめシートへの明示的なリンクが表示される（ページ全体で確定カード内の1つだけ）
    await waitFor(() => {
      const summaryLinks = screen.getAllByRole("link", { name: /まとめシートで確認・印刷する/ });
      expect(summaryLinks).toHaveLength(1);
      expect(summaryLinks[0].getAttribute("href")).toBe("/rooms/test-room/summary");
    });

    // 緑バナーは「プランを確定しました」のみで、リンクを含まない
    const statusBanners = screen.getAllByRole("status");
    const confirmationBanner = statusBanners.find((el) => el.textContent?.includes("プランを確定しました"));
    expect(confirmationBanner).toBeTruthy();
    expect(confirmationBanner?.textContent).not.toContain("まとめシートで確認・印刷ができます");
    expect(within(confirmationBanner!).queryByRole("link")).toBeNull();

    expect(onRoomChanged).toHaveBeenCalledOnce();
  });

  it("上部と下部の両方に代替案取得ボタンがあり、取得処理とローディング表示が揃っている", async () => {
    let currentSnap = initialSnapshot;
    const loadSnapshot = vi.fn(async () => currentSnap);

    render(<ProposalsClient roomId="test-room" loadSnapshot={loadSnapshot} />);

    await screen.findByRole("heading", { name: "現在のプランの状態" });

    // 上部と下部の両方にボタンが存在する
    const buttons = screen.getAllByRole("button", { name: "代替案を取得する" });
    expect(buttons).toHaveLength(2);

    // 下部ボタンをクリックしても同じように取得処理が動き、両方のボタンがローディング表示になる
    fireEvent.click(buttons[1]);

    await waitFor(() => {
      const loadingButtons = screen.getAllByRole("button", { name: "代替案を取得中…" });
      expect(loadingButtons).toHaveLength(2);
      expect(loadingButtons[0].getAttribute("disabled")).not.toBeNull();
      expect(loadingButtons[1].getAttribute("disabled")).not.toBeNull();
    });

    // 取得完了後に採用ボタンが表示される（上部・下部で2つ）
    const applyButtons = await screen.findAllByRole("button", { name: "採用する" });
    expect(applyButtons).toHaveLength(2);
  });
});
