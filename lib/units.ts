/**
 * 単位数マスター（Issue 5）の読み込み・検証・引き当て。
 *
 * 正本データは data/units.json（要介護3・4サービス・令和6年度介護報酬の基本単位のみ。
 * 加算は扱わない）。数値はすべて厚生労働省の公式資料で裏取りしたものだけを入れ、
 * 裏取りできない数値は入れない（各エントリの sourceUrl／sourceTitle が出典）。
 *
 * デモで使う区分・kind・billing の対応表（マスターと一緒に固定する）：
 *
 * | serviceId       | サービス名                       | kind      | billing | 区分の前提 |
 * |-----------------|----------------------------------|-----------|---------|------------|
 * | visit-body      | 訪問介護（身体介護）             | visit     | perUse  | 時間区分（20分未満〜。1時間以上は30分増すごとに82単位を加算する式を4時間未満まで列挙） |
 * | visit-life      | 訪問介護（生活援助）             | visit     | perUse  | 時間区分（20分以上45分未満／45分以上） |
 * | daycare-basic   | 通所介護                         | daycare   | perUse  | 通常規模型・要介護3。2時間以上3時間未満は4時間以上5時間未満の70%（告示の注） |
 * | dayrehab-basic  | 通所リハビリテーション           | dayrehab  | perUse  | 通常規模型・要介護3 |
 * | shortstay-basic | 短期入所生活介護（ショートステイ）| shortstay | perDay  | 単独型・要介護3、1日あたり |
 *
 * 時間の引き当て規則（Issue 6 と共有する正本。仕様 Issue 5）：
 * - perUse は配置の所要時間（(endHour−startHour)×60分）から、serviceId 内で一意な band
 *   （minMinutes ≦ 所要時間 ＜ maxMinutes）を選ぶ。minMinutes 省略＝0、maxMinutes 省略＝上限なし
 * - band の重複は禁止（validateUnitsMaster が invalidMaster として検出する）
 * - perDay は単一 band の units のみを使い、時間の引き当てはしない
 * - bands のどれにも合わない時間は、検証エンジン（Issue 6）が validationErrors
 *   （unsupportedBand）として返す。0単位でごまかさない
 */

import unitsData from "../data/units.json";
import type { PlacementKind, ValidationError } from "./types";

/** 課金方式。perUse＝1回あたり（時間区分）、perDay＝1日あたり */
export type BillingType = "perUse" | "perDay";

/** 単位数マスターの時間区分1件 */
export interface UnitBand {
  label: string;
  /** 下限（分、含む）。省略＝0 */
  minMinutes?: number;
  /** 上限（分、含まない）。省略＝上限なし */
  maxMinutes?: number;
  /** 基本単位（単位／回 または 単位／日） */
  units: number;
}

/** 単位数マスターのサービス1件（data/units.json の1エントリ） */
export interface ServiceMaster {
  serviceId: string;
  name: string;
  kind: PlacementKind;
  billing: BillingType;
  bands: UnitBand[];
  sourceUrl: string;
  sourceTitle: string;
}

const PLACEMENT_KINDS: readonly PlacementKind[] = [
  "visit",
  "daycare",
  "dayrehab",
  "shortstay",
  "family",
];

/** 整備済みの単位数マスター（data/units.json の内容） */
export const unitsMaster: ServiceMaster[] = unitsData as ServiceMaster[];

/** serviceId からマスターエントリを引く。無ければ undefined */
export function getServiceMaster(
  master: readonly ServiceMaster[],
  serviceId: string,
): ServiceMaster | undefined {
  return master.find((s) => s.serviceId === serviceId);
}

/** band の実効下限（分）。省略時は0 */
export function bandMinMinutes(band: UnitBand): number {
  return band.minMinutes ?? 0;
}

/** band の実効上限（分）。省略時は無限大 */
export function bandMaxMinutes(band: UnitBand): number {
  return band.maxMinutes ?? Number.POSITIVE_INFINITY;
}

/**
 * perUse の引き当て：所要時間（分）に合う band を返す。合わなければ undefined。
 * マスターが正しければ（band 重複なし）一致は最大で1件。
 */
export function findBandForMinutes(
  service: ServiceMaster,
  minutes: number,
): UnitBand | undefined {
  return service.bands.find(
    (band) => bandMinMinutes(band) <= minutes && minutes < bandMaxMinutes(band),
  );
}

/**
 * 所要時間（分）に対する単位数を返す。
 * perUse は band 引き当て（合わなければ null）、perDay は時間を見ず単一 band の units。
 */
export function unitsForMinutes(
  service: ServiceMaster,
  minutes: number,
): number | null {
  if (service.billing === "perDay") {
    return service.bands.length === 1 ? service.bands[0].units : null;
  }
  const band = findBandForMinutes(service, minutes);
  return band ? band.units : null;
}

function masterError(reason: string, serviceId?: string): ValidationError {
  return serviceId
    ? { code: "invalidMaster", reason, serviceId }
    : { code: "invalidMaster", reason };
}

/**
 * マスター自体の正しさを検証する。不正があれば validationErrors（invalidMaster）を返す。
 * 検証エンジンはこの結果が空でない場合、単位系の結果をすべて null にする。
 */
export function validateUnitsMaster(
  master: readonly ServiceMaster[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!Array.isArray(master) || master.length === 0) {
    errors.push(masterError("単位数マスターが空です"));
    return errors;
  }

  const seenServiceIds = new Set<string>();
  for (const service of master) {
    const sid = service?.serviceId;
    if (typeof sid !== "string" || sid === "") {
      errors.push(masterError("serviceId が空のエントリがあります"));
      continue;
    }
    if (seenServiceIds.has(sid)) {
      errors.push(masterError(`serviceId が重複しています: ${sid}`, sid));
    }
    seenServiceIds.add(sid);

    if (typeof service.name !== "string" || service.name === "") {
      errors.push(masterError(`name が空です: ${sid}`, sid));
    }
    if (!PLACEMENT_KINDS.includes(service.kind)) {
      errors.push(masterError(`kind が不正です: ${sid}`, sid));
    }
    if (service.billing !== "perUse" && service.billing !== "perDay") {
      errors.push(masterError(`billing が不正です: ${sid}`, sid));
      continue;
    }
    if (
      typeof service.sourceUrl !== "string" ||
      service.sourceUrl === "" ||
      typeof service.sourceTitle !== "string" ||
      service.sourceTitle === ""
    ) {
      errors.push(masterError(`出典（sourceUrl／sourceTitle）がありません: ${sid}`, sid));
    }
    if (!Array.isArray(service.bands) || service.bands.length === 0) {
      errors.push(masterError(`bands が空です: ${sid}`, sid));
      continue;
    }
    if (service.billing === "perDay" && service.bands.length !== 1) {
      errors.push(
        masterError(`perDay の bands は単一でなければなりません: ${sid}`, sid),
      );
    }

    let bandsValid = true;
    for (const band of service.bands) {
      if (typeof band.label !== "string" || band.label === "") {
        errors.push(masterError(`band の label が空です: ${sid}`, sid));
        bandsValid = false;
      }
      if (!Number.isInteger(band.units) || band.units <= 0) {
        errors.push(
          masterError(`band の units は正の整数でなければなりません: ${sid}`, sid),
        );
        bandsValid = false;
      }
      for (const key of ["minMinutes", "maxMinutes"] as const) {
        const value = band[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          errors.push(
            masterError(`band の ${key} は0以上の整数でなければなりません: ${sid}`, sid),
          );
          bandsValid = false;
        }
      }
      if (bandMinMinutes(band) >= bandMaxMinutes(band)) {
        errors.push(
          masterError(`band の範囲が不正です（下限≧上限）: ${sid}`, sid),
        );
        bandsValid = false;
      }
    }

    // band の重複禁止（perUse のみ。perDay は時間引き当てをしない）
    if (bandsValid && service.billing === "perUse") {
      const sorted = [...service.bands].sort(
        (a, b) => bandMinMinutes(a) - bandMinMinutes(b),
      );
      for (let i = 1; i < sorted.length; i++) {
        if (bandMaxMinutes(sorted[i - 1]) > bandMinMinutes(sorted[i])) {
          errors.push(
            masterError(`band が重複しています: ${sid}（${sorted[i].label}）`, sid),
          );
        }
      }
    }
  }
  return errors;
}
