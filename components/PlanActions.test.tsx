// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoFixture as fixture } from "../lib/demo-fixture";
import type { PlanActionsProps, Proposal, ValidationResult } from "../lib/types";
import PlanActions from "./PlanActions";

afterEach(cleanup);

const current = fixture.troubledPlan.expectedValidationResult;
const accepted = fixture.acceptedPlan.expectedValidationResult;

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    ...fixture.fixedProposal,
    baseRevision: 12,
    validation: accepted,
    ...overrides,
  };
}

function props(overrides: Partial<PlanActionsProps> = {}): PlanActionsProps {
  return {
    snapshot: {
      people: fixture.people,
      placements: fixture.troubledPlan.placements,
      constraints: fixture.constraints,
      hopes: fixture.hopes,
      unknowns: fixture.unknowns,
      careWindows: fixture.careWindows,
      copayRate: fixture.copayRate,
      revision: 12,
    },
    validation: current,
    proposals: [proposal()],
    confirmed: false,
    canEdit: true,
    onApplyProposal: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

function expectComparison(label: string, before: string, after: string) {
  const row = screen.getByText(label).closest("div");
  expect(row).not.toBeNull();
  expect(within(row!).getByRole("definition").textContent).toBe(`${before}→${after}`);
}

describe("代替案の変更要約", () => {
  it("固定デモの検算済み結果を現在から代替案の順で表示する", () => {
    render(<PlanActions {...props()} />);

    expect(screen.getByText("変更の要約")).toBeTruthy();
    expectComparison("月換算単位", "28,131 単位", "24,094 単位");
    expectComparison("月次自己負担（概算）", "37,878 円", "24,094 円");
    expectComparison("母の付き添い", "10 時間/週", "12 時間/週");
    expectComparison("長女の付き添い", "27 時間/週", "18 時間/週");
    expectComparison("長男の付き添い", "8 時間/週", "12 時間/週");
    expect(screen.queryByText("父の付き添い")).toBeNull();
    expect(screen.getByText(/概算であり実際の請求額ではありません/)).toBeTruthy();
    expect(screen.getByText(/食費・居住費・各種加算は含みません/)).toBeTruthy();
  });

  it("固定案以外でも渡された検証結果を表示し、配置や固定値から計算し直さない", () => {
    const aiValidation: ValidationResult = {
      ...accepted,
      monthlyUnits: 23_456,
      selfPayYen: 46_912,
      memberHours: [
        { personId: "person-son", hours: 11 },
        { personId: "person-mother", hours: 13 },
        { personId: "person-daughter", hours: 17 },
      ],
    };
    render(<PlanActions {...props({ proposals: [proposal({
      summary: "AIが返した別の検証済み代替案",
      changes: [],
      validation: aiValidation,
    })] })} />);

    expectComparison("月換算単位", "28,131 単位", "23,456 単位");
    expectComparison("月次自己負担（概算）", "37,878 円", "46,912 円");
    expectComparison("母の付き添い", "10 時間/週", "13 時間/週");
    expectComparison("長女の付き添い", "27 時間/週", "17 時間/週");
    expectComparison("長男の付き添い", "8 時間/週", "11 時間/週");
    expect(screen.queryByText("24,094 単位")).toBeNull();
  });

  it("同じ時間の家族と付き添い対象外の本人を除き、0時間への変更は表示する", () => {
    const before: ValidationResult = {
      ...current,
      memberHours: [...current.memberHours, { personId: "person-father", hours: 1 }],
    };
    const after: ValidationResult = {
      ...accepted,
      memberHours: [
        { personId: "person-mother", hours: 10 },
        { personId: "person-daughter", hours: 0 },
        { personId: "person-son", hours: 8 },
        { personId: "person-father", hours: 2 },
      ],
    };
    render(<PlanActions {...props({ validation: before, proposals: [proposal({ validation: after })] })} />);

    expectComparison("長女の付き添い", "27 時間/週", "0 時間/週");
    expect(screen.queryByText("母の付き添い")).toBeNull();
    expect(screen.queryByText("長男の付き添い")).toBeNull();
    expect(screen.queryByText("父の付き添い")).toBeNull();
  });

  it("家族の時間が全員同じなら変更なしと表示し、費用比較は残す", () => {
    render(<PlanActions {...props({ proposals: [proposal({
      validation: { ...accepted, memberHours: current.memberHours },
    })] })} />);

    expect(screen.getByText("家族の付き添い時間に変更はありません。")).toBeTruthy();
    expect(screen.queryByText(/の付き添い$/)).toBeNull();
    expectComparison("月換算単位", "28,131 単位", "24,094 単位");
    expectComparison("月次自己負担（概算）", "37,878 円", "24,094 円");
  });

  it("単位数・費用・付き添い時間の0を未判定として扱わない", () => {
    render(<PlanActions {...props({
      validation: {
        ...current,
        monthlyUnits: 0,
        selfPayYen: 0,
        memberHours: [{ personId: "person-mother", hours: 0 }],
      },
      proposals: [proposal({ validation: {
        ...accepted,
        monthlyUnits: 0,
        selfPayYen: 0,
        memberHours: [{ personId: "person-mother", hours: 2 }],
      } })],
    })} />);

    expectComparison("月換算単位", "0 単位", "0 単位");
    expectComparison("月次自己負担（概算）", "0 円", "0 円");
    expectComparison("母の付き添い", "0 時間/週", "2 時間/週");
  });

  it("nullの費用や欠けた家族の時間を0に置き換えず未判定と表示する", () => {
    render(<PlanActions {...props({
      validation: {
        ...current,
        monthlyUnits: null,
        selfPayYen: null,
        memberHours: [{ personId: "person-daughter", hours: 27 }],
      },
      proposals: [proposal({ validation: {
        ...accepted,
        monthlyUnits: null,
        selfPayYen: null,
        memberHours: [{ personId: "person-son", hours: 12 }],
      } })],
    })} />);

    expectComparison("月換算単位", "未判定", "未判定");
    expectComparison("月次自己負担（概算）", "未判定", "未判定");
    expectComparison("母の付き添い", "未判定", "未判定");
    expectComparison("長女の付き添い", "27 時間/週", "未判定");
    expectComparison("長男の付き添い", "未判定", "12 時間/週");
    expect(screen.queryByText("0 円")).toBeNull();
    expect(screen.queryByText("0 単位")).toBeNull();
    expect(screen.queryByText("0 時間/週")).toBeNull();
  });

  it("旧形式の代替案に検証結果がなければ未判定と再取得の案内を出す", () => {
    render(<PlanActions {...props({ proposals: [proposal({ validation: undefined })] })} />);

    expect(screen.getByText("変更の要約")).toBeTruthy();
    expect(screen.getByText("検証結果がないため未判定です。代替案を再取得してください。")).toBeTruthy();
    expect(screen.queryByText("月換算単位")).toBeNull();
    expect(screen.queryByText("24,094 単位")).toBeNull();
  });

  it("入力の版が進んだら古い案の要約を隠し、採用もできなくする", () => {
    const initial = props();
    const view = render(<PlanActions {...initial} />);
    expect(screen.getByText("変更の要約")).toBeTruthy();
    const initialButtons = screen.getAllByRole("button", { name: "採用する" });
    expect(initialButtons).toHaveLength(2);
    expect(initialButtons.every(b => !(b as HTMLButtonElement).disabled)).toBe(true);

    view.rerender(<PlanActions {...initial} snapshot={{ ...initial.snapshot, revision: 13 }} />);

    expect(screen.queryByText("変更の要約")).toBeNull();
    expect(screen.queryByText("28,131 単位")).toBeNull();
    expect(screen.queryByText("24,094 単位")).toBeNull();
    expect(screen.getByText(/古い版への提案のため適用できません/)).toBeTruthy();
    const staleButtons = screen.getAllByRole("button", { name: "採用する" });
    expect(staleButtons).toHaveLength(1);
    const button = staleButtons[0] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(initial.onApplyProposal).not.toHaveBeenCalled();
  });

  it("プラン確定後はまとめシートへのリンクを表示し、未確定時は表示しない", () => {
    // 確定前：ボタンは出ない
    const unconfirmedView = render(<PlanActions {...props({ confirmed: false, roomId: "room-abc" })} />);
    expect(screen.queryByRole("link", { name: /まとめシートで確認・印刷する/ })).toBeNull();
    unconfirmedView.unmount();

    // 確定後：まとめシートへの明示的なボタン（リンク）が1つだけ出る（確定カード内）
    render(<PlanActions {...props({ confirmed: true, roomId: "room-abc" })} />);
    const links = screen.getAllByRole("link", { name: /まとめシートで確認・印刷する/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/rooms/room-abc/summary");
  });

  it("確定ボタン実行時の緑バナーは「プランを確定しました」のみ表示してリンクを含まず、確定カード側にのみまとめシートリンクが1つ表示される", async () => {
    const onConfirm = vi.fn();
    const validProps = props({
      confirmed: false,
      roomId: "room-abc",
      onConfirm,
      validation: accepted,
      snapshot: {
        ...props().snapshot,
        placements: fixture.acceptedPlan.placements,
        unknowns: [],
      },
    });
    const view = render(<PlanActions {...validProps} />);

    const confirmButton = screen.getByRole("button", { name: "このプランで確定する" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalled();
    });

    // 緑バナーの検証: 「プランを確定しました」のみ表示され、リンクは含まない
    const banner = screen.getByRole("status");
    expect(banner.textContent).toContain("プランを確定しました");
    expect(banner.textContent).not.toContain("まとめシートで確認・印刷ができます");
    expect(within(banner).queryByRole("link")).toBeNull();

    // 確定完了状態へ遷移後（confirmed: true）
    view.rerender(<PlanActions {...validProps} confirmed={true} />);

    // ページ全体で「まとめシートで確認・印刷する」リンクは確定カード側の1つのみ
    const links = screen.getAllByRole("link", { name: /まとめシートで確認・印刷する/ });
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/rooms/room-abc/summary");

    // バナー内にリンクが含まれないことを再確認
    const updatedBanner = screen.getByRole("status");
    expect(within(updatedBanner).queryByRole("link")).toBeNull();
  });
});
