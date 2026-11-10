/**
 * プランの確定・代替案の適用・ケアマネコメント（Issue 14）が外部に依存する
 * 部分のインターフェース（接続点）。
 *
 * ハンドラ（handlers.ts）はこの型経由でだけ外部を呼ぶ。実物の差し込みは
 * lib/server/plan-ports.ts（Admin SDK）で行い、単体テストでは
 * lib/plan/fakes.ts のフェイクを差す（Issue 7 の lib/ai/ports.ts と同じ方式）。
 *
 * 意味論の正本は仕様の共通前提＋Issue 14：
 * - 適用：transaction 内で baseRevision を再確認 → applyChanges → 再検証 →
 *   OK なら一括保存（revision +1）。不一致・再検証NG では保存しない
 * - 確定：再検証 ok=true・validationErrors なし・unknowns 空のときだけ、
 *   expectedRevision 付き transaction で ConfirmedSnapshot を summary に保存
 *   （確定のみでは revision を増やさない）
 * - コメント：作成は careManager のみ、本文1〜1,000字、authorUid＝認証UID、
 *   createdAt＝サーバー時刻。全参加者が閲覧可
 */

import type { AuthPort, MembershipPort } from "../ai/ports";
import type { Proposal, RoomSnapshot, ValidationResult } from "../types";

/** コメント本文の最大字数（共通前提の権限表：本文1〜1,000字） */
export const COMMENT_BODY_MAX_LENGTH = 1000;

/** 検証エンジン（Issue 6 の validateRoom を差す想定。テストでは差し替え可） */
export type ValidateFn = (snapshot: RoomSnapshot) => ValidationResult;

/** 確定できない理由（仕様の確定条件に対応する3種） */
export type ConfirmBlockReason =
  /** 再検証の結果が ok=true でない */
  | "validation_not_ok"
  /** validationErrors が残っている */
  | "validation_errors"
  /** 制約の unknowns が空でない */
  | "unknowns_remain";

/** 代替案の適用結果（保存したかどうかと、その理由） */
export type ApplyProposalOutcome =
  /** 再検証OKで保存した。revision は保存後の新しい版 */
  | { status: "applied"; revision: number; validation: ValidationResult }
  /** baseRevision が現在の revision と一致しない（古い案は破棄する） */
  | { status: "stale"; actualRevision: number }
  /** 再検証でNGのため保存しなかった */
  | { status: "rejected"; validation: ValidationResult };

/** プラン確定の結果 */
export type ConfirmPlanOutcome =
  /** 確定し、summary に ConfirmedSnapshot を保存した */
  | {
      status: "confirmed";
      confirmedRevision: number;
      validation: ValidationResult;
    }
  /** expectedRevision が現在の revision と一致しない */
  | { status: "stale"; actualRevision: number }
  /** 確定条件を満たさないため保存しなかった */
  | {
      status: "blocked";
      reasons: ConfirmBlockReason[];
      validation: ValidationResult;
    };

/**
 * プランの保存まわり（適用・確定・コメント）の接続点。
 * 適用と確定は「整合スナップショットの取得 → 純粋ロジックでの判定 →
 * transaction 内で revision を再確認して保存」の方式に統一する
 * （Issue 2 の commitRoomChange と同じ方式。判定の純粋ロジックは logic.ts）。
 */
export interface PlanStorePort {
  /**
   * 代替案を本適用する。baseRevision 不一致・再検証NG では何も保存しない。
   * ルームがなければ RoomNotFoundError（lib/room-change.ts）を throw する。
   */
  applyProposal(
    roomId: string,
    proposal: Proposal,
  ): Promise<ApplyProposalOutcome>;

  /**
   * プランを確定する。確定条件を満たさない場合は何も保存しない。
   * 確定では revision を増やさない。
   * ルームがなければ RoomNotFoundError を throw する。
   */
  confirmPlan(
    roomId: string,
    expectedRevision: number,
  ): Promise<ConfirmPlanOutcome>;

  /**
   * コメントを1件保存する。createdAt は保存側がサーバー時刻で付ける
   * （クライアントから送られた時刻は採用しない）。
   */
  addComment(
    roomId: string,
    comment: { id: string; authorUid: string; body: string },
  ): Promise<void>;
}

/** Route Handler が使う接続点の一式 */
export interface PlanPorts {
  auth: AuthPort;
  membership: MembershipPort;
  store: PlanStorePort;
}
