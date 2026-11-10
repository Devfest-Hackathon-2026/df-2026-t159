/**
 * Gemini 呼び出しの実物（@google/genai）。
 *
 * - APIキーはサーバーの環境変数 GEMINI_API_KEY だけから読む
 *   （ブラウザへ配布される変数には絶対に入れない）
 * - モデル名は環境変数 GEMINI_MODEL、未設定時の既定値は gemini-3.5-flash-lite
 * - 応答は JSON モード＋ responseSchema で拘束し、パースして返す
 *
 * 注意：GEMINI_API_KEY が未発行のため、この実物経由の実APIコールは未検証。
 * 疎通確認はキー発行後に行うこと（単体テストは FakeGeminiPort で代替する）。
 */

import { GoogleGenAI, type Part } from "@google/genai";
import { GeminiOutputParseError, NotWiredError } from "../ai/errors";
import { cleanJsonText } from "../ai/normalizeUtil";
import type { GeminiPort } from "../ai/ports";

export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export function createGeminiPort(
  env: NodeJS.ProcessEnv = process.env,
): GeminiPort {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      async generateJson(): Promise<unknown> {
        throw new NotWiredError("GEMINI_API_KEY");
      },
    };
  }
  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateJson({ prompt, images, responseSchema, signal }) {
      const parts: Part[] = [{ text: prompt }];
      for (const image of images ?? []) {
        parts.push({
          inlineData: { mimeType: image.mimeType, data: image.dataBase64 },
        });
      }
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseSchema,
          abortSignal: signal,
        },
      });
      const text = response.text;
      if (!text) {
        throw new GeminiOutputParseError();
      }
      try {
        return JSON.parse(text) as unknown;
      } catch {
        try {
          return JSON.parse(cleanJsonText(text)) as unknown;
        } catch {
          throw new GeminiOutputParseError();
        }
      }
    },
  };
}
