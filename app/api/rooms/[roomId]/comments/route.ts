/**
 * Issue 14：ケアマネのコメント作成 API の Route Handler。
 *
 * 契約：
 * - POST、Content-Type: application/json
 * - ボディ：{ body } が必須（コメント本文、1〜1,000字）
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。
 *   対象ルームの careManager のみ（family は作成できない）
 * - レスポンス：成功時は 201 { commentId }。本文の字数不正は 400
 *
 * 処理本体は lib/plan/handlers.ts（handleCreateCommentRequest）。
 * authorUid は認証 UID、createdAt はサーバー時刻で保存する
 * （クライアントから送られた値は採用しない）。
 * コメントの作成は計算入力の revision を増やさない。本文はログに出さない。
 * 閲覧は Client SDK 直（Firestore ルールで参加者のみ可）に任せる。
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleCreateCommentRequest } from "@/lib/plan/handlers";
import { createPlanPorts } from "@/lib/server/plan-ports";

export const runtime = "nodejs";

// 接続点はモジュールスコープで1回だけ組み立てる
const ports = createPlanPorts();

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> },
): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonError(415, "unsupported_media_type", "application/json で送ってください");
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "invalid_body", "リクエストの形式が不正です");
  }

  const { roomId } = await params;
  const result = await handleCreateCommentRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    body: (body as Record<string, unknown>).body,
  });
  return NextResponse.json(result.body, { status: result.status });
}
