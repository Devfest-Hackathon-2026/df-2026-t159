import { describe, expect, it } from "vitest";
import { resizeBlock } from "./block-resize";
import type { Placement } from "./types";

const p: Placement = { id: "p", day: 2, startHour: 9, endHour: 12, kind: "family", personId: "person", note: "維持するメモ" };
describe("ブロックの上下リサイズ", () => {
  it("上端は開始だけ、下端は終了だけを1時間単位で変える", () => {
    expect(resizeBlock(p, "start", -28, 28)).toEqual({ ...p, startHour: 8 });
    expect(resizeBlock(p, "end", 56, 28)).toEqual({ ...p, endHour: 14 });
    expect(p).toMatchObject({ startHour: 9, endHour: 12 });
  });
  it("小さい移動は同じ時刻に留まり、移動元からの累積距離でスナップする", () => {
    expect(resizeBlock(p, "start", 10, 28)).toEqual(p);
    expect(resizeBlock(p, "start", 20, 28)?.startHour).toBe(10);
    expect(resizeBlock(p, "end", -20, 28)?.endHour).toBe(11);
  });
  it("6時・24時と最小1時間で止まる", () => {
    expect(resizeBlock(p, "start", -1000, 28)?.startHour).toBe(6);
    expect(resizeBlock(p, "end", 1000, 28)?.endHour).toBe(24);
    expect(resizeBlock(p, "start", 1000, 28)?.startHour).toBe(11);
    expect(resizeBlock(p, "end", -1000, 28)?.endHour).toBe(10);
  });
  it("1時間の配置も両側へ伸ばせるが、それより短くならない", () => {
    const short = { ...p, endHour: 10 };
    expect(resizeBlock(short, "start", 28, 28)).toEqual(short);
    expect(resizeBlock(short, "end", -28, 28)).toEqual(short);
    expect(resizeBlock(short, "start", -28, 28)?.startHour).toBe(8);
    expect(resizeBlock(short, "end", 28, 28)?.endHour).toBe(11);
  });
  it("ショートステイと不正な距離・スケールは変更しない", () => {
    expect(resizeBlock({ ...p, kind: "shortstay", startHour: 6, endHour: 24 }, "start", 28, 28)).toBeNull();
    expect(resizeBlock(p, "end", NaN, 28)).toBeNull();
    expect(resizeBlock(p, "end", 28, 0)).toBeNull();
  });

  it("訪問介護（身体介護）は最大3時間までしか伸ばせない（生活援助は上限なし）", () => {
    const visitBody: Placement = {
      id: "v-body",
      day: 0,
      startHour: 9,
      endHour: 10,
      kind: "visit",
      serviceId: "visit-body",
    };
    // 下端を4時間以上伸ばそうとしても、startHour + 3 = 12 で止まる
    expect(resizeBlock(visitBody, "end", 28 * 10, 28)?.endHour).toBe(12);

    // 上端を上に伸ばそうとしても、endHour - 3 = 7 で止まる
    const visitBody3h: Placement = { ...visitBody, startHour: 9, endHour: 12 };
    expect(resizeBlock(visitBody3h, "start", -28 * 5, 28)?.startHour).toBe(9);

    // 生活援助（visit-life）は3時間を超えて伸ばせる
    const visitLife: Placement = {
      id: "v-life",
      day: 0,
      startHour: 9,
      endHour: 10,
      kind: "visit",
      serviceId: "visit-life",
    };
    expect(resizeBlock(visitLife, "end", 28 * 5, 28)?.endHour).toBe(15);
  });
});
