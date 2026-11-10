/**
 * Issue 7：構造化結果の保存 API の Route Handler。
 *
 * 契約：
 * - POST、Content-Type: application/json
 * - ボディ：{ roomId, baseRevision, constraints, hopes, unknowns } が必須。
 *   constraints の各要素は構造化の下書き（ConstraintDraft）に、確認画面で
 *   利用者が選んだ personId を加えた形
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。対象ルームの family のみ
 * - レスポンス：成功時は { revision }（保存後の新しい revision）を返す
 * - エラー：401／403／400（結びつけ・形式の不備）／404／409（revision 不一致）
 *
 * 処理本体は lib/ai/handlers.ts（handleStructureSaveRequest）。
 * personId への結びつけは利用者が選んだ値だけを採用し、名前からの自動一致はしない。
 * 保存は commitRoomChange と同じ意味論（revision の +1 と同一 transaction）で行う。
 * Gemini は呼ばないため、回数枠は消費しない。制約本文はログに出さない。
 */

import { NextResponse, type NextRequest } from "next/server";
import { handleStructureSaveRequest } from "@/lib/ai/handlers";
import { extractBearerToken } from "@/lib/ai/http";
import { createServerPorts } from "@/lib/server/ports";

export const runtime = "nodejs";

// 接続点はモジュールスコープで1回だけ組み立てる
const ports = createServerPorts();

function jsonError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonError(415, "unsupported_media_type", "application/json で送ってください");
  }

  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return jsonError(400, "invalid_body", "リクエストの形式が不正です");
  }
  const {
    roomId,
    baseRevision,
    constraints,
    hopes,
    unknowns,
    careWindows,
    copayRate,
  } = body as Record<string, unknown>;
  if (typeof roomId !== "string" || roomId === "") {
    return jsonError(400, "invalid_room_id", "roomId が必須です");
  }
  if (typeof baseRevision !== "number") {
    return jsonError(400, "invalid_base_revision", "baseRevision が必須です");
  }

  const result = await handleStructureSaveRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    baseRevision,
    constraints,
    hopes,
    unknowns,
    careWindows,
    copayRate,
  });
  return NextResponse.json(result.body, { status: result.status });
}
