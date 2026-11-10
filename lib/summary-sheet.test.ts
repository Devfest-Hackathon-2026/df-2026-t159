import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import { demoFixture } from "./demo-fixture";
import {
  SUMMARY_DISCLAIMER_NOTE,
  formatConstraints,
  formatSummaryBurden,
  groupPlacementsByDay,
  isSummaryConfirmed,
} from "./summary-sheet";
import type { ConfirmedSnapshot, Placement, SummaryDoc } from "./types";

const fx = demoFixture;

describe("summary-sheet: 確定済み／未確定の判定分岐", () => {
  const dummyConfirmed: ConfirmedSnapshot = {
    snapshot: {
      people: fx.people,
      placements: fx.acceptedPlan.placements,
      constraints: fx.constraints,
      hopes: fx.hopes,
      unknowns: fx.unknowns,
      careWindows: fx.careWindows,
      copayRate: fx.copayRate,
      revision: 3,
    },
    validation: fx.acceptedPlan.expectedValidationResult,
    confirmedRevision: 3,
    confirmedAt: Timestamp.now(),
  };

  it("summary が存在し、confirmedRevision が現在の revision と一致するとき確定済み（true）", () => {
    expect(isSummaryConfirmed(dummyConfirmed, 3)).toBe(true);
  });

  it("summary が存在しない（null/undefined）ときは未確定（false）", () => {
    expect(isSummaryConfirmed(null, 3)).toBe(false);
    expect(isSummaryConfirmed(undefined, 3)).toBe(false);
  });

  it("現在の revision が不明（null/undefined）のときは未確定（false）", () => {
    expect(isSummaryConfirmed(dummyConfirmed, null)).toBe(false);
    expect(isSummaryConfirmed(dummyConfirmed, undefined)).toBe(false);
  });

  it("確定後に編集が行われて revision が進んだ（不一致）ときは未確定（false）", () => {
    // 確定時は revision=3 だったが、その後の編集で revision=4 に進んだ
    expect(isSummaryConfirmed(dummyConfirmed, 4)).toBe(false);
    expect(isSummaryConfirmed(dummyConfirmed, 2)).toBe(false);
  });
});

describe("summary-sheet: 注記の存在（仕様要件）", () => {
  it("概算注記に「30日の月を仮定した概算」と「食費・居住費・各種加算は含みません」が含まれる", () => {
    expect(SUMMARY_DISCLAIMER_NOTE).toContain("30日の月を仮定した概算");
    expect(SUMMARY_DISCLAIMER_NOTE).toContain("食費・居住費");
    expect(SUMMARY_DISCLAIMER_NOTE).toContain("加算は含みません");
  });

  it("formatSummaryBurden の出力オブジェクトに注記が含まれる", () => {
    const burden = formatSummaryBurden(
      fx.acceptedPlan.expectedValidationResult,
      fx.people,
    );
    expect(burden.disclaimerNote).toBe(SUMMARY_DISCLAIMER_NOTE);
  });
});

describe("summary-sheet: 確定プランの曜日別グルーピング", () => {
  it("月曜から日曜の7日分が作られ、時間順に並ぶ", () => {
    const schedule = groupPlacementsByDay(
      fx.acceptedPlan.placements,
      fx.people,
    );
    expect(schedule).toHaveLength(7);
    expect(schedule.map((d) => d.dayLabel)).toEqual([
      "月",
      "火",
      "水",
      "木",
      "金",
      "土",
      "日",
    ]);

    for (const day of schedule) {
      for (let i = 0; i < day.items.length - 1; i++) {
        expect(day.items[i].startHour).toBeLessThanOrEqual(
          day.items[i + 1].startHour,
        );
      }
    }
  });

  it("サービス名が単位数マスターから解決され、家族名も解決される", () => {
    const placements: Placement[] = [
      {
        id: "p1",
        day: 0,
        startHour: 9,
        endHour: 10,
        kind: "visit",
        serviceId: "visit-body",
      },
      {
        id: "p2",
        day: 0,
        startHour: 10,
        endHour: 12,
        kind: "family",
        personId: "person-daughter",
      },
    ];

    const schedule = groupPlacementsByDay(placements, fx.people);
    const monday = schedule[0];
    expect(monday.items).toHaveLength(2);

    expect(monday.items[0].title).toBe("訪問介護（身体介護）");
    expect(monday.items[0].isFamily).toBe(false);

    expect(monday.items[1].title).toBe("長女の付き添い");
    expect(monday.items[1].isFamily).toBe(true);
    expect(monday.items[1].personName).toBe("長女");
  });
});

describe("summary-sheet: 家族の制約の整形", () => {
  it("制約の人物名・種別・曜日・時間帯が整形される", () => {
    const formatted = formatConstraints(fx.constraints, fx.people);
    expect(formatted.length).toBeGreaterThan(0);

    const unavailableConstraint = formatted.find((c) => c.typeLabel === "対応不可");
    expect(unavailableConstraint).toBeDefined();
    expect(unavailableConstraint?.personName).not.toContain("person-");
    expect(unavailableConstraint?.daysText).toContain("曜");
    expect(unavailableConstraint?.timeRangeText).toBeDefined();
  });
});

describe("summary-sheet: 負担の分担（付き添い時間と月次概算）", () => {
  it("メンバー全員の付き添い時間と、月次の自己負担総額が整形される", () => {
    const burden = formatSummaryBurden(
      fx.acceptedPlan.expectedValidationResult,
      fx.people,
    );
    expect(burden.memberHours).toHaveLength(3);
    for (const m of burden.memberHours) {
      expect(m.name).toBeDefined();
      expect(m.hoursText).toContain("時間");
    }

    expect(burden.totalCareHoursText).toContain("時間");
    expect(burden.monthlyUnitsText).toContain("単位");
    expect(burden.limitUnitsText).toBe("27,048 単位");
    expect(burden.selfPayTotalText).toContain("円");
    expect(burden.withinYenText).toContain("円");
    expect(burden.overYenText).toBe("0 円");
    expect(burden.isOverLimit).toBe(false);
  });
});
