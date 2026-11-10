/**
 * POST /api/rooms/[roomId]/invites — 招待リンクの発行（Issue 2）。
 *
 * 発行できるのは対象ルームの既存 family のみ。トークンはサーバー側に
 * ハッシュだけを保存し、本体はこのレスポンスでのみ返す（ログに出さない）。
 * リクエスト：{ role: "family" | "careManager" }
 * レスポンス：200 { token, role, expiresAt, joinPath }
 */

import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  newRequestId,
  readJsonBody,
  requireUid,
} from "@/lib/server/http";
import { createInvite } from "@/lib/server/rooms";

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
    const result = await createInvite(uid, roomId, body.role);
    return NextResponse.json({
      ...result,
      joinPath: `/rooms/${roomId}?invite=${result.token}`,
    });
  } catch (err) {
    return apiErrorResponse(err, requestId);
  }
}
