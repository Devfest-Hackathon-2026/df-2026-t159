// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardRightRail from "../app/rooms/[roomId]/board/BoardRightRail";
import ProposalsClient from "../app/rooms/[roomId]/proposals/ProposalsClient";
import { demoFixture as fixture } from "../lib/demo-fixture";
import type { RoomSnapshot, ValidationResult } from "../lib/types";

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return { useAnonymousUser: () => user, getIdToken: vi.fn() };
});
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: async () => ({ exists: () => false }),
}));
vi.mock("@/lib/rooms", () => ({
  readOwnMembership: async () => ({ role: "family" }),
  readRoomSnapshot: async () => snapshot,
}));
vi.mock("@/lib/plan/client", () => ({ applyProposal: vi.fn(), confirmPlan: vi.fn() }));
vi.mock("@/lib/validation", () => ({ validateRoom: () => validation }));
vi.mock("next/navigation", () => ({ usePathname: () => "/rooms/test/proposals" }));

const snapshot: RoomSnapshot = {
  people: fixture.people,
  placements: fixture.troubledPlan.placements,
  constraints: fixture.constraints,
  hopes: fixture.hopes,
  unknowns: fixture.unknowns,
  careWindows: fixture.careWindows,
  copayRate: fixture.copayRate,
  revision: 1,
};
const headings = ["介護保険の上限", "空白（介護が必要な時間の空き）", "付き添いの負担", "ルール違反"];
let validation: ValidationResult;

beforeEach(() => {
  validation = structuredClone(fixture.troubledPlan.expectedValidationResult);
  validation.hardViolations = [
    { type: "unavailableOverlap", detail: "架空の対応不可時間の違反" },
    { type: "overlap", detail: "架空の付き添い重複" },
  ];
});
afterEach(cleanup);

function renderRail() {
  render(<BoardRightRail roomId="test" snapshot={snapshot} validation={validation} people={fixture.people} />);
  return within(screen.getByRole("region", { name: "警告一覧" }));
}

describe("検証詳細の種類別表示", () => {
  it("ボードの要約は同じ件数・重要度順のまま、展開した詳細だけ4分類する", () => {
    const warnings = renderRail();
    expect(warnings.getByText("問題 5件")).toBeTruthy();
    expect(warnings.getByRole("button", { name: /全5件/ })).toBeTruthy();
    expect(warnings.queryByRole("heading", { level: 3 })).toBeNull();
    expect(warnings.getByText("対応できない時間との重なり")).toBeTruthy();
    expect(warnings.queryByText(/保険の上限超過/)).toBeNull();

    fireEvent.click(warnings.getByRole("button", { name: /詳しく見る/ }));
    expect(warnings.getAllByRole("heading", { level: 3 }).map(e => e.textContent)).toEqual(headings);
    const rules = within(warnings.getByRole("region", { name: "ルール違反" }));
    expect(rules.getByText("架空の対応不可時間の違反")).toBeTruthy();
    expect(rules.getByText("架空の付き添い重複")).toBeTruthy();
    expect(rules.getAllByText("家族が対応できる曜日・時間に予定を変えてください。")).toHaveLength(2);
    expect(warnings.getByText("問題 5件")).toBeTruthy();
    fireEvent.click(warnings.getByRole("button", { name: /閉じる/ }));
    expect(warnings.queryByRole("heading", { level: 3 })).toBeNull();
    expect(warnings.getByRole("button", { name: /全5件/ })).toBeTruthy();
  });

  it("ボードは該当のない分類を表示しない", () => {
    validation.overUnits = 0;
    validation.overloads = [];
    validation.hardViolations = [];
    const warnings = renderRail();
    fireEvent.click(warnings.getByRole("button", { name: /詳しく見る/ }));
    expect(warnings.getAllByRole("heading", { level: 3 }).map(e => e.textContent)).toEqual([headings[1]]);
    expect(warnings.getByText("問題 1件")).toBeTruthy();
  });

  it("代替案でも元の注意点を4分類し、同分類の複数違反と件数を保つ", async () => {
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("5 件の注意点があります")).toBeTruthy();

    // 枠超過カードが常時表示
    const overLimitDetails = within(screen.getByRole("region", { name: "介護保険の上限" }));
    expect(overLimitDetails.getByText(/枠超過/)).toBeTruthy();
    expect(overLimitDetails.getByText(/サービス別の月換算単位/)).toBeTruthy();

    // 空白時間カードが常時表示
    const gapDetails = within(screen.getByRole("region", { name: "空白（介護が必要な時間の空き）" }));
    expect(gapDetails.getByText(/介護が必要な時間の空白/)).toBeTruthy();
    expect(gapDetails.getByText(/水曜 12:00–14:00/)).toBeTruthy();

    // 負担集中カードが常時表示
    const overloadDetails = within(screen.getByRole("region", { name: "付き添いの負担" }));
    expect(overloadDetails.getByText(/付き添いの負担集中/)).toBeTruthy();
    expect(overloadDetails.getByText(/長女 27時間／週/)).toBeTruthy();

    // ルール違反カードが常時表示
    const rules = within(screen.getByRole("region", { name: "ルール違反" }));
    expect(rules.getByText(/架空の対応不可時間の違反/)).toBeTruthy();
    expect(rules.getByText(/架空の付き添い重複/)).toBeTruthy();
  });

  it("代替案も該当のある分類だけ表示する", async () => {
    validation.overUnits = 0;
    validation.gaps = [];
    validation.overloads = [];
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("2 件の注意点があります")).toBeTruthy();
    expect(screen.getByRole("region", { name: "ルール違反" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "介護保険の上限" })).toBeNull();
    expect(screen.queryByRole("region", { name: "空白（介護が必要な時間の空き）" })).toBeNull();
    expect(screen.queryByRole("region", { name: "付き添いの負担" })).toBeNull();
  });

  it("問題のない代替案では空の分類を出さず、従来の成功表示を維持する", async () => {
    validation = structuredClone(fixture.acceptedPlan.expectedValidationResult);
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("問題なし（基準を満たしています）")).toBeTruthy();
    expect(screen.getByText("問題なし（確定できます）")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "介護保険の上限" })).toBeNull();
    expect(screen.queryByRole("region", { name: "空白（介護が必要な時間の空き）" })).toBeNull();
    expect(screen.queryByRole("region", { name: "付き添いの負担" })).toBeNull();
    expect(screen.queryByRole("region", { name: "ルール違反" })).toBeNull();
  });

  it("ボードの未判定は4分類の後に別枠で残し、要約件数にも含める", () => {
    validation.validationErrors = [{ code: "missingCareWindows", reason: "支援必要時間が未設定です。" }];
    const warnings = renderRail();
    expect(warnings.getByText("問題 6件")).toBeTruthy();
    fireEvent.click(warnings.getByRole("button", { name: /詳しく見る/ }));
    expect(warnings.getAllByRole("heading", { level: 3 }).map(e => e.textContent)).toEqual([...headings, "未判定・不備"]);
    expect(within(warnings.getByRole("region", { name: "未判定・不備" })).getByText("支援必要時間が未設定です。")).toBeTruthy();
    expect(within(warnings.getByRole("region", { name: "ルール違反" })).queryByText("支援必要時間が未設定です。")).toBeNull();
  });

  it("代替案の未判定も最後の別枠で表示し、違反に混ぜない", async () => {
    validation.validationErrors = [{ code: "unsupportedBand", reason: "時間区分を判定できません。" }];
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("6 件の注意点があります")).toBeTruthy();
    const unavailCard = screen.getByRole("region", { name: "未判定・不備" });
    expect(unavailCard).toBeTruthy();
    const details = within(unavailCard);
    expect(details.getByText("時間区分を判定できません。")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "ルール違反" })).queryByText("時間区分を判定できません。")).toBeNull();
  });

  it("未判定だけの場合も、空の4分類は出さず理由を残す", async () => {
    validation = { ...structuredClone(fixture.acceptedPlan.expectedValidationResult), ok: false,
      weeklyUnits: null, monthlyUnits: null, overUnits: null, selfPayYen: null, selfPayBreakdown: null,
      validationErrors: [{ code: "invalidMaster", reason: "単位数マスターを確認してください。" }] };
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("1 件の注意点があります")).toBeTruthy();
    const unavailCard = screen.getByRole("region", { name: "未判定・不備" });
    expect(unavailCard).toBeTruthy();
    expect(within(unavailCard).getByText("単位数マスターを確認してください。")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "介護保険の上限" })).toBeNull();
    expect(screen.queryByRole("region", { name: "ルール違反" })).toBeNull();
  });
});
