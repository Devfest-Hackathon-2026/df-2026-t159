/**
 * Gemini 構造化 API（Issue 7）の入力制限と、そのサーバー側バリデーション。
 *
 * 数値の正本は共通前提「Gemini の認可と制限」：
 * - 画像は1枚 5MB まで・合計2枚まで
 * - 事情メモは 4,000 字まで
 * - 応答タイムアウトは 30 秒
 * - 呼び出しは構造化・代替案あわせて1ルームあたり1時間に10回まで
 *
 * このモジュールは純粋関数のみで構成し、単体テストで検証する。
 */

import { payloadTooLarge, badRequest } from "./errors";

/** 画像1枚の最大サイズ（バイト） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 画像の最大枚数 */
export const MAX_IMAGE_COUNT = 2;

/** 事情メモの最大文字数（コードポイント数で数える） */
export const MAX_MEMO_CHARS = 4000;

/** Gemini 呼び出しのタイムアウト（ミリ秒） */
export const GEMINI_TIMEOUT_MS = 30_000;

/** Gemini 呼び出し回数の上限（1ルーム・1時間あたり。構造化と代替案の合算） */
export const GEMINI_CALL_LIMIT_PER_HOUR = 10;

/** 受け付ける画像の MIME タイプ（書類の写真を想定） */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** 構造化 API に渡される画像1枚分（Route Handler が multipart から組み立てる） */
export interface StructureImageInput {
  mimeType: string;
  /** バイト数（File.size 由来。base64 化前の実サイズ） */
  byteLength: number;
  /** 画像本体（base64）。DB／Storage へ保存せず、ログにも出さない */
  dataBase64: string;
}

/** 文字数をコードポイント数で数える（サロゲートペアを1文字として扱う） */
export function countChars(text: string): number {
  return [...text].length;
}

/**
 * 構造化 API の入力（メモ＋画像）を検査する。
 * 制限超過は 413、形式の不正は 400 の AiApiError を throw する。
 */
export function validateStructureInput(input: {
  memo: string;
  images: StructureImageInput[];
}): void {
  const { memo, images } = input;

  if (typeof memo !== "string") {
    throw badRequest("invalid_memo", "事情メモの形式が不正です");
  }
  if (countChars(memo) > MAX_MEMO_CHARS) {
    throw payloadTooLarge(
      "memo_too_long",
      `事情メモは ${MAX_MEMO_CHARS} 字までです`,
    );
  }

  if (!Array.isArray(images)) {
    throw badRequest("invalid_images", "画像の形式が不正です");
  }
  if (images.length > MAX_IMAGE_COUNT) {
    throw payloadTooLarge(
      "too_many_images",
      `画像は合計 ${MAX_IMAGE_COUNT} 枚までです`,
    );
  }
  for (const image of images) {
    if (
      !(ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(image.mimeType)
    ) {
      throw badRequest(
        "unsupported_image_type",
        "画像は JPEG／PNG／WebP のいずれかで送ってください",
      );
    }
    if (
      typeof image.byteLength !== "number" ||
      !Number.isFinite(image.byteLength) ||
      image.byteLength < 0
    ) {
      throw badRequest("invalid_images", "画像の形式が不正です");
    }
    if (image.byteLength > MAX_IMAGE_BYTES) {
      throw payloadTooLarge(
        "image_too_large",
        "画像は1枚 5MB までです",
      );
    }
  }
}
