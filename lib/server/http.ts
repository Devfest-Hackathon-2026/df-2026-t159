/**
 * Route Handler の共通処理（Issue 2）。
 *
 * - 全 Route Handler は Firebase ID トークンを検証する（Authorization: Bearer）
 * - ログに出すのは requestId と結果コードだけ。
 *   ID トークン・招待トークン・リクエスト本文はログに出さない
 */

import { NextResponse } from "next/server";
import { ApiError } from "./errors";
import { adminAuth } from "./firebase-admin";

/** Authorization ヘッダーの Firebase ID トークンを検証し、UID を返す。失敗時は 401 */
export async function requireUid(req: Request): Promise<string> {
  const header = req.headers.get("authorization");
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : null;
  if (!token) {
    throw new ApiError(401, "unauthorized");
  }
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    throw new ApiError(401, "unauthorized");
  }
}

/** リクエスト相関用のID（ログに残すのはこのIDと結果コードだけ） */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/** 例外を API レスポンスへ変換する。機微情報は含めない */
export function apiErrorResponse(err: unknown, requestId: string): NextResponse {
  if (err instanceof ApiError) {
    console.error(JSON.stringify({ requestId, code: err.code, status: err.status }));
    return NextResponse.json({ error: err.code }, { status: err.status });
  }
  console.error(JSON.stringify({ requestId, code: "internal_error" }));
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

/** JSON ボディをオブジェクトとして読む。形式が違う場合は 400 */
export async function readJsonBody(
  req: Request,
): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "invalid_body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body");
  }
  return body as Record<string, unknown>;
}
