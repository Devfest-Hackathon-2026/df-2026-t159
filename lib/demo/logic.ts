/**
 * デモ固定応答の生成・検証ロジック（Issue 15）。
 *
 * 構造化と代替案について、fixture ベースの固定応答を返す純粋ロジック。
 * 代替案の発行条件：
 * - matchDemoSnapshot で入力スナップショットを照合し、一致する場合のみ発行する
 * - 固定応答も実AIと同じ正規化（normalizeProposals）・applyChanges・再検証（validateRoom）の経路を通す
 * - baseRevision は入力を取得した時点の値をそのまま使い、現在の revision への付け替えはしない
 * - レスポンスに demo: true フラグを付ける
 */

import { applyChanges } from "../apply-changes";
import { demoFixture, type DemoFixture } from "../demo-fixture";
import { normalizeProposals } from "../ai/proposalNormalize";
import type {
  ConstraintDraft,
  ConstraintType,
  Proposal,
  RoomSnapshot,
  ValidationResult,
} from "../types";
import { validateRoom } from "../validation";
import { mapChanges } from "./mapping";
import { matchDemoSnapshot } from "./match";
import type {
  DemoProposalResult,
  DemoRoomMeta,
  DemoStructureResult,
} from "./types";

export class DemoMismatchError extends Error {
  constructor(public readonly reason: string) {
    super(`デモ入力照合不一致: ${reason}`);
    this.name = "DemoMismatchError";
  }
}

/**
 * デモ用構造化固定応答（下書き）を作成する。
 * fixture の制約を、家族の名前（memberName）付きドラフトに変換する。
 */
export function buildDemoStructureDraft(
  fixture: DemoFixture = demoFixture,
): DemoStructureResult {
  const peopleMap = new Map(fixture.people.map((p) => [p.id, p.name]));
  const constraints: ConstraintDraft[] = fixture.constraints.map((c) => ({
    memberName: peopleMap.get(c.personId) ?? "",
    type: c.type as ConstraintType,
    detail: c.detail,
    days: [...c.days],
    ...(c.startHour !== undefined ? { startHour: c.startHour } : {}),
    ...(c.endHour !== undefined ? { endHour: c.endHour } : {}),
  }));

  return {
    constraints,
    hopes: [...fixture.hopes],
    unknowns: [...fixture.unknowns],
    demo: true,
  };
}

/**
 * デモ用代替案固定応答を作成・検証する。
 * 1. matchDemoSnapshot で入力スナップショットを照合（不一致なら DemoMismatchError）
 * 2. 人物ID置換した changes を正規化入力形式へ整形
 * 3. 実AIと同じ normalizeProposals に通す
 * 4. applyChanges で試し適用し、validateRoom で再検証して ok=true を確認
 * 5. 再検証結果・snapshot.revision・demo: true を付けて返す
 */
export function buildDemoProposal(
  snapshot: RoomSnapshot,
  meta: Pick<DemoRoomMeta, "isDemo" | "fixtureVersion" | "personMapping">,
  fixture: DemoFixture = demoFixture,
  validate: (snap: RoomSnapshot) => ValidationResult = (s) => validateRoom(s),
): DemoProposalResult {
  const matchResult = matchDemoSnapshot(snapshot, meta, fixture);
  if (!matchResult.matched) {
    throw new DemoMismatchError(matchResult.reason);
  }

  const mappedChanges = mapChanges(fixture.fixedProposal.changes, meta.personMapping);

  // proposalNormalize が受け付けるキー（CHANGE_KEYS）のみに整形（note 等の余分なキーを除去）
  const cleanChanges = mappedChanges.map((ch) => {
    const clean: Record<string, unknown> = {
      action: ch.action,
    };
    if ("placementId" in ch && ch.placementId !== undefined) {
      clean.placementId = ch.placementId;
    }
    if ("day" in ch && ch.day !== undefined) {
      clean.day = ch.day;
    }
    if ("startHour" in ch && ch.startHour !== undefined) {
      clean.startHour = ch.startHour;
    }
    if ("endHour" in ch && ch.endHour !== undefined) {
      clean.endHour = ch.endHour;
    }
    if ("kind" in ch && ch.kind !== undefined) {
      clean.kind = ch.kind;
    }
    if ("serviceId" in ch && ch.serviceId !== undefined) {
      clean.serviceId = ch.serviceId;
    }
    if ("personId" in ch && ch.personId !== undefined) {
      clean.personId = ch.personId;
    }
    return clean;
  });

  const rawProposalPayload = {
    proposals: [
      {
        summary: fixture.fixedProposal.summary,
        changes: cleanChanges,
      },
    ],
  };

  const normalized = normalizeProposals(rawProposalPayload, {
    placements: snapshot.placements,
    people: snapshot.people,
    baseRevision: snapshot.revision,
  });

  if (normalized.length === 0) {
    throw new Error("固定代替案の正規化に失敗しました");
  }

  const proposal = normalized[0];

  // 試し適用と再検証（Issue 8 と同じ検証経路）
  const trialPlacements = applyChanges(snapshot.placements, proposal.changes);
  const trialSnapshot: RoomSnapshot = {
    ...snapshot,
    placements: trialPlacements,
  };
  const valResult = validate(trialSnapshot);
  if (!valResult.ok) {
    throw new Error("固定代替案の再検証が OK になりませんでした");
  }

  return {
    ...proposal,
    baseRevision: snapshot.revision,
    validation: valResult,
    demo: true,
  };
}
