/**
 * commitRoomChange の書き込み計画（planRoomChangeWrites）の単体テスト（Issue 2）。
 * Firestore には接続せず、トランザクションのロジックだけを検証する。
 */

import { describe, expect, it } from "vitest";
import {
  planRoomChangeWrites,
  RevisionConflictError,
} from "./room-change";
import type { Placement, RoomSnapshot } from "./types";

const basePlacement: Placement = {
  id: "p1",
  day: 0,
  startHour: 9,
  endHour: 12,
  kind: "daycare",
  serviceId: "daycare-basic",
};

function snapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    people: [
      { id: "person-father", name: "父", canProvideCare: false },
      { id: "person-daughter", name: "長女", canProvideCare: true },
    ],
    placements: [basePlacement],
    constraints: [],
    hopes: ["希望メモ"],
    unknowns: [],
    careWindows: [{ day: 0, startHour: 9, endHour: 12 }],
    copayRate: 1,
    revision: 3,
    ...overrides,
  };
}

describe("planRoomChangeWrites", () => {
  it("revision が一致しない場合は RevisionConflictError を投げる（保存しない）", () => {
    expect(() => planRoomChangeWrites(snapshot(), 2, {})).toThrow(
      RevisionConflictError,
    );
    try {
      planRoomChangeWrites(snapshot(), 2, {});
    } catch (err) {
      const conflict = err as RevisionConflictError;
      expect(conflict.expected).toBe(2);
      expect(conflict.actual).toBe(3);
    }
  });

  it("変更がなければ書き込みは revision の +1 だけになる", () => {
    const plan = planRoomChangeWrites(snapshot(), 3, {});
    expect(plan.nextRevision).toBe(4);
    expect(plan.upsertPlacements).toEqual([]);
    expect(plan.deletePlacementIds).toEqual([]);
    expect(plan.constraintsDoc).toBeNull();
    expect(plan.roomFields).toEqual({});
  });

  it("配置の追加は upsert に入る", () => {
    const added: Placement = {
      id: "p2",
      day: 1,
      startHour: 10,
      endHour: 11,
      kind: "visit",
      serviceId: "visit-body",
    };
    const plan = planRoomChangeWrites(snapshot(), 3, {
      placements: [basePlacement, added],
    });
    expect(plan.upsertPlacements).toEqual([added]);
    expect(plan.deletePlacementIds).toEqual([]);
    expect(plan.nextPlacements).toHaveLength(2);
  });

  it("配置の削除は deletePlacementIds に入る", () => {
    const plan = planRoomChangeWrites(snapshot(), 3, { placements: [] });
    expect(plan.deletePlacementIds).toEqual(["p1"]);
    expect(plan.upsertPlacements).toEqual([]);
  });

  it("配置の内容変更は upsert に入る（同一内容は入らない）", () => {
    const moved: Placement = { ...basePlacement, startHour: 10, endHour: 13 };
    const changed = planRoomChangeWrites(snapshot(), 3, {
      placements: [moved],
    });
    expect(changed.upsertPlacements).toEqual([moved]);

    const unchanged = planRoomChangeWrites(snapshot(), 3, {
      placements: [{ ...basePlacement }],
    });
    expect(unchanged.upsertPlacements).toEqual([]);
  });

  it("制約の一部だけを渡すと、残りは現在の値で補って constraints/main の全文になる", () => {
    const plan = planRoomChangeWrites(snapshot(), 3, {
      hopes: ["新しい希望"],
    });
    expect(plan.constraintsDoc).toEqual({
      constraints: [],
      hopes: ["新しい希望"],
      unknowns: [],
    });
  });

  it("careWindows と copayRate は roomFields にだけ入り、未指定なら入らない", () => {
    const plan = planRoomChangeWrites(snapshot(), 3, {
      careWindows: [{ day: 2, startHour: 9, endHour: 17 }],
      copayRate: 2,
    });
    expect(plan.roomFields).toEqual({
      careWindows: [{ day: 2, startHour: 9, endHour: 17 }],
      copayRate: 2,
    });
    expect(plan.constraintsDoc).toBeNull();
  });

  it("家族の追加・編集・削除の書き込み計画が正しく計算される", () => {
    const changedDaughter = {
      id: "person-daughter",
      name: "長女（改）",
      canProvideCare: true,
      careRole: "caregiver" as const,
    };
    const addedSon = {
      id: "person-son",
      name: "長男",
      canProvideCare: true,
      careRole: "caregiver" as const,
    };

    // father を削除、daughter を編集、son を追加
    const plan = planRoomChangeWrites(snapshot(), 3, {
      people: [changedDaughter, addedSon],
    });

    expect(plan.deletePeopleIds).toEqual(["person-father"]);
    expect(plan.upsertPeople).toEqual([changedDaughter, addedSon]);
    expect(plan.nextPeople).toEqual([changedDaughter, addedSon]);
  });

  it("家族の変更がない場合は upsertPeople と deletePeopleIds は空になる", () => {
    const s = snapshot();
    const plan = planRoomChangeWrites(s, 3, {
      people: s.people,
    });
    expect(plan.deletePeopleIds).toEqual([]);
    expect(plan.upsertPeople).toEqual([]);
  });

  it("コメントと summary は RoomChange の対象外（revision を増やす経路に入らない）", () => {
    // RoomChange 型に comments / summary の項目が存在しないこと自体が契約。
    // ここでは空の変更でも nextRevision が +1 になる（＝入力変更専用）ことを確認する。
    const plan = planRoomChangeWrites(snapshot(), 3, {});
    expect(plan.nextRevision).toBe(4);
    expect(Object.keys(plan.roomFields)).toEqual([]);
  });
});
