/**
 * 代替案の適用とプラン確定の「判定」だけを行う純粋ロジック（Issue 14）。
 *
 * Firestore へは触れず、「整合スナップショット＋提案／期待する版」から
 * 「保存してよいか・保存する内容は何か」だけを計算する。
 * 保存の実体（transaction）は接続点（ports.ts の PlanStorePort）の実装が担い、
 * 実物（Admin SDK）とフェイクの両方がこの判定を共有する
 * （Issue 2 の planRoomChangeWrites と同じ分担）。
 *
 * 変更の適用は必ず共通部品 applyChanges（Issue 6）を使う
 * （Issue 8 の試し適用と Issue 14 の本適用で同じ関数。仕様の確定事項）。
 */

import { applyChanges } from "../apply-changes";
import type { Placement, Proposal, RoomSnapshot, ValidationResult } from "../types";
import type { ConfirmBlockReason, ValidateFn } from "./ports";

/** 適用の判定結果 */
export type ApplyEvaluation =
  /** baseRevision が現在の revision と一致しない（古い案は破棄する） */
  | { kind: "stale"; actualRevision: number }
  /** 再検証でNG（保存しない） */
  | { kind: "rejected"; validation: ValidationResult }
  /** 再検証OK。nextPlacements を revision +1 で保存する */
  | {
      kind: "applicable";
      nextPlacements: Placement[];
      validation: ValidationResult;
    };

/**
 * 代替案を適用してよいか判定する。
 * 順序は仕様どおり：baseRevision の再確認 → applyChanges で候補を作る → 再検証。
 */
export function evaluateProposalApplication(
  snapshot: RoomSnapshot,
  proposal: Proposal,
  validate: ValidateFn,
): ApplyEvaluation {
  if (snapshot.revision !== proposal.baseRevision) {
    return { kind: "stale", actualRevision: snapshot.revision };
  }
  const nextPlacements = applyChanges(snapshot.placements, proposal.changes);
  const validation = validate({ ...snapshot, placements: nextPlacements });
  if (!validation.ok) {
    return { kind: "rejected", validation };
  }
  return { kind: "applicable", nextPlacements, validation };
}

/**
 * 確定条件を満たさない理由の一覧を返す（空なら確定できる）。
 * 条件は仕様の3点：再検証 ok=true・validationErrors なし・unknowns 空。
 * ok=true の定義上 validationErrors は空のはずだが、仕様が独立の条件として
 * 挙げているため、ここでも独立に検査する（二重の防御）。
 */
export function confirmBlockReasons(
  snapshot: RoomSnapshot,
  validation: ValidationResult,
): ConfirmBlockReason[] {
  const reasons: ConfirmBlockReason[] = [];
  if (!validation.ok) reasons.push("validation_not_ok");
  if (validation.validationErrors.length > 0) reasons.push("validation_errors");
  if (snapshot.unknowns.length > 0) reasons.push("unknowns_remain");
  return reasons;
}

/** 確定の判定結果 */
export type ConfirmEvaluation =
  /** expectedRevision が現在の revision と一致しない */
  | { kind: "stale"; actualRevision: number }
  /** 確定条件を満たさない（保存しない） */
  | {
      kind: "blocked";
      reasons: ConfirmBlockReason[];
      validation: ValidationResult;
    }
  /** 確定できる。snapshot と validation を ConfirmedSnapshot として保存する */
  | { kind: "confirmable"; validation: ValidationResult };

/**
 * プランを確定してよいか判定する。
 * 検証した版と保存する版を一致させるため、expectedRevision と現在の
 * revision の照合を最初に行う（古い検証結果に新しい confirmedRevision を
 * 付け替えることはしない。仕様の確定事項）。
 */
export function evaluateConfirmation(
  snapshot: RoomSnapshot,
  expectedRevision: number,
  validate: ValidateFn,
): ConfirmEvaluation {
  if (snapshot.revision !== expectedRevision) {
    return { kind: "stale", actualRevision: snapshot.revision };
  }
  const validation = validate(snapshot);
  const reasons = confirmBlockReasons(snapshot, validation);
  if (reasons.length > 0) {
    return { kind: "blocked", reasons, validation };
  }
  return { kind: "confirmable", validation };
}
