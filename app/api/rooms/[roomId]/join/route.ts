/**
 * POST /api/rooms/[roomId]/join — 招待による参加確定（Issue 2）。
 *
 * Firebase ID トークンを検証し、招待の保存値だけを検証・採用して role を決める
 * （リクエストで送られた role は採用しない）。参加確定と membership 作成は
 * サーバー側の transaction で処理する。
 * リクエスト：{ token: string }
 * レスポンス：200 { role, alreadyMember }
 */

import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  newRequestId,
  readJsonBody,
  requireUid,
} from "@/lib/server/http";
import { joinRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ roomId: string }> },
) {
  const requestId = newRequestId();
  try {
    const uid = await requireUid(req);
    const { roomId } = await params;
    const body = await readJsonBody(req);
    const result = await joinRoom(uid, roomId, body.token);
    return NextResponse.json(result);
  } catch (err) {
    return apiErrorResponse(err, requestId);
  }
}
