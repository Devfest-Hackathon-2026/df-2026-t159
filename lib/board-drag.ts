import type { CollisionDetection } from "@dnd-kit/core";
import { HOURS } from "./board";

/** 時間セル上のポインターと、ブロック内でつかんだ行を対応させる表示用処理。 */
export function dropStartHour(targetHour: number, grabOffsetY: number, rowHeight: number): number {
  return targetHour - Math.floor(Math.max(0, grabOffsetY) / rowHeight);
}

/** 測定する着地対象は7つの曜日列だけ。時間セルは実ポインターの高さから特定する。 */
export function createBoardCollisionDetection(rowHeight: number): CollisionDetection {
  return args => {
    const pointer = args.pointerCoordinates;
    if (!pointer) return [];
    for (const container of args.droppableContainers) {
      const rect = args.droppableRects.get(container.id);
      if (!container.data.current || !rect || pointer.x < rect.left || pointer.x >= rect.right ||
        pointer.y < rect.top || pointer.y >= rect.bottom) continue;
      container.data.current.hour = Math.max(HOURS[0], Math.min(HOURS[HOURS.length - 1],
        HOURS[0] + Math.floor((pointer.y - rect.top) / rowHeight)));
      return [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
    }
    return [];
  };
}
