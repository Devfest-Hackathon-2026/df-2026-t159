import { describe, expect, it } from "vitest";
import {
  CHECK_NOTE_TEXTS,
  getCheckNoteItems,
  getCheckNotesForPlacement,
} from "./check-notes";
import type { Placement } from "./types";

describe("check-notes (注記データ)", () => {
  it("通所リハビリ配置には医師の指示に関する注記が返る", () => {
    const placement: Placement = {
      id: "p-rehab",
      day: 1,
      startHour: 9,
      endHour: 11,
      kind: "dayrehab",
      serviceId: "dayrehab-basic",
    };
    const notes = getCheckNotesForPlacement(placement);
    expect(notes).toEqual([CHECK_NOTE_TEXTS.dayrehab]);
    expect(notes[0]).toBe("通所リハビリの利用には医師の指示が必要です。面談で確認してください");
  });

  it("通所介護の2〜3時間区分（2時間）には条件に関する注記が返る", () => {
    const placement: Placement = {
      id: "p-daycare-short",
      day: 2,
      startHour: 10,
      endHour: 12, // 2時間
      kind: "daycare",
      serviceId: "daycare-basic",
    };
    const notes = getCheckNotesForPlacement(placement);
    expect(notes).toEqual([CHECK_NOTE_TEXTS.daycare2to3]);
    expect(notes[0]).toBe("2〜3時間の区分は、利用者の状態によって使える条件があります。面談で確認してください");
  });

  it("通所介護の長時間の配置（4時間など）には2〜3時間区分の注記は出ない", () => {
    const placement: Placement = {
      id: "p-daycare-long",
      day: 2,
      startHour: 10,
      endHour: 14, // 4時間
      kind: "daycare",
      serviceId: "daycare-basic",
    };
    const notes = getCheckNotesForPlacement(placement);
    expect(notes).toHaveLength(0);
  });

  it("訪問介護やショートステイ、家族配置には注記が出ない", () => {
    const visit: Placement = {
      id: "p-visit",
      day: 0,
      startHour: 8,
      endHour: 9,
      kind: "visit",
      serviceId: "visit-body",
    };
    const family: Placement = {
      id: "p-family",
      day: 0,
      startHour: 18,
      endHour: 20,
      kind: "family",
      personId: "person-mother",
    };
    expect(getCheckNotesForPlacement(visit)).toHaveLength(0);
    expect(getCheckNotesForPlacement(family)).toHaveLength(0);
  });

  it("getCheckNoteItems で該当する配置から注記アイテム一覧が返る", () => {
    const placements: Placement[] = [
      { id: "1", day: 0, startHour: 9, endHour: 11, kind: "dayrehab", serviceId: "dayrehab-basic" },
      { id: "2", day: 1, startHour: 10, endHour: 12, kind: "daycare", serviceId: "daycare-basic" },
      { id: "3", day: 2, startHour: 10, endHour: 14, kind: "daycare", serviceId: "daycare-basic" },
    ];
    const items = getCheckNoteItems(placements);
    expect(items).toHaveLength(2);
    expect(items[0].text).toContain("通所リハビリ");
    expect(items[1].text).toContain("2〜3時間の区分");
  });

  it("同一サービスの確認事項は複数日あっても1つに集約される", () => {
    const placements: Placement[] = [
      { id: "demo-dayrehab-tue", day: 1, startHour: 9, endHour: 16, kind: "dayrehab", serviceId: "dayrehab-basic" },
      { id: "demo-dayrehab-thu", day: 3, startHour: 9, endHour: 16, kind: "dayrehab", serviceId: "dayrehab-basic" },
    ];
    const items = getCheckNoteItems(placements);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("通所リハビリの確認事項");
    expect(items[0].text).toBe(CHECK_NOTE_TEXTS.dayrehab);
  });
});
