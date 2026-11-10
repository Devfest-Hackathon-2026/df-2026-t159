/**
 * Issue 14：プランの「確定」API の Route Handler。
 *
 * 契約：
 * - POST、Content-Type: application/json
 * - ボディ：{ expectedRevision } が必須（画面が検証していたスナップショットの版）
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。対象ルームの family のみ
 * - レスポンス：成功時は { confirmed: true, confirmedRevision }。
 *   版が進んでいた場合は 409、確定条件を満たさない場合は 422
 *   （{ error: "not_confirmable", reasons, validation }）で、どちらも保存しない
 *
 * 処理本体は lib/plan/handlers.ts（handleConfirmPlanRequest）。
 * 確定できるのは再検証が ok=true・validationErrors なし・unknowns 空のときだけ。
 * 確定は expectedRevision 付き transaction で summary に保存し、
 * 確定のみでは revision を増やさない。Gemini は呼ばないため回数枠は消費しない。
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleConfirmPlanRequest } from "@/lib/plan/handlers";
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
  const { expectedRevision } = body as Record<string, unknown>;
  if (typeof expectedRevision !== "number") {
    return jsonError(400, "invalid_expected_revision", "expectedRevision が必須です");
  }

  const { roomId } = await params;
  const result = await handleConfirmPlanRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    expectedRevision,
  });
  return NextResponse.json(result.body, { status: result.status });
}
