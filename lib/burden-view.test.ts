import { describe, expect, it } from "vitest";
import { demoFixture } from "./demo-fixture";
import {
  ESTIMATE_DISCLAIMER_NOTE,
  formatBudgetSummary,
  formatCurrency,
  formatGaps,
  formatHardViolations,
  formatHours,
  formatMemberBurdens,
  formatUnits,
  formatValidationErrors,
  getWarningsStatus,
} from "./burden-view";
import {
  LIMIT_UNITS_CARE_LEVEL_3,
  type Gap,
  type HardViolation,
  type MemberHours,
  type Overload,
  type Person,
  type ValidationError,
  type ValidationResult,
} from "./types";

const fx = demoFixture;

describe("burden-view: 基本フォーマッタ", () => {
  it("formatCurrency は数値をフォーマットし、null は「算出不可」と表示する", () => {
    expect(formatCurrency(12340)).toBe("12,340 円");
    expect(formatCurrency(0)).toBe("0 円");
    expect(formatCurrency(null)).toBe("未判定（算出不可）");
  });

  it("formatUnits は数値をフォーマットし、null は「算出不可」と表示する", () => {
    expect(formatUnits(27048)).toBe("27,048 単位");
    expect(formatUnits(0)).toBe("0 単位");
    expect(formatUnits(null)).toBe("未判定（算出不可）");
  });

  it("formatHours は時間をフォーマットする", () => {
    expect(formatHours(15)).toBe("15 時間");
    expect(formatHours(0)).toBe("0 時間");
  });
});

describe("burden-view: fixture の揉めるプランでの警告出し分け", () => {
  const r = fx.troubledPlan.expectedValidationResult;

  it("揉めるプランのステータスで枠オーバー・空白・負担集中が検出される", () => {
    const status = getWarningsStatus(r);
    expect(status.ok).toBe(false);
    expect(status.hasWarnings).toBe(true);
    expect(status.isOverLimit).toBe(true);
    expect(status.hasGaps).toBe(true);
    expect(status.hasOverload).toBe(true);
    expect(status.hasHardViolations).toBe(false);
    expect(status.hasValidationErrors).toBe(false);
  });

  it("枠オーバーと自己負担の内訳が正しく整形され、注記が含まれる", () => {
    const budget = formatBudgetSummary(r);
    expect(budget.isOverLimit).toBe(true);
    expect(budget.hasNullCalculation).toBe(false);
    expect(budget.limitUnitsText).toBe("27,048 単位");
    // 月換算で上限を超過していること
    expect(budget.overUnitsText).not.toBe("0 単位");
    expect(budget.overUnitsText).not.toBe("未判定（算出不可）");
    // 自己負担の内訳
    expect(budget.selfPayTotalText).toContain("円");
    expect(budget.withinYenText).toContain("円");
    expect(budget.overYenText).toContain("円");
    expect(budget.disclaimerNote).toBe(ESTIMATE_DISCLAIMER_NOTE);
  });

  it("水曜昼の空白時間が正しく抽出・整形される", () => {
    const gaps = formatGaps(r.gaps);
    expect(gaps.count).toBe(1);
    expect(gaps.totalHours).toBe(2);
    expect(gaps.items[0].day).toBe(2); // 水曜
    expect(gaps.items[0].dayLabel).toBe("水");
    expect(gaps.items[0].timeRangeText).toBe("12:00〜14:00");
    expect(gaps.items[0].durationHours).toBe(2);
    expect(gaps.items[0].label).toContain("水曜 12:00〜14:00（2時間）");
  });

  it("長女への負担集中が検出され、メンバー全員分の時間が表示される", () => {
    const burden = formatMemberBurdens(r.memberHours, r.overloads, fx.people);
    expect(burden.hasOverload).toBe(true);
    expect(burden.overloadCount).toBe(1);
    expect(burden.overloadedNames).toContain("長女");

    // canProvideCare=true の3人全員（母、長女、長男）が含まれる
    expect(burden.members).toHaveLength(3);
    const daughter = burden.members.find((m) => m.personId === "person-daughter");
    expect(daughter?.isOverload).toBe(true);
    expect(daughter?.hours).toBeGreaterThan(20);

    const mother = burden.members.find((m) => m.personId === "person-mother");
    expect(mother?.isOverload).toBe(false);

    const son = burden.members.find((m) => m.personId === "person-son");
    expect(son?.isOverload).toBe(false);

    // 家族別の金額配分項目が含まれていないこと（MemberBurdenItem の型にもない）
    for (const m of burden.members) {
      expect((m as unknown as Record<string, unknown>).yen).toBeUndefined();
      expect((m as unknown as Record<string, unknown>).cost).toBeUndefined();
    }
  });
});

describe("burden-view: fixture の納得プラン", () => {
  const r = fx.acceptedPlan.expectedValidationResult;

  it("納得プランでは全判定が合格で、警告が出ない", () => {
    const status = getWarningsStatus(r);
    expect(status.ok).toBe(true);
    expect(status.hasWarnings).toBe(false);
    expect(status.isOverLimit).toBe(false);
    expect(status.hasGaps).toBe(false);
    expect(status.hasOverload).toBe(false);

    const budget = formatBudgetSummary(r);
    expect(budget.isOverLimit).toBe(false);
    expect(budget.overUnitsText).toBe("0 単位");

    const gaps = formatGaps(r.gaps);
    expect(gaps.count).toBe(0);
    expect(gaps.totalHours).toBe(0);

    const burden = formatMemberBurdens(r.memberHours, r.overloads, fx.people);
    expect(burden.hasOverload).toBe(false);
    for (const m of burden.members) {
      expect(m.isOverload).toBe(false);
      expect(m.hours).toBeLessThanOrEqual(20);
    }
  });
});

describe("burden-view: hardViolations と validationErrors の整形", () => {
  it("hardViolations の全種別に対応するタイトルと詳細を整形する", () => {
    const sampleViolations: HardViolation[] = [
      {
        type: "unavailableOverlap",
        detail: "長女の勤務時間（月曜 09:00〜18:00）と重複しています",
        placementId: "p1",
      },
      {
        type: "overlap",
        detail: "長男の付き添い（火曜 10:00〜12:00）が重複しています",
        placementId: "p2",
      },
      {
        type: "unknownId",
        detail: "サービスID 'unknown' は存在しません",
      },
      {
        type: "ineligibleCareProvider",
        detail: "父は付き添い対象外です",
        placementId: "p3",
      },
      {
        type: "invalidRange",
        detail: "時刻は6:00〜24:00の範囲で指定してください",
      },
      {
        type: "duplicateShortstay",
        detail: "同日に複数のショートステイが配置されています",
      },
    ];

    const formatted = formatHardViolations(sampleViolations);
    expect(formatted).toHaveLength(6);
    expect(formatted[0].title).toBe("対応できない時間との重なり");
    expect(formatted[0].placementId).toBe("p1");
    expect(formatted[1].title).toBe("付き添い時間の重なり");
    expect(formatted[2].title).toBe("未登録のサービス・家族が選ばれています");
    expect(formatted[3].title).toBe("付き添いができない家族が選ばれています");
    expect(formatted[4].title).toBe("曜日・時間の指定を確認してください");
    expect(formatted[5].title).toBe("同じ日のショートステイが重複しています");
  });

  it("validationErrors のコードに対応するタイトルと理由を整形する", () => {
    const sampleErrors: ValidationError[] = [
      {
        code: "unsupportedBand",
        reason: "訪問介護で300分の時間区分は定義されていません",
        placementId: "p1",
        serviceId: "visit-body",
      },
      {
        code: "missingCareWindows",
        reason: "支援必要時間（careWindows）が1件も設定されていません",
      },
      {
        code: "incompleteConstraint",
        reason: "仕事制約に開始時刻または終了時刻が指定されていません",
        personId: "person-son",
      },
      {
        code: "invalidMaster",
        reason: "単位数マスターの定義が不正です",
      },
    ];

    const formatted = formatValidationErrors(sampleErrors);
    expect(formatted).toHaveLength(4);
    expect(formatted[0].title).toBe("計算できないサービス利用時間です");
    expect(formatted[0].reason).toContain("訪問介護");
    expect(formatted[1].title).toBe("介護が必要な時間が未設定です");
    expect(formatted[2].title).toBe("家族の都合の入力が不足しています");
    expect(formatted[3].title).toBe("費用の計算用データに問題があります");
  });
});

describe("burden-view: null の「算出不可」表示（未計算を0と表示しない）", () => {
  it("単位・金額が null のとき「算出不可」と表示され、hasNullCalculation=true になる", () => {
    const nullResult: ValidationResult = {
      ok: false,
      weeklyUnits: null,
      monthlyUnits: null,
      limitUnits: LIMIT_UNITS_CARE_LEVEL_3,
      overUnits: null,
      selfPayYen: null,
      selfPayBreakdown: null,
      gaps: [],
      memberHours: [
        { personId: "person-mother", hours: 5 },
        { personId: "person-daughter", hours: 0 },
      ],
      overloads: [],
      hardViolations: [],
      validationErrors: [
        {
          code: "unsupportedBand",
          reason: "時間区分が引けないため単位数を算出できません",
        },
      ],
    };

    const budget = formatBudgetSummary(nullResult);
    expect(budget.hasNullCalculation).toBe(true);
    expect(budget.weeklyUnitsText).toBe("未判定（算出不可）");
    expect(budget.monthlyUnitsText).toBe("未判定（算出不可）");
    expect(budget.overUnitsText).toBe("未判定（算出不可）");
    expect(budget.selfPayTotalText).toBe("未判定（算出不可）");
    expect(budget.withinYenText).toBe("未判定（算出不可）");
    expect(budget.overYenText).toBe("未判定（算出不可）");
    // limitUnits は定数なので表示される
    expect(budget.limitUnitsText).toBe("27,048 単位");
  });
});

describe("burden-view: メンバー全員分の時間表示（未配置0時間も含む）", () => {
  it("配置が0時間のメンバーも一覧に表示される", () => {
    const people: Person[] = [
      { id: "p-1", name: "母", canProvideCare: true },
      { id: "p-2", name: "長男", canProvideCare: true },
      { id: "p-3", name: "父", canProvideCare: false }, // 被介護者
    ];
    const memberHours: MemberHours[] = [
      { personId: "p-1", hours: 10 },
      { personId: "p-2", hours: 0 }, // 未配置
    ];
    const overloads: Overload[] = [];

    const burden = formatMemberBurdens(memberHours, overloads, people);
    expect(burden.members).toHaveLength(2);

    const m1 = burden.members.find((m) => m.personId === "p-1");
    expect(m1?.name).toBe("母");
    expect(m1?.hours).toBe(10);
    expect(m1?.hoursText).toBe("10 時間");
    expect(m1?.isOverload).toBe(false);

    const m2 = burden.members.find((m) => m.personId === "p-2");
    expect(m2?.name).toBe("長男");
    expect(m2?.hours).toBe(0);
    expect(m2?.hoursText).toBe("0 時間");
    expect(m2?.isOverload).toBe(false);

    expect(burden.totalHours).toBe(10);
    expect(burden.hasOverload).toBe(false);
  });
});
