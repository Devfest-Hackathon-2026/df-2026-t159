/**
 * コラム・決めることリスト・サービス説明のロジックと検証（Issue 13）。
 *
 * 入力は data/columns.json と ValidationResult。
 * 仕様（carepact_issues.md 共通前提・Issue 13）：
 * - コンテンツ型：decision（id, title, body）／column（id, title, body, sceneId）／service（id, title, body, kind, serviceId?）の union
 * - 決めることリスト：8項目の一覧と詳細。「進み具合」は MVP から外す（入力にも保存先にもない状態は表示しない）
 * - 場面連動コラム：5種の sceneId（overLimit, careGap, caregiverOverload, hardViolation, validationUnavailable）
 *   - 枠オーバー（overUnits > 0）のとき overLimit
 *   - 空白がある（gaps 非空）とき careGap
 *   - 過労（overloads 非空）のとき caregiverOverload
 *   - 配置違反（hardViolations 非空）のとき hardViolation
 *   - 計算不能（validationErrors 非空）のとき validationUnavailable
 *   - 注意：null の検査項目は未判定として扱い、対応するコラムは出さない
 * - サービス説明：4サービス＋家族の付き添い（サービスパレットと配置の詳細から読める形）
 */

import rawColumnsData from "../data/columns.json";
import type {
  ColumnContent,
  DecisionContent,
  PlacementKind,
  SceneColumnContent,
  SceneId,
  ServiceContent,
  ValidationResult,
} from "./types";

/** 場面IDの固定5種（共通前提・Issue 13） */
export const SCENE_IDS: readonly SceneId[] = [
  "overLimit",
  "careGap",
  "caregiverOverload",
  "hardViolation",
  "validationUnavailable",
] as const;

/** サービス説明で網羅すべき種別（4サービス＋家族の付き添い＝PlacementKind の5種） */
export const REQUIRED_SERVICE_KINDS: readonly PlacementKind[] = [
  "visit",
  "daycare",
  "dayrehab",
  "shortstay",
  "family",
] as const;

export const EXPECTED_DECISION_COUNT = 8;
export const EXPECTED_SCENE_COUNT = 5;

/** 場面IDの日本語表示名 */
export const SCENE_LABELS: Record<SceneId, string> = {
  overLimit: "介護保険の上限超過",
  careGap: "介護の空白時間",
  caregiverOverload: "付き添いの負担集中",
  hardViolation: "予定の置き方に問題",
  validationUnavailable: "計算・判定できない項目",
};

/** 場面IDごとのスタイル定義（WarningAlerts とトーンを一致） */
export interface SceneStyle {
  icon: string;
  badge: string;
  border: string;
  bg: string;
  text: string;
  headerBg: string;
}

export const SCENE_STYLES: Record<SceneId, SceneStyle> = {
  overLimit: {
    icon: "⚠️",
    badge: "上限超過",
    border: "border-amber-300",
    bg: "bg-amber-50",
    text: "text-amber-950",
    headerBg: "bg-amber-100/70",
  },
  careGap: {
    icon: "🕒",
    badge: "介護の空白",
    border: "border-blue-300",
    bg: "bg-blue-50",
    text: "text-blue-950",
    headerBg: "bg-blue-100/70",
  },
  caregiverOverload: {
    icon: "🏃",
    badge: "負担集中",
    border: "border-orange-300",
    bg: "bg-orange-50",
    text: "text-orange-950",
    headerBg: "bg-orange-100/70",
  },
  hardViolation: {
    icon: "🚫",
    badge: "予定の置き方",
    border: "border-red-300",
    bg: "bg-red-50",
    text: "text-red-950",
    headerBg: "bg-red-100/70",
  },
  validationUnavailable: {
    icon: "❓",
    badge: "未判定あり",
    border: "border-purple-300",
    bg: "bg-purple-50",
    text: "text-purple-950",
    headerBg: "bg-purple-100/70",
  },
};

/** サービス種別の表示ラベル（週間ボード・トップ画面と一致） */
export const SERVICE_KIND_LABELS: Record<PlacementKind, string> = {
  visit: "訪問介護",
  daycare: "通所介護",
  dayrehab: "通所リハビリ",
  shortstay: "ショートステイ",
  family: "家族の付き添い",
};

/** サービス種別のバッジ用スタイル */
export const SERVICE_KIND_STYLES: Record<PlacementKind, string> = {
  visit: "bg-sky-100 text-sky-900 border-sky-300",
  daycare: "bg-emerald-100 text-emerald-900 border-emerald-300",
  dayrehab: "bg-fuchsia-200 text-fuchsia-950 border-fuchsia-400",
  shortstay: "bg-violet-100 text-violet-900 border-violet-300",
  family: "bg-amber-100 text-amber-900 border-amber-300",
};

/** 読み込んだ columns.json データ */
export const columnsData: ColumnContent[] = rawColumnsData as ColumnContent[];

/** 決めることリスト項目（type: "decision"）のみ抽出 */
export function getDecisionContents(
  contents: readonly ColumnContent[],
): DecisionContent[] {
  return contents.filter((c): c is DecisionContent => c.type === "decision");
}

/** 場面連動コラム（type: "column"）のみ抽出 */
export function getSceneColumns(
  contents: readonly ColumnContent[],
): SceneColumnContent[] {
  return contents.filter((c): c is SceneColumnContent => c.type === "column");
}

/** サービス説明（type: "service"）のみ抽出 */
export function getServiceContents(
  contents: readonly ColumnContent[],
): ServiceContent[] {
  return contents.filter((c): c is ServiceContent => c.type === "service");
}

/** 特定の sceneId に対応するコラムを引く */
export function findSceneColumn(
  contents: readonly ColumnContent[],
  sceneId: SceneId,
): SceneColumnContent | undefined {
  return getSceneColumns(contents).find((c) => c.sceneId === sceneId);
}

/**
 * サービス説明を検索する。
 * serviceId があれば優先一致、なければ kind で一致するものを返す。
 */
export function findServiceContent(
  contents: readonly ColumnContent[],
  kind: PlacementKind,
  serviceId?: string,
): ServiceContent | undefined {
  const services = getServiceContents(contents);
  if (serviceId) {
    const byId = services.find((s) => s.serviceId === serviceId);
    if (byId) return byId;
  }
  return services.find((s) => s.kind === kind);
}

/**
 * ValidationResult から現在発生している場面（SceneId）を判定して返す。
 *
 * 判定条件（共通前提・Issue 13）:
 * - overLimit: overUnits !== null && overUnits > 0
 * - careGap: gaps.length > 0
 * - caregiverOverload: overloads.length > 0
 * - hardViolation: hardViolations.length > 0
 * - validationUnavailable: validationErrors.length > 0
 *
 * 注意: null の検査項目は未判定として扱い、対応するコラムは出さない。
 */
export function determineActiveScenes(validation: ValidationResult): SceneId[] {
  const scenes: SceneId[] = [];
  if (validation.overUnits !== null && validation.overUnits > 0) {
    scenes.push("overLimit");
  }
  if (validation.gaps.length > 0) {
    scenes.push("careGap");
  }
  if (validation.overloads.length > 0) {
    scenes.push("caregiverOverload");
  }
  if (validation.hardViolations.length > 0) {
    scenes.push("hardViolation");
  }
  if (validation.validationErrors.length > 0) {
    scenes.push("validationUnavailable");
  }
  return scenes;
}

/** 特定の場面が現在発生しているか判定 */
export function isSceneActive(
  validation: ValidationResult,
  sceneId: SceneId,
): boolean {
  switch (sceneId) {
    case "overLimit":
      return validation.overUnits !== null && validation.overUnits > 0;
    case "careGap":
      return validation.gaps.length > 0;
    case "caregiverOverload":
      return validation.overloads.length > 0;
    case "hardViolation":
      return validation.hardViolations.length > 0;
    case "validationUnavailable":
      return validation.validationErrors.length > 0;
  }
}

/** ValidationResult に応じて現在表示すべき場面連動コラムの一覧を取得 */
export function getActiveSceneColumns(
  contents: readonly ColumnContent[],
  validation: ValidationResult,
): SceneColumnContent[] {
  const activeScenes = new Set(determineActiveScenes(validation));
  return getSceneColumns(contents).filter((c) => activeScenes.has(c.sceneId));
}

/** columns.json の検証エラー詳細 */
export interface ColumnsValidationError {
  id?: string;
  field?: string;
  message: string;
}

/**
 * columns.json の形式を検証する純粋関数。
 * - 8項目（決めることリスト）
 * - 5本（場面連動コラム：5種の sceneId すべて）
 * - サービス説明（4サービス＋家族の付き添い）
 * - 各種必須フィールド（id, title, body）および ID 一意性
 */
export function validateColumnsData(data: unknown): ColumnsValidationError[] {
  const errors: ColumnsValidationError[] = [];
  if (!Array.isArray(data) || data.length === 0) {
    errors.push({ message: "columns.json が配列でないか、空です。" });
    return errors;
  }

  const seenIds = new Set<string>();
  const decisions: DecisionContent[] = [];
  const columns: SceneColumnContent[] = [];
  const services: ServiceContent[] = [];

  for (let i = 0; i < data.length; i++) {
    const item = data[i];
    if (typeof item !== "object" || item === null) {
      errors.push({
        field: `[${i}]`,
        message: "要素がオブジェクトではありません。",
      });
      continue;
    }

    const { id, title, body, type } = item as Record<string, unknown>;

    if (typeof id !== "string" || id.trim() === "") {
      errors.push({
        field: `[${i}].id`,
        message: "id は空でない文字列でなければなりません。",
      });
    } else if (seenIds.has(id)) {
      errors.push({ id, field: "id", message: `id が重複しています: ${id}` });
    } else {
      seenIds.add(id);
    }

    if (typeof title !== "string" || title.trim() === "") {
      errors.push({
        id: typeof id === "string" ? id : undefined,
        field: `[${i}].title`,
        message: "title は空でない文字列でなければなりません。",
      });
    }

    if (typeof body !== "string" || body.trim() === "") {
      errors.push({
        id: typeof id === "string" ? id : undefined,
        field: `[${i}].body`,
        message: "body は空でない文字列でなければなりません。",
      });
    }

    if (type === "decision") {
      decisions.push(item as DecisionContent);
    } else if (type === "column") {
      const sceneId = (item as Record<string, unknown>).sceneId;
      if (
        typeof sceneId !== "string" ||
        !SCENE_IDS.includes(sceneId as SceneId)
      ) {
        errors.push({
          id: typeof id === "string" ? id : undefined,
          field: "sceneId",
          message: `sceneId は ${SCENE_IDS.join(", ")} のいずれかでなければなりません。取得値: ${String(sceneId)}`,
        });
      }
      columns.push(item as SceneColumnContent);
    } else if (type === "service") {
      const kind = (item as Record<string, unknown>).kind;
      if (
        typeof kind !== "string" ||
        !REQUIRED_SERVICE_KINDS.includes(kind as PlacementKind)
      ) {
        errors.push({
          id: typeof id === "string" ? id : undefined,
          field: "kind",
          message: `kind は ${REQUIRED_SERVICE_KINDS.join(", ")} のいずれかでなければなりません。取得値: ${String(kind)}`,
        });
      }
      services.push(item as ServiceContent);
    } else {
      errors.push({
        id: typeof id === "string" ? id : undefined,
        field: "type",
        message: `type は 'decision' | 'column' | 'service' のいずれかでなければなりません。取得値: ${String(type)}`,
      });
    }
  }

  // 決めることリスト8項目のチェック
  if (decisions.length !== EXPECTED_DECISION_COUNT) {
    errors.push({
      field: "decisions",
      message: `決めることリストは ${EXPECTED_DECISION_COUNT} 項目必要です（現在: ${decisions.length} 項目）。`,
    });
  }

  // 場面連動コラム5本のチェック（5種の sceneId が重複なくすべて揃っていること）
  const columnSceneIds = new Set(columns.map((c) => c.sceneId));
  for (const requiredScene of SCENE_IDS) {
    if (!columnSceneIds.has(requiredScene)) {
      errors.push({
        field: "columns",
        message: `場面連動コラムに sceneId: "${requiredScene}" が含まれていません。`,
      });
    }
  }
  if (columns.length !== EXPECTED_SCENE_COUNT) {
    errors.push({
      field: "columns",
      message: `場面連動コラムは ${EXPECTED_SCENE_COUNT} 本必要です（現在: ${columns.length} 本）。`,
    });
  }

  // サービス説明のチェック（4サービス＋家族の付き添い＝5種が網羅されていること）
  const serviceKinds = new Set(services.map((s) => s.kind));
  for (const requiredKind of REQUIRED_SERVICE_KINDS) {
    if (!serviceKinds.has(requiredKind)) {
      errors.push({
        field: "services",
        message: `サービス説明に kind: "${requiredKind}" が含まれていません。`,
      });
    }
  }

  return errors;
}
