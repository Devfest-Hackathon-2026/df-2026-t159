/**
 * POST /api/rooms/[roomId]/reset — デモルームリセット（Issue 15）。
 *
 * デモ用ルーム限定（isDemo）・ルーム作成者のみ実行可（creatorUid 一致）。
 * 保持するもの＝members・people・人物対応・creatorUid・コメント。
 * 固定初期値へ復元するもの＝配置・constraints・hopes・unknowns・careWindows・負担割合。
 * summary は削除し、代替案のキャッシュは失効させる。
 * 全計算入力と revision の +1 を一括保存し、revision を 0 に戻さない。
 *
 * レスポンス：200 { reset: true, revision }
 */

import { NextResponse, type NextRequest } from "next/server";
import { extractBearerToken } from "@/lib/ai/http";
import { handleResetDemoRoomRequest } from "@/lib/demo/handlers";
import { createDemoPorts } from "@/lib/server/demo-ports";

export const runtime = "nodejs";

const ports = createDemoPorts();

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ roomId: string }> },
): Promise<NextResponse> {
  const { roomId } = await context.params;
  const result = await handleResetDemoRoomRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
  });

  return NextResponse.json(result.body, { status: result.status });
}
