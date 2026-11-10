/**
 * Issue 7／Issue 15：Gemini 構造化 API の Route Handler。
 *
 * 契約（共通前提・Issue 15）：
 * - POST、Content-Type: multipart/form-data
 * - フィールド：roomId（必須）、memo（事情メモ。空でも可）、images（画像ファイル、最大2枚）、demo（"true" でデモ固定応答）
 * - 認可：Authorization: Bearer ＜Firebase ID トークン＞。対象ルームの family のみ
 * - レスポンス：成功時は下書きの制約一式（ConstraintDraft[] ＋ hopes ＋ unknowns、demo フラグ）を JSON で返す
 * - エラー：401／403／413／429／504（共通前提）ほか 400／404／415／502
 *
 * demo="true" の場合は Issue 15 のデモ固定応答経路（handleDemoStructureRequest）を通す。
 */

import { NextResponse, type NextRequest } from "next/server";
import { handleStructureRequest } from "@/lib/ai/handlers";
import { extractBearerToken } from "@/lib/ai/http";
import type { StructureImageInput } from "@/lib/ai/inputValidation";
import { handleDemoStructureRequest } from "@/lib/demo/handlers";
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
  if (!contentType.includes("multipart/form-data")) {
    return jsonError(415, "unsupported_media_type", "multipart/form-data で送ってください");
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return jsonError(400, "invalid_form", "リクエストの形式が不正です");
  }

  const roomId = form.get("roomId");
  if (typeof roomId !== "string" || roomId === "") {
    return jsonError(400, "invalid_room_id", "roomId が必須です");
  }

  const isDemo = form.get("demo") === "true";
  if (isDemo) {
    const result = await handleDemoStructureRequest(demoPorts, {
      idToken: extractBearerToken(request),
      roomId,
    });
    return NextResponse.json(result.body, { status: result.status });
  }

  const memoField = form.get("memo");
  if (memoField !== null && typeof memoField !== "string") {
    return jsonError(400, "invalid_memo", "事情メモの形式が不正です");
  }
  const memo = typeof memoField === "string" ? memoField : "";

  const images: StructureImageInput[] = [];
  for (const entry of form.getAll("images")) {
    if (!(entry instanceof File)) {
      return jsonError(400, "invalid_images", "画像の形式が不正です");
    }
    const buffer = Buffer.from(await entry.arrayBuffer());
    images.push({
      mimeType: entry.type,
      byteLength: entry.size,
      dataBase64: buffer.toString("base64"),
    });
  }

  const result = await handleStructureRequest(ports, {
    idToken: extractBearerToken(request),
    roomId,
    memo,
    images,
  });
  return NextResponse.json(result.body, { status: result.status });
}
