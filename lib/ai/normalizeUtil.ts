/**
 * Gemini の生出力を正規化・検証するための共通部品。
 *
 * 方針（共通前提）：Gemini の生出力は信頼しない。responseSchema は形式の拘束であり、
 * 意味検査の代わりにはしない。形式・範囲・参照の整合が取れない出力は
 * NormalizeError で拒否し、ハンドラ側で 502（invalid_ai_output）として返す。
 */

export class NormalizeError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`AI の出力が不正です: ${reason}`);
    this.name = "NormalizeError";
    this.reason = reason;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fail(reason: string): never {
  throw new NormalizeError(reason);
}

/** 余分なキーがあれば拒否しつつ、許可されたキーだけであることを確認する */
export function assertAllowedKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      fail(`${where} に許可されていない項目「${key}」が含まれています`);
    }
  }
}

/** null は「なし」として除去したコピーを返す（Gemini が null で返す任意項目の吸収用） */
export function stripNulls(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

export function asInt(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${where} は整数でなければなりません`);
  }
  return value as number;
}

export function asString(
  value: unknown,
  where: string,
  maxChars: number,
): string {
  if (typeof value !== "string") {
    fail(`${where} は文字列でなければなりません`);
  }
  const text = value as string;
  if ([...text].length > maxChars) {
    fail(`${where} は ${maxChars} 字以内でなければなりません`);
  }
  return text;
}

/** 配置・制約に共通の時刻範囲検査（ボード範囲は 6≦start＜end≦24） */
export function assertBoardTimeRange(
  startHour: number,
  endHour: number,
  where: string,
): void {
  if (!(startHour >= 6 && startHour < endHour && endHour <= 24)) {
    fail(`${where} の時刻範囲が不正です（6時から24時の範囲で指定してください）`);
  }
}

/** JSON文字列の前後のMarkdownフェンス（```json ... ```）や前置き・後置き文を除去してJSON本体を取り出す */
export function cleanJsonText(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/** unknown 値が JSON 文字列の場合にパースを試みる（Markdownフェンス除去・部分抽出含む） */
export function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    try {
      return JSON.parse(cleanJsonText(value));
    } catch {
      return value;
    }
  }
}
