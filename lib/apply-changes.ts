/**
 * 変更の適用（Issue 6 が実装。契約は Issue 0 の lib/types.ts）。
 *
 * 代替案の変更リストを配置の一覧へ適用する、保存しない純粋関数。
 * Issue 8（試し適用）と Issue 14（本適用）は必ずこの同じ関数を使う。
 *
 * 契約：
 * - 入力（placements／changes とその要素）は変更しない。結果は新しい配列で返す
 * - move は終了時刻を元の長さから算出する（長さは変えない）
 * - add の配置 ID は change.placementId（＝正規化時にサーバーが crypto.randomUUID() で
 *   採番したもの）をそのまま使う。ここでは採番しない
 * - 正規化（Issue 8）を通った変更は対象 ID が実在し、同一 ID への操作は1回だけ。
 *   それでも堅牢のため、存在しない ID への remove／move／resize は無視する（例外にしない）
 */

import type { Placement, ProposalChange } from "./types";

/** 変更リストを適用した新しい配置一覧を返す（保存はしない） */
export function applyChanges(
  placements: Placement[],
  changes: ProposalChange[],
): Placement[] {
  const removedIds = new Set<string>();
  const modifiedById = new Map<string, Placement>();
  const added: Placement[] = [];
  const byId = new Map(placements.map((p) => [p.id, p]));

  for (const change of changes) {
    switch (change.action) {
      case "remove": {
        if (byId.has(change.placementId)) {
          removedIds.add(change.placementId);
        }
        break;
      }
      case "move": {
        const target = byId.get(change.placementId);
        if (target) {
          const duration = target.endHour - target.startHour;
          modifiedById.set(change.placementId, {
            ...target,
            day: change.day,
            startHour: change.startHour,
            endHour: change.startHour + duration,
          });
        }
        break;
      }
      case "resize": {
        const target = byId.get(change.placementId);
        if (target) {
          modifiedById.set(change.placementId, {
            ...target,
            startHour: change.startHour,
            endHour: change.endHour,
          });
        }
        break;
      }
      case "add": {
        const placement: Placement = {
          id: change.placementId,
          day: change.day,
          startHour: change.startHour,
          endHour: change.endHour,
          kind: change.kind,
        };
        if (change.serviceId !== undefined) placement.serviceId = change.serviceId;
        if (change.personId !== undefined) placement.personId = change.personId;
        if (change.note !== undefined) placement.note = change.note;
        added.push(placement);
        break;
      }
    }
  }

  const kept = placements
    .filter((p) => !removedIds.has(p.id))
    .map((p) => modifiedById.get(p.id) ?? p);
  return [...kept, ...added];
}
