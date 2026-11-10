/**
 * ケアマネ面談用まとめシートの表示用ロジック（Issue 11）。
 *
 * 確定スナップショット（Issue 14）を読み、確定プラン・家族の希望と制約・
 * 負担の分担（付き添い時間・概算費用）を1画面にまとめ、印刷用レイアウトで表示する。
 *
 * 仕様（Issue 11・共通前提）：
 * - 「確定済み」と言えるのは summary.confirmedRevision ＝ 現在の room.revision のときだけ
 *   （編集で revision が進んだら自動的に「未確定」扱いにする）
 * - 金額には概算である旨の注記（「30日の月を仮定した概算」「食費・居住費・加算は含まない」）を入れる
 * - 確定済みでないときは「未確定」と分かる表示にする
 * - 家族別の比較は付き添い時間のみ。お金は月次総額のみで家族別配分は出さない
 * - 数値が null の項目は「算出不可」と表示する
 */

import { normalizeSavedConstraintType } from "./ai/structureNormalize";
import { DAY_LABELS } from "./structure-review";
import {
  type Constraint,
  type ConstraintType,
  type DayIndex,
  type Person,
  type Placement,
  type SummaryDoc,
  type ValidationResult,
} from "./types";
import { getServiceMaster, unitsMaster } from "./units";

// まとめシート単独で起動できる表示整形。未マージの負担ビューに依存しない。
const formatCurrency = (value: number | null) => value === null ? "未判定（算出不可）" : `${value.toLocaleString("ja-JP")} 円`;
const formatUnits = (value: number | null) => value === null ? "未判定（算出不可）" : `${value.toLocaleString("ja-JP")} 単位`;
const formatHours = (value: number) => `${value} 時間`;
const formatTimeRange = (start: number, end: number) => `${String(start).padStart(2, "0")}:00〜${String(end).padStart(2, "0")}:00`;

/** まとめシート用の注記文（仕様の正本に準拠） */
export const SUMMARY_DISCLAIMER_NOTE =
  "※ 単位数の月換算は30日の月を仮定した概算であり、実際の請求額ではありません。食費・居住費・各種加算は含みません。";

/** プランが確定状態かどうかを判定する純粋関数 */
export function isSummaryConfirmed(
  summary: SummaryDoc | null | undefined,
  currentRevision: number | null | undefined,
): boolean {
  if (!summary) return false;
  if (currentRevision === null || currentRevision === undefined) return false;
  return summary.confirmedRevision === currentRevision;
}

/** 配置の種別の日本語名 */
const PLACEMENT_KIND_LABELS: Record<string, string> = {
  visit: "訪問介護",
  daycare: "通所介護（デイサービス）",
  dayrehab: "通所リハビリ（デイケア）",
  shortstay: "ショートステイ",
  family: "家族の付き添い",
};

/** 制約の種別の日本語名 */
const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  hope: "希望",
  unavailable: "対応不可",
  other: "その他",
};

/** 整形されたスケジュール配置項目 */
export interface SummaryPlacementItem {
  id: string;
  startHour: number;
  endHour: number;
  timeRangeText: string;
  title: string;
  categoryLabel: string;
  note?: string;
  isFamily: boolean;
  personName?: string;
}

/** 曜日ごとのスケジュール */
export interface DaySchedule {
  day: DayIndex;
  dayLabel: string;
  items: SummaryPlacementItem[];
}

/** 配置一覧を曜日別・時間順にグルーピング */
export function groupPlacementsByDay(
  placements: readonly Placement[],
  people?: readonly Person[],
): DaySchedule[] {
  const nameMap = new Map<string, string>();
  if (people) {
    for (const p of people) {
      nameMap.set(p.id, p.name);
    }
  }

  const byDay = new Map<DayIndex, SummaryPlacementItem[]>();
  for (let d = 0; d < 7; d++) {
    byDay.set(d as DayIndex, []);
  }

  for (const p of placements) {
    const isFamily = p.kind === "family";
    const personName = p.personId ? nameMap.get(p.personId) ?? p.personId : undefined;
    let title = "";
    if (isFamily) {
      title = personName ? `${personName}の付き添い` : "家族の付き添い";
    } else if (p.serviceId) {
      const master = getServiceMaster(unitsMaster, p.serviceId);
      title = master?.name ?? PLACEMENT_KIND_LABELS[p.kind] ?? p.kind;
    } else {
      title = PLACEMENT_KIND_LABELS[p.kind] ?? p.kind;
    }

    const item: SummaryPlacementItem = {
      id: p.id,
      startHour: p.startHour,
      endHour: p.endHour,
      timeRangeText: formatTimeRange(p.startHour, p.endHour),
      title,
      categoryLabel: PLACEMENT_KIND_LABELS[p.kind] ?? p.kind,
      note: p.note,
      isFamily,
      personName,
    };

    const list = byDay.get(p.day);
    if (list) list.push(item);
  }

  const result: DaySchedule[] = [];
  for (let d = 0; d < 7; d++) {
    const day = d as DayIndex;
    const items = byDay.get(day) ?? [];
    items.sort((a, b) => a.startHour - b.startHour);
    result.push({
      day,
      dayLabel: DAY_LABELS[day],
      items,
    });
  }

  return result;
}

/** 整形された制約項目 */
export interface FormattedConstraintItem {
  personName: string;
  typeLabel: string;
  detail: string;
  daysText: string;
  timeRangeText?: string;
}

/** 家族の制約を整形 */
export function formatConstraints(
  constraints: readonly Constraint[],
  people?: readonly Person[],
): FormattedConstraintItem[] {
  const nameMap = new Map<string, string>();
  if (people) {
    for (const p of people) {
      nameMap.set(p.id, p.name);
    }
  }

  return constraints.map((c) => {
    const personName = nameMap.get(c.personId) ?? `家族(${c.personId})`;
    const normalizedType = normalizeSavedConstraintType(c.type);
    const typeLabel = CONSTRAINT_TYPE_LABELS[normalizedType] ?? c.type;
    const daysText =
      c.days.length === 7
        ? "毎日"
        : c.days.map((d) => DAY_LABELS[d] ?? `${d}`).join("・");

    let timeRangeText: string | undefined;
    if (c.startHour !== undefined && c.endHour !== undefined) {
      timeRangeText = formatTimeRange(c.startHour, c.endHour);
    }

    return {
      personName,
      typeLabel,
      detail: c.detail,
      daysText: c.days.length === 7 ? "毎日" : daysText ? `${daysText}曜` : "曜日指定なし",
      timeRangeText,
    };
  });
}

/** 負担・費用のまとめシート表示用データ */
export interface SummaryBurdenView {
  /** 家族別付き添い時間（canProvideCare=true の全員） */
  memberHours: {
    personId: string;
    name: string;
    hours: number;
    hoursText: string;
  }[];
  totalCareHoursText: string;
  weeklyUnitsText: string;
  monthlyUnitsText: string;
  limitUnitsText: string;
  overUnitsText: string;
  selfPayTotalText: string;
  withinYenText: string;
  overYenText: string;
  isOverLimit: boolean;
  disclaimerNote: string;
}

/** 負担と費用のまとめを整形 */
export function formatSummaryBurden(
  validation: ValidationResult,
  people?: readonly Person[],
): SummaryBurdenView {
  const nameMap = new Map<string, string>();
  if (people) {
    for (const p of people) {
      nameMap.set(p.id, p.name);
    }
  }

  const memberHours = validation.memberHours.map((m) => ({
    personId: m.personId,
    name: nameMap.get(m.personId) ?? `家族(${m.personId})`,
    hours: m.hours,
    hoursText: formatHours(m.hours),
  }));

  const totalCareHours = memberHours.reduce((acc, m) => acc + m.hours, 0);
  const isOverLimit = validation.overUnits !== null && validation.overUnits > 0;

  return {
    memberHours,
    totalCareHoursText: formatHours(totalCareHours),
    weeklyUnitsText: formatUnits(validation.weeklyUnits),
    monthlyUnitsText: formatUnits(validation.monthlyUnits),
    limitUnitsText: formatUnits(validation.limitUnits),
    overUnitsText: formatUnits(validation.overUnits),
    selfPayTotalText: formatCurrency(validation.selfPayYen),
    withinYenText: formatCurrency(validation.selfPayBreakdown?.withinYen ?? null),
    overYenText: formatCurrency(validation.selfPayBreakdown?.overYen ?? null),
    isOverLimit,
    disclaimerNote: SUMMARY_DISCLAIMER_NOTE,
  };
}
