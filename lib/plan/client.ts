/**
 * プランの確定・代替案の適用・ケアマネコメント（Issue 14）のクライアント側呼び出し。
 *
 * 書き込み（適用・確定・コメント作成）は Route Handler 経由に集約する
 * （ID トークンを付け、サーバーで認可と transaction を担保する）。
 * コメントの閲覧だけは Client SDK 直で読む（Firestore ルールで参加者のみ可。
 * 時系列＝createdAt の昇順）。
 */

import { collection, getDocsFromServer, orderBy, query } from "firebase/firestore";
import { getIdToken } from "../auth";
import { db } from "../firebase";
import {
  firestorePaths,
  type Proposal,
  type RoomComment,
  type ValidationResult,
} from "../types";

/** API が返したエラー（status と理由コードを持つ） */
export class PlanApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** 422 のときにサーバーが返した検証結果（理由の表示用） */
  readonly validation?: ValidationResult;

  constructor(
    status: number,
    code: string,
    message: string,
    validation?: ValidationResult,
  ) {
    super(message);
    this.name = "PlanApiError";
    this.status = status;
    this.code = code;
    this.validation = validation;
  }
}

async function postJson(
  path: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  const token = await getIdToken();
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new PlanApiError(
      res.status,
      typeof data.error === "string" ? data.error : "unknown_error",
      typeof data.message === "string"
        ? data.message
        : "通信に失敗しました。もう一度お試しください",
      data.validation as ValidationResult | undefined,
    );
  }
  return data;
}

/**
 * 代替案を本適用する。成功時は保存後の revision を返す。
 * 版が進んでいた場合（409）・適用後の再検証でNGの場合（422）は
 * PlanApiError を throw し、何も保存されていない。
 */
export async function applyProposal(
  roomId: string,
  proposal: Proposal,
): Promise<{ revision: number; validation: ValidationResult }> {
  const data = await postJson(`/api/rooms/${roomId}/apply-proposal`, {
    proposal,
  });
  return {
    revision: data.revision as number,
    validation: data.validation as ValidationResult,
  };
}

/**
 * プランを確定する。成功時は confirmedRevision を返す。
 * 版が進んでいた場合（409）・確定条件を満たさない場合（422）は
 * PlanApiError を throw し、何も保存されていない。
 */
export async function confirmPlan(
  roomId: string,
  expectedRevision: number,
): Promise<{ confirmedRevision: number }> {
  const data = await postJson(`/api/rooms/${roomId}/confirm`, {
    expectedRevision,
  });
  return { confirmedRevision: data.confirmedRevision as number };
}

/** ケアマネのコメントを1件作成する。成功時はコメントIDを返す */
export async function postComment(
  roomId: string,
  body: string,
): Promise<{ commentId: string }> {
  const data = await postJson(`/api/rooms/${roomId}/comments`, { body });
  return { commentId: data.commentId as string };
}

/** コメントを時系列（古い順）で読む。未参加者は Firestore ルールで読めない */
export async function listComments(roomId: string): Promise<RoomComment[]> {
  const snap = await getDocsFromServer(
    query(
      collection(db, firestorePaths.comments(roomId)),
      orderBy("createdAt", "asc"),
    ),
  );
  return snap.docs.map((d) => d.data() as RoomComment);
}
