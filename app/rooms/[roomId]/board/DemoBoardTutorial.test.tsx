// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardClient, { type BoardConnection } from "./BoardClient";
import { ROW_HEIGHT } from "./WeeklyBoard";
import {
  clearDemoBoardTutorialDone,
  DEMO_BOARD_TUTORIAL_STEPS,
  DEMO_TRIAL_PLACEMENT_ID,
  isDemoBoardTutorialDone,
} from "@/lib/demo-board-tutorial";
import { demoFixture } from "@/lib/demo-fixture";
import { buildDemoProposal } from "@/lib/demo/logic";
import { mapConstraints, mapPeople, mapPlacements } from "@/lib/demo/mapping";
import { matchDemoSnapshot } from "@/lib/demo/match";
import type { PersonMapping } from "@/lib/demo/types";
import {
  clearDemoInputTutorialDone,
  markDemoInputTutorialDone,
} from "@/lib/demo-input-tutorial";
import type { MemberRole, Placement, RoomSnapshot } from "@/lib/types";

vi.mock("@/components/RoomName", () => ({ default: () => "デモルーム（佐藤家）" }));

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, { bubbles: true, cancelable: true, ...init });
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
  }
}

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

function createConnection(options: {
  isDemo: boolean;
  role?: MemberRole;
  snapshot?: Partial<RoomSnapshot>;
}) {
  let stored: RoomSnapshot = structuredClone({
    ...demoSnapshot,
    ...options.snapshot,
  });
  const savedSnapshots: RoomSnapshot[] = [];
  const connection: BoardConnection = {
    load: vi.fn(async () => ({
      snapshot: structuredClone(stored),
      role: options.role ?? "family",
      isDemo: options.isDemo,
    })),
    save: vi.fn(async (_roomId, expected, placements: Placement[]) => {
      if (stored.revision !== expected) throw new Error("conflict");
      stored = {
        ...stored,
        placements: structuredClone(placements),
        revision: stored.revision + 1,
      };
      savedSnapshots.push(structuredClone(stored));
      return stored.revision;
    }),
    saveCopayRate: vi.fn(async () => stored.revision + 1),
    confirm: vi.fn(async () => ({ confirmedRevision: stored.revision })),
  };
  return {
    connection,
    getStored: () => structuredClone(stored),
    getSavedSnapshots: () => savedSnapshots,
  };
}

function mockBoardDragGeometry(container: HTMLElement) {
  const familyBtn = container.querySelector<HTMLElement>(
    'button[aria-label="＋ 家族の付き添い"]',
  );
  if (familyBtn) {
    vi.spyOn(familyBtn, "getBoundingClientRect").mockReturnValue(
      new DOMRect(350, 100, 110, 36),
    );
  }
  const dayColumns = container.querySelectorAll<HTMLElement>("[data-board-day]");
  dayColumns.forEach((col, index) => {
    const left = 48 + index * 100;
    vi.spyOn(col, "getBoundingClientRect").mockReturnValue(
      new DOMRect(left, 200, 100, 18 * ROW_HEIGHT),
    );
  });
}

describe("デモルーム専用チュートリアル（週間ボード）", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearDemoBoardTutorialDone();
    clearDemoInputTutorialDone();
    stubMatchMedia(true);
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    clearDemoBoardTutorialDone();
    clearDemoInputTutorialDone();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    global.fetch = originalFetch;
  });

  it("通常ルーム（isDemo=false）ではチュートリアルを表示しない", async () => {
    const { connection } = createConnection({ isDemo: false });
    render(<BoardClient roomId="normal-board-1" connection={connection} />);

    await screen.findByLabelText("週間ボード 月〜日 6:00〜24:00");

    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(screen.queryByTestId("demo-board-tutorial-exit-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "案内を終わる" })).toBeNull();
  });

  it("ケアマネ（閲覧のみ）ではデモルームでもチュートリアルを表示しない", async () => {
    const { connection } = createConnection({ isDemo: true, role: "careManager" });
    render(<BoardClient roomId="demo-board-cm" connection={connection} />);

    await screen.findByLabelText("週間ボード 月〜日 6:00〜24:00");

    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "案内を終わる" })).toBeNull();
  });

  it("土曜の体験配置を正規化保存し、代替案を開く直前で終了すると再表示しない", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { connection, getStored } = createConnection({ isDemo: true, role: "family" });
    const { container, unmount } = render(
      <BoardClient roomId="demo-board-wide" connection={connection} />,
    );

    const dialog = await screen.findByTestId("demo-board-tutorial-dialog");
    expect(screen.getByRole("button", { name: "案内を終わる" })).toBeTruthy();

    // ステップ 1：家族の事情（この時点では土曜 8:00〜12:00 長女の付き添い1件が抜けた状態）
    expect(dialog.getAttribute("data-tutorial-step")).toBe("1");
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("family-assist");
    expect(dialog.textContent).toContain(`デモ案内 1 / ${DEMO_BOARD_TUTORIAL_STEPS.length}`);
    expect(screen.queryByRole("button", { name: "戻る" })).toBeNull();
    expect(
      document.querySelector('[data-board-tutorial-target="family-assist"]'),
    ).toBeTruthy();

    // 1件抜かれた状態：長女は23時間、土曜 8:00〜12:00 はボード上に無く空きになっている
    const metricsCard = screen.getByRole("region", { name: "単位数・自己負担・家族の負担" });
    await waitFor(() => {
      expect(within(metricsCard).getByText("23時間")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /長女の付き添い 土曜 8:00の詳細/ })).toBeNull();
    expect(connection.save).not.toHaveBeenCalled();

    // ステップ 2：配置を1件だけ体験（手動「次へ」は出ない）
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("place-trial");
    const instruction = "「＋ 家族の付き添い」を土曜 8:00〜12:00 の点線枠へドラッグするか、枠をタップしてください。開いた画面で長女と時間を確認し、保存しましょう。";
    const description = document.getElementById(dialog.getAttribute("aria-describedby")!);
    expect(description?.textContent).toBe(instruction);
    expect(Array.from(description!.querySelectorAll("strong"), (el) => el.textContent)).toEqual([
      "ドラッグするか、枠をタップしてください",
      "保存しましょう",
    ]);
    expect(within(dialog).getByRole("status").textContent).toBe(`予定を1件だけ入れてみる。${instruction}`);
    expect(screen.queryByRole("button", { name: "次へ" })).toBeNull();
    expect(screen.getByTestId("demo-trial-target-slot")).toBeTruthy();
    expect(
      document.querySelector('[data-board-tutorial-target="palette-family"]'),
    ).toBeTruthy();

    // 対象外マスへのクリックは拒否され保存されない
    fireEvent.click(screen.getByRole("button", { name: "月曜 10:00" }));
    expect(screen.queryByTestId("placement-popup")).toBeNull();
    expect(within(dialog).getByRole("alert").textContent).toContain("土曜 8:00〜12:00");
    expect(connection.save).not.toHaveBeenCalled();

    // 対象外マス（月曜 10:00）へのドラッグドロップも拒否され保存されない
    mockBoardDragGeometry(container);
    const familyBtn = screen.getByRole("button", { name: "＋ 家族の付き添い" });
    await act(async () => {
      fireEvent.pointerDown(familyBtn, {
        pointerId: 1,
        button: 0,
        pointerType: "mouse",
        clientX: 400,
        clientY: 118,
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerMove(document, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 400,
        clientY: 126,
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerMove(document, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 98, // day 0 (left=48..148)
        clientY: 320, // 10:00 (200 + 4*28 + 8)
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerUp(document, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 98,
        clientY: 320,
        isPrimary: true,
      });
    });
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");
    expect(connection.save).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert").textContent).toContain("土曜 8:00〜12:00");

    // 対象マス（土曜 9:00 = 土曜 8:00〜12:00 の点線枠内）へドラッグドロップすると正規化保存してステップ 3 へ進む
    await act(async () => {
      fireEvent.pointerDown(familyBtn, {
        pointerId: 2,
        button: 0,
        pointerType: "mouse",
        clientX: 400,
        clientY: 118,
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerMove(document, {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 400,
        clientY: 126,
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerMove(document, {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 598, // day 5 (left=48 + 5*100 = 548..648)
        clientY: 298, // 9:00 (200 + 3*28 + 14)
        isPrimary: true,
      });
    });
    await act(async () => {
      fireEvent.pointerUp(document, {
        pointerId: 2,
        pointerType: "mouse",
        clientX: 598,
        clientY: 298,
        isPrimary: true,
      });
    });

    expect(connection.save).not.toHaveBeenCalled();
    expect(dialog.dataset.tutorialStep).toBe("2");
    fireEvent.click(within(await screen.findByTestId("placement-popup")).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    });
    expect(connection.save).toHaveBeenCalledTimes(1);
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("money");
    expect(getStored().placements).toEqual(demoFixture.troubledPlan.placements);

    // 完成形の数字（左列カード）が反映される
    await waitFor(() => {
      expect(within(metricsCard).getByText("28,131単位")).toBeTruthy();
      expect(within(metricsCard).getByText("27時間")).toBeTruthy();
    });

    // 戻るボタンで体験済みステップ 2 に戻っても「次へ」で復帰できる
    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");
    expect(screen.getByRole("button", { name: "次へ" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    // ステップ 3 → 4 → 5
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("money");
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("4");
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("burden");

    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("5");
    expect(dialog.getAttribute("data-tutorial-step-id")).toBe("proposals");

    expect(screen.queryByRole("button", { name: "次へ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(isDemoBoardTutorialDone("demo-board-wide")).toBe(true);

    // 体験ステップ以外の保存・確定・外部APIは呼ばないこと
    expect(connection.save).toHaveBeenCalledTimes(1);
    expect(connection.saveCopayRate).not.toHaveBeenCalled();
    expect(connection.confirm).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    // 再表示してもチュートリアルは出ない
    unmount();
    render(<BoardClient roomId="demo-board-wide" connection={connection} />);
    await screen.findByLabelText("週間ボード 月〜日 6:00〜24:00");
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
  });

  it("人物IDマッピング付きデモルームで体験配置（枠タップ→保存）を完了すると、保存後スナップショットが matchDemoSnapshot と固定代替案生成に完全一致する", async () => {
    stubMatchMedia(false); // モバイル／タップ経路
    const personMapping: PersonMapping = {
      "person-father": "uuid-father",
      "person-mother": "uuid-mother",
      "person-daughter": "uuid-daughter",
      "person-son": "uuid-son",
    };
    const mappedSnapshot: RoomSnapshot = {
      people: mapPeople(demoFixture.people, personMapping),
      placements: mapPlacements(demoFixture.troubledPlan.placements, personMapping),
      constraints: mapConstraints(demoFixture.constraints, personMapping),
      hopes: [...demoFixture.hopes],
      unknowns: [...demoFixture.unknowns],
      careWindows: [...demoFixture.careWindows],
      copayRate: demoFixture.copayRate,
      revision: 0,
    };

    const { connection, getStored } = createConnection({
      isDemo: true,
      role: "family",
      snapshot: mappedSnapshot,
    });

    render(<BoardClient roomId="demo-board-mapped" connection={connection} />);
    const dialog = await screen.findByTestId("demo-board-tutorial-dialog");

    // Step 1 -> Step 2
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");

    // 対象セル（土曜 9:00）をタップすると土曜 8:00〜12:00 長女 でポップアップが開く
    fireEvent.click(screen.getByRole("button", { name: /土曜 9:00/ }));
    const popup = screen.getByTestId("placement-popup");
    expect((within(popup).getByLabelText("曜日") as HTMLSelectElement).value).toBe("5");
    expect((within(popup).getByLabelText("開始") as HTMLSelectElement).value).toBe("8");
    expect((within(popup).getByLabelText("終了") as HTMLSelectElement).value).toBe("12");
    expect((within(popup).getByLabelText("付き添う家族") as HTMLSelectElement).value).toBe(
      "uuid-daughter",
    );

    // 不正な時間帯（10:00〜12:00）に変えて保存すると拒否される
    fireEvent.change(within(popup).getByLabelText("開始"), { target: { value: "10" } });
    fireEvent.click(within(popup).getByRole("button", { name: "保存" }));
    expect(connection.save).not.toHaveBeenCalled();
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");

    // 正しい 8:00〜12:00 で保存すると fixture 完全一致で保存され Step 3 へ進む
    fireEvent.change(within(popup).getByLabelText("開始"), { target: { value: "8" } });
    fireEvent.click(within(popup).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    });

    const savedSnapshot = getStored();
    const demoMeta = {
      isDemo: true,
      fixtureVersion: demoFixture.fixtureVersion,
      personMapping,
    };
    expect(savedSnapshot.placements.find(p => p.id === DEMO_TRIAL_PLACEMENT_ID)).toEqual({
      id: DEMO_TRIAL_PLACEMENT_ID,
      day: 5,
      startHour: 8,
      endHour: 12,
      kind: "family",
      personId: "uuid-daughter",
      note: "土曜の午前は長女が担当",
    });
    expect(matchDemoSnapshot(savedSnapshot, demoMeta)).toEqual({ matched: true });
    const proposal = buildDemoProposal(savedSnapshot, demoMeta);
    expect(proposal.demo).toBe(true);
    expect(proposal.validation.ok).toBe(true);
  });

  it("狭幅画面（matchMedia が非デスクトップ）でも全9ステップで操作ゲートがある", async () => {
    stubMatchMedia(false);
    const { connection } = createConnection({ isDemo: true, role: "family" });

    render(<BoardClient roomId="demo-board-narrow" connection={connection} />);

    const dialog = await screen.findByTestId("demo-board-tutorial-dialog");
    expect(dialog.textContent).toContain(`デモ案内 1 / ${DEMO_BOARD_TUTORIAL_STEPS.length}`);

    // Step 1 -> Step 2 -> タップ保存で Step 3 へ
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "土曜 8:00 介護の空白" }));
    fireEvent.click(within(screen.getByTestId("placement-popup")).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(dialog.getAttribute("data-tutorial-step")).toBe("3"));

    for (let i = 3; i < 5; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    }
    expect(dialog.getAttribute("data-tutorial-step")).toBe("5");
    expect(screen.queryByRole("button", { name: "次へ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(isDemoBoardTutorialDone("demo-board-narrow")).toBe(true);
  });

  it("実測幅で横スクロールが発生している場合（clientWidth < scrollWidth）も全9ステップになる", async () => {
    stubMatchMedia(true);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-board-tutorial-target") === "weekly-board" ? 500 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("data-board-tutorial-target") === "weekly-board" ? 840 : 0;
    });

    const { connection } = createConnection({ isDemo: true, role: "family" });
    render(<BoardClient roomId="demo-board-overflow" connection={connection} />);

    const dialog = await screen.findByTestId("demo-board-tutorial-dialog");
    await waitFor(() => {
      expect(dialog.textContent).toContain(`デモ案内 1 / ${DEMO_BOARD_TUTORIAL_STEPS.length}`);
    });
  });

  it("「案内を終わる」と Esc キーで途中終了でき、saveせずマスク解除して全24件表示へ戻り、同ルームでは再表示されない", async () => {
    const { connection } = createConnection({ isDemo: true, role: "family" });
    const { unmount } = render(
      <BoardClient roomId="demo-board-exit" connection={connection} />,
    );

    await screen.findByTestId("demo-board-tutorial-dialog");
    expect(screen.queryByRole("button", { name: /長女の付き添い 土曜 8:00の詳細/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));

    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(isDemoBoardTutorialDone("demo-board-exit")).toBe(true);
    expect(connection.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /長女の付き添い 土曜 8:00の詳細/ })).toBeTruthy();

    unmount();
    render(<BoardClient roomId="demo-board-exit" connection={connection} />);
    await screen.findByLabelText("週間ボード 月〜日 6:00〜24:00");
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "チュートリアルをもう一度見る" }));
    const replay = await screen.findByTestId("demo-board-tutorial-dialog");
    expect(replay.getAttribute("data-tutorial-step")).toBe("1");
    expect(isDemoBoardTutorialDone("demo-board-exit")).toBe(false);
    fireEvent.click(within(replay).getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "土曜 8:00 介護の空白" }));
    fireEvent.click(within(screen.getByTestId("placement-popup")).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(replay.getAttribute("data-tutorial-step")).toBe("3"));
    expect(connection.save).not.toHaveBeenCalled();
    cleanup();
    render(<BoardClient roomId="demo-board-exit" connection={connection} />);
    await screen.findByRole("button", { name: "チュートリアルをもう一度見る" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();

    // 別ルームでは初回表示され、Esc キーで終了できる
    cleanup();
    const { connection: conn2 } = createConnection({ isDemo: true, role: "family" });
    render(<BoardClient roomId="demo-board-esc" connection={conn2} />);
    await screen.findByTestId("demo-board-tutorial-dialog");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();
    expect(isDemoBoardTutorialDone("demo-board-esc")).toBe(true);
    expect(conn2.save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /長女の付き添い 土曜 8:00の詳細/ })).toBeTruthy();
  });

  it("体験用の配置が残っていないルームでもステップ1から見直せる", async () => {
    const { connection } = createConnection({
      isDemo: true,
      snapshot: { placements: demoSnapshot.placements.filter(p => p.id !== DEMO_TRIAL_PLACEMENT_ID) },
    });
    render(<BoardClient roomId="demo-edited" connection={connection} />);
    fireEvent.click(await screen.findByRole("button", { name: "チュートリアルをもう一度見る" }));
    const dialog = await screen.findByTestId("demo-board-tutorial-dialog");
    expect(dialog.dataset.tutorialStep).toBe("1");
    fireEvent.click(within(dialog).getByRole("button", { name: "次へ" }));
    expect(dialog.textContent).toContain("週間ボードで予定を確認");
    fireEvent.click(within(dialog).getByRole("button", { name: "次へ" }));
    expect(dialog.dataset.tutorialStep).toBe("3");
    expect(connection.save).not.toHaveBeenCalled();
  });

  it("入力チュートリアル完了済みでもボードチュートリアルは別キーで初回表示され、localStorage不可時もメモリフォールバックが効く", async () => {
    markDemoInputTutorialDone("demo-board-separate-key");

    const { connection: conn1 } = createConnection({ isDemo: true, role: "family" });
    const { unmount } = render(
      <BoardClient roomId="demo-board-separate-key" connection={conn1} />,
    );
    await screen.findByTestId("demo-board-tutorial-dialog");
    unmount();

    // localStorage が例外を投げる環境でもメモリ保持で完了判定・再表示抑止が機能する
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    const { connection: conn2 } = createConnection({ isDemo: true, role: "family" });
    const second = render(
      <BoardClient roomId="demo-board-memory-fallback" connection={conn2} />,
    );
    await screen.findByTestId("demo-board-tutorial-dialog");

    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    expect(isDemoBoardTutorialDone("demo-board-memory-fallback")).toBe(true);

    second.unmount();
    render(
      <BoardClient roomId="demo-board-memory-fallback" connection={conn2} />,
    );
    await screen.findByLabelText("週間ボード 月〜日 6:00〜24:00");
    expect(screen.queryByTestId("demo-board-tutorial-dialog")).toBeNull();

    expect(getItemSpy).toHaveBeenCalled();
    expect(setItemSpy).toHaveBeenCalled();
  });
});
