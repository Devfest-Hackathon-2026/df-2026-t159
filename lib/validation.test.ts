/**
 * 検証エンジン（Issue 6）の単体テスト。
 * 仕様 Issue 6 の受け入れ条件8件（手計算と一致するテストケース）を中心に、
 * 境界ケース（上限ちょうど・超過・重なり・対象外の介護者・不明ID・
 * ショートステイ同日2件など）を検証する。
 * 単位の合計を正確に制御するため、テスト用マスターを差し込んで使う。
 */

import { describe, expect, it } from "vitest";
import type { ServiceMaster } from "./units";
import { validateRoom, type ValidationInput } from "./validation";
import type { Person, Placement } from "./types";

const testMaster: ServiceMaster[] = [
  {
    serviceId: "svc-6311",
    name: "テスト訪問（6311単位）",
    kind: "visit",
    billing: "perUse",
    bands: [{ label: "固定", units: 6311 }],
    sourceUrl: "https://example.com",
    sourceTitle: "テスト用マスター",
  },
  {
    serviceId: "svc-6312",
    name: "テスト訪問（6312単位）",
    kind: "visit",
    billing: "perUse",
    bands: [{ label: "固定", units: 6312 }],
    sourceUrl: "https://example.com",
    sourceTitle: "テスト用マスター",
  },
  {
    serviceId: "svc-day",
    name: "テスト通所（2〜3時間のみ）",
    kind: "daycare",
    billing: "perUse",
    bands: [{ label: "2時間以上3時間未満", minMinutes: 120, maxMinutes: 180, units: 100 }],
    sourceUrl: "https://example.com",
    sourceTitle: "テスト用マスター",
  },
  {
    serviceId: "svc-stay",
    name: "テストショートステイ（500単位/日）",
    kind: "shortstay",
    billing: "perDay",
    bands: [{ label: "1日あたり", units: 500 }],
    sourceUrl: "https://example.com",
    sourceTitle: "テスト用マスター",
  },
];

const people: Person[] = [
  { id: "father", name: "父", canProvideCare: false },
  { id: "mother", name: "母", canProvideCare: true },
  { id: "daughter", name: "長女", canProvideCare: true },
  { id: "son", name: "長男", canProvideCare: true },
];

function input(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    people,
    placements: [],
    constraints: [],
    careWindows: [{ day: 0, startHour: 9, endHour: 10 }],
    copayRate: 1,
    ...overrides,
  };
}

describe("単位と金額（Issue 6 受け入れ条件）", () => {
  it("週6,311単位 → 月換算27,047単位で枠内（上限ちょうど手前）", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "svc-6311" },
        ],
      }),
      testMaster,
    );
    expect(result.weeklyUnits).toBe(6311);
    expect(result.monthlyUnits).toBe(27047);
    expect(result.limitUnits).toBe(27048);
    expect(result.overUnits).toBe(0);
    expect(result.selfPayBreakdown).toEqual({ withinYen: 27047, overYen: 0 });
    expect(result.selfPayYen).toBe(27047);
    expect(result.ok).toBe(true);
  });

  it("週6,312単位 → 月換算27,051単位で3単位超過", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "svc-6312" },
        ],
      }),
      testMaster,
    );
    expect(result.weeklyUnits).toBe(6312);
    expect(result.monthlyUnits).toBe(27051);
    expect(result.overUnits).toBe(3);
    expect(result.ok).toBe(false);
  });

  it("超過分は負担割合によらず全額自己負担（枠内は3割・超過は全額）", () => {
    const result = validateRoom(
      input({
        copayRate: 3,
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "svc-6312" },
        ],
      }),
      testMaster,
    );
    // 枠内 27,048単位×10円×3割＝81,144円／超過 3単位×10円＝30円（全額）
    expect(result.selfPayBreakdown).toEqual({ withinYen: 81144, overYen: 30 });
    expect(result.selfPayYen).toBe(81174);
  });

  it("家族の付き添いは0単位（時間だけ数える）", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 17, endHour: 19 }],
        placements: [
          { id: "p1", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "daughter" },
        ],
      }),
      testMaster,
    );
    expect(result.weeklyUnits).toBe(0);
    expect(result.monthlyUnits).toBe(0);
    expect(result.selfPayYen).toBe(0);
    expect(result.memberHours).toContainEqual({ personId: "daughter", hours: 2 });
    expect(result.ok).toBe(true);
  });

  it("ショートステイは日単位で数える（1件＝500単位）", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 5, startHour: 6, endHour: 24 }],
        placements: [
          { id: "s1", day: 5, startHour: 6, endHour: 24, kind: "shortstay", serviceId: "svc-stay" },
        ],
      }),
      testMaster,
    );
    expect(result.weeklyUnits).toBe(500);
    expect(result.hardViolations).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("ショートステイ同日2件は duplicateShortstay", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 5, startHour: 6, endHour: 24 }],
        placements: [
          { id: "s1", day: 5, startHour: 6, endHour: 24, kind: "shortstay", serviceId: "svc-stay" },
          { id: "s2", day: 5, startHour: 6, endHour: 24, kind: "shortstay", serviceId: "svc-stay" },
        ],
      }),
      testMaster,
    );
    const dups = result.hardViolations.filter((v) => v.type === "duplicateShortstay");
    expect(dups.map((v) => v.placementId).sort()).toEqual(["s1", "s2"]);
    // 同日重複時は perDay の「1日分」が定まらず単位を正しく算出できないため、
    // 単位系はすべて null（二重加算した 1,000単位のような誤った数字を返さない）
    expect(result.weeklyUnits).toBeNull();
    expect(result.monthlyUnits).toBeNull();
    expect(result.overUnits).toBeNull();
    expect(result.selfPayYen).toBeNull();
    expect(result.selfPayBreakdown).toBeNull();
    expect(result.ok).toBe(false);
  });
});

describe("違反の検出", () => {
  it("対応不可時間（仕事）への付き添いは unavailableOverlap で、空白としても残る", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 17, endHour: 19 }],
        constraints: [
          { personId: "daughter", type: "unavailable", detail: "平日勤務", days: [0], startHour: 9, endHour: 18 },
        ],
        placements: [
          { id: "p1", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "daughter" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "unavailableOverlap", placementId: "p1" }),
    );
    // 違反のある配置は有効な支援に数えないため、careWindow は空白のまま
    expect(result.gaps).toEqual([{ day: 0, startHour: 17, endHour: 19 }]);
    // 負担の時間としては数える
    expect(result.memberHours).toContainEqual({ personId: "daughter", hours: 2 });
    expect(result.ok).toBe(false);
  });

  it("同じ人の付き添いの重なりは overlap", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 1, startHour: 17, endHour: 20 }],
        placements: [
          { id: "p1", day: 1, startHour: 17, endHour: 19, kind: "family", personId: "daughter" },
          { id: "p2", day: 1, startHour: 18, endHour: 20, kind: "family", personId: "daughter" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({
        type: "overlap",
        placementId: "p2",
        detail: "同じ人の付き添いが重なっています（火曜 17:00〜19:00 長女の付き添い と 火曜 18:00〜20:00 長女の付き添い）",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("サービス同士の重なりも overlap の hardViolation になる（修正3(a)）", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 9, endHour: 16 }],
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "svc-day" },
          { id: "p2", day: 0, startHour: 10, endHour: 11, kind: "visit", serviceId: "svc-visit-30" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({
        type: "overlap",
        placementId: "p2",
        detail: "予定が重なっています（月曜 9:00〜12:00 テスト通所（2〜3時間のみ） と 月曜 10:00〜11:00 訪問介護）",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("サービスと家族の付き添いの重なりも overlap になる（修正3(a)）", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 2, startHour: 9, endHour: 16 }],
        placements: [
          { id: "p1", day: 2, startHour: 9, endHour: 16, kind: "daycare", serviceId: "svc-day" },
          { id: "p2", day: 2, startHour: 10, endHour: 12, kind: "family", personId: "mother" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({
        type: "overlap",
        placementId: "p2",
        detail: "予定が重なっています（水曜 9:00〜16:00 テスト通所（2〜3時間のみ） と 水曜 10:00〜12:00 母の付き添い）",
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("本番マスターでの重なり detail 表記（通所リハビリテーション と 通所介護）", () => {
    const result = validateRoom(
      input({
        people: [
          { id: "p-mother", name: "母", canProvideCare: true },
          { id: "p-daughter", name: "長女", canProvideCare: true },
        ],
        careWindows: [{ day: 1, startHour: 9, endHour: 16 }],
        placements: [
          { id: "demo-dayrehab-tue", day: 1, startHour: 9, endHour: 16, kind: "dayrehab", serviceId: "dayrehab-basic" },
          { id: "cb553e5e-dummy", day: 1, startHour: 12, endHour: 15, kind: "daycare", serviceId: "daycare-basic" },
        ],
      }),
    );
    expect(result.hardViolations).toContainEqual({
      type: "overlap",
      placementId: "cb553e5e-dummy",
      detail: "予定が重なっています（火曜 9:00〜16:00 通所リハビリテーション と 火曜 12:00〜15:00 通所介護）",
    });
    expect(result.ok).toBe(false);
  });

  it("未配置メンバーも0時間で memberHours に全員分返る", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 17, endHour: 19 }],
        placements: [
          { id: "p1", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "daughter" },
        ],
      }),
      testMaster,
    );
    expect(result.memberHours).toEqual([
      { personId: "mother", hours: 0 },
      { personId: "daughter", hours: 2 },
      { personId: "son", hours: 0 },
    ]);
  });

  it("canProvideCare=false の人への家族配置は ineligibleCareProvider", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 17, endHour: 19 }],
        placements: [
          { id: "p1", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "father" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "ineligibleCareProvider", placementId: "p1" }),
    );
    // 父は memberHours の対象外（canProvideCare=false）
    expect(result.memberHours.map((m) => m.personId)).toEqual(["mother", "daughter", "son"]);
    expect(result.ok).toBe(false);
  });

  it("存在しない personId への家族配置は unknownId", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 17, endHour: 19, kind: "family", personId: "ghost" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "unknownId", placementId: "p1" }),
    );
    // 家族配置は単位に影響しないので、単位系は算出できる
    expect(result.weeklyUnits).toBe(0);
  });

  it("存在しない serviceId は unknownId で、単位系は未計算（null）になる", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "ghost-service" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "unknownId", placementId: "p1" }),
    );
    expect(result.weeklyUnits).toBeNull();
    expect(result.monthlyUnits).toBeNull();
    expect(result.overUnits).toBeNull();
    expect(result.selfPayYen).toBeNull();
    expect(result.selfPayBreakdown).toBeNull();
    expect(result.ok).toBe(false);
  });

  it("範囲外の配置（6時前開始）は invalidRange", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 5, endHour: 7, kind: "visit", serviceId: "svc-6311" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "invalidRange", placementId: "p1" }),
    );
    expect(result.weeklyUnits).toBeNull();
  });

  it("ショートステイが終日（6〜24）でない場合は invalidRange", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "s1", day: 5, startHour: 9, endHour: 17, kind: "shortstay", serviceId: "svc-stay" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "invalidRange", placementId: "s1" }),
    );
  });
});

describe("計算できない場合の扱い（validationErrors）", () => {
  it("band に合わない時間は unsupportedBand で、単位系は null", () => {
    const result = validateRoom(
      input({
        placements: [
          // テスト通所は2〜3時間の band のみ。1時間は合わない
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "daycare", serviceId: "svc-day" },
        ],
      }),
      testMaster,
    );
    expect(result.validationErrors).toContainEqual(
      expect.objectContaining({ code: "unsupportedBand", placementId: "p1", serviceId: "svc-day" }),
    );
    expect(result.weeklyUnits).toBeNull();
    expect(result.selfPayYen).toBeNull();
    expect(result.ok).toBe(false);
  });

  it("先行配置のエラーで算出が打ち切られても、後続配置の unsupportedBand が記録される", () => {
    const result = validateRoom(
      input({
        placements: [
          // 先行：存在しない serviceId で単位計算が打ち切られる
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "ghost-service" },
          // 後続：band に合わない時間（テスト通所は2〜3時間の band のみ、これは1時間）
          { id: "p2", day: 1, startHour: 9, endHour: 10, kind: "daycare", serviceId: "svc-day" },
        ],
      }),
      testMaster,
    );
    expect(result.hardViolations).toContainEqual(
      expect.objectContaining({ type: "unknownId", placementId: "p1" }),
    );
    // band 照合は算出可否にかかわらず全配置について行う
    expect(result.validationErrors).toContainEqual(
      expect.objectContaining({ code: "unsupportedBand", placementId: "p2", serviceId: "svc-day" }),
    );
    expect(result.weeklyUnits).toBeNull();
    expect(result.ok).toBe(false);
  });

  it("unsupportedBand が複数配置にあれば全件記録される", () => {
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "daycare", serviceId: "svc-day" },
          { id: "p2", day: 1, startHour: 9, endHour: 10, kind: "daycare", serviceId: "svc-day" },
        ],
      }),
      testMaster,
    );
    const bands = result.validationErrors.filter((e) => e.code === "unsupportedBand");
    expect(bands.map((e) => e.placementId).sort()).toEqual(["p1", "p2"]);
    expect(result.weeklyUnits).toBeNull();
    expect(result.ok).toBe(false);
  });

  it("careWindows 未設定は missingCareWindows（単位は独立に計算できる）", () => {
    const result = validateRoom(
      input({
        careWindows: [],
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "svc-6311" },
        ],
      }),
      testMaster,
    );
    expect(result.validationErrors).toContainEqual(
      expect.objectContaining({ code: "missingCareWindows" }),
    );
    expect(result.weeklyUnits).toBe(6311);
    expect(result.gaps).toEqual([]);
    expect(result.ok).toBe(false);
  });

  it("必須時刻が不足する unavailable 制約は incompleteConstraint", () => {
    const broken = {
      personId: "daughter",
      type: "unavailable",
      detail: "時刻なし",
      days: [0],
    } as unknown as ValidationInput["constraints"][number];
    const result = validateRoom(
      input({
        constraints: [broken],
      }),
      testMaster,
    );
    expect(result.validationErrors).toContainEqual(
      expect.objectContaining({ code: "incompleteConstraint", personId: "daughter" }),
    );
    expect(result.ok).toBe(false);
  });

  it("不正なマスターは invalidMaster で、単位系は null", () => {
    const brokenMaster: ServiceMaster[] = [
      {
        serviceId: "svc-6311",
        name: "重複band",
        kind: "visit",
        billing: "perUse",
        bands: [
          { label: "a", minMinutes: 0, maxMinutes: 60, units: 100 },
          { label: "b", minMinutes: 30, maxMinutes: 90, units: 200 },
        ],
        sourceUrl: "https://example.com",
        sourceTitle: "テスト用",
      },
    ];
    const result = validateRoom(
      input({
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "svc-6311" },
        ],
      }),
      brokenMaster,
    );
    expect(result.validationErrors).toContainEqual(
      expect.objectContaining({ code: "invalidMaster" }),
    );
    expect(result.weeklyUnits).toBeNull();
    expect(result.ok).toBe(false);
  });
});

describe("空白と過労", () => {
  it("careWindows の一部だけ埋まれば残りが空白になる", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 1, startHour: 9, endHour: 12 }],
        placements: [
          { id: "p1", day: 1, startHour: 9, endHour: 11, kind: "daycare", serviceId: "svc-day" },
        ],
      }),
      testMaster,
    );
    expect(result.gaps).toEqual([{ day: 1, startHour: 11, endHour: 12 }]);
    expect(result.weeklyUnits).toBe(100);
    expect(result.ok).toBe(false);
  });

  it("週20時間超の付き添いは overloads に入る", () => {
    const days = [0, 1, 2] as const;
    const result = validateRoom(
      input({
        careWindows: days.map((day) => ({ day, startHour: 6, endHour: 13 })),
        placements: days.map((day, i) => ({
          id: `p${i}`,
          day,
          startHour: 6,
          endHour: 13,
          kind: "family" as const,
          personId: "daughter",
        })),
      }),
      testMaster,
    );
    expect(result.memberHours).toContainEqual({ personId: "daughter", hours: 21 });
    expect(result.overloads).toEqual([{ personId: "daughter", hours: 21 }]);
    expect(result.ok).toBe(false);
  });

  it("週20時間ちょうどの付き添いは overloads に入らない（境界値）", () => {
    const spans = [
      { day: 0, startHour: 6, endHour: 13 }, // 7時間
      { day: 1, startHour: 6, endHour: 13 }, // 7時間
      { day: 2, startHour: 6, endHour: 12 }, // 6時間（合計20時間）
    ] as const;
    const result = validateRoom(
      input({
        careWindows: spans.map((s) => ({ ...s })),
        placements: spans.map((s, i) => ({
          id: `p${i}`,
          ...s,
          kind: "family" as const,
          personId: "daughter",
        })),
      }),
      testMaster,
    );
    expect(result.memberHours).toContainEqual({ personId: "daughter", hours: 20 });
    expect(result.overloads).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("実マスター（data/units.json）との結合", () => {
  it("既定マスターで訪問介護（身体）60分は 567単位になる", () => {
    // 第2引数を省略し、data/units.json 本体（unitsMaster）で計算する
    const result = validateRoom(
      input({
        careWindows: [{ day: 0, startHour: 9, endHour: 10 }],
        placements: [
          { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "visit-body" },
        ],
      }),
    );
    expect(result.validationErrors).toEqual([]);
    expect(result.weeklyUnits).toBe(567);
    expect(result.ok).toBe(true);
  });

  it("既定マスターでショートステイ1日は 787単位になる", () => {
    const result = validateRoom(
      input({
        careWindows: [{ day: 5, startHour: 6, endHour: 24 }],
        placements: [
          { id: "s1", day: 5, startHour: 6, endHour: 24, kind: "shortstay", serviceId: "shortstay-basic" },
        ],
      }),
    );
    expect(result.validationErrors).toEqual([]);
    expect(result.weeklyUnits).toBe(787);
    expect(result.ok).toBe(true);
  });
});
