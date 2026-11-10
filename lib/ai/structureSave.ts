/**
 * 構造化結果の保存時変換（Issue 7）。
 *
 * 確認画面で利用者が確定した下書き（ConstraintDraft）に、利用者が明示的に選んだ
 * personId を結びつけて、保存形式（Constraint）へ変換する純粋ロジック。
 *
 * 信頼境界（共通前提・Issue 7）：
 * - personId への結びつけは利用者が画面で選んだ値だけを採用する。
 *   memberName（名前）からの自動一致は絶対にしない（同名・表記ゆれで誤爆するため）
 * - personId が people に存在しない場合は保存自体を拒否する（400）
 * - 入力はクライアントから来るため、件数・文字列長・型・時刻規則をサーバーで再検査する
 *   （下書きの正規化と同じ規則。検査エラーは AI 出力の不正ではなくリクエスト不正なので 400）
 *
 * 変換後の制約一式は commitRoomChange 経由で constraints/main へ丸ごと保存される
 * （RoomChange.constraints は一式の置き換え）。
 */

import {
  BOARD_END_HOUR,
  BOARD_START_HOUR,
  type CareWindow,
  type Constraint,
  type ConstraintType,
  type CopayRate,
  type DayIndex,
  type Person,
} from "../types";
import { badRequest } from "./errors";
import { isRecord } from "./normalizeUtil";
import {
  MAX_DETAIL_CHARS,
  MAX_DRAFT_CONSTRAINTS,
  MAX_DRAFT_LIST_ITEMS,
  MAX_LIST_ITEM_CHARS,
  MAX_MEMBER_NAME_CHARS,
  normalizeLegacyConstraintTypeInput,
} from "./structureNormalize";

const CONSTRAINT_TYPES: readonly ConstraintType[] = [
  "hope",
  "unavailable",
  "other",
];

const DRAFT_KEYS = [
  "memberName",
  "type",
  "detail",
  "days",
  "startHour",
  "endHour",
  "personId",
] as const;

export interface BoundStructureInput {
  constraints: Constraint[];
  hopes: string[];
  unknowns: string[];
  careWindows?: CareWindow[];
  copayRate?: CopayRate;
}

function invalid(message: string): never {
  throw badRequest("invalid_constraints", message);
}

function asBoundedString(
  value: unknown,
  where: string,
  maxChars: number,
): string {
  if (typeof value !== "string") {
    invalid(`${where} は文字列でなければなりません`);
  }
  const text = value as string;
  if ([...text].length > maxChars) {
    invalid(`${where} は ${maxChars} 字以内でなければなりません`);
  }
  return text;
}

function normalizeDays(value: unknown, where: string): DayIndex[] {
  if (!Array.isArray(value)) {
    invalid(`${where} は配列でなければなりません`);
  }
  const days = new Set<number>();
  for (const item of value as unknown[]) {
    if (typeof item !== "number" || !Number.isInteger(item)) {
      invalid(`${where} の要素は整数でなければなりません`);
    }
    if (item < 0 || item > 6) {
      invalid(`${where} は 0〜6 の曜日でなければなりません`);
    }
    days.add(item);
  }
  return [...days].sort((a, b) => a - b) as DayIndex[];
}

function normalizeHourPair(
  obj: Record<string, unknown>,
  required: boolean,
  where: string,
): { startHour?: number; endHour?: number } {
  const hasStart = "startHour" in obj;
  const hasEnd = "endHour" in obj;
  if (hasStart !== hasEnd) {
    invalid(`${where} の時刻は開始と終了をそろえて指定してください`);
  }
  if (!hasStart) {
    if (required) {
      invalid(`${where} には時刻が必須です`);
    }
    return {};
  }
  const { startHour, endHour } = obj;
  if (
    typeof startHour !== "number" ||
    !Number.isInteger(startHour) ||
    typeof endHour !== "number" ||
    !Number.isInteger(endHour)
  ) {
    invalid(`${where} の時刻は整数でなければなりません`);
  }
  // 制約の時刻規則：整数時間で 0≦startHour＜endHour≦24（下書きの正規化と同じ）
  if (!(startHour >= 0 && startHour < endHour && endHour <= 24)) {
    invalid(`${where} の時刻範囲が不正です`);
  }
  return { startHour, endHour };
}

function bindConstraint(
  value: unknown,
  index: number,
  peopleIds: ReadonlySet<string>,
): Constraint {
  const where = `constraints[${index}]`;
  if (!isRecord(value)) {
    invalid(`${where} はオブジェクトでなければなりません`);
  }
  for (const key of Object.keys(value)) {
    if (!(DRAFT_KEYS as readonly string[]).includes(key)) {
      invalid(`${where} に許可されていない項目「${key}」が含まれています`);
    }
  }

  // memberName は表示用の控えとして形だけ検査する。personId の決定には使わない
  asBoundedString(value.memberName, `${where} の memberName`, MAX_MEMBER_NAME_CHARS);

  const detail = asBoundedString(value.detail, `${where} の detail`, MAX_DETAIL_CHARS);
  if (detail.trim() === "") {
    invalid(`${where} の detail が空です`);
  }
  const type = normalizeLegacyConstraintTypeInput(value.type);
  if (
    typeof type !== "string" ||
    !(CONSTRAINT_TYPES as readonly string[]).includes(type)
  ) {
    invalid(`${where} の type が不正です`);
  }
  const days = normalizeDays(value.days, `${where} の days`);

  const timed = type === "unavailable";
  if (timed && days.length === 0) {
    invalid(`${where}（${type}）には曜日が必須です`);
  }
  const hours = normalizeHourPair(value, timed, where);

  // 結びつけは利用者が明示した personId だけを採用する（名前からの自動一致はしない）
  const personId = value.personId;
  if (typeof personId !== "string" || personId === "") {
    throw badRequest(
      "person_binding_required",
      `${where} に、対象の家族（personId）が選ばれていません`,
    );
  }
  if (!peopleIds.has(personId)) {
    throw badRequest(
      "unknown_person_id",
      `${where} の対象の家族が、このルームの家族一覧にありません`,
    );
  }

  return {
    personId,
    type: type as ConstraintType,
    detail,
    days,
    ...hours,
  } as Constraint;
}

function normalizeStringList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    invalid(`${where} は配列でなければなりません`);
  }
  if (value.length > MAX_DRAFT_LIST_ITEMS) {
    invalid(`${where} は ${MAX_DRAFT_LIST_ITEMS} 件までです`);
  }
  const items: string[] = [];
  for (const item of value as unknown[]) {
    const text = asBoundedString(item, `${where} の要素`, MAX_LIST_ITEM_CHARS);
    if (text.trim() !== "") items.push(text);
  }
  return items;
}

function normalizeCareWindows(value: unknown): CareWindow[] {
  if (!Array.isArray(value)) {
    throw badRequest("invalid_care_windows", "careWindows は配列でなければなりません");
  }
  if (value.length > 100) {
    throw badRequest("invalid_care_windows", "careWindows の件数が多すぎます");
  }
  const windows: CareWindow[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const where = `careWindows[${i}]`;
    if (!isRecord(item)) {
      throw badRequest("invalid_care_windows", `${where} はオブジェクトでなければなりません`);
    }
    const { day, startHour, endHour } = item;
    if (typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6) {
      throw badRequest("invalid_care_windows", `${where} の曜日が不正です`);
    }
    if (
      typeof startHour !== "number" ||
      !Number.isInteger(startHour) ||
      typeof endHour !== "number" ||
      !Number.isInteger(endHour) ||
      !(
        startHour >= BOARD_START_HOUR &&
        startHour < endHour &&
        endHour <= BOARD_END_HOUR
      )
    ) {
      throw badRequest(
        "invalid_care_windows",
        `${where} の時刻範囲が不正です`,
      );
    }
    windows.push({ day: day as DayIndex, startHour, endHour });
  }
  return windows.sort(
    (a, b) =>
      a.day - b.day || a.startHour - b.startHour || a.endHour - b.endHour,
  );
}

function normalizeCopayRate(value: unknown): CopayRate {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  throw badRequest("invalid_copay_rate", "copayRate は 1, 2, 3 のいずれかでなければなりません");
}

/**
 * 確認済みの下書き一式（各要素に personId を結びつけたもの）を保存形式へ変換する。
 * 形が不正・結びつけ不備の場合は AiApiError（400）を throw する。
 */
export function bindStructureDrafts(
  raw: {
    constraints: unknown;
    hopes: unknown;
    unknowns: unknown;
    careWindows?: unknown;
    copayRate?: unknown;
  },
  people: readonly Person[],
): BoundStructureInput {
  if (!Array.isArray(raw.constraints)) {
    invalid("constraints は配列でなければなりません");
  }
  if (raw.constraints.length > MAX_DRAFT_CONSTRAINTS) {
    invalid(`constraints は ${MAX_DRAFT_CONSTRAINTS} 件までです`);
  }
  const peopleIds = new Set(people.map((p) => p.id));
  const result: BoundStructureInput = {
    constraints: raw.constraints.map((item, i) =>
      bindConstraint(item, i, peopleIds),
    ),
    hopes: normalizeStringList(raw.hopes, "hopes"),
    unknowns: normalizeStringList(raw.unknowns, "unknowns"),
  };
  if (raw.careWindows !== undefined) {
    result.careWindows = normalizeCareWindows(raw.careWindows);
  }
  if (raw.copayRate !== undefined) {
    result.copayRate = normalizeCopayRate(raw.copayRate);
  }
  return result;
}
