// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyBoard from "./WeeklyBoard";
import { mockSnapshot } from "@/lib/mock";
import type { Placement, RoomSnapshot, ValidationResult } from "@/lib/types";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("WeeklyBoard D1改善テスト", () => {
  it("空白がある時間帯は赤い帯と先頭チップ「⚠ 介護が必要 HH:MM–HH:MM」を表示する", () => {
    const validation: ValidationResult = {
      ok: false,
      weeklyUnits: 0,
      monthlyUnits: 0,
      limitUnits: 27048,
      overUnits: 0,
      selfPayYen: 0,
      selfPayBreakdown: { withinYen: 0, overYen: 0 },
      gaps: [{ day: 2, startHour: 12, endHour: 14 }], // 水曜 12:00〜14:00
      memberHours: [],
      overloads: [],
      hardViolations: [],
      validationErrors: [],
    };

    render(
      <WeeklyBoard
        snapshot={mockSnapshot}
        canEdit={true}
        saving={false}
        services={[]}
        validation={validation}
        onSave={vi.fn(async () => true)}
      />
    );

    // 水曜 12:00 の先頭セルにチップ「⚠ 介護が必要 12:00–14:00」が表示される
    expect(screen.getByText("⚠ 介護が必要")).toBeTruthy();
    expect(screen.getByText("12:00–14:00")).toBeTruthy();

    // 12:00 と 13:00 の両マスに薄赤の背景クラスが付与されている
    const cell12 = screen.getByLabelText("水曜 12:00 介護の空白");
    const cell13 = screen.getByLabelText("水曜 13:00 介護の空白");
    expect(cell12.className).toContain("bg-red-50");
    expect(cell13.className).toContain("bg-red-50");

    // 介護必須の旧ラベルは存在しない
    expect(screen.queryByText("介護必須")).toBeNull();
  });

  it("同一曜日で2つのブロックが重なる場合、外枠は全幅（100%）となり、重なっている時間帯のみ左右分割される", () => {
    const snapshotWithOverlap: RoomSnapshot = {
      ...mockSnapshot,
      placements: [
        {
          id: "overlap-1",
          day: 0,
          startHour: 10,
          endHour: 12,
          kind: "family",
          personId: "person-daughter",
        },
        {
          id: "overlap-2",
          day: 0,
          startHour: 11,
          endHour: 13,
          kind: "family",
          personId: "person-mother",
        },
      ],
    };

    render(
      <WeeklyBoard
        snapshot={snapshotWithOverlap}
        canEdit={true}
        saving={false}
        services={[]}
        validation={null}
        onSave={vi.fn(async () => true)}
      />
    );

    const block1 = screen.getByRole("button", { name: /長女の付き添い.*10:00の詳細/ });
    const block2 = screen.getByRole("button", { name: /母の付き添い.*11:00の詳細/ });

    const parent1 = block1.parentElement!;
    const parent2 = block2.parentElement!;

    // 2つの重なり時、ブロック外枠は全幅（width: 100%, marginLeft: 0%）
    expect(parent1.style.width).toBe("100%");
    expect(parent2.style.width).toBe("100%");
    expect(parent1.style.marginLeft).toBe("0%");
    expect(parent2.style.marginLeft).toBe("0%");

    // block1 (長女 10〜12時): 10〜11時は全幅、11〜12時は左50%
    const seg1_10_11 = within(block1).getByTestId("segment-10-11");
    const seg1_11_12 = within(block1).getByTestId("segment-11-12");
    expect(seg1_10_11.getAttribute("data-segment-width")).toBe("100");
    expect(seg1_10_11.getAttribute("data-segment-left")).toBe("0");
    expect(seg1_11_12.getAttribute("data-segment-width")).toBe("50");
    expect(seg1_11_12.getAttribute("data-segment-left")).toBe("0");

    // block2 (母 11〜13時): 11〜12時は右50%、12〜13時は全幅
    const seg2_11_12 = within(block2).getByTestId("segment-11-12");
    const seg2_12_13 = within(block2).getByTestId("segment-12-13");
    expect(seg2_11_12.getAttribute("data-segment-width")).toBe("50");
    expect(seg2_11_12.getAttribute("data-segment-left")).toBe("50");
    expect(seg2_12_13.getAttribute("data-segment-width")).toBe("100");
    expect(seg2_12_13.getAttribute("data-segment-left")).toBe("0");
  });

  it("17〜19時と18〜21時の重なりで、17〜18時は全幅・18〜19時だけ分割・19〜21時は全幅になる", () => {
    const snapshot: RoomSnapshot = {
      ...mockSnapshot,
      placements: [
        {
          id: "placement-a",
          day: 0,
          startHour: 17,
          endHour: 19,
          kind: "family",
          personId: "person-mother",
        },
        {
          id: "placement-b",
          day: 0,
          startHour: 18,
          endHour: 21,
          kind: "family",
          personId: "person-daughter",
        },
      ],
    };

    render(
      <WeeklyBoard
        snapshot={snapshot}
        canEdit={true}
        saving={false}
        services={[]}
        validation={null}
        onSave={vi.fn(async () => true)}
      />
    );

    const blockA = screen.getByRole("button", { name: /母の付き添い.*17:00の詳細/ });
    const blockB = screen.getByRole("button", { name: /長女の付き添い.*18:00の詳細/ });

    // 外枠は両方とも全幅
    expect(blockA.parentElement?.style.width).toBe("100%");
    expect(blockB.parentElement?.style.width).toBe("100%");

    // A: 17〜18時は全幅 (width 100%, left 0%)、18〜19時は左50% (width 50%, left 0%)
    const segA_17_18 = within(blockA).getByTestId("segment-17-18");
    const segA_18_19 = within(blockA).getByTestId("segment-18-19");
    expect(segA_17_18.getAttribute("data-segment-width")).toBe("100");
    expect(segA_17_18.getAttribute("data-segment-left")).toBe("0");
    expect(segA_18_19.getAttribute("data-segment-width")).toBe("50");
    expect(segA_18_19.getAttribute("data-segment-left")).toBe("0");

    // B: 18〜19時は右50% (width 50%, left 50%)、19〜21時は全幅 (width 100%, left 0%)
    const segB_18_19 = within(blockB).getByTestId("segment-18-19");
    const segB_19_21 = within(blockB).getByTestId("segment-19-21");
    expect(segB_18_19.getAttribute("data-segment-width")).toBe("50");
    expect(segB_18_19.getAttribute("data-segment-left")).toBe("50");
    expect(segB_19_21.getAttribute("data-segment-width")).toBe("100");
    expect(segB_19_21.getAttribute("data-segment-left")).toBe("0");
  });

  it("重なりがない単独ブロックは幅100%・marginLeft 0%のまま", () => {
    const singleSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      placements: [
        {
          id: "single-1",
          day: 0,
          startHour: 9,
          endHour: 12,
          kind: "daycare",
          serviceId: "daycare-basic",
        },
      ],
    };

    render(
      <WeeklyBoard
        snapshot={singleSnapshot}
        canEdit={true}
        saving={false}
        services={[]}
        validation={null}
        onSave={vi.fn(async () => true)}
      />
    );

    const block = screen.getByRole("button", { name: /通所介護.*9:00の詳細/ });
    const parent = block.parentElement!;
    expect(parent.style.width).toBe("100%");
    expect(parent.style.marginLeft).toBe("0%");
  });
});
