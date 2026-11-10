import type { DayIndex, Placement, PlacementKind } from "./types";

export const DAYS = ["月", "火", "水", "木", "金", "土", "日"] as const;
export const HOURS = Array.from({ length: 18 }, (_, i) => i + 6);
export const KIND_LABELS: Record<PlacementKind, string> = {
  visit: "訪問介護", daycare: "通所介護", dayrehab: "通所リハビリ",
  shortstay: "ショートステイ", family: "家族の付き添い",
};

/** パレット・配置ブロック・ドラッグ中の表示で共用する種別アイコン。 */
export const SERVICE_ICONS: Record<PlacementKind, string> = {
  visit: "🏠",
  daycare: "🚌",
  dayrehab: "🏃",
  shortstay: "🏨",
  family: "👥",
};

/** パレットの表示用データ。単位数や時間区分の計算は持たない。 */
export interface BoardService {
  serviceId: string;
  title: string;
  kind: Exclude<PlacementKind, "family">;
}

/** ドラッグでは長さを保ち、範囲外は補正せず拒否する。 */
export function moveBlock(p: Placement, day: number, startHour: number): Placement | null {
  const start = p.kind === "shortstay" ? 6 : startHour;
  const end = p.kind === "shortstay" ? 24 : start + p.endHour - p.startHour;
  if (!Number.isInteger(day) || day < 0 || day > 6 || !Number.isInteger(start) || start < 6 || end > 24) return null;
  return { ...p, day: day as DayIndex, startHour: start, endHour: end };
}

/** フォームの入力範囲のみ検査。制度上の検証は検証エンジンに任せる。 */
export function placementInputError(p: Placement, placements: Placement[]): string | null {
  if (!Number.isInteger(p.day) || p.day < 0 || p.day > 6 ||
      !Number.isInteger(p.startHour) || !Number.isInteger(p.endHour) ||
      p.startHour < 6 || p.startHour >= p.endHour || p.endHour > 24) return "時刻は6:00〜24:00の整数時間で、開始より後に終了してください。";
  if (p.kind === "shortstay") {
    if (p.startHour !== 6 || p.endHour !== 24) return "ショートステイは6:00〜24:00固定です。";
    if (placements.some(other => other.id !== p.id && other.kind === "shortstay" && other.day === p.day)) return "ショートステイは同日1件までです。";
  }
  if (p.kind === "visit" && p.serviceId !== "visit-life") {
    if (p.endHour - p.startHour > 3) return "訪問介護（身体介護）は最大3時間までです。";
  }
  return null;
}

/**
 * サービス種類ごとのドロップ・配置追加時の既定の開始・終了時刻を決定する。
 * 通所介護・通所リハビリは3時間（単位数マスターの最低区分が3時間〜のため）、
 * ショートステイは6:00〜24:00固定、その他（訪問介護・家族の付き添い）は1時間。
 */
export function getDefaultPlacementHours(
  kind: PlacementKind,
  startHour: number = 6
): { startHour: number; endHour: number } {
  if (kind === "shortstay") {
    return { startHour: 6, endHour: 24 };
  }
  const duration = kind === "daycare" || kind === "dayrehab" ? 3 : 1;
  const start = Math.max(6, Math.min(24, startHour));
  const end = Math.min(24, start + duration);
  return { startHour: start, endHour: end };
}

export interface PlacementColumnLayout {
  column: number;
  totalColumns: number;
}

/**
 * 同一曜日内の配置ブロックについて、重なりを検知し
 * 横並びで均等分割して表示するためのカラム番号と総カラム数を計算する。
 */
export function computePlacementColumns(
  placements: Placement[]
): Map<string, PlacementColumnLayout> {
  const result = new Map<string, PlacementColumnLayout>();
  if (placements.length === 0) return result;

  // 開始時刻順（同一なら長さが長い順、同一ならID順）でソート
  const sorted = [...placements].sort((a, b) => {
    if (a.startHour !== b.startHour) return a.startHour - b.startHour;
    if (a.endHour !== b.endHour) return b.endHour - a.endHour;
    return a.id.localeCompare(b.id);
  });

  // 重なり合うブロックの連結成分（クラスター）を構築
  const clusters: Placement[][] = [];
  for (const p of sorted) {
    let added = false;
    for (const cluster of clusters) {
      if (cluster.some(other => p.startHour < other.endHour && other.startHour < p.endHour)) {
        cluster.push(p);
        added = true;
        break;
      }
    }
    if (!added) {
      clusters.push([p]);
    }
  }

  // クラスター同士が間接的に重なる場合をマージ
  const mergedClusters: Placement[][] = [];
  for (const cluster of clusters) {
    let merged = false;
    for (const target of mergedClusters) {
      if (cluster.some(p => target.some(t => p.startHour < t.endHour && t.startHour < p.endHour))) {
        target.push(...cluster);
        merged = true;
        break;
      }
    }
    if (!merged) {
      mergedClusters.push(cluster);
    }
  }

  // 各クラスター内で列を割り当てる（貪欲法）
  for (const cluster of mergedClusters) {
    const uniquePlacements = Array.from(new Set(cluster)).sort((a, b) => {
      if (a.startHour !== b.startHour) return a.startHour - b.startHour;
      if (a.endHour !== b.endHour) return b.endHour - a.endHour;
      return a.id.localeCompare(b.id);
    });

    const columns: Placement[][] = [];
    const assignment = new Map<string, number>();

    for (const p of uniquePlacements) {
      let placedCol = -1;
      for (let colIdx = 0; colIdx < columns.length; colIdx++) {
        const lastInCol = columns[colIdx][columns[colIdx].length - 1];
        if (lastInCol.endHour <= p.startHour) {
          columns[colIdx].push(p);
          placedCol = colIdx;
          break;
        }
      }
      if (placedCol === -1) {
        columns.push([p]);
        placedCol = columns.length - 1;
      }
      assignment.set(p.id, placedCol);
    }

    const totalCols = columns.length;
    for (const p of uniquePlacements) {
      result.set(p.id, {
        column: assignment.get(p.id) ?? 0,
        totalColumns: totalCols,
      });
    }
  }

  return result;
}

export interface BlockSegment {
  startHour: number;
  endHour: number;
  widthPct: number;
  leftPct: number;
  isSplit: boolean;
  colIndex: number;
}

/**
 * 1つの配置ブロックを、重なり区間だけを左右分割して描くためのセグメント列に変換する。
 * - 単独表示（totalColumns=1）または3つ以上の重なり（カスケード表示）のときは全幅1セグメント。
 * - ちょうど2つの重なりのときは、重なっている時間帯だけ widthPct=50・leftPct=列位置×50 とし、
 *   重なっていない時間帯は全幅にする。
 */
export function computeBlockSegments(
  placement: Placement,
  dayPlacements: Placement[],
  columnLayouts: Map<string, PlacementColumnLayout>,
): BlockSegment[] {
  const layout = columnLayouts.get(placement.id) ?? { column: 0, totalColumns: 1 };
  const full: BlockSegment = {
    startHour: placement.startHour,
    endHour: placement.endHour,
    widthPct: 100,
    leftPct: 0,
    isSplit: false,
    colIndex: 0,
  };
  if (layout.totalColumns !== 2) return [full];

  const overlapping = dayPlacements.filter(
    other =>
      other.id !== placement.id &&
      other.startHour < placement.endHour &&
      placement.startHour < other.endHour,
  );
  if (overlapping.length === 0) return [full];

  const points = new Set<number>([placement.startHour, placement.endHour]);
  for (const other of overlapping) {
    points.add(Math.max(placement.startHour, other.startHour));
    points.add(Math.min(placement.endHour, other.endHour));
  }
  const sorted = [...points].sort((a, b) => a - b);

  const segments: BlockSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const startHour = sorted[i];
    const endHour = sorted[i + 1];
    if (endHour <= startHour) continue;
    const isSplit = overlapping.some(
      other => other.startHour <= startHour && endHour <= other.endHour,
    );
    const seg: BlockSegment = isSplit
      ? {
          startHour,
          endHour,
          widthPct: 50,
          leftPct: layout.column * 50,
          isSplit: true,
          colIndex: layout.column,
        }
      : {
          startHour,
          endHour,
          widthPct: 100,
          leftPct: 0,
          isSplit: false,
          colIndex: 0,
        };
    const prev = segments[segments.length - 1];
    if (
      prev &&
      prev.isSplit === seg.isSplit &&
      prev.widthPct === seg.widthPct &&
      prev.leftPct === seg.leftPct &&
      prev.endHour === seg.startHour
    ) {
      prev.endHour = seg.endHour;
    } else {
      segments.push(seg);
    }
  }
  return segments.length > 0 ? segments : [full];
}

/**
 * ラベル（サービス名・時刻・注記）を表示するセグメントを選ぶ。
 * 全幅の区間を優先し、その中で最も長い区間、同点なら先頭側を返す。
 */
export function findTextSegment(segments: BlockSegment[]): BlockSegment | undefined {
  let best: BlockSegment | undefined;
  for (const seg of segments) {
    if (!best) {
      best = seg;
      continue;
    }
    const segFull = seg.widthPct >= 100;
    const bestFull = best.widthPct >= 100;
    if (segFull !== bestFull) {
      if (segFull) best = seg;
      continue;
    }
    if (seg.endHour - seg.startHour > best.endHour - best.startHour) best = seg;
  }
  return best;
}
