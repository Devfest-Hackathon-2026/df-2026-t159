/**
 * POST /api/rooms/demo — デモルーム作成（Issue 15）。
 *
 * fixture から専用の作成操作でデモルームを作る。
 * 初回に生成した sourcePersonId→roomPersonId の対応を保存し、以後変更不可とする。
 * ルームに isDemo: true, creatorUid, revision: 0 を保持する。
 *
 * リクエスト：{ initialState?: "troubled" | "empty" }（任意）
 * レスポンス：201 { roomId, personMapping }
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleCreateDemoRoomRequest } from "@/lib/demo/handlers";
import { createDemoPorts } from "@/lib/server/demo-ports";

export const runtime = "nodejs";

const ports = createDemoPorts();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({}));
  const initialState =
    body && typeof body === "object" && body.initialState === "empty"
      ? "empty"
      : "troubled";

  const result = await handleCreateDemoRoomRequest(ports, {
    idToken: extractBearerToken(request),
    initialState,
  });

  return NextResponse.json(result.body, { status: result.status });
}
