/**
 * 警告表示と負担の見える化ビューの表示用ロジック（Issue 4）。
 *
 * 入力は ValidationResult のみ（検証計算そのものは行わない）。
 * 表示用データを純粋関数で整形し、コンポーネントやテストから利用可能にする。
 *
 * 仕様（Issue 4・共通前提）：
 * - 枠オーバー（月換算の超過単位と金額、自己負担内訳＝枠内分／超過分）
 * - 空白時間（careWindows 内の無配置時間のデータ整形と一覧表示）
 * - hardViolations（対応不可時間の重複、重なり、介護不可者配置などの違反）
 * - validationErrors（「計算できなかった項目があります」と分かる表示）
 * - 負担の見える化（memberHours 全員分を使った付き添い時間の比較。お金は月次総額のみで家族別配分は出さない）
 * - 金額の近くには概算である旨の注記を出す
 * - 数値が null の項目は「算出不可」と表示する（0円や0単位と表示しない）
 */

import { DAY_LABELS } from "./structure-review";
import {
  OVERLOAD_HOURS_PER_WEEK,
  type DayIndex,
  type Gap,
  type HardViolation,
  type HardViolationType,
  type MemberHours,
  type Overload,
  type Person,
  type ValidationError,
  type ValidationErrorCode,
  type ValidationResult,
} from "./types";

/** 概算に関する注記文（共通前提・Issue 4・Issue 11 で共通） */
export const ESTIMATE_DISCLAIMER_NOTE =
  "※ 月換算は30日の月で計算した目安で、実際の請求額ではありません。食費・居住費・各種加算は含みません。";

/** 金額の表示整形。null は「算出不可」 */
export function formatCurrency(amount: number | null): string {
  if (amount === null) return "未判定（算出不可）";
  return `${amount.toLocaleString("ja-JP")} 円`;
}

/** 単位数の表示整形。null は「算出不可」 */
export function formatUnits(units: number | null): string {
  if (units === null) return "未判定（算出不可）";
  return `${units.toLocaleString("ja-JP")} 単位`;
}

/** 時間の表示整形 */
export function formatHours(hours: number): string {
  return `${hours} 時間`;
}

/** 時刻範囲の表示整形（例: 09:00〜12:00） */
export function formatTimeRange(startHour: number, endHour: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(startHour)}:00〜${pad(endHour)}:00`;
}

/** 枠オーバーと費用の表示情報 */
export interface BudgetSummaryView {
  /** 週の合計単位 */
  weeklyUnitsText: string;
  /** 月換算単位 */
  monthlyUnitsText: string;
  /** 限度額（単位／月） */
  limitUnitsText: string;
  /** 超過単位 */
  overUnitsText: string;
  /** 月次自己負担総額 */
  selfPayTotalText: string;
  /** 枠内分の自己負担額 */
  withinYenText: string;
  /** 枠外（全額負担）の自己負担額 */
  overYenText: string;
  /** 限度額を超過しているか */
  isOverLimit: boolean;
  /** 単位・金額に計算不能（null）が含まれるか */
  hasNullCalculation: boolean;
  /** 注記文 */
  disclaimerNote: string;
}

/** 費用・単位数のサマリーを整形 */
export function formatBudgetSummary(
  result: ValidationResult,
): BudgetSummaryView {
  const isOverLimit = result.overUnits !== null && result.overUnits > 0;
  const hasNullCalculation =
    result.weeklyUnits === null ||
    result.monthlyUnits === null ||
    result.overUnits === null ||
    result.selfPayYen === null ||
    result.selfPayBreakdown === null;

  return {
    weeklyUnitsText: formatUnits(result.weeklyUnits),
    monthlyUnitsText: formatUnits(result.monthlyUnits),
    limitUnitsText: formatUnits(result.limitUnits),
    overUnitsText: formatUnits(result.overUnits),
    selfPayTotalText: formatCurrency(result.selfPayYen),
    withinYenText: formatCurrency(result.selfPayBreakdown?.withinYen ?? null),
    overYenText: formatCurrency(result.selfPayBreakdown?.overYen ?? null),
    isOverLimit,
    hasNullCalculation,
    disclaimerNote: ESTIMATE_DISCLAIMER_NOTE,
  };
}

/** 整形された空白時間1件（ボード連携やリスト表示用） */
export interface FormattedGap {
  day: DayIndex;
  dayLabel: string;
  startHour: number;
  endHour: number;
  timeRangeText: string;
  durationHours: number;
  label: string;
}

/** 空白時間の一覧サマリー */
export interface GapSummaryView {
  totalHours: number;
  count: number;
  items: FormattedGap[];
  groupedByDay: {
    day: DayIndex;
    dayLabel: string;
    gaps: FormattedGap[];
  }[];
}

/** 空白時間を表示用に整形 */
export function formatGaps(gaps: readonly Gap[]): GapSummaryView {
  const items: FormattedGap[] = gaps.map((g) => {
    const dayLabel = DAY_LABELS[g.day] ?? `${g.day}日目`;
    const timeRangeText = formatTimeRange(g.startHour, g.endHour);
    const durationHours = g.endHour - g.startHour;
    const label = `${dayLabel}曜 ${timeRangeText}（${durationHours}時間）`;
    return {
      day: g.day,
      dayLabel,
      startHour: g.startHour,
      endHour: g.endHour,
      timeRangeText,
      durationHours,
      label,
    };
  });

  const totalHours = items.reduce((acc, item) => acc + item.durationHours, 0);

  // 曜日順（0〜6）にグルーピング
  const groupMap = new Map<DayIndex, FormattedGap[]>();
  for (const item of items) {
    const existing = groupMap.get(item.day) ?? [];
    existing.push(item);
    groupMap.set(item.day, existing);
  }

  const groupedByDay: GapSummaryView["groupedByDay"] = [];
  for (let d = 0; d < 7; d++) {
    const day = d as DayIndex;
    const dayGaps = groupMap.get(day);
    if (dayGaps && dayGaps.length > 0) {
      dayGaps.sort((a, b) => a.startHour - b.startHour);
      groupedByDay.push({
        day,
        dayLabel: DAY_LABELS[day],
        gaps: dayGaps,
      });
    }
  }

  return {
    totalHours,
    count: items.length,
    items,
    groupedByDay,
  };
}

/** hardViolations の見出しマッピング */
const HARD_VIOLATION_TITLES: Record<HardViolationType, string> = {
  unavailableOverlap: "対応できない時間との重なり",
  overlap: "付き添い時間の重なり",
  unknownId: "未登録のサービス・家族が選ばれています",
  ineligibleCareProvider: "付き添いができない家族が選ばれています",
  invalidRange: "曜日・時間の指定を確認してください",
  duplicateShortstay: "同じ日のショートステイが重複しています",
};

/** 整形された hardViolation */
export interface FormattedHardViolation {
  type: HardViolationType;
  title: string;
  detail: string;
  placementId?: string;
}

/** hardViolations を整形 */
export function formatHardViolations(
  violations: readonly HardViolation[],
): FormattedHardViolation[] {
  return violations.map((v) => {
    let title = HARD_VIOLATION_TITLES[v.type] ?? "予定の置き方の問題";
    if (
      v.type === "overlap" &&
      (v.detail.startsWith("予定が重なっています") || !v.detail.includes("付き添い"))
    ) {
      title = "予定の重なり";
    }
    return {
      type: v.type,
      title,
      detail: v.detail,
      placementId: v.placementId,
    };
  });
}

/** validationErrors の見出しマッピング */
const VALIDATION_ERROR_TITLES: Record<string, string> = {
  unsupportedBand: "計算できないサービス利用時間です",
  missingCareWindows: "介護が必要な時間が未設定です",
  incompleteConstraint: "家族の都合の入力が不足しています",
  invalidMaster: "費用の計算用データに問題があります",
};

/** 整形された validationError */
export interface FormattedValidationError {
  code: ValidationErrorCode;
  title: string;
  reason: string;
  serviceId?: string;
  placementId?: string;
  personId?: string;
}

/** validationErrors を整形 */
export function formatValidationErrors(
  errors: readonly ValidationError[],
): FormattedValidationError[] {
  return errors.map((e) => ({
    code: e.code,
    title: VALIDATION_ERROR_TITLES[e.code] ?? "計算・判定エラー",
    reason: e.reason,
    serviceId: e.serviceId,
    placementId: e.placementId,
    personId: e.personId,
  }));
}

/** 家族ごとの負担表示項目 */
export interface MemberBurdenItem {
  personId: string;
  name: string;
  hours: number;
  hoursText: string;
  isOverload: boolean;
  /** バー表示用パーセント（0〜100） */
  barPercentage: number;
}

/** 家族全体の負担サマリー */
export interface MemberBurdenSummary {
  /** バーとアクセシビリティ属性で共用する表示上の最大値 */
  maxHours: number;
  members: MemberBurdenItem[];
  totalHours: number;
  totalHoursText: string;
  hasOverload: boolean;
  overloadCount: number;
  overloadedNames: string[];
}

/**
 * 家族ごとの付き添い時間（週次）を整形。
 * canProvideCare=true の全員分（未配置の0時間も含む）を返す。
 * お金は家族別に配分せず、時間のみを扱う。
 */
export function formatMemberBurdens(
  memberHours: readonly MemberHours[],
  overloads: readonly Overload[],
  people?: readonly Person[],
): MemberBurdenSummary {
  const nameMap = new Map<string, string>();
  if (people) {
    for (const p of people) {
      nameMap.set(p.id, p.name);
    }
  }

  const overloadSet = new Set(overloads.map((o) => o.personId));

  // バー表示の基準最大時間（最低でも20時間を基準にし、それを超える場合は最大値基準）
  const maxHours = Math.max(
    OVERLOAD_HOURS_PER_WEEK,
    ...memberHours.map((m) => m.hours),
    1,
  );

  const members: MemberBurdenItem[] = memberHours.map((m) => {
    const isOverload = overloadSet.has(m.personId);
    const name = nameMap.get(m.personId) ?? `家族(${m.personId})`;
    const barPercentage = Math.min(100, Math.round((m.hours / maxHours) * 100));

    return {
      personId: m.personId,
      name,
      hours: m.hours,
      hoursText: formatHours(m.hours),
      isOverload,
      barPercentage,
    };
  });

  const totalHours = members.reduce((sum, m) => sum + m.hours, 0);
  const overloadedNames = members
    .filter((m) => m.isOverload)
    .map((m) => m.name);

  return {
    maxHours,
    members,
    totalHours,
    totalHoursText: formatHours(totalHours),
    hasOverload: overloadedNames.length > 0,
    overloadCount: overloadedNames.length,
    overloadedNames,
  };
}

/** 総合的な警告状況サマリー */
export interface WarningsStatus {
  ok: boolean;
  hasWarnings: boolean;
  isOverLimit: boolean;
  hasGaps: boolean;
  hasHardViolations: boolean;
  hasValidationErrors: boolean;
  hasOverload: boolean;
  totalWarningCount: number;
}

/** ValidationResult から警告フラグ・件数を抽出 */
export function getWarningsStatus(result: ValidationResult): WarningsStatus {
  const isOverLimit = result.overUnits !== null && result.overUnits > 0;
  const hasGaps = result.gaps.length > 0;
  const hasHardViolations = result.hardViolations.length > 0;
  const hasValidationErrors = result.validationErrors.length > 0;
  const hasOverload = result.overloads.length > 0;

  let count = 0;
  if (isOverLimit) count++;
  if (hasGaps) count++;
  if (hasHardViolations) count += result.hardViolations.length;
  if (hasValidationErrors) count += result.validationErrors.length;
  if (hasOverload) count += result.overloads.length;

  return {
    ok: result.ok,
    hasWarnings: !result.ok,
    isOverLimit,
    hasGaps,
    hasHardViolations,
    hasValidationErrors,
    hasOverload,
    totalWarningCount: count,
  };
}
