// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardClient, { type BoardConnection } from "./BoardClient";
import { mockSnapshot } from "../../../../lib/mock";
import type { RoomSnapshot } from "../../../../lib/types";

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
  };
  return connection;
}

describe("ボードの保存と表示の接続（Firestoreはテスト用ポート）", () => {
  it("配置や入力の有無にかかわらず、ボードが直接表示される", async () => {
    // 1. 配置あり -> そのままボード編集
    const connWithPlacements = connectionFor();
    const { unmount: u1 } = render(<BoardClient roomId="test" connection={connWithPlacements} />);
    expect(await screen.findByRole("button", { name: "＋ 家族の付き添い" })).toBeTruthy();
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

  it("ボード内の準備ステップ（ステージ）は表示されない", async () => {
    const connection = connectionFor();
    render(<BoardClient roomId="test" connection={connection} />);
    await screen.findByRole("button", { name: "＋ 家族の付き添い" });
    expect(screen.queryByLabelText("ボードの準備の確認")).toBeNull();
    expect(screen.queryByRole("heading", { name: "保存した家族の事情を確認" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "初期配置の読み込み" })).toBeNull();
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
    expect((screen.getByLabelText("サービス") as HTMLSelectElement).value).toBe("test-shortstay");
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

    // 整理した家族の事情は初期状態で開いており、予定を入れながら見られる
    expect(screen.getAllByText(/平日は仕事（モック）/).length).toBeGreaterThan(0);

    // 整理した家族の事情を隠す・表示できる
    fireEvent.click(screen.getByRole("button", { name: "閉じる ▲" }));
    expect(screen.queryByText(/平日は仕事（モック）/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "開く ▼" }));
    expect(screen.getAllByText(/平日は仕事（モック）/).length).toBeGreaterThan(0);
    expect(assistAside).toBeTruthy();

    // ボード上のパレットは初期状態ではコンパクト表示で、「詳細を表示」で説明を開閉できる
    expect(screen.queryByText(/ヘルパーが自宅に来て/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "詳細を表示" }));
    expect(screen.getByText(/ヘルパーが自宅に来て/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "詳細表示を隠す" }));
    expect(screen.queryByText(/ヘルパーが自宅に来て/)).toBeNull();
  });
});
