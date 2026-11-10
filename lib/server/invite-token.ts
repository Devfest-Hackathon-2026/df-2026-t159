/**
 * 招待トークンの生成とハッシュ化（純粋ロジック。Issue 2）。
 *
 * 仕様（共通前提）：トークンは128bit以上のランダム値・有効24時間・1回のみ使用。
 * サーバー側にはトークン本体ではなくハッシュだけを保存し、
 * 招待ドキュメントのIDにもハッシュを使う（原本は保存しない）。
 * トークン本体・ハッシュともログに出さないこと。
 */

import { createHash, randomBytes } from "node:crypto";

/** 招待トークンの乱数バイト数。32バイト＝256bit（下限128bitを満たす） */
export const INVITE_TOKEN_BYTES = 32;

/** 招待トークンの有効期間（24時間） */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

/** 招待トークン本体を生成する（base64url 文字列） */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** 保存・照合用にトークンを SHA-256 ハッシュ化する（16進数64文字） */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** リクエストで送られたトークンが想定の形かどうか（形式チェックのみ） */
export function isInviteTokenShape(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}
