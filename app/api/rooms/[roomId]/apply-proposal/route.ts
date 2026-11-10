/**
 * Issue 14：代替案の「採用」（本適用）API の Route Handler。
 *
 * 契約：
 * - POST、Content-Type: application/json
 * - ボディ：{ proposal } が必須。proposal は Issue 8 の代替案APIが返した
 *   正規化済みの代替案（summary／changes／baseRevision）
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。対象ルームの family のみ
 * - レスポンス：成功時は { applied: true, revision, validation }。
 *   版が進んでいた場合は 409、適用後の再検証でNGの場合は 422
 *   （{ error: "proposal_rejected", validation }）で、どちらも保存しない
 *
 * 処理本体は lib/plan/handlers.ts（handleApplyProposalRequest）。
 * 適用は transaction 内で baseRevision を再確認し、applyChanges → 再検証 →
 * OK のときだけ一括保存する（Issue 8 の試し適用と同じ applyChanges を使う）。
 * Gemini は呼ばないため、回数枠は消費しない。
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleApplyProposalRequest } from "@/lib/plan/handlers";
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
  const result = await handleApplyProposalRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    proposal: (body as Record<string, unknown>).proposal,
  });
  return NextResponse.json(result.body, { status: result.status });
}
