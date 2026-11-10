/**
 * Issue 8／Issue 15：代替案 API の Route Handler。
 *
 * 契約（共通前提・Issue 15）：
 * - POST、Content-Type: application/json
 * - ボディ：{ roomId, baseRevision, demo?: boolean }
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。対象ルームの family のみ
 * - レスポンス：成功時は { proposals: Proposal[], baseRevision, demo?: true } を返す。
 *   baseRevision はサーバーが整合スナップショットから付け直した値
 *   各案の validation は試し適用後の検証結果（比較表示用）。採用時は改めて再検証する。
 * - エラー：401／403／429／504（共通前提）ほか 400／404／409（revision 不一致）／415／422／502
 *
 * demo=true の場合は Issue 15 のデモ固定応答経路（handleDemoProposalsRequest）を通す。
 * 通常時は lib/ai/handlers.ts（handleProposalsRequest）を通す。
 */

import { NextResponse, type NextRequest } from "next/server";
import { handleProposalsRequest } from "@/lib/ai/handlers";
import { extractBearerToken } from "@/lib/ai/http";
import { handleDemoProposalsRequest } from "@/lib/demo/handlers";
import { createDemoPorts } from "@/lib/server/demo-ports";
import { createServerPorts } from "@/lib/server/ports";

export const runtime = "nodejs";

// 接続点はモジュールスコープで1回だけ組み立てる
const ports = createServerPorts();
const demoPorts = createDemoPorts();

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
  const { roomId, baseRevision, demo } = body as Record<string, unknown>;
  if (typeof roomId !== "string" || roomId === "") {
    return jsonError(400, "invalid_room_id", "roomId が必須です");
  }
  if (typeof baseRevision !== "number") {
    return jsonError(400, "invalid_base_revision", "baseRevision が必須です");
  }

  if (demo === true) {
    const result = await handleDemoProposalsRequest(demoPorts, {
      idToken: extractBearerToken(request),
      roomId,
      baseRevision,
    });
    return NextResponse.json(result.body, { status: result.status });
  }

  const result = await handleProposalsRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    baseRevision,
  });
  return NextResponse.json(result.body, { status: result.status });
}
