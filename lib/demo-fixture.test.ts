/**
 * デモ用 fixture（Issue 10）のテスト。
 *
 * 検証すること：
 * - fixture の構造が共通型（lib/types.ts）に沿い、参照（personId・serviceId）が解決できる
 * - 配置 ID が固定文字列で一意（デモモードの代替案と対応づけるための仕様）
 * - 両プランの expectedValidationResult が算術的に整合する
 *   （月換算＝週合計×30÷7 の四捨五入、自己負担＝枠内は負担割合・超過分は全額）
 * - デモ台本が求める再現ポイント：揉めるプランは「枠オーバー・水曜昼の空白・
 *   長女への負担集中」を含み、納得プランは ok=true で全員の負担が20時間以下
 * - fixedProposal を適用すると納得プランになる（適用の意味論は Issue 0 の契約を
 *   このテスト内に最小実装で写したもの。本実装は Issue 6 の applyChanges）
 *
 * 期待値と実エンジン（Issue 6 下書き）の一致は、Issue 5/6 の作業ツリーで
 * validateRoom を実際に呼んで確認済み（docs/demo-fixture.md に記録）。
 * 本ツリーにはエンジンが未マージのため、ここではエンジンを呼ばない。
 */

import { describe, expect, it } from "vitest";
import { demoFixture } from "./demo-fixture";
import {
  LIMIT_UNITS_CARE_LEVEL_3,
  OVERLOAD_HOURS_PER_WEEK,
  UNIT_PRICE_YEN,
  type Placement,
  type ProposalChange,
  type ValidationResult,
} from "./types";

const fx = demoFixture;

/** Issue 5 のマスター（data/units.json）に存在する serviceId の一覧 */
const KNOWN_SERVICE_IDS = [
  "visit-body",
  "visit-life",
  "daycare-basic",
  "dayrehab-basic",
  "shortstay-basic",
];

describe("people と制約", () => {
  it("4人家族で、被介護者（父）だけ canProvideCare=false", () => {
    expect(fx.people).toHaveLength(4);
    const father = fx.people.find((p) => p.id === "person-father");
    expect(father?.canProvideCare).toBe(false);
    expect(father?.careRole).toBe("recipient");
    expect(father?.icon).toBe("👴");
    const mother = fx.people.find((p) => p.id === "person-mother");
    expect(mother?.icon).toBe("👵");
    const daughter = fx.people.find((p) => p.id === "person-daughter");
    expect(daughter?.icon).toBe("👩");
    const son = fx.people.find((p) => p.id === "person-son");
    expect(son?.icon).toBe("👨");
    for (const p of fx.people) {
      if (p.id !== "person-father") {
        expect(p.canProvideCare).toBe(true);
        expect(p.careRole).toBe("caregiver");
      }
    }
    expect(new Set(fx.people.map((p) => p.id)).size).toBe(4);
  });

  it("制約の personId はすべて people に存在する", () => {
    const ids = new Set(fx.people.map((p) => p.id));
    for (const c of fx.constraints) expect(ids.has(c.personId)).toBe(true);
  });

  it("unavailable の制約は days 非空・時刻が必須で範囲内", () => {
    for (const c of fx.constraints) {
      if (c.type === "unavailable") {
        expect(c.days.length).toBeGreaterThan(0);
        expect(c.startHour).toBeDefined();
        expect(c.endHour).toBeDefined();
        expect(c.startHour!).toBeGreaterThanOrEqual(0);
        expect(c.startHour!).toBeLessThan(c.endHour!);
        expect(c.endHour!).toBeLessThanOrEqual(24);
      }
    }
  });

  it("unknowns は空（fixture は入力確認後の状態を表す）", () => {
    expect(fx.unknowns).toEqual([]);
  });
});

describe("配置の形", () => {
  const all = [...fx.troubledPlan.placements, ...fx.acceptedPlan.placements];

  it("配置 ID は固定文字列（UUID 形式ではない）でプラン内一意", () => {
    const uuidLike =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const plan of [fx.troubledPlan, fx.acceptedPlan]) {
      const ids = plan.placements.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(uuidLike.test(id)).toBe(false);
    }
  });

  it("すべての配置がボード範囲（6≦start＜end≦24・整数時間）にある", () => {
    for (const p of all) {
      expect(p.day).toBeGreaterThanOrEqual(0);
      expect(p.day).toBeLessThanOrEqual(6);
      expect(p.startHour).toBeGreaterThanOrEqual(6);
      expect(p.startHour).toBeLessThan(p.endHour);
      expect(p.endHour).toBeLessThanOrEqual(24);
    }
  });

  it("serviceId・personId の参照が解決できる", () => {
    const carers = new Set(
      fx.people.filter((p) => p.canProvideCare).map((p) => p.id),
    );
    for (const p of all) {
      if (p.kind === "family") {
        expect(p.personId).toBeDefined();
        expect(carers.has(p.personId!)).toBe(true);
        expect(p.serviceId).toBeUndefined();
      } else {
        expect(p.serviceId).toBeDefined();
        expect(KNOWN_SERVICE_IDS).toContain(p.serviceId);
        expect(p.personId).toBeUndefined();
      }
    }
  });
});

/** 期待値の算術整合（月換算・枠内／超過・自己負担の式） */
function expectArithmeticConsistency(result: ValidationResult) {
  expect(result.limitUnits).toBe(LIMIT_UNITS_CARE_LEVEL_3);
  expect(result.weeklyUnits).not.toBeNull();
  expect(result.monthlyUnits).toBe(
    Math.round((result.weeklyUnits! * 30) / 7),
  );
  expect(result.overUnits).toBe(
    Math.max(0, result.monthlyUnits! - LIMIT_UNITS_CARE_LEVEL_3),
  );
  const withinUnits = result.monthlyUnits! - result.overUnits!;
  const withinYen = (withinUnits * UNIT_PRICE_YEN * fx.copayRate) / 10;
  const overYen = result.overUnits! * UNIT_PRICE_YEN;
  expect(result.selfPayBreakdown).toEqual({ withinYen, overYen });
  expect(result.selfPayYen).toBe(withinYen + overYen);
  const carerIds = fx.people
    .filter((p) => p.canProvideCare)
    .map((p) => p.id)
    .sort();
  expect(result.memberHours.map((m) => m.personId).sort()).toEqual(carerIds);
}

describe("揉めるプランの期待値", () => {
  const r = fx.troubledPlan.expectedValidationResult;

  it("算術が整合する", () => {
    expectArithmeticConsistency(r);
  });

  it("デモ台本の3つの揉めポイント（枠オーバー・空白・負担集中）を含む", () => {
    expect(r.ok).toBe(false);
    // 枠オーバー：週合計6,312単位以上→月換算で上限超過
    expect(r.weeklyUnits!).toBeGreaterThanOrEqual(6312);
    expect(r.overUnits!).toBeGreaterThan(0);
    // 空白：水曜（day=2）の昼 12:00〜14:00
    expect(r.gaps).toContainEqual({ day: 2, startHour: 12, endHour: 14 });
    // 負担集中：長女が週20時間超
    const daughter = r.memberHours.find((m) => m.personId === "person-daughter");
    expect(daughter?.hours).toBeGreaterThan(OVERLOAD_HOURS_PER_WEEK);
    expect(r.overloads).toContainEqual({
      personId: "person-daughter",
      hours: daughter?.hours,
    });
    // 違反・計算エラーはない（警告の種類を台本の3つに絞る）
    expect(r.hardViolations).toEqual([]);
    expect(r.validationErrors).toEqual([]);
  });
});

describe("納得プランの期待値", () => {
  const r = fx.acceptedPlan.expectedValidationResult;

  it("算術が整合する", () => {
    expectArithmeticConsistency(r);
  });

  it("全判定が合格（ok=true）で、負担は全員20時間以下", () => {
    expect(r.ok).toBe(true);
    expect(r.overUnits).toBe(0);
    expect(r.gaps).toEqual([]);
    expect(r.overloads).toEqual([]);
    expect(r.hardViolations).toEqual([]);
    expect(r.validationErrors).toEqual([]);
    for (const m of r.memberHours) {
      expect(m.hours).toBeLessThanOrEqual(OVERLOAD_HOURS_PER_WEEK);
    }
  });
});

/**
 * applyChanges の最小の写し（Issue 0 の契約どおりの意味論のみ）。
 * 本実装は Issue 6。本テストでは fixture の changes が納得プランを
 * 再現できることだけを確認する。note は適用で保持される前提で比較に含める。
 */
function applyChangesMinimal(
  placements: Placement[],
  changes: ProposalChange[],
): Placement[] {
  const removed = new Set<string>();
  const modified = new Map<string, Placement>();
  const added: Placement[] = [];
  const byId = new Map(placements.map((p) => [p.id, p]));
  for (const change of changes) {
    if (change.action === "remove") {
      if (byId.has(change.placementId)) removed.add(change.placementId);
    } else if (change.action === "resize") {
      const t = byId.get(change.placementId);
      if (t)
        modified.set(change.placementId, {
          ...t,
          startHour: change.startHour,
          endHour: change.endHour,
        });
    } else if (change.action === "move") {
      const t = byId.get(change.placementId);
      if (t) {
        const duration = t.endHour - t.startHour;
        modified.set(change.placementId, {
          ...t,
          day: change.day,
          startHour: change.startHour,
          endHour: change.startHour + duration,
        });
      }
    } else if (change.action === "add") {
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
    }
  }
  return [
    ...placements
      .filter((p) => !removed.has(p.id))
      .map((p) => modified.get(p.id) ?? p),
    ...added,
  ];
}

describe("固定 changes", () => {
  it("適用すると納得プランの配置と一致する", () => {
    const applied = applyChangesMinimal(
      fx.troubledPlan.placements,
      fx.fixedProposal.changes,
    );
    const byId = (list: Placement[]) =>
      [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(applied)).toEqual(byId(fx.acceptedPlan.placements));
  });

  it("同一 ID への操作は1回だけ（正規化済みの形）", () => {
    const targets = fx.fixedProposal.changes.map((c) => c.placementId);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("デモ用書類と版情報", () => {
  it("退院サマリーと家族メモが揃い、物語の前提（要介護3・来週退院）を含む", () => {
    expect(fx.documents.dischargeSummary).toContain("要介護3");
    expect(fx.documents.familyMemo.length).toBeGreaterThan(0);
    expect(fx.documents.familyMemo).toContain("平日9時から18時まで仕事");
  });

  it("masterVersion と fixtureVersion が入っている", () => {
    expect(fx.masterVersion).not.toBe("");
    expect(fx.fixtureVersion).not.toBe("");
  });
});
