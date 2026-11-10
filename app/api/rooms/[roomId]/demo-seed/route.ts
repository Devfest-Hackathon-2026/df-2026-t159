/**
 * POST /api/rooms/[roomId]/demo-seed — デモ初期配置投入（Issue 15）。
 *
 * デモルームに「揉めるプラン」を明示操作で読み込む。
 * レスポンス：200 { seeded: true, revision }
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleDemoSeedRequest } from "@/lib/demo/handlers";
import { createDemoPorts } from "@/lib/server/demo-ports";

export const runtime = "nodejs";

const ports = createDemoPorts();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
): Promise<NextResponse> {
  const { roomId } = await context.params;
  const result = await handleDemoSeedRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
  });

  return NextResponse.json(result.body, { status: result.status });
}
