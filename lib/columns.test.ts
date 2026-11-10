/**
 * コラム・決めることリスト・サービス説明のテスト（Issue 13）。
 *
 * 検証項目：
 * 1. data/columns.json の形式検証（8項目＋5本＋サービス説明が揃い、sceneId が5種と一致）
 * 2. validateColumnsData による異常系検出（項目不足、重複、型不正等）
 * 3. 場面判定（ValidationResult の各状態から対応する sceneId が選ばれる、null は未判定）
 * 4. 抽出・検索関数（getDecisionContents, getSceneColumns, getServiceContents, findServiceContent など）
 */

import { describe, expect, it } from "vitest";
import { demoFixture } from "./demo-fixture";
import {
  columnsData,
  determineActiveScenes,
  EXPECTED_DECISION_COUNT,
  EXPECTED_SCENE_COUNT,
  findSceneColumn,
  findServiceContent,
  getActiveSceneColumns,
  getDecisionContents,
  getSceneColumns,
  getServiceContents,
  isSceneActive,
  REQUIRED_SERVICE_KINDS,
  SCENE_IDS,
  validateColumnsData,
} from "./columns";
import type { ColumnContent, ValidationResult } from "./types";

/** 基準となる正常なダミー ValidationResult */
function createBaseValidation(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
    ok: true,
    weeklyUnits: 2000,
    monthlyUnits: 8571,
    limitUnits: 27048,
    overUnits: 0,
    selfPayYen: 8571,
    selfPayBreakdown: { withinYen: 8571, overYen: 0 },
    gaps: [],
    memberHours: [{ personId: "p1", hours: 10 }],
    overloads: [],
    hardViolations: [],
    validationErrors: [],
    ...overrides,
  };
}

describe("columns.json の形式検証", () => {
  it("data/columns.json は形式検証エラーが0件である", () => {
    const errors = validateColumnsData(columnsData);
    expect(errors).toEqual([]);
  });

  it("正本の決めることリストが8項目揃っており、各項目にタイトルと本文がある", () => {
    const decisions = getDecisionContents(columnsData);
    expect(decisions).toHaveLength(EXPECTED_DECISION_COUNT);
    const titles = decisions.map((d) => d.title);
    expect(new Set(titles).size).toBe(8);
    for (const d of decisions) {
      expect(d.id).toBeTruthy();
      expect(d.title.trim()).not.toBe("");
      expect(d.body.trim().length).toBeGreaterThan(10);
    }
  });

  it("場面連動コラムが5本揃い、sceneId が5種（overLimit, careGap, caregiverOverload, hardViolation, validationUnavailable）と重複なく一致する", () => {
    const columns = getSceneColumns(columnsData);
    expect(columns).toHaveLength(EXPECTED_SCENE_COUNT);
    const scenes = columns.map((c) => c.sceneId);
    expect(new Set(scenes).size).toBe(EXPECTED_SCENE_COUNT);
    for (const sid of SCENE_IDS) {
      expect(scenes).toContain(sid);
    }
    for (const c of columns) {
      expect(c.title).toBeTruthy();
      expect(c.body.trim().length).toBeGreaterThan(10);
    }
  });

  it("サービス説明が揃っており、4サービス＋家族の付き添い（全5種）が網羅されている", () => {
    const services = getServiceContents(columnsData);
    expect(services.length).toBeGreaterThanOrEqual(5);
    const kinds = new Set(services.map((s) => s.kind));
    for (const requiredKind of REQUIRED_SERVICE_KINDS) {
      expect(kinds.has(requiredKind)).toBe(true);
    }
    for (const s of services) {
      expect(s.title).toBeTruthy();
      expect(s.body.trim().length).toBeGreaterThan(10);
    }
  });

  it("すべてのコンテンツの ID は一意である", () => {
    const ids = columnsData.map((c) => c.id);
    expect(new Set(ids).size).toBe(columnsData.length);
  });
});

describe("validateColumnsData の異常系検出", () => {
  it("空配列または非配列はエラーになる", () => {
    expect(validateColumnsData([])).toEqual([
      { message: "columns.json が配列でないか、空です。" },
    ]);
    expect(validateColumnsData(null)).toEqual([
      { message: "columns.json が配列でないか、空です。" },
    ]);
    expect(validateColumnsData("invalid")).toEqual([
      { message: "columns.json が配列でないか、空です。" },
    ]);
  });

  it("ID が重複している場合は検出する", () => {
    const dupData: ColumnContent[] = [
      ...columnsData,
      {
        type: "decision",
        id: columnsData[0].id,
        title: "重複タイトル",
        body: "重複本文",
      },
    ];
    const errors = validateColumnsData(dupData);
    expect(errors.some((e) => e.message.includes("重複"))).toBe(true);
  });

  it("決めることリストが8項目未満の場合は検出する", () => {
    const firstDecision = getDecisionContents(columnsData)[0];
    const partialData = columnsData.filter(c => c.id !== firstDecision.id);
    const errors = validateColumnsData(partialData);
    expect(errors.some((e) => e.field === "decisions")).toBe(true);
  });

  it("場面連動コラムの sceneId が欠落または不正な場合は検出する", () => {
    const missingSceneData = columnsData.filter(
      (c) => !(c.type === "column" && c.sceneId === "overLimit"),
    );
    const errors = validateColumnsData(missingSceneData);
    expect(
      errors.some(
        (e) =>
          e.field === "columns" && e.message.includes('"overLimit" が含まれていません'),
      ),
    ).toBe(true);
  });

  it("サービス説明に特定の kind が不足している場合は検出する", () => {
    const missingServiceData = columnsData.filter(
      (c) => !(c.type === "service" && c.kind === "shortstay"),
    );
    const errors = validateColumnsData(missingServiceData);
    expect(
      errors.some(
        (e) =>
          e.field === "services" && e.message.includes('"shortstay" が含まれていません'),
      ),
    ).toBe(true);
  });
});

describe("場面判定ロジック（determineActiveScenes & isSceneActive）", () => {
  it("全ての条件がクリアされている場合はアクティブな場面がない（空配列）", () => {
    const v = createBaseValidation();
    expect(determineActiveScenes(v)).toEqual([]);
    expect(isSceneActive(v, "overLimit")).toBe(false);
    expect(isSceneActive(v, "careGap")).toBe(false);
    expect(isSceneActive(v, "caregiverOverload")).toBe(false);
    expect(isSceneActive(v, "hardViolation")).toBe(false);
    expect(isSceneActive(v, "validationUnavailable")).toBe(false);
  });

  it("overUnits > 0 のとき overLimit が選ばれる（overUnits = 0 では選ばれない）", () => {
    const over = createBaseValidation({ overUnits: 150 });
    expect(determineActiveScenes(over)).toEqual(["overLimit"]);
    expect(isSceneActive(over, "overLimit")).toBe(true);

    const zero = createBaseValidation({ overUnits: 0 });
    expect(determineActiveScenes(zero)).toEqual([]);
    expect(isSceneActive(zero, "overLimit")).toBe(false);
  });

  it("overUnits が null（未判定）のときは overLimit は選ばれない（仕様共通前提）", () => {
    const nullBudget = createBaseValidation({
      overUnits: null,
      monthlyUnits: null,
      selfPayYen: null,
    });
    expect(determineActiveScenes(nullBudget)).toEqual([]);
    expect(isSceneActive(nullBudget, "overLimit")).toBe(false);
  });

  it("gaps が非空のとき careGap が選ばれる", () => {
    const withGap = createBaseValidation({
      gaps: [{ day: 2, startHour: 13, endHour: 15 }],
    });
    expect(determineActiveScenes(withGap)).toEqual(["careGap"]);
    expect(isSceneActive(withGap, "careGap")).toBe(true);
  });

  it("overloads が非空のとき caregiverOverload が選ばれる", () => {
    const withOverload = createBaseValidation({
      overloads: [{ personId: "p1", hours: 26 }],
    });
    expect(determineActiveScenes(withOverload)).toEqual(["caregiverOverload"]);
    expect(isSceneActive(withOverload, "caregiverOverload")).toBe(true);
  });

  it("hardViolations が非空のとき hardViolation が選ばれる", () => {
    const withViolation = createBaseValidation({
      hardViolations: [
        {
          type: "unavailableOverlap",
          detail: "勤務時間帯と重複しています",
        },
      ],
    });
    expect(determineActiveScenes(withViolation)).toEqual(["hardViolation"]);
    expect(isSceneActive(withViolation, "hardViolation")).toBe(true);
  });

  it("validationErrors が非空のとき validationUnavailable が選ばれる", () => {
    const withError = createBaseValidation({
      validationErrors: [
        {
          code: "missingCareWindows",
          reason: "支援必要時間帯が未設定です",
        },
      ],
    });
    expect(determineActiveScenes(withError)).toEqual(["validationUnavailable"]);
    expect(isSceneActive(withError, "validationUnavailable")).toBe(true);
  });

  it("デモ fixture の揉めるプランでは overLimit, careGap, caregiverOverload の3場面が選ばれる", () => {
    const troubled = demoFixture.troubledPlan.expectedValidationResult;
    const active = determineActiveScenes(troubled);
    expect(active).toEqual(["overLimit", "careGap", "caregiverOverload"]);
    expect(isSceneActive(troubled, "overLimit")).toBe(true);
    expect(isSceneActive(troubled, "careGap")).toBe(true);
    expect(isSceneActive(troubled, "caregiverOverload")).toBe(true);
    expect(isSceneActive(troubled, "hardViolation")).toBe(false);
    expect(isSceneActive(troubled, "validationUnavailable")).toBe(false);
  });

  it("デモ fixture の納得プランではすべての場面が非アクティブになる", () => {
    const accepted = demoFixture.acceptedPlan.expectedValidationResult;
    expect(determineActiveScenes(accepted)).toEqual([]);
    for (const sid of SCENE_IDS) {
      expect(isSceneActive(accepted, sid)).toBe(false);
    }
  });

  it("getActiveSceneColumns で現在発生している場面のコラムのみが抽出される", () => {
    const troubled = demoFixture.troubledPlan.expectedValidationResult;
    const activeColumns = getActiveSceneColumns(columnsData, troubled);
    expect(activeColumns.map((c) => c.sceneId)).toEqual([
      "overLimit",
      "careGap",
      "caregiverOverload",
    ]);
  });
});

describe("検索・抽出関数", () => {
  it("findSceneColumn で特定の sceneId のコラムを取得できる", () => {
    const col = findSceneColumn(columnsData, "overLimit");
    expect(col).toBeDefined();
    expect(col?.sceneId).toBe("overLimit");
    expect(col?.title.trim()).not.toBe("");
    expect(col?.body.trim()).not.toBe("");
  });

  it("findServiceContent で serviceId または kind による検索ができる", () => {
    const daycare = findServiceContent(columnsData, "daycare", "daycare-basic");
    expect(daycare).toBeDefined();
    expect(daycare?.kind).toBe("daycare");
    expect(daycare?.title).toContain("通所介護");

    const family = findServiceContent(columnsData, "family");
    expect(family).toBeDefined();
    expect(family?.kind).toBe("family");
    expect(family?.title).toContain("付き添い");

    // 不明な serviceId でも kind にフォールバックする
    const visitFallback = findServiceContent(
      columnsData,
      "visit",
      "unknown-service-id",
    );
    expect(visitFallback).toBeDefined();
    expect(visitFallback?.kind).toBe("visit");
  });
});
