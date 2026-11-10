import type { BoardService } from "./board";
import type { PlacementKind } from "./types";
import { getServiceMaster, unitsMaster } from "./units";

/** マスターの基本単位の範囲を表示するだけ。配置や費用の計算には使わない。 */
export function paletteUnitHints(kind: PlacementKind, services: readonly BoardService[]): string[] {
  if (kind === "family") return [];
  return services.filter(s => s.kind === kind).flatMap(service => {
    const master = getServiceMaster(unitsMaster, service.serviceId);
    if (!master || master.bands.length === 0) return [];
    const values = master.bands.map(band => band.units);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = min === max ? min.toLocaleString("ja-JP") : `${min.toLocaleString("ja-JP")}〜${max.toLocaleString("ja-JP")}`;
    const maxLimitNote = service.serviceId === "visit-body" ? "（最大3時間）" : "";
    return [`${master.name}${maxLimitNote}：${range}単位／${master.billing === "perDay" ? "日" : "回"}`];
  });
}
