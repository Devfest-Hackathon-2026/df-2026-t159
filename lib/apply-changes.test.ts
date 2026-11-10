/**
 * applyChanges（Issue 6）の単体テスト。
 * 保存しない純粋関数としての契約（入力を変更しない・move は長さを保つ・
 * add はサーバー採番済みの ID をそのまま使う）を検証する。
 */

import { describe, expect, it } from "vitest";
import { applyChanges } from "./apply-changes";
import type { Placement } from "./types";

const placements: Placement[] = [
  { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "daycare-basic" },
  { id: "p2", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "daughter" },
  { id: "p3", day: 2, startHour: 10, endHour: 11, kind: "visit", serviceId: "visit-body" },
];

describe("applyChanges", () => {
  it("remove は対象だけを取り除く", () => {
    const result = applyChanges(placements, [{ action: "remove", placementId: "p2" }]);
    expect(result.map((p) => p.id)).toEqual(["p1", "p3"]);
  });

  it("move は曜日と開始時刻を変え、長さを保つ", () => {
    const result = applyChanges(placements, [
      { action: "move", placementId: "p1", day: 3, startHour: 10 },
    ]);
    const moved = result.find((p) => p.id === "p1");
    expect(moved).toMatchObject({ day: 3, startHour: 10, endHour: 13 });
  });

  it("resize は時刻だけを変える（曜日は変えない）", () => {
    const result = applyChanges(placements, [
      { action: "resize", placementId: "p3", startHour: 10, endHour: 12 },
    ]);
    const resized = result.find((p) => p.id === "p3");
    expect(resized).toMatchObject({ day: 2, startHour: 10, endHour: 12 });
  });

  it("add はサーバー採番済みの placementId をそのまま使って末尾に追加する", () => {
    const result = applyChanges(placements, [
      {
        action: "add",
        placementId: "server-issued-id",
        day: 4,
        startHour: 9,
        endHour: 10,
        kind: "visit",
        serviceId: "visit-life",
      },
    ]);
    expect(result).toHaveLength(4);
    expect(result[3]).toEqual({
      id: "server-issued-id",
      day: 4,
      startHour: 9,
      endHour: 10,
      kind: "visit",
      serviceId: "visit-life",
    });
  });

  it("複数の変更をまとめて適用できる", () => {
    const result = applyChanges(placements, [
      { action: "remove", placementId: "p2" },
      { action: "move", placementId: "p1", day: 1, startHour: 9 },
      {
        action: "add",
        placementId: "new-1",
        day: 1,
        startHour: 17,
        endHour: 19,
        kind: "family",
        personId: "son",
      },
    ]);
    expect(result.map((p) => p.id)).toEqual(["p1", "p3", "new-1"]);
    expect(result[0]).toMatchObject({ day: 1, startHour: 9, endHour: 12 });
  });

  it("入力の配列と要素を変更しない（純粋関数）", () => {
    const before = JSON.parse(JSON.stringify(placements)) as Placement[];
    const result = applyChanges(placements, [
      { action: "move", placementId: "p1", day: 5, startHour: 8 },
      { action: "remove", placementId: "p2" },
    ]);
    expect(placements).toEqual(before);
    expect(result).not.toBe(placements);
  });

  it("存在しない ID への操作は無視する（例外にしない）", () => {
    const result = applyChanges(placements, [
      { action: "remove", placementId: "ghost" },
      { action: "move", placementId: "ghost", day: 1, startHour: 9 },
      { action: "resize", placementId: "ghost", startHour: 9, endHour: 10 },
    ]);
    expect(result).toEqual(placements);
  });

  it("変更が空なら等しい内容の新しい配列を返す", () => {
    const result = applyChanges(placements, []);
    expect(result).toEqual(placements);
    expect(result).not.toBe(placements);
  });
});
