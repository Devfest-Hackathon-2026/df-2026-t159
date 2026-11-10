/**
 * プランの確定・代替案の適用・ケアマネコメント（Issue 14）のハンドラ本体。
 *
 * Route Handler（app/api/rooms/[roomId]/**）は HTTP の読み取りだけを行い、
 * 処理はここに寄せる。ここは ports（ports.ts）経由でだけ外部を呼ぶため、
 * フェイクを差して単体テストできる（Issue 7 の lib/ai/handlers.ts と同じ方式）。
 *
 * 認可（共通前提の権限表）：
 * - 適用と確定は family のみ（非認証 401／family 以外 403）
 * - コメントの作成は careManager のみ（非認証 401／careManager 以外 403）
 *
 * 戻り値の約束：
 * - 適用：成功 200 { applied: true, revision, validation }／
 *   版が進んでいた 409（revision_mismatch）／
 *   再検証NG 422 { error: "proposal_rejected", validation }
 * - 確定：成功 200 { confirmed: true, confirmedRevision }／
 *   版が進んでいた 409（revision_mismatch）／
 *   条件を満たさない 422 { error: "not_confirmable", reasons, validation }
 * - コメント：成功 201 { commentId }／本文の字数不正 400
 * ログ・レスポンスにコメント本文などの中身は出さない（requestId と結果だけ）。
 */

import { AiApiError, revisionMismatch, roomNotFound, unauthorized } from "../ai/errors";
import { RevisionConflictError, RoomNotFoundError } from "../room-change";
import type { MemberRole } from "../types";
import { COMMENT_BODY_MAX_LENGTH, type PlanPorts } from "./ports";
import { parseProposal } from "./validate-proposal";

export interface PlanHandlerResult {
  status: number;
  body: unknown;
}

interface ErrorBody {
  error: string;
  message: string;
  requestId: string;
}

function errorResult(
  status: number,
  code: string,
  message: string,
  requestId: string,
): PlanHandlerResult {
  const body: ErrorBody = { error: code, message, requestId };
  return { status, body };
}

function toErrorResult(error: unknown, requestId: string): PlanHandlerResult {
  if (error instanceof AiApiError) {
    return errorResult(error.status, error.code, error.message, requestId);
  }
  if (error instanceof RevisionConflictError) {
    const wrapped = revisionMismatch();
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  if (error instanceof RoomNotFoundError) {
    const wrapped = roomNotFound();
    return errorResult(wrapped.status, wrapped.code, wrapped.message, requestId);
  }
  return errorResult(500, "internal_error", "サーバーでエラーが発生しました", requestId);
}

/** 認証（401）と role 照合（403）を行い、uid を返す */
async function requireRoleUid(
  ports: PlanPorts,
  idToken: string | null,
  roomId: string,
  role: MemberRole,
  forbiddenMessage: string,
): Promise<string> {
  if (!idToken) throw unauthorized();
  const verified = await ports.auth.verifyIdToken(idToken);
  if (!verified) throw unauthorized();
  const actualRole = await ports.membership.getRole(roomId, verified.uid);
  if (actualRole !== role) {
    throw new AiApiError(403, "forbidden", forbiddenMessage);
  }
  return verified.uid;
}

const requireFamilyUid = (ports: PlanPorts, idToken: string | null, roomId: string) =>
  requireRoleUid(
    ports,
    idToken,
    roomId,
    "family",
    "この操作ができるのはルームの family だけです",
  );

const requireCareManagerUid = (
  ports: PlanPorts,
  idToken: string | null,
  roomId: string,
) =>
  requireRoleUid(
    ports,
    idToken,
    roomId,
    "careManager",
    "コメントを作成できるのはケアマネだけです",
  );

// ---------------------------------------------------------------------------
// 代替案の適用（採用）
// ---------------------------------------------------------------------------

export interface ApplyProposalHandlerInput {
  idToken: string | null;
  roomId: string;
  /** Issue 8 が返した正規化済みの代替案（未検証の JSON。そのまま信頼しない） */
  proposal: unknown;
}

/**
 * 代替案をボードへ本適用する。
 * 判定と保存は PlanStorePort が transaction 方式で行う（baseRevision の再確認 →
 * applyChanges → 再検証 → OK なら一括保存。再検証NG・版不一致では保存しない）。
 */
export async function handleApplyProposalRequest(
  ports: PlanPorts,
  input: ApplyProposalHandlerInput,
): Promise<PlanHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);
    const proposal = parseProposal(input.proposal);

    const outcome = await ports.store.applyProposal(input.roomId, proposal);
    switch (outcome.status) {
      case "applied":
        return {
          status: 200,
          body: {
            applied: true,
            revision: outcome.revision,
            validation: outcome.validation,
          },
        };
      case "stale":
        throw revisionMismatch();
      case "rejected":
        return {
          status: 422,
          body: {
            error: "proposal_rejected",
            message:
              "適用後の検証で問題が残るため、この代替案は採用できませんでした",
            validation: outcome.validation,
            requestId,
          },
        };
    }
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// プランの確定
// ---------------------------------------------------------------------------

export interface ConfirmPlanHandlerInput {
  idToken: string | null;
  roomId: string;
  /** 画面が検証していたスナップショットの revision。サーバー側の現在値と照合する */
  expectedRevision: number;
}

/**
 * プランを確定する。
 * 確定できるのは再検証が ok=true・validationErrors なし・unknowns 空のときだけ
 * （判定は evaluateConfirmation）。確定では revision を増やさない。
 */
export async function handleConfirmPlanRequest(
  ports: PlanPorts,
  input: ConfirmPlanHandlerInput,
): Promise<PlanHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    await requireFamilyUid(ports, input.idToken, input.roomId);
    if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return errorResult(
        400,
        "invalid_expected_revision",
        "expectedRevision が不正です",
        requestId,
      );
    }

    const outcome = await ports.store.confirmPlan(
      input.roomId,
      input.expectedRevision,
    );
    switch (outcome.status) {
      case "confirmed":
        return {
          status: 200,
          body: { confirmed: true, confirmedRevision: outcome.confirmedRevision },
        };
      case "stale":
        throw revisionMismatch();
      case "blocked":
        return {
          status: 422,
          body: {
            error: "not_confirmable",
            message: "確定の条件を満たしていないため、確定できません",
            reasons: outcome.reasons,
            validation: outcome.validation,
            requestId,
          },
        };
    }
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}

// ---------------------------------------------------------------------------
// ケアマネのコメント作成
// ---------------------------------------------------------------------------

export interface CreateCommentHandlerInput {
  idToken: string | null;
  roomId: string;
  /** コメント本文（未検証の入力。そのまま信頼しない） */
  body: unknown;
}

/** 文字数（コードポイント単位。日本語の通常の文字は1字＝1） */
function bodyLength(body: string): number {
  return Array.from(body).length;
}

/**
 * コメントを1件作成する。
 * 作成は careManager のみ。本文は1〜1,000字。ID はサーバーが採番し、
 * authorUid は認証 UID、createdAt は保存側がサーバー時刻で付ける。
 * コメントの作成は計算入力の revision を増やさない。
 */
export async function handleCreateCommentRequest(
  ports: PlanPorts,
  input: CreateCommentHandlerInput,
): Promise<PlanHandlerResult> {
  const requestId = crypto.randomUUID();
  try {
    const uid = await requireCareManagerUid(ports, input.idToken, input.roomId);

    if (typeof input.body !== "string") {
      return errorResult(400, "invalid_comment_body", "本文が必要です", requestId);
    }
    const length = bodyLength(input.body);
    if (length < 1 || length > COMMENT_BODY_MAX_LENGTH) {
      return errorResult(
        400,
        "invalid_comment_body",
        `本文は1〜${COMMENT_BODY_MAX_LENGTH}字で入力してください`,
        requestId,
      );
    }

    const id = crypto.randomUUID();
    await ports.store.addComment(input.roomId, {
      id,
      authorUid: uid,
      body: input.body,
    });
    return { status: 201, body: { commentId: id } };
  } catch (error) {
    return toErrorResult(error, requestId);
  }
}
