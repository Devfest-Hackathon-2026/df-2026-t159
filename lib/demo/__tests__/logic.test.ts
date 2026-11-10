import { describe, expect, it } from "vitest";
import { applyChanges } from "../../apply-changes";
import { demoFixture } from "../../demo-fixture";
import type { RoomSnapshot } from "../../types";
import { validateRoom } from "../../validation";
import {
  buildDemoProposal,
  buildDemoStructureDraft,
  DemoMismatchError,
} from "../logic";
import {
  createPersonMapping,
  mapConstraints,
  mapPeople,
  mapPlacements,
} from "../mapping";
import type { DemoRoomMeta } from "../types";

describe("デモ固定応答ロジック（logic.ts）", () => {
  const fx = demoFixture;
  const personMapping = createPersonMapping(fx.people, (id) => `room-${id}`);

  const defaultMeta: DemoRoomMeta = {
    roomId: "demo-room-1",
    creatorUid: "uid-creator",
    isDemo: true,
    revision: 3,
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
    revision: 3,
  };

  describe("buildDemoStructureDraft", () => {
    it("fixture から家族の名前（memberName）付きの制約下書きと demo フラグを生成する", () => {
      const draft = buildDemoStructureDraft(fx);
      expect(draft.demo).toBe(true);
      expect(draft.constraints).toHaveLength(fx.constraints.length);

      // 各制約の memberName が解決されている
      const memberNames = new Set(draft.constraints.map((c) => c.memberName));
      expect(memberNames.has("父")).toBe(true);
      expect(memberNames.has("母")).toBe(true);
      expect(memberNames.has("長女")).toBe(true);
      expect(memberNames.has("長男")).toBe(true);

      expect(draft.hopes).toEqual(fx.hopes);
      expect(draft.unknowns).toEqual(fx.unknowns);
    });
  });

  describe("buildDemoProposal", () => {
    it("照合が一致する場合、正規化・applyChanges・再検証を通過した固定代替案を返す", () => {
      const proposal = buildDemoProposal(defaultSnapshot, defaultMeta, fx);

      expect(proposal.demo).toBe(true);
      expect(proposal.baseRevision).toBe(3); // snapshot.revision がそのまま使われる
      expect(proposal.summary).toBe(fx.fixedProposal.summary);
      expect(proposal.changes.length).toBeGreaterThan(0);

      // 試し適用して検証エンジンで判定すると ok=true になる
      const trialPlacements = applyChanges(defaultSnapshot.placements, proposal.changes);
      const val = validateRoom({
        ...defaultSnapshot,
        placements: trialPlacements,
      });
      expect(val.ok).toBe(true);
      expect(val.overUnits).toBe(0);
      expect(val.gaps).toHaveLength(0);
      expect(val.overloads).toHaveLength(0);
      expect(proposal.validation).toEqual(val);
      // fixture の人物IDではなく、このルームの人物IDで比較できること。
      expect(proposal.validation.memberHours).toEqual(
        fx.acceptedPlan.expectedValidationResult.memberHours.map((member) => ({
          ...member,
          personId: personMapping[member.personId],
        })),
      );
    });

    it("スナップショットが fixture と不一致の場合、DemoMismatchError を投げて固定案を返さない", () => {
      const mismatchedSnapshot: RoomSnapshot = {
        ...defaultSnapshot,
        copayRate: 3 as const, // 負担割合を変更
      };

      expect(() =>
        buildDemoProposal(mismatchedSnapshot, defaultMeta, fx),
      ).toThrow(DemoMismatchError);
    });

    it("baseRevision は現在のスナップショットの revision がそのまま入り、付け替えは行われない", () => {
      const rev5Snapshot: RoomSnapshot = {
        ...defaultSnapshot,
        revision: 5,
      };
      const rev5Meta: DemoRoomMeta = {
        ...defaultMeta,
        revision: 5,
      };

      const proposal = buildDemoProposal(rev5Snapshot, rev5Meta, fx);
      expect(proposal.baseRevision).toBe(5);
    });
  });
});
