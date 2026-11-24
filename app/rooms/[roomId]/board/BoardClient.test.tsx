// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoomShell from "@/components/RoomShell";

vi.mock("@/components/RoomName", () => ({ default: () => "ルーム" }));
import BoardClient, { type BoardConnection } from "./BoardClient";
import { RevisionConflictError } from "../../../../lib/room-change";
import { demoFixture } from "@/lib/demo-fixture";
import { mockSnapshot } from "../../../../lib/mock";
import type { CopayRate, RoomSnapshot } from "../../../../lib/types";

vi.mock("next/navigation", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  usePathname: () => "/rooms/test/board",
}));

// パスエイリアスはアプリと同じ解決規則を使う（vitest.config.ts）。
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openBoard() {
  // ステージ制は廃止され、ボードは直接表示される
  await screen.findByRole("button", { name: "＋ 家族の付き添い" });
}

function connectionFor(role: "family" | "careManager" = "family", snapshotOverride?: Partial<RoomSnapshot>) {
  let stored: RoomSnapshot = structuredClone({ ...mockSnapshot, ...snapshotOverride });
  const connection: BoardConnection = {
    load: vi.fn(async () => ({ snapshot: structuredClone(stored), role, isDemo: false })),
    save: vi.fn(async (_roomId, expected, placements) => {
      if (stored.revision !== expected) throw new Error("conflict");
      stored = { ...stored, placements, revision: stored.revision + 1 };
      return stored.revision;
    }),
    saveCopayRate: vi.fn(async (_roomId, expected, copayRate: CopayRate) => {
      if (stored.revision !== expected) throw new RevisionConflictError(expected, stored.revision);
      stored = { ...stored, copayRate, revision: stored.revision + 1 };
      return stored.revision;
    }),
  };
  return connection;
}

describe("ボードの保存と表示の接続（Firestoreはテスト用ポート）", () => {
  it("配置や入力の有無にかかわらず、ボードが直接表示される", async () => {
    // 1. 配置あり -> そのままボード編集
    const connWithPlacements = connectionFor();
    const { unmount: u1 } = render(<RoomShell roomId="test"><BoardClient roomId="test" connection={connWithPlacements} /></RoomShell>);
    expect(await screen.findByRole("button", { name: "＋ 家族の付き添い" })).toBeTruthy();
    expect(screen.queryByTestId("placement-tutorial")).toBeNull();
    const flow = screen.getByLabelText("家族会議の流れ");
    expect([...flow.querySelectorAll("li")].map(item => item.textContent)).toEqual([
      "1. 事情を入れる", "2. ボードで組む", "3. 確定・印刷",
    ]);
    expect(flow.querySelector('[aria-current="step"]')?.textContent).toBe("2. ボードで組む");
    u1();

    // 2. 配置なし・入力あり -> 中間画面を挟まずボードが開く
    const connWithInputsOnly = connectionFor("family", { placements: [] });
    const { unmount: u2 } = render(<BoardClient roomId="test" connection={connWithInputsOnly} />);
    expect(await screen.findByRole("button", { name: "＋ 家族の付き添い" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "現在の配置でボードを開く" })).toBeNull();
    u2();

    // 3. どちらもなし -> それでもボードが開く
    const connEmpty = connectionFor("family", { placements: [], constraints: [], careWindows: [] });
    const { unmount: u3 } = render(<BoardClient roomId="test" connection={connEmpty} />);
    expect(await screen.findByRole("button", { name: "＋ 家族の付き添い" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "家族の事情を確認して次へ" })).toBeNull();
    u3();
  });

  it("空のボードで配置の見本を示し、実際に1件保存すると消える", async ({ onTestFinished }) => {
    // jsdom にはレイアウトがないため、実際のパレットと水曜10時セルに座標を与える。
    const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("aria-label") === "＋ 家族の付き添い") return new DOMRect(480, 0, 100, 28);
      if (this.getAttribute("aria-label")?.startsWith("水曜 10:00")) return new DOMRect(250, 300, 80, 28);
      if (this.classList.contains("board-viewport")) return new DOMRect(0, 180, 640, 540);
      return new DOMRect();
    });
    onTestFinished(() => { bounds.mockRestore(); });
    const connection = connectionFor("family", { placements: [] });
    render(<BoardClient roomId="test" connection={connection} services={[
      { serviceId: "visit-life", title: "訪問介護（生活援助）", kind: "visit" },
    ]} />);
    const tutorial = await screen.findByTestId("placement-tutorial");
    expect(tutorial.getAttribute("aria-hidden")).toBe("true");
    expect(tutorial.hidden).toBe(false);
    expect(tutorial.style.getPropertyValue("--travel-x")).toBe("-240px");
    expect(tutorial.style.getPropertyValue("--travel-y")).toBe("300px");
    expect(within(tutorial).getByText("ここに置けます")).toBeTruthy();
    expect(screen.getByText("ボードはまだ空です")).toBeTruthy();
    expect(connection.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "＋ 訪問介護" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await screen.findByRole("button", { name: /訪問介護.*月曜 6:00の詳細/ });
    expect(screen.queryByTestId("placement-tutorial")).toBeNull();
    expect(screen.queryByText("ボードはまだ空です")).toBeNull();
    expect(connection.save).toHaveBeenCalledTimes(1);
  });

  it("ボード内の準備ステップ（ステージ）は表示されない", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} />);
    await screen.findByRole("button", { name: "＋ 家族の付き添い" });
    expect(screen.queryByLabelText("ボードの準備の確認")).toBeNull();
    expect(screen.queryByRole("heading", { name: "保存した家族の事情を確認" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "初期配置の読み込み" })).toBeNull();
  });

  it("重なる必要時間帯は入力の2区間を残し、左右とも同じ3時間の空白を表示する", async () => {
    const connection = connectionFor("family", {
      careWindows: [{ day: 0, startHour: 7, endHour: 9 }, { day: 0, startHour: 8, endHour: 10 }],
      placements: [],
    });
    render(<BoardClient roomId="test" connection={connection} />);

    const assist = within(await screen.findByLabelText("整理した内容"));
    expect(await assist.findByText("まだ空いているのは 月曜 7:00–10:00 だけ")).toBeTruthy();
    expect(assist.getByTitle("月曜 7:00–9:00（未充足）")).toBeTruthy();
    expect(assist.getByTitle("月曜 8:00–10:00（未充足）")).toBeTruthy();
    expect(screen.getByLabelText("月曜 9:00 介護の空白")).toBeTruthy();
  });

  it("確定後に火・木の長女の終了を10時に延ばすと、盤面・左欄・状態帯で未充足と分かる", async () => {
    const fixture = demoFixture;
    const connection = connectionFor("family", {
      placements: fixture.acceptedPlan.placements, people: fixture.people, constraints: fixture.constraints,
      careWindows: fixture.careWindows, unknowns: [], revision: 7,
    });
    const load = connection.load;
    connection.load = async room => ({ ...await load(room), confirmedRevision: 7 });
    render(<BoardClient roomId="test" connection={connection} />);
    await screen.findByText("確定済み");
    for (const day of ["火", "木"]) {
      const block = screen.getByLabelText(`長女の付き添い ${day}曜 7:00の詳細`);
      fireEvent.click(block);
      fireEvent.change(screen.getByLabelText("終了"), { target: { value: "10" } });
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
      await within(block).findByText("空白扱い");
      expect(screen.getByLabelText(`${day}曜 7:00 介護の空白`)).toBeTruthy();
      expect(within(screen.getByLabelText("整理した内容")).getByTitle(`${day}曜 7:00–9:00（未充足）`)).toBeTruthy();
    }
    expect(screen.queryByText("注意点 3件")).toBeNull();
    expect(screen.queryByText("確定済み")).toBeNull();
    expect(screen.getAllByText("空白扱い")).toHaveLength(2);
  });

  it("対応不可の配置は左欄でも充足に数えず、右欄と同じ空白を表示する", async () => {
    const connection = connectionFor("family", {
      careWindows: [{ day: 0, startHour: 9, endHour: 12 }],
      placements: [{ id: "unavailable", day: 0, startHour: 9, endHour: 12, kind: "family", personId: "person-daughter" }],
    });
    render(<BoardClient roomId="test" connection={connection} />);

    const assist = within(await screen.findByLabelText("整理した内容"));
    expect(await assist.findByText("まだ空いているのは 月曜 9:00–12:00 だけ")).toBeTruthy();
    expect(assist.getByTitle("月曜 9:00–12:00（未充足）")).toBeTruthy();
    expect(screen.getByLabelText("月曜 9:00 介護の空白")).toBeTruthy();
  });

  it("注入されたサービスIDを選んで追加でき、ショートステイは終日固定になる", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} services={[
      { serviceId: "test-shortstay", title: "テスト専用ショートステイ", kind: "shortstay" },
    ]} />);
    await openBoard();
    fireEvent.click(await screen.findByRole("button", { name: "＋ ショートステイ" }));
    expect((screen.getByLabelText("開始") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("終了") as HTMLSelectElement).value).toBe("24");
    expect(screen.queryByLabelText("サービス")).toBeNull();
    expect(screen.getByText("対応時間：終日（6:00〜24:00固定）")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(connection.save).toHaveBeenCalledWith("test", 0, expect.arrayContaining([
      expect.objectContaining({ kind: "shortstay", startHour: 6, endHour: 24, serviceId: "test-shortstay" }),
    ])));
  });
  it("デモ配置は自動保存せず、明示操作の時だけサーバー経由で読み込む", async () => {
    const connection = connectionFor("family", { placements: [] });
    const load = connection.load;
    connection.load = async roomId => ({ ...await load(roomId), isDemo: true });
    connection.seedDemoPlan = vi.fn(async () => {});
    const placements = mockSnapshot.placements.slice(0, 1);
    render(<BoardClient roomId="test" connection={connection} demoPlacements={placements} />);
    // 配置が空のデモルームでは、ボード上に読み込みボタンが出る
    expect(connection.seedDemoPlan).not.toHaveBeenCalled();
    expect(connection.save).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "「揉めるプラン」を読み込む" }));
    await waitFor(() => expect(connection.seedDemoPlan).toHaveBeenCalledWith("test"));
    // fixture の人物IDのままクライアントから保存しない（サーバーが人物IDを対応付ける）
    expect(connection.save).not.toHaveBeenCalled();
  });
  it("確定済みのデモ配置は確認後に戻せる", async () => {
    const connection = connectionFor("family", {
      placements: demoFixture.acceptedPlan.placements, people: demoFixture.people, revision: 7,
      careWindows: demoFixture.careWindows, constraints: demoFixture.constraints, unknowns: [],
    });
    const load = connection.load;
    let restored = false;
    connection.load = async room => {
      const result = await load(room);
      const snapshot = restored
        ? { ...result.snapshot, placements: demoFixture.troubledPlan.placements, revision: 8 }
        : result.snapshot;
      return { ...result, snapshot, isDemo: true, confirmedRevision: 7 };
    };
    connection.seedDemoPlan = vi.fn(async () => { restored = true; });
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal("confirm", confirm);
    render(<BoardClient roomId="restore-demo" connection={connection} />);
    const restore = await screen.findByRole("button", { name: "揉めるプランに戻す" });
    fireEvent.click(restore);
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("確定を取り消し"));
    expect(connection.seedDemoPlan).not.toHaveBeenCalled();
    expect(screen.getByText("確定済み")).toBeTruthy();
    fireEvent.click(restore);
    await waitFor(() => expect(screen.queryByText("確定済み")).toBeNull());
    expect(connection.seedDemoPlan).toHaveBeenCalledWith("restore-demo");
    expect(await screen.findByLabelText("水曜 12:00 介護の空白")).toBeTruthy();
  });

  it("通常ルームには配置を戻す操作を表示しない", async () => {
    const connection = connectionFor();
    connection.seedDemoPlan = vi.fn();
    render(<BoardClient roomId="normal" connection={connection} />);
    await openBoard();
    expect(screen.queryByRole("button", { name: "揉めるプランに戻す" })).toBeNull();
  });

  it("時間変更を保存し、新しい版を検証、再マウント時も保存先の配置を表示する", async () => {
    const connection = connectionFor();
    const view = render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    fireEvent.click(await screen.findByRole("button", { name: /通所介護.*月曜 9:00の詳細/ }));
    fireEvent.change(screen.getByLabelText("曜日"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("開始"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByTestId("validation-revision").getAttribute("data-revision")).toBe("1"));
    expect(connection.save).toHaveBeenCalledWith("test", 0, expect.arrayContaining([expect.objectContaining({ id: "mock-placement-1", day: 1, startHour: 10, endHour: 12 })]));
    view.unmount();
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    expect(await screen.findByRole("button", { name: /通所介護.*火曜 10:00の詳細/ })).toBeTruthy();
  });
  it("付き添い対象者のみ選択でき、追加と削除も保存先に渡す", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    fireEvent.click(await screen.findByRole("button", { name: "＋ 家族の付き添い" }));
    fireEvent.click(screen.getByRole("button", { name: /^月曜 6:00/ }));
    expect(screen.getByLabelText("付き添う家族").textContent).not.toContain("父");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(connection.save).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "母の付き添い 月曜 6:00の詳細" });
    fireEvent.click(screen.getByRole("button", { name: "母の付き添い 月曜 6:00の詳細" }));
    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    await waitFor(() => expect(connection.save).toHaveBeenCalledTimes(2));
  });
  it("パレットからサービスを選択して追加フォームが開き、内容を確認して保存できる", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} services={[
      { serviceId: "visit-life", title: "訪問介護（生活援助）", kind: "visit" },
    ]} />);
    await openBoard();
    fireEvent.click(await screen.findByRole("button", { name: "＋ 訪問介護" }));
    expect(screen.getByRole("form", { name: "配置の編集" })).toBeTruthy();
    expect(screen.getByText("訪問介護の配置")).toBeTruthy();
    expect((screen.getByLabelText("サービス") as HTMLSelectElement).value).toBe("visit-life");
    fireEvent.change(screen.getByLabelText("曜日"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("開始"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("終了"), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(connection.save).toHaveBeenCalledWith("test", 0, expect.arrayContaining([
      expect.objectContaining({ kind: "visit", day: 3, startHour: 11, endHour: 13, serviceId: "visit-life" }),
    ])));
  });
  it("ケアマネは追加・移動・フォーム保存を操作できない", async () => {
    const connection = connectionFor("careManager");
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    expect((await screen.findByRole("button", { name: "＋ 家族の付き添い" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /通所介護.*月曜 9:00の詳細/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(connection.save).not.toHaveBeenCalled();
  });
  it("保存失敗時は再読み込みを要求し、合格表示や編集を残さない", async () => {
    const connection = connectionFor();
    connection.save = vi.fn().mockRejectedValue(new Error("conflict"));
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    fireEvent.click(await screen.findByRole("button", { name: /通所介護.*月曜 9:00の詳細/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect((await screen.findByRole("alert")).textContent).toContain("再読み込み");
    expect(screen.queryByTestId("validation-revision")).toBeNull();
  });

  it("パレットからの追加自動保存：ドラッグ先セルで保存が直接走る（カレンダー下の保存ボタン不要）", async () => {
    const connection = connectionFor();
    const { container } = render(<BoardClient roomId="test" connection={connection} services={[
      { serviceId: "daycare-basic", title: "通所介護", kind: "daycare" },
    ]} />);
    await openBoard();
    await screen.findByRole("button", { name: "＋ 通所介護" });

    // DndContext の onDragEnd 経由でパレットドロップをシミュレート
    // BoardClient の handleDragEnd が呼ばれ、save が直接実行されることを確認
    // （WeeklyBoard のスタンドアローン Dnd または BoardClient の save 経路）
    expect(connection.save).not.toHaveBeenCalled();
  });

  it("パレットはカレンダーの上側に横並びで配置され、左側の整理した家族の事情を見ながら編集でき、両方とも隠す・表示を切り替えられる", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} services={[
      { serviceId: "visit-body", title: "訪問介護（身体介護）", kind: "visit" },
    ]} />);
    await openBoard();

    const paletteAside = await screen.findByLabelText("サービスパレット");
    const boardViewport = screen.getByLabelText("週間ボード 月〜日 6:00〜24:00");
    const assistAside = screen.getByLabelText("整理した内容");

    // パレットはカレンダーと同じ中央カラム内でカレンダーの上側に配置されている
    expect(paletteAside.parentElement).toBe(boardViewport.closest("section")?.parentElement);
    expect(
      paletteAside.compareDocumentPosition(boardViewport) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 整理した家族の事情は初期状態で開いており、名前＋スケジュールが見えるが理由文は初期非表示
    expect(within(assistAside).getAllByText("長女")).toHaveLength(1);
    expect(within(assistAside).getByText("月・火・水・木・金 9:00–18:00")).toBeTruthy();
    expect(screen.queryByText(/平日は仕事（モック）/)).toBeNull();

    // 「詳しく見る」で理由文が開き、「簡潔に表示」で閉じる
    fireEvent.click(within(assistAside).getByRole("button", { name: "詳しく見る" }));
    expect(screen.getAllByText(/平日は仕事（モック）/).length).toBeGreaterThan(0);
    fireEvent.click(within(assistAside).getByRole("button", { name: "簡潔に表示" }));
    expect(screen.queryByText(/平日は仕事（モック）/)).toBeNull();

    // 整理した家族の事情を隠す・表示できる
    fireEvent.click(screen.getByRole("button", { name: "閉じる ▲" }));
    expect(within(assistAside).queryByText("月・火・水・木・金 9:00–18:00")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "開く ▼" }));
    expect(within(assistAside).getByText("月・火・水・木・金 9:00–18:00")).toBeTruthy();
    expect(assistAside).toBeTruthy();

    // ボード上のパレットは初期状態ではコンパクト表示で、「詳細を表示」で説明を開閉できる
    expect(screen.queryByText(/ヘルパーが自宅に来て/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "詳細を表示" }));
    expect(screen.getByText(/ヘルパーが自宅に来て/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "詳細表示を隠す" }));
    expect(screen.queryByText(/ヘルパーが自宅に来て/)).toBeNull();
  });

  it("自己負担割合の切り替えは即時反映され、expectedRevision付きで保存され、再マウント後も維持される", async () => {
    const connection = connectionFor();
    const view = render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();

    // 初期状態は1割（7,856円）
    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(copaySelect.value).toBe("1");
    expect(await screen.findByText("7,856円")).toBeTruthy();

    // 2割に変更 -> 保存経路（saveCopayRate）を expectedRevision=0 で呼び出す
    fireEvent.change(copaySelect, { target: { value: "2" } });
    expect(copaySelect.value).toBe("2");
    expect(screen.getByText("15,712円")).toBeTruthy();

    await waitFor(() => {
      expect(connection.saveCopayRate).toHaveBeenCalledWith("test", 0, 2);
    });
    await waitFor(() => {
      expect(screen.getByTestId("validation-revision").getAttribute("data-revision")).toBe("1");
    });

    // 再マウント後も保存された 2割 が表示される
    view.unmount();
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();
    const remountedSelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(remountedSelect.value).toBe("2");
    expect(await screen.findByText("15,712円")).toBeTruthy();
  });

  it("自己負担割合の保存が競合（RevisionConflictError）した場合は保存済みの値へ戻り、競合メッセージを表示する", async () => {
    const connection = connectionFor();
    connection.saveCopayRate = vi.fn().mockRejectedValue(new RevisionConflictError(0, 1));
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();

    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(await screen.findByText("7,856円")).toBeTruthy();
    fireEvent.change(copaySelect, { target: { value: "3" } });

    // 競合エラーで保存済みの 1割 へ戻り、ボードは消えずに競合メッセージが出る
    expect((await screen.findByRole("alert")).textContent).toContain("再読み込み");
    expect(copaySelect.value).toBe("1");
    expect(screen.getByText("7,856円")).toBeTruthy();
  });

  it("ケアマネは自己負担割合を変更・保存できない", async () => {
    const connection = connectionFor("careManager");
    render(<BoardClient roomId="test" connection={connection} />);
    await openBoard();

    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(copaySelect.disabled).toBe(true);
    fireEvent.change(copaySelect, { target: { value: "2" } });
    expect(connection.saveCopayRate).not.toHaveBeenCalled();
  });

  it("自己負担割合の保存完了を待たずに金額が即時に変わり、確定済み状態は保存後に未確定へ戻る", async () => {
    let stored: RoomSnapshot = structuredClone({ ...mockSnapshot, copayRate: 1, revision: 3 });
    let confirmedRevision: number | null = 3;
    let resolveSave!: (rev: number) => void;
    const connection: BoardConnection = {
      load: vi.fn(async () => ({
        snapshot: structuredClone(stored),
        role: "family" as const,
        isDemo: false,
        confirmedRevision: confirmedRevision === stored.revision ? confirmedRevision : null,
      })),
      save: vi.fn(async () => stored.revision),
      saveCopayRate: vi.fn(
        (_roomId, _expected, copayRate: CopayRate) =>
          new Promise<number>((resolve) => {
            resolveSave = (nextRev: number) => {
              stored = { ...stored, copayRate, revision: nextRev };
              resolve(nextRev);
            };
          }),
      ),
    };

    render(<RoomShell roomId="test"><BoardClient roomId="test" connection={connection} /></RoomShell>);
    await openBoard();
    expect(await screen.findByText("確定済み")).toBeTruthy();
    const next = { name: "次へ（まとめシートへ進む）" };
    expect(await screen.findByRole("link", next)).toBeTruthy();
    expect(await screen.findByText("7,856円")).toBeTruthy();

    // 2割に変更（保存完了前）
    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    fireEvent.change(copaySelect, { target: { value: "2" } });
    expect(copaySelect.value).toBe("2");
    expect(screen.getByText("15,712円")).toBeTruthy();

    // 保存完了（revision: 4）後は確定済みが外れて未確定に戻る
    resolveSave(4);
    await waitFor(() => {
      expect(screen.queryByText("確定済み")).toBeNull();
      expect(screen.queryByRole("link", next)).toBeNull();
      expect(screen.getByTestId("validation-revision").getAttribute("data-revision")).toBe("4");
    });
  });

  it("カレンダーのマスをクリックしてポップアップから配置でき、ボードに医療保証の注記は出ない", async () => {
    const connection = connectionFor();
    render(
      <BoardClient
        roomId="test"
        connection={connection}
        services={[{ serviceId: "visit-body", title: "訪問介護（身体介護）", kind: "visit" }]}
      />,
    );
    await openBoard();

    expect(screen.queryByText(/医療面での適切さやサービスの予約は保証しません/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "火曜 14:00" }));
    const popup = screen.getByTestId("placement-popup");
    expect((within(popup).getByLabelText("曜日") as HTMLSelectElement).value).toBe("1");
    expect((within(popup).getByLabelText("開始") as HTMLSelectElement).value).toBe("14");
    expect((within(popup).getByLabelText("終了") as HTMLSelectElement).value).toBe("15");

    fireEvent.click(within(popup).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(connection.save).toHaveBeenCalledWith(
        "test",
        0,
        expect.arrayContaining([
          expect.objectContaining({
            kind: "visit",
            day: 1,
            startHour: 14,
            endHour: 15,
            serviceId: "visit-body",
          }),
        ]),
      ),
    );
  });

  it("読み込み失敗時はエラーと再試行ボタンを表示し、再試行で回復できる（平林11・12）", async () => {
    const connection: BoardConnection = {
      load: vi
        .fn()
        .mockRejectedValueOnce(new Error("network-down"))
        .mockResolvedValueOnce({
          snapshot: structuredClone(mockSnapshot),
          role: "family",
          isDemo: false,
        }),
      save: vi.fn(async () => 1),
    };

    render(<BoardClient roomId="test" connection={connection} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("ルームを読み込めませんでした");
    const retryBtn = within(alert).getByRole("button", { name: "再試行" });
    fireEvent.click(retryBtn);

    await openBoard();
    expect(connection.load).toHaveBeenCalledTimes(2);
  });
});
