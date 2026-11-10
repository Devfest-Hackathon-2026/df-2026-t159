import { describe, expect, it } from "vitest";
import { demoFixture } from "../../demo-fixture";
import type { RoomSnapshot } from "../../types";
import {
  createPersonMapping,
  mapConstraints,
  mapPeople,
  mapPlacements,
} from "../mapping";
import { matchDemoSnapshot } from "../match";
import type { DemoRoomMeta, SnapshotMatchResult } from "../types";

function assertMismatch(
  result: SnapshotMatchResult,
): Extract<SnapshotMatchResult, { matched: false }> {
  expect(result.matched).toBe(false);
  if (result.matched) throw new Error("Expected mismatch");
  return result;
}

describe("デモ入力スナップショット照合（match.ts）", () => {
  const fx = demoFixture;
  const personMapping = createPersonMapping(fx.people, (id) => `room-${id}`);

  const defaultMeta: DemoRoomMeta = {
    roomId: "demo-room-1",
    creatorUid: "uid-creator",
    isDemo: true,
    revision: 2,
    fixtureVersion: fx.fixtureVersion,
    personMapping,
    careWindows: fx.careWindows,
    copayRate: fx.copayRate,
  };

  const defaultSnapshot: RoomSnapshot = {
    people: mapPeople(fx.people, personMapping),
    placements: mapPlacements(fx.troubledPlan.placements, personMapping),
    constraints: mapConstraints(fx.constraints, personMapping),
    hopes: [...fx.hopes],
    unknowns: [...fx.unknowns],
    careWindows: [...fx.careWindows],
    copayRate: fx.copayRate,
    revision: 2,
  };

  it("完全一致する場合は matched: true を返す", () => {
    const result = matchDemoSnapshot(defaultSnapshot, defaultMeta, fx);
    expect(result.matched).toBe(true);
  });

  it("配列の順序が異なっていても内容が一致していれば matched: true を返す", () => {
    const reversedSnapshot: RoomSnapshot = {
      ...defaultSnapshot,
      placements: [...defaultSnapshot.placements].reverse(),
      constraints: [...defaultSnapshot.constraints].reverse(),
      careWindows: [...defaultSnapshot.careWindows].reverse(),
      hopes: [...defaultSnapshot.hopes].reverse(),
    };
    const result = matchDemoSnapshot(reversedSnapshot, defaultMeta, fx);
    expect(result.matched).toBe(true);
  });

  it("isDemo が false の場合は照合に失敗する", () => {
    const meta = { ...defaultMeta, isDemo: false };
    const mismatch = assertMismatch(matchDemoSnapshot(defaultSnapshot, meta, fx));
    expect(mismatch.reason).toContain("デモルームではありません");
  });

  it("fixtureVersion が異なる場合は照合に失敗する", () => {
    const meta = { ...defaultMeta, fixtureVersion: "9.9.9" };
    const mismatch = assertMismatch(matchDemoSnapshot(defaultSnapshot, meta, fx));
    expect(mismatch.field).toBe("fixtureVersion");
  });

  it("people の構成が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      people: defaultSnapshot.people.slice(0, 3), // 1人欠落
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("people");
  });

  it("people の canProvideCare が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      people: defaultSnapshot.people.map((p) =>
        p.name === "父" ? { ...p, canProvideCare: true } : p,
      ),
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("people");
  });

  it("careWindows が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      careWindows: defaultSnapshot.careWindows.slice(0, -1),
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("careWindows");
  });

  it("自己負担割合（copayRate）が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      copayRate: 2 as const,
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("copayRate");
  });

  it("制約（constraints）の時刻が異なる場合は照合に失敗する", () => {
    const modifiedConstraints = [...defaultSnapshot.constraints];
    modifiedConstraints[0] = {
      ...modifiedConstraints[0],
      startHour: (modifiedConstraints[0].startHour ?? 8) + 1,
    };
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      constraints: modifiedConstraints,
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("constraints");
  });

  it("希望（hopes）が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      hopes: ["別の希望"],
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("hopes");
  });

  it("未確認事項（unknowns）が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      unknowns: ["未確認事項が残っている"],
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("unknowns");
  });

  it("配置（placements）の件数が異なる場合は照合に失敗する", () => {
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      placements: defaultSnapshot.placements.slice(0, -1),
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("placements");
  });

  it("配置の時刻が変更されている場合は照合に失敗する", () => {
    const modifiedPlacements = defaultSnapshot.placements.map((p, idx) =>
      idx === 0 ? { ...p, startHour: p.startHour + 1 } : p,
    );
    const snapshot: RoomSnapshot = {
      ...defaultSnapshot,
      placements: modifiedPlacements,
    };
    const mismatch = assertMismatch(matchDemoSnapshot(snapshot, defaultMeta, fx));
    expect(mismatch.field).toBe("placements");
  });
});
