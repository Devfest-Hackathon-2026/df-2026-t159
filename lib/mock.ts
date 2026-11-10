/**
 * 雛形確認用のモックデータ（Issue 0）。
 *
 * すべて架空データ。トップ画面と各画面の受け皿が共通型で描けることの確認用で、
 * 本番のサンプル家族・デモ素材は Issue 10 が担当する。実データに差し替えたら消す。
 */

import {
  LIMIT_UNITS_CARE_LEVEL_3,
  type RoomSnapshot,
  type ValidationResult,
} from "./types";

export const mockSnapshot: RoomSnapshot = {
  people: [
    { id: "person-father", name: "父", canProvideCare: false },
    { id: "person-mother", name: "母", canProvideCare: true },
    { id: "person-daughter", name: "長女", canProvideCare: true },
    { id: "person-son", name: "長男", canProvideCare: true },
  ],
  placements: [
    {
      id: "mock-placement-1",
      day: 0,
      startHour: 9,
      endHour: 12,
      kind: "daycare",
      serviceId: "daycare-basic",
    },
    {
      id: "mock-placement-2",
      day: 0,
      startHour: 17,
      endHour: 19,
      kind: "family",
      personId: "person-daughter",
    },
    {
      id: "mock-placement-3",
      day: 2,
      startHour: 10,
      endHour: 11,
      kind: "visit",
      serviceId: "visit-body",
    },
    {
      id: "mock-placement-4",
      day: 5,
      startHour: 6,
      endHour: 24,
      kind: "shortstay",
      serviceId: "shortstay-basic",
    },
  ],
  constraints: [
    {
      personId: "person-daughter",
      type: "unavailable",
      detail: "平日は仕事（モック）",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    },
  ],
  hopes: ["週末は家族で交代したい（モック）"],
  unknowns: ["退院日は未定（モック）"],
  careWindows: [
    { day: 0, startHour: 9, endHour: 12 },
    { day: 0, startHour: 17, endHour: 19 },
    { day: 2, startHour: 10, endHour: 11 },
  ],
  copayRate: 1,
  revision: 0,
};

export const mockValidation: ValidationResult = {
  ok: false,
  weeklyUnits: 6860,
  monthlyUnits: 29400,
  limitUnits: LIMIT_UNITS_CARE_LEVEL_3,
  overUnits: 2352,
  selfPayYen: 50568,
  selfPayBreakdown: { withinYen: 27048, overYen: 23520 },
  gaps: [{ day: 2, startHour: 17, endHour: 19 }],
  memberHours: [
    { personId: "person-mother", hours: 6 },
    { personId: "person-daughter", hours: 18 },
    { personId: "person-son", hours: 3 },
  ],
  overloads: [],
  hardViolations: [],
  validationErrors: [],
};
