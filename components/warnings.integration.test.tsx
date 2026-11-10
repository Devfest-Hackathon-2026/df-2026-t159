// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoFixture as fixture } from "../lib/demo-fixture";
import type { RoomSnapshot, ValidationResult } from "../lib/types";
import { useRoomValidation } from "../lib/useRoomValidation";
import { formatMemberBurdens } from "../lib/burden-view";
import WarningAlerts from "./WarningAlerts";
import BurdenView from "./BurdenView";
import WeeklyBoard from "../app/rooms/[roomId]/board/WeeklyBoard";
import BurdenClient from "../app/rooms/[roomId]/burden/BurdenClient";
import BoardClient, { type BoardConnection } from "../app/rooms/[roomId]/board/BoardClient";

function snapshot(): RoomSnapshot {
  return structuredClone({ people: fixture.people, placements: fixture.troubledPlan.placements,
    constraints: fixture.constraints, careWindows: fixture.careWindows, copayRate: fixture.copayRate,
    hopes: fixture.hopes, unknowns: fixture.unknowns, revision: 12 });
}
const expected = fixture.troubledPlan.expectedValidationResult;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Issue #6 の表示と実エンジン接続", () => {
  it("揉めるプランの期待値から超過・空白・長女27時間を表示し、全員を比較する", () => {
    render(<BurdenView validation={expected} people={fixture.people} />);
    expect(screen.getAllByText(/1,083 単位/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10,830 円/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/37,878 円/).length).toBeGreaterThan(0);
    expect(screen.getByText(/水曜 12:00〜14:00/)).toBeTruthy();
    const family = within(screen.getByRole("region", { name: "家族ごとの付き添い時間" }));
    for (const [name, hours] of [["母", "10"], ["長女", "27"], ["長男", "8"]]) {
      expect(family.getByRole("progressbar", { name: `${name}の週の付き添い時間` }).getAttribute("aria-valuenow")).toBe(hours);
    }
    expect(family.queryByText("父")).toBeNull();
  });
  it("既定のuseRoomValidationは仮結果でなく実エンジンの期待値を返す", async () => {
    const input = snapshot();
    const { result } = renderHook(() => useRoomValidation(input));
    await waitFor(() => expect(result.current.validation).toEqual({ revision: 12, result: expected }));
  });
  it("対応不可の配置も実エンジンのhardViolationsをそのまま表示する", async () => {
    const input = snapshot();
    const p = input.placements.find(p => p.kind === "family" && p.personId === "person-daughter")!;
    input.constraints = [...input.constraints, { personId: p.personId!, type: "unavailable", detail: "表示確認用の対応不可時間", days: [p.day], startHour: p.startHour, endHour: p.endHour }];
    const { result } = renderHook(() => useRoomValidation(input));
    await waitFor(() => expect(result.current.validation?.result.hardViolations.some(v => v.type === "unavailableOverlap")).toBe(true));
    render(<WarningAlerts validation={result.current.validation!.result} people={input.people} />);
    expect(screen.getAllByText(/対応できない時間との重なり/).length).toBeGreaterThan(0);
  });
  it("空白は返された水曜12・13時だけを色づけし、結果のない版では消す", () => {
    const props = { snapshot: snapshot(), canEdit: true, saving: false, services: [], onSave: async () => true };
    const view = render(<WeeklyBoard {...props} validation={expected} />);
    expect(screen.getByLabelText("水曜 12:00 介護の空白").className).toContain("bg-red-50");
    expect(screen.getByLabelText("水曜 13:00 介護の空白")).toBeTruthy();
    expect(screen.getByLabelText("水曜 14:00").className).not.toContain("bg-red-50");
    view.rerender(<WeeklyBoard {...props} validation={null} />);
    expect(screen.queryByLabelText(/介護の空白/)).toBeNull();
  });
  it("実ボードのフォーム保存後に新しい版の実結果で空白の色と警告を更新する", async () => {
    let stored = snapshot();
    const connection: BoardConnection = {
      async load() { return { snapshot: structuredClone(stored), role: "family", isDemo: false }; },
      async save(_id, revision, placements) {
        if (revision !== stored.revision) throw new Error("conflict");
        stored = { ...stored, placements, revision: revision + 1 };
        return stored.revision;
      },
    };
    render(<BoardClient roomId="test" connection={connection} />);
    await screen.findByLabelText("水曜 12:00 介護の空白", {}, { timeout: 5000 });
    fireEvent.click(screen.getByRole("button", { name: "＋ 家族の付き添い" }));
    fireEvent.change(screen.getByLabelText("曜日"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("付き添う家族"), { target: { value: "person-mother" } });
    fireEvent.change(screen.getByLabelText("終了"), { target: { value: "14" } });
    fireEvent.change(screen.getByLabelText("開始"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByTestId("validation-revision").getAttribute("data-revision")).toBe("13"));
    expect(screen.queryByLabelText(/介護の空白/)).toBeNull();
    expect(screen.queryByText(/介護が必要な時間の空白/)).toBeNull();
  });
  it("未判定の費用や空白を限度額内・空白なしと誤表示しない", () => {
    const unavailable: ValidationResult = { ...expected, weeklyUnits: null, monthlyUnits: null, overUnits: null, selfPayYen: null, selfPayBreakdown: null, gaps: [], validationErrors: [{ code: "missingCareWindows", reason: "支援必要時間が未設定" }] };
    render(<BurdenView validation={unavailable} people={fixture.people} />);
    expect(screen.getAllByText(/未判定/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/保険の上限内です/)).toBeNull();
    expect(screen.queryByText(/すべてサービス・家族/)).toBeNull();
    expect(screen.queryByText(/^0 円$/)).toBeNull();
  });
  it("0時間の家族も表示し、バーを0幅にし、過労はoverloadsだけから表示する", () => {
    const r = { ...expected, memberHours: [{ personId: "person-mother", hours: 0 }, { personId: "person-daughter", hours: 27 }, { personId: "person-son", hours: 8 }], overloads: [] };
    render(<BurdenView validation={r} people={fixture.people} />);
    const bar = screen.getByRole("progressbar", { name: "母の週の付き添い時間" });
    expect(bar.style.width).toBe("0%");
    expect(screen.getByText("0 時間 / 週")).toBeTruthy();
    expect(formatMemberBurdens(r.memberHours, [], fixture.people).hasOverload).toBe(false);
  });
  it("負担画面でも実hookの結果と入力版を表示し、読み込み失敗時に古い結果を残さない", async () => {
    const load = vi.fn().mockResolvedValueOnce(snapshot()).mockRejectedValue(new Error("denied"));
    render(<BurdenClient roomId="test" loadSnapshot={load} />);
    await waitFor(() => expect(screen.getByTestId("burden-validation-revision").textContent).toContain("12"));
    expect(screen.getByRole("progressbar", { name: "長女の週の付き添い時間" }).getAttribute("aria-valuenow")).toBe("27");
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await screen.findByText(/参加状態と接続設定/);
    expect(screen.queryByTestId("burden-validation-revision")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("接続エラーの状態でも架空fixtureの期待値プレビューは明示操作で使える", async () => {
    const load = vi.fn().mockRejectedValue(new Error("test"));
    render(<BurdenClient roomId="test" loadSnapshot={load} />);
    await screen.findByText(/参加状態と接続設定/);
    fireEvent.click(screen.getByRole("button", { name: "デモ過密プランの警告をプレビュー" }));
    expect(screen.getByText(/架空の「揉めるプラン」の期待値/)).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "長女の週の付き添い時間" })).toBeTruthy();
  });
});
