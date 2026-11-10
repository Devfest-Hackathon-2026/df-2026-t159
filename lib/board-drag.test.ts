import { describe, expect, it } from "vitest";
import type { CollisionDetection } from "@dnd-kit/core";
import { createBoardCollisionDetection, dropStartHour } from "./board-drag";
import { moveBlock } from "./board";
import type { Placement } from "./types";

const rowHeight = 28;
const placement: Placement = { id: "p", day: 0, startHour: 9, endHour: 16, kind: "daycare", serviceId: "daycare-basic" };

describe("つかんだ位置を基準にした着地", () => {
  it.each([[2, 12], [2.5 * rowHeight, 14], [6.8 * rowHeight, 18]])(
    "上・中・下（オフセット%s）をつかんでも、対象セル%sで12時開始にそろう", (offset, targetHour) => {
      const moved = moveBlock(placement, 1, dropStartHour(targetHour, offset, rowHeight));
      expect(moved).toEqual({ ...placement, day: 1, startHour: 12, endHour: 19 });
    },
  );
  it("24時超過を補正せず拒否し、ショートステイの終日条件も維持する", () => {
    expect(moveBlock(placement, 1, dropStartHour(23, 0, rowHeight))).toBeNull();
    expect(moveBlock({ ...placement, kind: "shortstay", startHour: 6, endHour: 24 }, 1, 18))
      .toEqual({ ...placement, kind: "shortstay", day: 1, startHour: 6, endHour: 24 });
  });
});

function scene(top = 100) {
  const containers = [0, 1].map(day => {
    const rect = { left: 100 + day * 100, right: 200 + day * 100, top, bottom: top + 504, width: 100, height: 504 };
    return { id: `day-${day}`, key: `day-${day}`, disabled: false, node: { current: null },
      rect: { current: rect }, data: { current: { day, hour: 6 } } };
  });
  const args: Parameters<CollisionDetection>[0] = {
    active: { id: "p", data: { current: {} }, rect: { current: { initial: null, translated: null } } },
    collisionRect: { left: 650, right: 750, top: 100, bottom: 604, width: 100, height: 504 },
    droppableContainers: containers, droppableRects: new Map(containers.map(c => [c.id, c.rect.current])),
    pointerCoordinates: null,
  };
  return { args, containers, detect: createBoardCollisionDetection(rowHeight) };
}

describe("曜日列のポインター判定", () => {
  it("ブロックの中心でなく実ポインターの曜日・時間を採用し、同じ列の移動も更新する", () => {
    const { args, containers, detect } = scene();
    args.pointerCoordinates = { x: 150, y: 100 + 28 * 3 + 5 };
    expect(detect(args).map(c => c.id)).toEqual(["day-0"]);
    expect(containers[0].data.current.hour).toBe(9);
    args.pointerCoordinates.y = 100 + 28 * 10 + 5;
    detect(args);
    expect(containers[0].data.current.hour).toBe(16);
  });
  it("曜日の境界を半開区間で扱い、盤面外やポインターなしで保存先を作らない", () => {
    const { args, detect } = scene();
    args.pointerCoordinates = { x: 200, y: 100 };
    expect(detect(args).map(c => c.id)).toEqual(["day-1"]);
    args.pointerCoordinates = { x: 150, y: 604 };
    expect(detect(args)).toEqual([]);
    args.pointerCoordinates = { x: 99, y: 200 };
    expect(detect(args)).toEqual([]);
    args.pointerCoordinates = null;
    expect(detect(args)).toEqual([]);
  });
  it("スクロール後の列矩形でも、現在の画面座標から時間を特定する", () => {
    const { args, containers, detect } = scene(-200);
    args.pointerCoordinates = { x: 150, y: 0 };
    detect(args);
    expect(containers[0].data.current.hour).toBe(13);
  });
});
