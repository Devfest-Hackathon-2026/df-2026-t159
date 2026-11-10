// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import SummarySheet from "./SummarySheet";
import { demoFixture as f } from "@/lib/demo-fixture";
import type { SummaryDoc } from "@/lib/types";

afterEach(cleanup);

it("保存順が19時→7時→10時→17時でも、同じ曜日のカードを開始時刻順に表示し、保存配列を変えない", () => {
  const snapshot: SummaryDoc["snapshot"] = {
    people: f.people, constraints: f.constraints, hopes: f.hopes, unknowns: [],
    careWindows: f.careWindows, copayRate: f.copayRate, revision: 1,
    placements: [19, 7, 10, 17].map(startHour => ({
      id: `family-${startHour}`, kind: "family", personId: "person-daughter", day: 1,
      startHour, endHour: startHour + 2, note: `${startHour}時の予定`,
    })),
  };
  Object.freeze(snapshot.placements);
  const summary: SummaryDoc = { snapshot, validation: f.acceptedPlan.expectedValidationResult,
    confirmedRevision: 1, confirmedAt: Timestamp.fromMillis(0) };
  const { container } = render(<SummarySheet roomId="test" summary={summary} currentRevision={1} />);
  const days = container.querySelectorAll(".summary-calendar-day");
  expect(days).toHaveLength(7);
  const cards = days[1].querySelectorAll(".summary-calendar-placement");
  expect([...cards].map(card => card.children[1].textContent)).toEqual([
    "7:00〜9:00", "10:00〜12:00", "17:00〜19:00", "19:00〜21:00",
  ]);
  expect([...cards].map(card => card.children[2].textContent)).toEqual([
    "7時の予定", "10時の予定", "17時の予定", "19時の予定",
  ]);
  expect(snapshot.placements.map(p => p.startHour)).toEqual([19, 7, 10, 17]);
  expect(days[0].querySelectorAll(".summary-calendar-placement")).toHaveLength(0);
});
