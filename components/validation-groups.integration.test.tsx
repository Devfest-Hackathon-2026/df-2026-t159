// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardStatusBand from "../app/rooms/[roomId]/board/BoardStatusBand";
import ProposalsClient from "../app/rooms/[roomId]/proposals/ProposalsClient";
import { demoFixture as fixture } from "../lib/demo-fixture";
import type { RoomSnapshot, ValidationResult } from "../lib/types";

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return {
    useAnonymousUser: () => user,
    useAnonymousAuth: () => ({
      user,
      loading: false,
      error: null,
      retry: vi.fn(),
    }),
    getIdToken: vi.fn(),
  };
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
const headings = ["介護保険の上限", "空白（介護が必要な時間の空き）", "付き添いの負担", "確認が必要な予定"];
let validation: ValidationResult;

beforeEach(() => {
  validation = structuredClone(fixture.troubledPlan.expectedValidationResult);
  validation.hardViolations = [
    { type: "unavailableOverlap", detail: "架空の対応不可時間の違反" },
    { type: "overlap", detail: "架空の付き添い重複" },
  ];
});
afterEach(cleanup);

function renderBand() {
  render(<BoardStatusBand roomId="test" snapshot={snapshot} validation={validation} people={fixture.people} />);
  return within(screen.getByRole("region", { name: "プランの状態" }));
}

describe("検証詳細の種類別表示", () => {
  it("ボードの帯は注意点件数だけ表示し、重複しない違反の内容を表示する", () => {
    const band = renderBand();
    expect(band.queryByText("注意点 5件")).toBeNull();
    const rules = within(band.getByRole("region", { name: "確認が必要な予定" }));
    expect(rules.getByText("対応不可との重なり")).toBeTruthy();
    expect(rules.getByText("付き添い時間の重なり")).toBeTruthy();
    expect(rules.getByText("架空の対応不可時間の違反")).toBeTruthy();
    expect(rules.getByText("架空の付き添い重複")).toBeTruthy();
    expect(band.queryByText(/解消のヒント/)).toBeNull();
  });

  it.each([
    ["予定が重なっています（月曜 9:00〜12:00 通所介護 と 月曜 10:00〜11:00 訪問介護）", "予定の重なり"],
    ["同じ人の付き添いが重なっています（火曜 17:00〜19:00 長女の付き添い と 火曜 18:00〜20:00 長女の付き添い）", "付き添い時間の重なり"],
    ["予定が重なっています（水曜 9:00〜16:00 通所介護 と 水曜 10:00〜12:00 母の付き添い）", "予定の重なり"],
  ] as const)("ボードでは見出しと短い1行のみを表示し長い補足説明を出さない：%s", (detail, expectedTitle) => {
    validation.hardViolations = [{ type: "overlap", detail }];
    const band = renderBand();
    const rules = within(band.getByRole("region", { name: "確認が必要な予定" }));
    expect(rules.getByText(expectedTitle)).toBeTruthy();
    expect(rules.getByText(detail)).toBeTruthy();
    expect(rules.queryByText(/同じ時間に置くと、重なりとして警告します/)).toBeNull();
    expect(rules.queryByText(/解消のヒント/)).toBeNull();
  });

  it("ボードは該当のない分類を表示しない", () => {
    validation.overUnits = 0;
    validation.overloads = [];
    validation.hardViolations = [];
    const band = renderBand();
    expect(band.queryByRole("region", { name: headings[1] })).toBeNull();
    expect(band.queryByText("注意点 1件")).toBeNull();
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

    // 確認が必要な予定カードが常時表示
    const rules = within(screen.getByRole("region", { name: "確認が必要な予定" }));
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
    expect(screen.getByRole("region", { name: "確認が必要な予定" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "介護保険の上限" })).toBeNull();
    expect(screen.queryByRole("region", { name: "空白（介護が必要な時間の空き）" })).toBeNull();
    expect(screen.queryByRole("region", { name: "付き添いの負担" })).toBeNull();
  });

  it("問題のない代替案では空の分類を出さず、従来の成功表示を維持する", async () => {
    validation = structuredClone(fixture.acceptedPlan.expectedValidationResult);
    render(<ProposalsClient roomId="test" />);
    await screen.findByRole("heading", { name: "現在のプランの状態" });
    expect(screen.getByText("予定と費用の自動チェックを通過しました")).toBeTruthy();
    expect(screen.getByText("相談用に確定できます")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "介護保険の上限" })).toBeNull();
    expect(screen.queryByRole("region", { name: "空白（介護が必要な時間の空き）" })).toBeNull();
    expect(screen.queryByRole("region", { name: "付き添いの負担" })).toBeNull();
    expect(screen.queryByRole("region", { name: "確認が必要な予定" })).toBeNull();
  });

  it("ボードの未判定は別枠で残し、要約件数にも含める", () => {
    validation.validationErrors = [{ code: "missingCareWindows", reason: "支援必要時間が未設定です。" }];
    const band = renderBand();
    expect(band.queryByText("注意点 6件")).toBeNull();
    expect(band.getByRole("heading", { name: "未判定・不備" })).toBeTruthy();
    expect(within(band.getByRole("region", { name: "未判定・不備" })).getByText("支援必要時間が未設定です。")).toBeTruthy();
    expect(within(band.getByRole("region", { name: "確認が必要な予定" })).queryByText("支援必要時間が未設定です。")).toBeNull();
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
    expect(within(screen.getByRole("region", { name: "確認が必要な予定" })).queryByText("時間区分を判定できません。")).toBeNull();
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
    expect(screen.queryByRole("region", { name: "確認が必要な予定" })).toBeNull();
  });
});
