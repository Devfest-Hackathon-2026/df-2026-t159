/**
 * 検証エンジン（Issue 6）。プランの「枠・お金・空白・無理」を機械的に判定する純粋関数。
 * AIは使わない。手動・AI・読み込みの全経路で同じ検査を通す。
 *
 * 契約（仕様の共通前提＋Issue 6 が正本）：
 * - 月換算単位 ＝ 週の合計単位 × 30 ÷ 7。四捨五入してから枠内／超過に分ける
 * - 自己負担 ＝（枠内単位数 × 10円 × 負担割合）＋（超過単位数 × 10円）。超過分は全額自己負担
 * - 単位を一部でも算出できない場合、weeklyUnits・monthlyUnits・overUnits・
 *   selfPayYen・selfPayBreakdown は null（未計算を0に置き換えない）
 * - hardViolations のある配置は「空白を埋める有効な支援」に数えない（空白判定から除外）
 * - memberHours は canProvideCare=true の家族全員分（配置がない人も0時間）。
 *   家族配置の時間は、重なりや対応不可時間の違反があっても「その人が担う予定の時間」
 *   として合計する（過労の検出が目的のため）。帰属できない配置（人物不明・対象外・
 *   範囲不正）は数えない
 * - overloads は週20時間超（OVERLOAD_HOURS_PER_WEEK）の人
 * - ok は hardViolations・validationErrors・gaps・overloads がすべて空で overUnits=0 のときだけ true
 *
 * 仕様から判断した点（仕様に明記がないものの扱い）：
 * - 配置の serviceId がマスターに存在しない／serviceId 自体がない場合は unknownId
 *   （「存在しないIDへの参照」）。kind と serviceId の種別が一致しない場合と、
 *   perDay サービスをショートステイ以外の kind で置いた場合は invalidRange
 * - 制約の personId が家族に存在しない場合は incompleteConstraint
 *   （結びつけが完了していない制約として、判定できないものに分類）
 * - careWindows の要素に範囲不正がある場合は missingCareWindows として返す
 *   （validationErrors の code は共通前提で固定された4種以外を使わないため）
 * - ショートステイの同日重複（duplicateShortstay）がある週は、perDay の
 *   「1日分」が定まらず単位を正しく算出できないため、単位系をすべて null に
 *   する（2日分を加算した誤った数字を返さない）
 */

import {
  LIMIT_UNITS_CARE_LEVEL_3,
  OVERLOAD_HOURS_PER_WEEK,
  UNIT_PRICE_YEN,
  type Constraint,
  type Gap,
  type HardViolation,
  type Person,
  type Placement,
  type RoomSnapshot,
  type ValidationError,
  type ValidationResult,
} from "./types";
import { DAYS, KIND_LABELS } from "./board";
import {
  getServiceMaster,
  unitsForMinutes,
  unitsMaster,
  validateUnitsMaster,
  type ServiceMaster,
} from "./units";

/** validateRoom の入力（RoomSnapshot から計算に要る分だけ） */
export type ValidationInput = Pick<
  RoomSnapshot,
  "people" | "placements" | "constraints" | "careWindows" | "copayRate"
>;

export interface TimeSpan {
  day: number;
  startHour: number;
  endHour: number;
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** ボード・careWindows の範囲規則：day=0〜6、整数時間で 6≦start＜end≦24 */
function isBoardRange(day: unknown, startHour: unknown, endHour: unknown): boolean {
  return (
    isInt(day) &&
    day >= 0 &&
    day <= 6 &&
    isInt(startHour) &&
    isInt(endHour) &&
    startHour >= 6 &&
    startHour < endHour &&
    endHour <= 24
  );
}

/** 制約（unavailable）の時刻規則：days 非空・各 day=0〜6、整数時間で 0≦start＜end≦24 */
function isConstraintRange(constraint: Constraint): boolean {
  const days = constraint.days;
  if (!Array.isArray(days) || days.length === 0) return false;
  if (!days.every((d) => isInt(d) && d >= 0 && d <= 6)) return false;
  const { startHour, endHour } = constraint;
  return (
    isInt(startHour) &&
    isInt(endHour) &&
    startHour >= 0 &&
    startHour < endHour &&
    endHour <= 24
  );
}

/** 半開区間 [aStart, aEnd) と [bStart, bEnd) の重なり */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** 重なり検証メッセージ用の配置説明（例: "火曜 9:00〜16:00 通所リハビリテーション"） */
function formatPlacementForDetail(
  p: Placement,
  people: readonly Person[],
  master: readonly ServiceMaster[],
): string {
  const dayName = DAYS[p.day] !== undefined ? `${DAYS[p.day]}曜` : `${p.day}曜`;
  const timeRange = `${p.startHour}:00〜${p.endHour}:00`;

  let serviceName = "";
  if (p.kind === "family") {
    const person = people.find((item) => item.id === p.personId);
    serviceName = person?.name
      ? `${person.name}の付き添い`
      : p.personId
        ? `${p.personId}の付き添い`
        : (p.note || "家族の付き添い");
  } else {
    const service = master.find((s) => s.serviceId === p.serviceId);
    if (service?.name) {
      serviceName = service.name
        .replace(/（通常規模型・要介護3）/, "")
        .replace(/（単独型・要介護3）/, "")
        .trim();
    } else if (p.note) {
      serviceName = p.note;
    } else {
      serviceName = KIND_LABELS[p.kind] ?? "サービス";
    }
  }

  return `${dayName} ${timeRange} ${serviceName}`;
}

/** careWindow からカバー済み区間を引いた残り（空白）を返す */
export function subtractCoverage(
  window: TimeSpan,
  covers: readonly TimeSpan[],
): Gap[] {
  const clipped = covers
    .filter((c) => c.day === window.day)
    .map((c) => ({
      start: Math.max(c.startHour, window.startHour),
      end: Math.min(c.endHour, window.endHour),
    }))
    .filter((c) => c.start < c.end)
    .sort((a, b) => a.start - b.start);

  const gaps: Gap[] = [];
  let cursor = window.startHour;
  for (const cover of clipped) {
    if (cover.start > cursor) {
      gaps.push({
        day: window.day as Gap["day"],
        startHour: cursor,
        endHour: Math.min(cover.start, window.endHour),
      });
    }
    cursor = Math.max(cursor, cover.end);
  }
  if (cursor < window.endHour) {
    gaps.push({
      day: window.day as Gap["day"],
      startHour: cursor,
      endHour: window.endHour,
    });
  }
  return gaps;
}

/**
 * 配置・家族・制約・careWindows・負担割合を受けて ValidationResult を返す純粋関数。
 * master は差し替え可能（テスト用）。既定は data/units.json の整備済みマスター。
 */
export function validateRoom(
  input: ValidationInput,
  master: readonly ServiceMaster[] = unitsMaster,
): ValidationResult {
  const hardViolations: HardViolation[] = [];
  const validationErrors: ValidationError[] = [];

  const people: Person[] = Array.isArray(input.people) ? input.people : [];
  const placements: Placement[] = Array.isArray(input.placements)
    ? input.placements
    : [];
  const constraints: Constraint[] = Array.isArray(input.constraints)
    ? input.constraints
    : [];
  const peopleById = new Map(people.map((p) => [p.id, p]));

  // --- マスター検証（不正なら単位系はすべて算出不可） ---
  const masterErrors = validateUnitsMaster(master);
  validationErrors.push(...masterErrors);
  let unitsCalculable = masterErrors.length === 0;

  // --- careWindows の検査 ---
  const rawWindows = Array.isArray(input.careWindows) ? input.careWindows : [];
  const careWindows: TimeSpan[] = [];
  if (rawWindows.length === 0) {
    validationErrors.push({
      code: "missingCareWindows",
      reason: "介護が必要な時間帯が未設定です",
    });
  } else {
    for (const w of rawWindows) {
      if (isBoardRange(w?.day, w?.startHour, w?.endHour)) {
        careWindows.push({ day: w.day, startHour: w.startHour, endHour: w.endHour });
      } else {
        validationErrors.push({
          code: "missingCareWindows",
          reason: `介護が必要な曜日・時刻を確認してください（曜日番号=${w?.day}, ${w?.startHour}〜${w?.endHour}）`,
        });
      }
    }
  }

  // --- 制約の完全性検査と、対応不可時間（unavailable）の収集 ---
  const unavailableByPerson = new Map<string, (TimeSpan & { type: string })[]>();
  for (const c of constraints) {
    if (!c || typeof c.personId !== "string" || !peopleById.has(c.personId)) {
      validationErrors.push({
        code: "incompleteConstraint",
        reason: "家族の事情に指定された人が家族一覧にいません",
        ...(typeof c?.personId === "string" ? { personId: c.personId } : {}),
      });
      continue;
    }
    if (c.type === "unavailable") {
      if (!isConstraintRange(c)) {
        validationErrors.push({
          code: "incompleteConstraint",
          reason: `対応できない時間の曜日・時刻が不足しています`,
          personId: c.personId,
        });
        continue;
      }
      const spans = unavailableByPerson.get(c.personId) ?? [];
      for (const day of c.days) {
        spans.push({ day, startHour: c.startHour, endHour: c.endHour, type: c.type });
      }
      unavailableByPerson.set(c.personId, spans);
    }
  }

  // --- 配置ごとの検査と単位計算 ---
  const violatedIds = new Set<string>();
  const violate = (v: HardViolation) => {
    hardViolations.push(v);
    if (v.placementId) violatedIds.add(v.placementId);
  };

  let weeklyUnits = 0;
  const shortstayByDay = new Map<number, Placement[]>();
  const familyByPerson = new Map<string, Placement[]>();
  const memberMinutes = new Map<string, number>();
  for (const person of people) {
    if (person.canProvideCare) memberMinutes.set(person.id, 0);
  }

  for (const p of placements) {
    if (!p || typeof p.id !== "string") continue;

    // 範囲検査（全 kind 共通）
    if (!isBoardRange(p.day, p.startHour, p.endHour)) {
      violate({
        type: "invalidRange",
        detail: `予定の曜日・時刻を確認してください（曜日番号=${p.day}, ${p.startHour}〜${p.endHour}）`,
        placementId: p.id,
      });
      // サービス配置の単位は算出できないため、合計は未計算（null）にする
      if (p.kind !== "family") unitsCalculable = false;
      continue;
    }
    const minutes = (p.endHour - p.startHour) * 60;

    if (p.kind === "family") {
      if (typeof p.personId !== "string" || p.personId === "") {
        violate({
          type: "unknownId",
          detail: "付き添う家族が選ばれていません",
          placementId: p.id,
        });
        continue;
      }
      const person = peopleById.get(p.personId);
      if (!person) {
        violate({
          type: "unknownId",
          detail: `付き添いに指定された人が家族一覧にいません: ${p.personId}`,
          placementId: p.id,
        });
        continue;
      }
      if (!person.canProvideCare) {
        violate({
          type: "ineligibleCareProvider",
          detail: `${person.name} は付き添いを担当できません`,
          placementId: p.id,
        });
        continue;
      }
      // 対応不可時間との重なり
      for (const span of unavailableByPerson.get(person.id) ?? []) {
        if (
          span.day === p.day &&
          overlaps(p.startHour, p.endHour, span.startHour, span.endHour)
        ) {
          violate({
            type: "unavailableOverlap",
            detail: `${person.name} が対応できない時間に付き添いの予定があります`,
            placementId: p.id,
          });
          break;
        }
      }
      memberMinutes.set(
        person.id,
        (memberMinutes.get(person.id) ?? 0) + (p.endHour - p.startHour) * 60,
      );
      const list = familyByPerson.get(person.id) ?? [];
      list.push(p);
      familyByPerson.set(person.id, list);
      continue;
    }

    if (p.kind === "shortstay") {
      const list = shortstayByDay.get(p.day) ?? [];
      list.push(p);
      shortstayByDay.set(p.day, list);
    }

    // サービス配置（family 以外）：serviceId の解決
    if (typeof p.serviceId !== "string" || p.serviceId === "") {
      violate({
        type: "unknownId",
        detail: "予定のサービスが選ばれていません",
        placementId: p.id,
      });
      unitsCalculable = false;
      continue;
    }
    const service = getServiceMaster(master, p.serviceId);
    if (!service) {
      violate({
        type: "unknownId",
        detail: `選んだサービスが料金データにありません: ${p.serviceId}`,
        placementId: p.id,
      });
      unitsCalculable = false;
      continue;
    }

    if (p.kind === "shortstay") {
      // ショートステイの入力検査（UIだけの補正にしない）：6:00〜24:00固定・
      // 専用 serviceId（kind=shortstay）・billing=perDay を必須とする
      if (p.startHour !== 6 || p.endHour !== 24) {
        violate({
          type: "invalidRange",
          detail: "ショートステイは 6:00〜24:00 の予定にしてください",
          placementId: p.id,
        });
        unitsCalculable = false;
        continue;
      }
      if (service.kind !== "shortstay" || service.billing !== "perDay") {
        violate({
          type: "invalidRange",
          detail: "ショートステイは1日単位の専用サービスを選んでください",
          placementId: p.id,
        });
        unitsCalculable = false;
        continue;
      }
    } else {
      if (service.billing === "perDay") {
        violate({
          type: "invalidRange",
          detail: "1日単位のサービスはショートステイ専用です",
          placementId: p.id,
        });
        unitsCalculable = false;
        continue;
      }
      if (service.kind !== p.kind) {
        violate({
          type: "invalidRange",
          detail: `予定の種類（${p.kind}）とサービスの種類（${service.kind}）が一致しません`,
          placementId: p.id,
        });
        unitsCalculable = false;
        continue;
      }
    }

    // 単位計算（perDay は時間引き当てなし、perUse は band 引き当て）
    // band 照合と unsupportedBand の記録は、先行する配置のエラーで単位系が
    // 算出不可になった後でも、全配置について行う（仕様：「bands のどれにも
    // 合わない時間は validationErrors として返す」は無条件）。単位の加算だけを
    // unitsCalculable の間に行う（agy 独立レビュー指摘3への対応）
    const units = unitsForMinutes(service, minutes);
    if (units === null) {
      validationErrors.push({
        code: "unsupportedBand",
        reason: `${service.name} には ${minutes}分に対応する時間区分がありません`,
        serviceId: service.serviceId,
        placementId: p.id,
      });
      unitsCalculable = false;
    } else if (unitsCalculable) {
      weeklyUnits += units;
    }
  }

  // --- ショートステイの同日重複 ---
  for (const [day, list] of shortstayByDay) {
    if (list.length >= 2) {
      for (const p of list) {
        violate({
          type: "duplicateShortstay",
          detail: `同じ日にショートステイが ${list.length} 件あります（曜日番号=${day}）`,
          placementId: p.id,
        });
      }
      // perDay は「単一 band の units を1日分として数える」仕様のため、同日に
      // 2件以上ある場合は正しい単位を算出できない（2日分を加算すると誤った
      // 数字になる）。「算出できない配置がある場合は合計を null にし、誤った
      // 数字を見せない」という既存判断と同じ原則で、単位系をすべて null に
      // する（agy 独立レビュー指摘1への対応）
      unitsCalculable = false;
    }
  }

  // --- 予定の重なり（同一曜日の配置ペアの時間が重なっているもの） ---
  const validPlacements = placements.filter(
    (p) =>
      p &&
      typeof p.id === "string" &&
      isBoardRange(p.day, p.startHour, p.endHour),
  );
  const byDay = new Map<number, Placement[]>();
  for (const p of validPlacements) {
    const list = byDay.get(p.day) ?? [];
    list.push(p);
    byDay.set(p.day, list);
  }
  for (const list of byDay.values()) {
    const sorted = [...list].sort(
      (a, b) =>
        a.startHour - b.startHour ||
        a.endHour - b.endHour ||
        a.id.localeCompare(b.id),
    );
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];
        // ショートステイ同士の同日重複は duplicateShortstay で扱うため除外
        if (a.kind === "shortstay" && b.kind === "shortstay") continue;
        // 異なる家族メンバー同士の付き添いは許容（2人付き添い等、troubledPlan 互換）
        if (
          a.kind === "family" &&
          b.kind === "family" &&
          a.personId !== b.personId
        ) {
          continue;
        }
        if (overlaps(a.startHour, a.endHour, b.startHour, b.endHour)) {
          const isSameFamily =
            a.kind === "family" &&
            b.kind === "family" &&
            a.personId &&
            a.personId === b.personId;
          const aDesc = formatPlacementForDetail(a, people, master);
          const bDesc = formatPlacementForDetail(b, people, master);
          const detail = isSameFamily
            ? `同じ人の付き添いが重なっています（${aDesc} と ${bDesc}）`
            : `予定が重なっています（${aDesc} と ${bDesc}）`;
          violate({
            type: "overlap",
            detail,
            placementId: b.id,
          });
          violatedIds.add(a.id);
          violatedIds.add(b.id);
        }
      }
    }
  }

  // --- 空白（careWindows のうち、違反のない配置で埋まっていない時間） ---
  const covers: TimeSpan[] = placements
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        !violatedIds.has(p.id) &&
        isBoardRange(p.day, p.startHour, p.endHour),
    )
    .map((p) => ({ day: p.day, startHour: p.startHour, endHour: p.endHour }));
  const gaps: Gap[] = [];
  for (const window of [...careWindows].sort(
    (a, b) => a.day - b.day || a.startHour - b.startHour,
  )) {
    gaps.push(...subtractCoverage(window, covers));
  }

  // --- 負担（付き添い時間）と過労 ---
  const memberHours = people
    .filter((person) => person.canProvideCare)
    .map((person) => ({
      personId: person.id,
      hours: (memberMinutes.get(person.id) ?? 0) / 60,
    }));
  const overloads = memberHours
    .filter((m) => m.hours > OVERLOAD_HOURS_PER_WEEK)
    .map((m) => ({ personId: m.personId, hours: m.hours }));

  // --- 単位・お金（算出できる場合のみ。できない場合は null） ---
  let weekly: number | null = null;
  let monthlyUnits: number | null = null;
  let overUnits: number | null = null;
  let selfPayYen: number | null = null;
  let selfPayBreakdown: ValidationResult["selfPayBreakdown"] = null;
  if (unitsCalculable) {
    weekly = weeklyUnits;
    monthlyUnits = Math.round((weeklyUnits * 30) / 7);
    overUnits = Math.max(0, monthlyUnits - LIMIT_UNITS_CARE_LEVEL_3);
    const withinUnits = monthlyUnits - overUnits;
    const withinYen = (withinUnits * UNIT_PRICE_YEN * input.copayRate) / 10;
    const overYen = overUnits * UNIT_PRICE_YEN;
    selfPayYen = withinYen + overYen;
    selfPayBreakdown = { withinYen, overYen };
  }

  const ok =
    hardViolations.length === 0 &&
    validationErrors.length === 0 &&
    overUnits === 0 &&
    gaps.length === 0 &&
    overloads.length === 0;

  return {
    ok,
    weeklyUnits: weekly,
    monthlyUnits,
    limitUnits: LIMIT_UNITS_CARE_LEVEL_3,
    overUnits,
    selfPayYen,
    selfPayBreakdown,
    gaps,
    memberHours,
    overloads,
    hardViolations,
    validationErrors,
  };
}
