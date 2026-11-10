/**
 * POST /api/rooms — ルーム作成（Issue 2）。
 *
 * Firebase ID トークンを検証し、作成者を family として membership を同時発行する。
 * membership の発行はサーバー側（Admin SDK）に集約する。
 * リクエスト：{ people: Person[], careWindows?: CareWindow[], copayRate?: 1|2|3 }
 * レスポンス：201 { roomId }
 */

import { NextResponse } from "next/server";
import {
  apiErrorResponse,
  newRequestId,
  readJsonBody,
  requireUid,
} from "@/lib/server/http";
import {
  createRoom,
  validateCareWindows,
  validateCopayRate,
  validatePeople,
} from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const requestId = newRequestId();
  try {
    const uid = await requireUid(req);
    const body = await readJsonBody(req);
    const people = validatePeople(body.people);
    const careWindows =
      body.careWindows === undefined
        ? []
        : validateCareWindows(body.careWindows);
    const copayRate =
      body.copayRate === undefined ? 1 : validateCopayRate(body.copayRate);
    const { roomId } = await createRoom(uid, { people, careWindows, copayRate });
    return NextResponse.json({ roomId }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, requestId);
  }
}
