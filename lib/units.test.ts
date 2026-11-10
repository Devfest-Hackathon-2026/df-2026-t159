/**
 * 単位数マスター（Issue 5）の単体テスト。
 * 実マスター（data/units.json）の裏取り済み数値の引き当てと、
 * マスター検証（invalidMaster 検出）を検証する。
 */

import { describe, expect, it } from "vitest";
import {
  findBandForMinutes,
  getServiceMaster,
  unitsForMinutes,
  unitsMaster,
  validateUnitsMaster,
  type ServiceMaster,
} from "./units";

function service(serviceId: string): ServiceMaster {
  const found = getServiceMaster(unitsMaster, serviceId);
  if (!found) throw new Error(`マスターに ${serviceId} がありません`);
  return found;
}

describe("実マスター（data/units.json）", () => {
  it("4サービス＋訪問介護の2区分が揃い、マスター検証を通過する", () => {
    expect(unitsMaster.map((s) => s.serviceId).sort()).toEqual([
      "daycare-basic",
      "dayrehab-basic",
      "shortstay-basic",
      "visit-body",
      "visit-life",
    ]);
    expect(validateUnitsMaster(unitsMaster)).toEqual([]);
  });

  it("全エントリに出典（sourceUrl／sourceTitle）が付いている", () => {
    for (const s of unitsMaster) {
      expect(s.sourceUrl).toMatch(/^https:\/\//);
      expect(s.sourceTitle).not.toBe("");
    }
  });

  it("代表ケース：訪問介護（身体介護）60分は 567単位（1時間以上1時間30分未満）", () => {
    expect(unitsForMinutes(service("visit-body"), 60)).toBe(567);
    expect(unitsForMinutes(service("visit-body"), 45)).toBe(387);
    expect(unitsForMinutes(service("visit-body"), 15)).toBe(163);
  });

  it("代表ケース：通所介護7時間は 900単位（通常規模型・要介護3）", () => {
    expect(unitsForMinutes(service("daycare-basic"), 7 * 60)).toBe(900);
    expect(unitsForMinutes(service("daycare-basic"), 3 * 60)).toBe(479);
    // 2時間以上3時間未満は4時間以上5時間未満（502）の70%＝351.4→四捨五入で351
    expect(unitsForMinutes(service("daycare-basic"), 2 * 60)).toBe(351);
  });

  it("通所リハビリ（通常規模型・要介護3）の時間区分が引ける", () => {
    expect(unitsForMinutes(service("dayrehab-basic"), 90)).toBe(429);
    expect(unitsForMinutes(service("dayrehab-basic"), 7 * 60)).toBe(1046);
  });

  it("訪問介護（生活援助）は20分未満に band がなく null（unsupportedBand になる）", () => {
    expect(unitsForMinutes(service("visit-life"), 30)).toBe(179);
    expect(unitsForMinutes(service("visit-life"), 45)).toBe(220);
    expect(unitsForMinutes(service("visit-life"), 10)).toBeNull();
    expect(findBandForMinutes(service("visit-life"), 10)).toBeUndefined();
  });

  it("band の境界は下限を含み上限を含まない（半開区間）", () => {
    const body = service("visit-body");
    expect(unitsForMinutes(body, 20)).toBe(244);
    expect(unitsForMinutes(body, 30)).toBe(387);
    expect(unitsForMinutes(body, 90)).toBe(649); // 567＋82（30分増し1回）
    expect(unitsForMinutes(body, 120)).toBe(731); // 567＋82×2
  });

  it("ショートステイは perDay で時間を見ず単一 band の単位（787）を返す", () => {
    const stay = service("shortstay-basic");
    expect(stay.billing).toBe("perDay");
    expect(unitsForMinutes(stay, 18 * 60)).toBe(787);
    expect(unitsForMinutes(stay, 60)).toBe(787);
  });
});

describe("validateUnitsMaster（invalidMaster の検出）", () => {
  const base: ServiceMaster = {
    serviceId: "test-service",
    name: "テスト",
    kind: "visit",
    billing: "perUse",
    bands: [{ label: "区分", minMinutes: 0, maxMinutes: 60, units: 100 }],
    sourceUrl: "https://example.com",
    sourceTitle: "出典",
  };

  it("band が重複すると invalidMaster", () => {
    const master: ServiceMaster[] = [
      {
        ...base,
        bands: [
          { label: "a", minMinutes: 0, maxMinutes: 60, units: 100 },
          { label: "b", minMinutes: 30, maxMinutes: 90, units: 200 },
        ],
      },
    ];
    const errors = validateUnitsMaster(master);
    expect(errors.some((e) => e.code === "invalidMaster")).toBe(true);
  });

  it("serviceId が重複すると invalidMaster", () => {
    const errors = validateUnitsMaster([base, { ...base }]);
    expect(errors.some((e) => e.code === "invalidMaster")).toBe(true);
  });

  it("perDay で band が2つあると invalidMaster", () => {
    const master: ServiceMaster[] = [
      {
        ...base,
        kind: "shortstay",
        billing: "perDay",
        bands: [
          { label: "a", units: 100 },
          { label: "b", units: 200 },
        ],
      },
    ];
    const errors = validateUnitsMaster(master);
    expect(errors.some((e) => e.code === "invalidMaster")).toBe(true);
  });

  it("出典が欠けると invalidMaster", () => {
    const errors = validateUnitsMaster([{ ...base, sourceUrl: "" }]);
    expect(errors.some((e) => e.code === "invalidMaster")).toBe(true);
  });

  it("band に隙間があるだけなら不正ではない（合わない時間は unsupportedBand の担当）", () => {
    const master: ServiceMaster[] = [
      {
        ...base,
        bands: [
          { label: "a", minMinutes: 0, maxMinutes: 30, units: 100 },
          { label: "b", minMinutes: 60, maxMinutes: 90, units: 200 },
        ],
      },
    ];
    expect(validateUnitsMaster(master)).toEqual([]);
  });
});
