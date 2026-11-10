import { describe, expect, it } from "vitest";
import {
  computePlacementColumns,
  getDefaultPlacementHours,
  moveBlock,
  placementInputError,
} from "./board";
import type { Placement } from "./types";

const p: Placement = { id: "p", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "test-service" };
describe("ボードの移動と入力範囲", () => {
  it("曜日と開始時刻だけを変え、長さとIDを保つ", () => {
    expect(moveBlock(p, 6, 21)).toEqual({ ...p, day: 6, startHour: 21, endHour: 24 });
    expect(p.startHour).toBe(9);
  });
  it("24時を越える移動、6時より前、曜日・時刻の範囲外を拒否する", () => {
    expect(moveBlock(p, 1, 22)).toBeNull();
    expect(moveBlock(p, 1, 5)).toBeNull();
    expect(moveBlock(p, 7, 9)).toBeNull();
    expect(moveBlock(p, 1, 9.5)).toBeNull();
  });
  it("ショートステイは曜日だけを変更し、終日を保つ", () => {
    const stay: Placement = { ...p, kind: "shortstay", startHour: 6, endHour: 24 };
    expect(moveBlock(stay, 1, 15)).toEqual({ ...stay, day: 1 });
    expect(placementInputError({ ...stay, day: 1 }, [{ ...stay, id: "other", day: 1 }])).toContain("同日1件");
  });
  it("フォームの整数時間と半開区間を確認する", () => {
    expect(placementInputError({ ...p, endHour: 9 }, [])).not.toBeNull();
    expect(placementInputError({ ...p, endHour: 24 }, [])).toBeNull();
  });
  it("訪問介護（身体介護）は3時間を超える入力を拒否する（生活援助は許可）", () => {
    const bodyVisit: Placement = { id: "bv", day: 0, startHour: 9, endHour: 13, kind: "visit", serviceId: "visit-body" };
    expect(placementInputError(bodyVisit, [])).toContain("最大3時間");
    expect(placementInputError({ ...bodyVisit, endHour: 12 }, [])).toBeNull();

    const lifeVisit: Placement = { id: "lv", day: 0, startHour: 9, endHour: 14, kind: "visit", serviceId: "visit-life" };
    expect(placementInputError(lifeVisit, [])).toBeNull();
  });
});

describe("ドロップ時の既定時間（修正2(a)）", () => {
  it("通所介護（daycare）は既定で3時間になる", () => {
    expect(getDefaultPlacementHours("daycare", 9)).toEqual({
      startHour: 9,
      endHour: 12,
    });
  });

  it("通所リハビリ（dayrehab）は既定で3時間になる", () => {
    expect(getDefaultPlacementHours("dayrehab", 10)).toEqual({
      startHour: 10,
      endHour: 13,
    });
  });

  it("訪問介護（visit）は既定で1時間のまま", () => {
    expect(getDefaultPlacementHours("visit", 7)).toEqual({
      startHour: 7,
      endHour: 8,
    });
  });

  it("家族の付き添い（family）は既定で1時間のまま", () => {
    expect(getDefaultPlacementHours("family", 18)).toEqual({
      startHour: 18,
      endHour: 19,
    });
  });

  it("ショートステイ（shortstay）はドロップ時刻に関わらず6:00〜24:00固定", () => {
    expect(getDefaultPlacementHours("shortstay", 14)).toEqual({
      startHour: 6,
      endHour: 24,
    });
  });

  it("24時を超える場合は24時で打ち止めにする", () => {
    expect(getDefaultPlacementHours("daycare", 22)).toEqual({
      startHour: 22,
      endHour: 24,
    });
  });
});

describe("重なりブロックの横並びカラム計算（修正3(b)）", () => {
  it("重なりがない単独ブロックは1カラム・幅100%", () => {
    const placements: Placement[] = [
      { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "svc-1" },
      { id: "p2", day: 0, startHour: 13, endHour: 16, kind: "daycare", serviceId: "svc-1" },
    ];
    const layout = computePlacementColumns(placements);
    expect(layout.get("p1")).toEqual({ column: 0, totalColumns: 1 });
    expect(layout.get("p2")).toEqual({ column: 0, totalColumns: 1 });
  });

  it("時間が重なるブロックは分割されたカラム番号と総カラム数を割り当てる", () => {
    const placements: Placement[] = [
      { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "svc-1" },
      { id: "p2", day: 0, startHour: 10, endHour: 11, kind: "visit", serviceId: "svc-2" },
    ];
    const layout = computePlacementColumns(placements);
    expect(layout.get("p1")?.totalColumns).toBe(2);
    expect(layout.get("p2")?.totalColumns).toBe(2);
    expect(layout.get("p1")?.column).not.toBe(layout.get("p2")?.column);
  });

  it("3重に重なるブロックは3カラムで割り当てる", () => {
    const placements: Placement[] = [
      { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "svc-1" },
      { id: "p2", day: 0, startHour: 10, endHour: 13, kind: "visit", serviceId: "svc-2" },
      { id: "p3", day: 0, startHour: 11, endHour: 14, kind: "family", personId: "daughter" },
    ];
    const layout = computePlacementColumns(placements);
    expect(layout.get("p1")?.totalColumns).toBe(3);
    expect(layout.get("p2")?.totalColumns).toBe(3);
    expect(layout.get("p3")?.totalColumns).toBe(3);
    const cols = new Set([layout.get("p1")?.column, layout.get("p2")?.column, layout.get("p3")?.column]);
    expect(cols.size).toBe(3);
  });
});
