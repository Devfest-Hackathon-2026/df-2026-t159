// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyBoard, { ROW_HEIGHT } from "./WeeklyBoard";
import { mockSnapshot } from "@/lib/mock";
import * as board from "@/lib/board";

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
}
beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(canEdit = true, onSave = vi.fn(async () => true)) {
  render(<WeeklyBoard snapshot={mockSnapshot} canEdit={canEdit} saving={false} services={[]} validation={null} onSave={onSave} />);
  return onSave;
}
const block = () => screen.getByRole("button", { name: /通所介護.*月曜 .*の詳細/ });
const handle = (edge: "開始" | "終了") => screen.getByRole("button", { name: new RegExp(`通所介護.*月曜 .*の${edge}時刻を変更`) });
const pointer = (clientY: number) => ({ pointerId: 1, clientY, button: 0 });

describe("上下ハンドルからのリサイズ", () => {
  it("終了端の仮表示だけを追随させ、離した時だけ既存保存先へ渡す", async () => {
    const save = setup();
    const end = handle("終了");
    fireEvent.pointerDown(end, pointer(100));
    fireEvent.pointerMove(end, pointer(100 + ROW_HEIGHT * 2));
    expect(block().parentElement?.style.gridRow).toBe("4 / 9");
    expect(save).not.toHaveBeenCalled();
    fireEvent.pointerUp(end, pointer(100 + ROW_HEIGHT * 2));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "mock-placement-1", day: 0, startHour: 9, endHour: 14 })]));
    expect(screen.queryByRole("form")).toBeNull();
  });
  it("開始端は開始だけを変え、ハンドルのクリックだけでは編集や保存をしない", async () => {
    const save = setup();
    const start = handle("開始");
    fireEvent.pointerDown(start, pointer(100));
    fireEvent.pointerUp(start, pointer(100));
    fireEvent.click(start);
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).toBeNull();
    fireEvent.pointerDown(start, pointer(100));
    fireEvent.pointerMove(start, pointer(100 - ROW_HEIGHT));
    expect(block().parentElement?.style.gridRow).toBe("3 / 7");
    fireEvent.pointerUp(start, pointer(100 - ROW_HEIGHT));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ startHour: 8, endHour: 12 })]));
  });
  it("キャンセル・キャプチャ喪失・Escapeでは元に戻して保存しない", () => {
    const save = setup();
    for (const cancel of ["pointer", "capture", "escape"]) {
      const end = handle("終了");
      fireEvent.pointerDown(end, pointer(100));
      fireEvent.pointerMove(end, pointer(100 + ROW_HEIGHT));
      if (cancel === "pointer") fireEvent.pointerCancel(end, pointer(128));
      else if (cancel === "capture") fireEvent.lostPointerCapture(end, pointer(128));
      else fireEvent.keyDown(window, { key: "Escape" });
      expect(block().parentElement?.style.gridRow).toBe("4 / 7");
    }
    expect(save).not.toHaveBeenCalled();
  });
  it("既存入力検査が不正とした場合は保存せず、元の長さとエラーに戻る", async () => {
    vi.spyOn(board, "placementInputError").mockReturnValue("テスト用の配置エラー");
    const save = setup();
    const end = handle("終了");
    fireEvent.pointerDown(end, pointer(100));
    fireEvent.pointerMove(end, pointer(156));
    fireEvent.pointerUp(end, pointer(156));
    await waitFor(() => expect(block().parentElement?.style.gridRow).toBe("4 / 7"));
    expect(screen.getByRole("alert").textContent).toBe("テスト用の配置エラー");
    expect(save).not.toHaveBeenCalled();
  });
  it("保存先が失敗を返した場合も仮表示を残さない", async () => {
    setup(true, vi.fn(async () => false));
    const end = handle("終了");
    fireEvent.pointerDown(end, pointer(100));
    fireEvent.pointerMove(end, pointer(156));
    fireEvent.pointerUp(end, pointer(156));
    await waitFor(() => expect(block().parentElement?.style.gridRow).toBe("4 / 7"));
  });
  it("通常の重なりは保存を拒否する条件として追加しない", async () => {
    const save = vi.fn(async () => true);
    const snapshot = { ...mockSnapshot, constraints: [], placements: [
      { id: "family-1", day: 0 as const, startHour: 9, endHour: 12, kind: "family" as const, personId: "person-mother" },
      { id: "family-2", day: 0 as const, startHour: 13, endHour: 15, kind: "family" as const, personId: "person-mother" },
    ] };
    render(<WeeklyBoard snapshot={snapshot} canEdit saving={false} services={[]} validation={null} onSave={save} />);
    const end = screen.getByRole("button", { name: "母の付き添い 月曜 9:00の終了時刻を変更" });
    fireEvent.pointerDown(end, pointer(100));
    fireEvent.pointerMove(end, pointer(156));
    fireEvent.pointerUp(end, pointer(156));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "family-1", endHour: 14 })]));
  });
  it("ショートステイと閲覧者にはリサイズハンドルを出さない", () => {
    setup();
    expect(screen.queryByRole("button", { name: /ショートステイ.*時刻を変更/ })).toBeNull();
    cleanup();
    setup(false);
    expect(screen.queryByRole("button", { name: /時刻を変更/ })).toBeNull();
    fireEvent.click(block());
    expect(screen.getByRole("form", { name: "配置の編集" })).toBeTruthy();
  });

  it("家族同士が重なる時間帯がある場合、外枠は全幅で重なる時間帯のみ分割表示される", () => {
    const snapshot = {
      ...mockSnapshot,
      placements: [
        { id: "mother-1", day: 0 as const, startHour: 17, endHour: 19, kind: "family" as const, personId: "person-mother" },
        { id: "daughter-1", day: 0 as const, startHour: 18, endHour: 21, kind: "family" as const, personId: "person-daughter" },
      ],
    };
    render(<WeeklyBoard snapshot={snapshot} canEdit saving={false} services={[]} validation={null} onSave={vi.fn()} />);

    const motherBlock = screen.getByRole("button", { name: /母の付き添い.*月曜 17:00の詳細/ });
    const daughterBlock = screen.getByRole("button", { name: /長女の付き添い.*月曜 18:00の詳細/ });

    // 2カラム重なり時は外枠は全幅（width: 100%, marginLeft: 0%）
    expect(motherBlock.parentElement?.style.width).toBe("100%");
    expect(motherBlock.parentElement?.style.marginLeft).toBe("0%");
    expect(daughterBlock.parentElement?.style.width).toBe("100%");
    expect(daughterBlock.parentElement?.style.marginLeft).toBe("0%");
    // ホバー・フォーカス時に前面に浮上するクラスが付与されていること
    expect(motherBlock.parentElement?.className).toContain("hover:z-30");
    expect(daughterBlock.parentElement?.className).toContain("hover:z-30");
  });

  it("訪問介護（身体介護）の編集フォームでは最大3時間の案内が表示され、終了時刻が最大3時間に制限される", () => {
    const snapshot = {
      ...mockSnapshot,
      placements: [
        { id: "visit-1", day: 0 as const, startHour: 9, endHour: 11, kind: "visit" as const, serviceId: "visit-body" },
      ],
    };
    const services = [
      { serviceId: "visit-body", title: "訪問介護（身体介護）", kind: "visit" as const },
      { serviceId: "visit-life", title: "訪問介護（生活援助）", kind: "visit" as const },
    ];
    render(<WeeklyBoard snapshot={snapshot} canEdit saving={false} services={services} validation={null} onSave={vi.fn()} />);

    // ブロックをクリックして編集フォームを開く
    const visitBlock = screen.getByRole("button", { name: /訪問介護.*月曜 9:00の詳細/ });
    fireEvent.click(visitBlock);

    // 最大3時間の案内テキストが表示されていること
    expect(screen.getByText(/訪問介護（身体介護）は最大3時間（表の範囲内）まで設定できます/)).toBeTruthy();

    // 終了時刻の選択肢が開始（9:00）+ 3時間（12:00）までに制限されていること
    const endSelect = screen.getByRole("combobox", { name: "終了" });
    const optionValues = Array.from(endSelect.querySelectorAll("option")).map(opt => opt.value);
    expect(optionValues).toEqual(["10", "11", "12"]);
  });
});
