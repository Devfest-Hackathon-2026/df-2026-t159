import { BOARD_END_HOUR, BOARD_START_HOUR, type Placement } from "./types";

export type ResizeEdge = "start" | "end";

/** 訪問介護（身体介護）は単位数表の範囲が最大3時間まで */
export const MAX_VISIT_BODY_HOURS = 3;

/** 元の配置を基準に1時間へスナップする。反対側の端と曜日・IDは変えない。 */
export function resizeBlock(p: Placement, edge: ResizeEdge, deltaY: number, hourHeight: number): Placement | null {
  if (p.kind === "shortstay" || !Number.isFinite(deltaY) || !Number.isFinite(hourHeight) || hourHeight <= 0) return null;
  const hours = Math.round(deltaY / hourHeight);

  // 身体介護は最大3時間（表の範囲内）までしか伸ばせない
  const isBodyVisit = p.kind === "visit" && p.serviceId !== "visit-life";
  const minStartHour = isBodyVisit
    ? Math.max(BOARD_START_HOUR, p.endHour - MAX_VISIT_BODY_HOURS)
    : BOARD_START_HOUR;
  const maxEndHour = isBodyVisit
    ? Math.min(BOARD_END_HOUR, p.startHour + MAX_VISIT_BODY_HOURS)
    : BOARD_END_HOUR;

  return edge === "start"
    ? { ...p, startHour: Math.min(p.endHour - 1, Math.max(minStartHour, p.startHour + hours)) }
    : { ...p, endHour: Math.max(p.startHour + 1, Math.min(maxEndHour, p.endHour + hours)) };
}
