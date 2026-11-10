/**
 * Gemini 連携 API（Issue 7・8）で使う HTTP エラーの共通表現。
 *
 * ステータスと理由コードの対応は共通前提に固定する：
 * 非認証 401／非 family 403／入力超過 413／回数超過 429／処理時間超過 504。
 * それ以外は 400（リクエスト形式）・404（ルームなし）・409（revision 不一致）・
 * 415（Content-Type 不一致）・502（AI の出力・上流の異常）を使う。
 * エラーメッセージに、画像・メモ本文・制約本文・トークンなどの中身は含めない。
 */

export class AiApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AiApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * サーバー側の接続点（Issue 2 の Admin SDK 実装など）がまだ差し込まれていない状態。
 * ハンドラでは 500（server_not_configured）として返す。
 * 統合時に lib/server/ports.ts の実装へ差し替えること。
 */
export class NotWiredError extends Error {
  constructor(what: string) {
    super(`${what} はまだ接続されていません（Issue 2 統合時に接続します）`);
    this.name = "NotWiredError";
  }
}

/** Gemini の応答テキストが JSON として読めなかった場合（形式不正 → 502） */
export class GeminiOutputParseError extends Error {
  constructor() {
    super("Gemini の応答を JSON として読み取れませんでした");
    this.name = "GeminiOutputParseError";
  }
}

export const unauthorized = (): AiApiError =>
  new AiApiError(401, "unauthorized", "認証が必要です。再度ログインしてください");

export const forbidden = (): AiApiError =>
  new AiApiError(403, "forbidden", "この機能を使えるのは家族として参加した方だけです");

export const badRequest = (code: string, message: string): AiApiError =>
  new AiApiError(400, code, message);

export const payloadTooLarge = (code: string, message: string): AiApiError =>
  new AiApiError(413, code, message);

export const roomNotFound = (): AiApiError =>
  new AiApiError(404, "room_not_found", "ルームが見つかりません");

export const revisionMismatch = (): AiApiError =>
  new AiApiError(
    409,
    "revision_mismatch",
    "ボードの内容が更新されています。最新の状態でやり直してください",
  );

export const rateLimited = (): AiApiError =>
  new AiApiError(
    429,
    "rate_limited",
    "AI の呼び出し回数が上限（1時間に10回）に達しました。時間を置いてお試しください",
  );

export const gatewayTimeout = (): AiApiError =>
  new AiApiError(504, "gateway_timeout", "30秒以内にAIから返事がありませんでした。もう一度お試しください");

export const invalidAiOutput = (message: string): AiApiError =>
  new AiApiError(502, "invalid_ai_output", message);

export const aiUpstreamError = (): AiApiError =>
  new AiApiError(502, "ai_upstream_error", "AI の呼び出しに失敗しました");
