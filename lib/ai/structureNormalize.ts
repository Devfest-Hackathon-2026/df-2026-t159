/**
 * Gemini 構造化（Issue 7）の出力の正規化・検証（純粋関数）。
 *
 * 入力は Gemini の生出力（unknown）。出力は下書きの制約一式
 * { constraints: ConstraintDraft[], hopes: string[], unknowns: string[] }。
 * 下書きは名前（memberName）ベースで、personId への結びつけは確認画面側（保存時）の責務。
 *
 * 正規化ポリシー：
 * - 意味が変わらない安全な正規化は許容する：
 *   - 未知の余分なキーは捨てる
 *   - Markdownコードフェンス（```json ... ```）や前置き・後置き文の混入を吸収する
 *   - 列挙値（type）の表記ゆれ・同義語（日本語「仕事」「外出」「希望」「その他」等、大文字小文字）を正規化する
 *   - 曜日の形式ゆれ（単数値、日本語表記「月」「水曜」「平日」「土日」、全角数字）を正規化する
 *   - 時刻の形式ゆれ（「9時」「18時」「24:00」「24時」、全角数字、数値文字列）を正規化する
 *   - 任意項目の欠落・空文字は既定値（配列は空配列、時刻は未設定）で補う
 *   - days の重複除去とソート、hopes／unknowns の空文字除去
 * - 従来どおり拒否するもの：
 *   - enum外の値（無関係な type など）
 *   - 解釈できない時刻（「午前9時」「09:30」など）、時刻範囲の不正（逆転等）
 *   - 核になる配列の型違い（constraints がオブジェクトなど）
 *   - 必須項目の欠落・空文字（memberName, detail, timed 制約の曜日・時刻）
 */

import type {
  Constraint,
  ConstraintDraft,
  ConstraintType,
  DayIndex,
} from "../types";
import {
  NormalizeError,
  asString,
  fail,
  isRecord,
  stripNulls,
  tryParseJson,
} from "./normalizeUtil";

export { NormalizeError };

/** 下書きの件数・長さの上限（サーバー側検査。共通前提「配列件数・各文字列長も検査する」） */
export const MAX_DRAFT_CONSTRAINTS = 50;
export const MAX_DRAFT_LIST_ITEMS = 20;
export const MAX_MEMBER_NAME_CHARS = 50;
export const MAX_DETAIL_CHARS = 500;
export const MAX_LIST_ITEM_CHARS = 200;

export interface StructureDraftResult {
  constraints: ConstraintDraft[];
  hopes: string[];
  unknowns: string[];
}

export interface StructureNormalizeOptions {
  /**
   * 一部の制約が形式不正（時刻欠落など）の場合に、その制約を unknowns に落として
   * 正常な制約だけを救うかどうか（既定: false = 厳格検証で NormalizeError）。
   * handlers.ts のリトライ後フォールバックなどで利用する。
   */
  allowPartial?: boolean;
}

const JAPANESE_DAY_MAP: Record<string, number> = {
  月: 0,
  月曜: 0,
  月曜日: 0,
  mon: 0,
  monday: 0,
  火: 1,
  火曜: 1,
  火曜日: 1,
  tue: 1,
  tuesday: 1,
  水: 2,
  水曜: 2,
  水曜日: 2,
  wed: 2,
  wednesday: 2,
  木: 3,
  木曜: 3,
  木曜日: 3,
  thu: 3,
  thursday: 3,
  金: 4,
  金曜: 4,
  金曜日: 4,
  fri: 4,
  friday: 4,
  土: 5,
  土曜: 5,
  土曜日: 5,
  sat: 5,
  saturday: 5,
  日: 6,
  日曜: 6,
  日曜日: 6,
  sun: 6,
  sunday: 6,
};

/**
 * 保存済みデータ（Firestore の既存データや localStorage の下書き）の type を正規化する。
 * 旧データの "work" は "unavailable"（対応不可）として扱う。
 */
export function normalizeSavedConstraintType(raw: unknown): ConstraintType {
  if (raw === "work" || raw === "unavailable") {
    return "unavailable";
  }
  if (raw === "hope") {
    return "hope";
  }
  return "other";
}

/**
 * 保存リクエスト等で受け取った type の旧値（"work"）を "unavailable" に写像する。
 * それ以外の値はそのまま返し、呼び出し側の検証に委ねる。
 */
export function normalizeLegacyConstraintTypeInput(raw: unknown): unknown {
  return raw === "work" ? "unavailable" : raw;
}

/**
 * Firestore 等から読み込んだ Constraint 配列の旧 type（"work"）を "unavailable" に正規化する。
 */
export function normalizeSavedConstraints(
  constraints: readonly Constraint[] | undefined | null,
): Constraint[] {
  if (!Array.isArray(constraints)) return [];
  return constraints.map((c) => {
    const rawType = (c as { type?: unknown }).type;
    if (rawType === "work") {
      return { ...c, type: "unavailable" };
    }
    return c;
  });
}

function normalizeType(raw: unknown, where: string): ConstraintType {
  if (typeof raw !== "string") {
    fail(`${where} の type が不正です`);
  }
  const trimmed = raw.trim().toLowerCase().replace(/[-_\s]/g, "");
  // unavailable: 対応不可, 不可, 仕事, 勤務, 就労, 就業, 業務, 外出, 用事, 通院, 都合不可, unavailable, notavailable, work（旧値・仕事系を統合）
  if (
    trimmed === "unavailable" ||
    trimmed === "notavailable" ||
    trimmed === "work" ||
    trimmed === "対応不可" ||
    trimmed === "不可" ||
    trimmed === "仕事" ||
    trimmed === "勤務" ||
    trimmed === "就労" ||
    trimmed === "就業" ||
    trimmed === "業務" ||
    trimmed === "外出" ||
    trimmed === "用事" ||
    trimmed === "通院" ||
    trimmed === "都合不可"
  ) {
    return "unavailable";
  }
  // hope: 希望, 要望, 付き添い可能, 対応可能, 可能, hope
  if (
    trimmed === "hope" ||
    trimmed === "希望" ||
    trimmed === "要望" ||
    trimmed === "付き添い可能" ||
    trimmed === "対応可能" ||
    trimmed === "可能"
  ) {
    return "hope";
  }
  // other: その他, other
  if (trimmed === "other" || trimmed === "その他") {
    return "other";
  }
  fail(`${where} の type が不正です`);
}

function parseHour(value: unknown, where: string): number {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      fail(`${where} は整数でなければなりません`);
    }
    return value;
  }
  if (typeof value === "string") {
    // 全角英数字・コロンを半角に変換
    const normalized = value
      .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
      .replace(/：/g, ":")
      .trim();

    // 「午前9時」「午後5時」など特定しきれない・非標準な表現は拒否（既存テスト準拠）
    if (normalized.startsWith("午前") || normalized.startsWith("午後")) {
      fail(`${where} は有効な時刻でなければなりません`);
    }

    // "24:00" や "09:00", "9:00", "24:00:00" などの時刻表記
    const timeMatch = /^(\d{1,2}):00(?::00)?$/.exec(normalized);
    if (timeMatch) {
      return parseInt(timeMatch[1], 10);
    }
    // "9時", "18時", "24時", "9時00分" などの日本語時刻表記
    const jpHourMatch = /^(\d{1,2})時(?:00分)?$/.exec(normalized);
    if (jpHourMatch) {
      return parseInt(jpHourMatch[1], 10);
    }
    // "9", "24", "0" などの整数文字列
    if (/^\d+$/.test(normalized)) {
      return parseInt(normalized, 10);
    }
  }
  fail(`${where} は有効な時刻でなければなりません`);
}

function parseSingleDay(item: unknown, where: string): number[] {
  if (typeof item === "number") {
    if (Number.isInteger(item) && item >= 0 && item <= 6) {
      return [item];
    }
    fail(`${where} は 0〜6 の曜日でなければなりません`);
  }
  if (typeof item === "string") {
    const trimmed = item.trim().toLowerCase();
    // 全角数字を半角に変換
    const half = trimmed.replace(/[０-６]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0),
    );

    // マクロ表現
    if (half === "平日") {
      return [0, 1, 2, 3, 4];
    }
    if (half === "土日" || half === "週末") {
      return [5, 6];
    }
    if (half === "毎日" || half === "全日" || half === "全曜日") {
      return [0, 1, 2, 3, 4, 5, 6];
    }
    // カンマ区切りの複数曜日
    if (half.includes(",")) {
      const parts = half
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      return parts.flatMap((p) => parseSingleDay(p, where));
    }
    // 整数文字列
    if (/^\d+$/.test(half)) {
      const num = parseInt(half, 10);
      if (num >= 0 && num <= 6) {
        return [num];
      }
      fail(`${where} は 0〜6 の曜日でなければなりません`);
    }
    // 日本語・英語の曜日表記
    if (half in JAPANESE_DAY_MAP) {
      return [JAPANESE_DAY_MAP[half]];
    }
  }
  fail(`${where} は 0〜6 の曜日でなければなりません`);
}

function normalizeDays(value: unknown, where: string): DayIndex[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  let items: unknown[];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "number" || typeof value === "string") {
    items = [value];
  } else {
    fail(`${where} は配列でなければなりません`);
  }

  const days = new Set<number>();
  for (const item of items) {
    if (item === null || item === undefined || item === "") continue;
    const parsed = parseSingleDay(item, where);
    for (const d of parsed) {
      days.add(d);
    }
  }
  return [...days].sort((a, b) => a - b) as DayIndex[];
}

function normalizeHourPair(
  obj: Record<string, unknown>,
  required: boolean,
  where: string,
): { startHour?: number; endHour?: number } {
  const rawStart = obj.startHour;
  const rawEnd = obj.endHour;
  const hasStart =
    rawStart !== undefined && rawStart !== null && rawStart !== "";
  const hasEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== "";

  if (hasStart !== hasEnd) {
    fail(`${where} の時刻は開始と終了をそろえて指定してください`);
  }
  if (!hasStart) {
    if (required) {
      fail(`${where} には時刻が必須です`);
    }
    return {};
  }
  const startHour = parseHour(rawStart, `${where} の startHour`);
  const endHour = parseHour(rawEnd, `${where} の endHour`);
  // 制約の時刻規則：整数時間で 0≦startHour＜endHour≦24（日またぎは日別に分割する）
  if (!(startHour >= 0 && startHour < endHour && endHour <= 24)) {
    fail(`${where} の時刻範囲が不正です`);
  }
  return { startHour, endHour };
}

function normalizeConstraint(value: unknown, index: number): ConstraintDraft {
  const where = `constraints[${index}]`;
  if (!isRecord(value)) {
    fail(`${where} はオブジェクトでなければなりません`);
  }
  const obj = stripNulls(value);
  // 未知の余分なキーは捨てる（assertAllowedKeys は行わない）

  const memberName = asString(
    obj.memberName,
    `${where} の memberName`,
    MAX_MEMBER_NAME_CHARS,
  );
  if (memberName.trim() === "") {
    fail(`${where} の memberName が空です`);
  }
  const detail = asString(obj.detail, `${where} の detail`, MAX_DETAIL_CHARS);
  if (detail.trim() === "") {
    fail(`${where} の detail が空です`);
  }
  const type = normalizeType(obj.type, where);
  const days = normalizeDays(obj.days, `${where} の days`);

  // unavailable は時刻と曜日が必須（不完全な必須制約は保存時に検証エラーになるため、
  // 下書きの正規化の時点で形式として拒否する）
  const timed = type === "unavailable";
  if (timed && days.length === 0) {
    fail(`${where}（${type}）には曜日が必須です`);
  }
  const hours = normalizeHourPair(obj, timed, where);

  return {
    memberName: memberName.trim(),
    type,
    detail: detail.trim(),
    days,
    ...hours,
  };
}

function normalizeStringList(value: unknown, where: string): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }
  let items: unknown[];
  if (Array.isArray(value)) {
    items = value;
  } else if (typeof value === "string") {
    items = [value];
  } else {
    fail(`${where} は配列でなければなりません`);
  }
  if (items.length > MAX_DRAFT_LIST_ITEMS) {
    fail(`${where} は ${MAX_DRAFT_LIST_ITEMS} 件までです`);
  }
  const out: string[] = [];
  for (const item of items) {
    if (item === null || item === undefined) continue;
    const text = asString(item, `${where} の要素`, MAX_LIST_ITEM_CHARS);
    if (text.trim() !== "") out.push(text.trim());
  }
  return out;
}

/** Gemini の生出力を下書きの制約一式へ正規化する。不正なら NormalizeError */
export function normalizeStructureOutput(
  raw: unknown,
  options: StructureNormalizeOptions = {},
): StructureDraftResult {
  const parsedRaw = tryParseJson(raw);
  if (!isRecord(parsedRaw)) {
    fail("出力がオブジェクトではありません");
  }
  // 未知の余分なキーは捨てる（assertAllowedKeys は行わない）

  const rawConstraints = parsedRaw.constraints;
  if (
    rawConstraints !== undefined &&
    rawConstraints !== null &&
    !Array.isArray(rawConstraints)
  ) {
    fail("constraints は配列でなければなりません");
  }
  const constraintsArray = (rawConstraints ?? []) as unknown[];
  if (constraintsArray.length > MAX_DRAFT_CONSTRAINTS) {
    fail(`constraints は ${MAX_DRAFT_CONSTRAINTS} 件までです`);
  }

  const hopes = normalizeStringList(parsedRaw.hopes, "hopes");
  const unknowns = normalizeStringList(parsedRaw.unknowns, "unknowns");

  const constraints: ConstraintDraft[] = [];
  const droppedReasons: string[] = [];

  for (let i = 0; i < constraintsArray.length; i++) {
    const item = constraintsArray[i];
    try {
      constraints.push(normalizeConstraint(item, i));
    } catch (error) {
      if (options.allowPartial && error instanceof NormalizeError) {
        // 救えなかった制約は落とし、unknowns に記録する（Requirement 4）
        const hint =
          isRecord(item) &&
          typeof item.detail === "string" &&
          item.detail.trim()
            ? `「${item.detail.trim()}」`
            : `項目 ${i + 1}`;
        droppedReasons.push(
          `制約 ${hint} は形式不備（${error.reason}）のため下書きから除外しました。必要に応じて手動で追加してください。`,
        );
      } else {
        throw error;
      }
    }
  }

  if (droppedReasons.length > 0) {
    unknowns.push(...droppedReasons);
  }

  return {
    constraints,
    hopes,
    unknowns,
  };
}
