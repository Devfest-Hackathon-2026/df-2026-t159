// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoFixture as fixture } from "../lib/demo-fixture";
import type { PlanActionsProps, Proposal } from "../lib/types";
import PlanActions, { formatProposalSummary } from "./PlanActions";
import { formatProposalChange, formatProposalChanges } from "./ProposalChangeList";

afterEach(cleanup);

const currentValidation = fixture.troubledPlan.expectedValidationResult;
const acceptedValidation = fixture.acceptedPlan.expectedValidationResult;

function createProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    ...fixture.fixedProposal,
    baseRevision: 12,
    validation: acceptedValidation,
    ...overrides,
  };
}

function createProps(overrides: Partial<PlanActionsProps> = {}): PlanActionsProps {
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
    validation: currentValidation,
    proposals: [createProposal()],
    confirmed: false,
    canEdit: true,
    onApplyProposal: vi.fn(),
    onConfirm: vi.fn(),
    ...overrides,
  };
}

describe("代替案カードの表示改修", () => {
  describe("1. 説明文の短縮", () => {
    it("固定デモの説明文（長い文）を狙いが伝わる短い文に短縮する", () => {
      const original = fixture.fixedProposal.summary;
      const shortened = formatProposalSummary(original);

      expect(shortened).not.toBe(original);
      expect(shortened.length).toBeLessThan(original.length);
      expect(shortened).toBe("通所時間を調整して上限内に収め、家族で付き添いを分担して長女の負担を軽減します。");

      render(<PlanActions {...createProps()} />);
      expect(screen.getByText(shortened)).toBeTruthy();
      expect(screen.queryByText(original)).toBeNull();
    });

    it("実AIの説明文はそのまま表示する", () => {
      const aiSummary = "火曜と木曜の訪問介護を1時間前倒しし、夕方の空白を解消する代替案です。";
      render(
        <PlanActions
          {...createProps({
            proposals: [createProposal({ summary: aiSummary })],
          })}
        />,
      );
      expect(screen.getByText(aiSummary)).toBeTruthy();
    });
  });

  describe("2. 変更の一覧（1件1行・12件）", () => {
    it("formatProposalChanges で固定デモの12件の変更が期待する書式に変換される", () => {
      const items = formatProposalChanges(
        fixture.fixedProposal.changes,
        fixture.troubledPlan.placements,
        fixture.people,
      );

      expect(items).toHaveLength(12);

      // 書式：「曜日：サービス名 開始–終了」の変化が分かる形。追加・削除・変更を区別できる言葉を含む
      expect(items[0].text).toBe("水曜：通所介護 9:00–12:00 → 9:00–16:00（変更）");
      expect(items[0].action).toBe("change");

      expect(items[1].text).toBe("火曜：通所リハビリ 9:00–16:00 → 10:00–14:00（変更）");
      expect(items[1].action).toBe("change");

      expect(items[2].text).toBe("木曜：通所リハビリ 9:00–16:00 → 10:00–14:00（変更）");
      expect(items[2].action).toBe("change");

      expect(items[3].text).toBe("金曜：訪問介護 7:00–9:00（削除）");
      expect(items[3].action).toBe("remove");

      expect(items[4].text).toBe("月曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）");
      expect(items[4].action).toBe("change");

      expect(items[5].text).toBe("火曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）");
      expect(items[5].action).toBe("change");

      expect(items[6].text).toBe("水曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）");
      expect(items[6].action).toBe("change");

      expect(items[7].text).toBe("木曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）");
      expect(items[7].action).toBe("change");

      expect(items[8].text).toBe("金曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）");
      expect(items[8].action).toBe("change");

      // 家族の付き添いは担当者名（母）が出る
      expect(items[9].text).toBe("金曜：母の付き添い 7:00–9:00（追加）");
      expect(items[9].action).toBe("add");

      // 削除（長女）と追加（長男）
      expect(items[10].text).toBe("土曜：長女の付き添い 8:00–12:00（削除）");
      expect(items[10].action).toBe("remove");

      expect(items[11].text).toBe("土曜：長男の付き添い 8:00–12:00（追加）");
      expect(items[11].action).toBe("add");
    });

    it("代替案カード内に変更の一覧リスト（12件）がレンダリングされる", () => {
      render(<PlanActions {...createProps()} />);

      const details = screen.getByText("変更の詳細（12件）").closest("details")!;
      expect(details.open).toBe(false);
      fireEvent.click(screen.getByText("変更の詳細（12件）"));
      expect(details.open).toBe(true);

      const changeList = screen.getByRole("list", { name: "変更の一覧" });
      expect(changeList).toBeTruthy();

      const listItems = within(changeList).getAllByRole("listitem");
      expect(listItems).toHaveLength(12);

      // 主要な変更項目が含まれていることの確認
      expect(within(changeList).getByText(/水曜：通所介護 9:00–12:00 → 9:00–16:00（変更）/)).toBeTruthy();
      expect(within(changeList).getByText(/火曜：通所リハビリ 9:00–16:00 → 10:00–14:00（変更）/)).toBeTruthy();
      expect(within(changeList).getByText(/木曜：通所リハビリ 9:00–16:00 → 10:00–14:00（変更）/)).toBeTruthy();
      expect(within(changeList).getByText(/金曜：訪問介護 7:00–9:00（削除）/)).toBeTruthy();
      expect(within(changeList).getByText(/月曜：長女の付き添い 18:00–21:00 → 19:00–21:00（変更）/)).toBeTruthy();
      expect(within(changeList).getByText(/金曜：母の付き添い 7:00–9:00（追加）/)).toBeTruthy();
      expect(within(changeList).getByText(/土曜：長女の付き添い 8:00–12:00（削除）/)).toBeTruthy();
      expect(within(changeList).getByText(/土曜：長男の付き添い 8:00–12:00（追加）/)).toBeTruthy();
    });
  });

  describe("3. ミニボード（適用後の週間予定）", () => {
    it("適用後の週間予定が読み取り専用カレンダーとして描画され、納得プランの配置24件が表示される", () => {
      render(<PlanActions {...createProps()} />);

      const miniBoard = screen.getByLabelText("適用後の週間予定");
      expect(miniBoard).toBeTruthy();

      // 納得プラン（24件）の配置が描画されていることを確認
      const acceptedPlacements = fixture.acceptedPlan.placements;
      expect(acceptedPlacements).toHaveLength(24);

      for (const p of acceptedPlacements) {
        const element = within(miniBoard).getByTestId(`mini-placement-${p.id}`);
        expect(element).toBeTruthy();
      }

      // 削除された金曜朝の訪問介護（demo-visit-fri）は存在しないこと
      expect(within(miniBoard).queryByTestId("mini-placement-demo-visit-fri")).toBeNull();

      // 変更後の水曜通所介護が 9:00〜16:00 であること
      const wedDaycare = within(miniBoard).getByTestId("mini-placement-demo-daycare-wed");
      expect(wedDaycare.textContent).toContain("通所介護");
      expect(wedDaycare.textContent).toContain("9:00〜16:00");

      // 新規追加された金曜朝の母の付き添い（demo-mother-fri-morning）が存在すること
      const friMother = within(miniBoard).getByTestId("mini-placement-demo-mother-fri-morning");
      expect(friMother.textContent).toContain("母（付き添い）");
      expect(friMother.textContent).toContain("7:00〜9:00");

      // 新規追加された土曜午前の長男の付き添い（demo-son-sat-morning）が存在すること
      const satSon = within(miniBoard).getByTestId("mini-placement-demo-son-sat-morning");
      expect(satSon.textContent).toContain("長男（付き添い）");
      expect(satSon.textContent).toContain("8:00〜12:00");
    });
  });

  describe("4. カード要素の並び順", () => {
    it("説明文 → 変更の一覧 → ミニボード → 変更の要約 の順で並んでいる", () => {
      const { container } = render(<PlanActions {...createProps()} />);
      fireEvent.click(screen.getByText("変更の詳細（12件）"));

      const card = container.querySelector("li.rounded-xl");
      expect(card).not.toBeNull();

      const summaryEl = within(card as HTMLElement).getByText(/通所時間を調整して上限内に収め/);
      const changesListEl = within(card as HTMLElement).getByRole("list", { name: "変更の一覧" });
      const miniBoardEl = within(card as HTMLElement).getByLabelText("適用後の週間予定");
      const summarySheetEl = within(card as HTMLElement).getByText("変更の要約");

      // DOMツリー上の登場順序を検証
      expect(
        summaryEl.compareDocumentPosition(changesListEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      expect(
        changesListEl.compareDocumentPosition(miniBoardEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      expect(
        miniBoardEl.compareDocumentPosition(summarySheetEl) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("適用後の追加・変更と、元の位置の削除を区別して表示する", () => {
    render(<PlanActions {...createProps()} />);
    expect(screen.getByTestId("mini-placement-demo-mother-fri-morning").getAttribute("data-change")).toBe("add");
    expect(screen.getByTestId("mini-placement-demo-daycare-wed").getAttribute("data-change")).toBe("change");
    const removed = screen.getByTestId("mini-removed-demo-visit-fri");
    expect(removed.getAttribute("data-change")).toBe("remove");
    expect(removed.getAttribute("aria-label")).toContain("削除（元の位置）");
    expect(removed.style.top).toBe("calc(1 * var(--mini-row-h))");
    expect(screen.getByTestId("mini-removed-demo-daughter-sat-morning").style.left)
      .not.toBe(screen.getByTestId("mini-placement-demo-son-sat-morning").style.left);
  });

  describe("5. 番号バッジとハイライト連動", () => {
    it("変更一覧とミニボードの対応ブロックに同じ番号バッジが表示される", () => {
      render(<PlanActions {...createProps()} />);
      fireEvent.click(screen.getByText("変更の詳細（12件）"));

      const changeList = screen.getByRole("list", { name: "変更の一覧" });
      const badges = within(changeList).getAllByTestId("change-number-badge");
      expect(badges).toHaveLength(12);
      expect(badges[0].textContent).toBe("1");
      expect(badges[11].textContent).toBe("12");

      const miniBoard = screen.getByLabelText("適用後の週間予定");
      // 1番目（demo-daycare-wed）のブロックに番号バッジ 1 が出る
      const wedBlock = within(miniBoard).getByTestId("mini-placement-demo-daycare-wed");
      const wedBadge = within(wedBlock).getByTestId("mini-change-badge");
      expect(wedBadge.textContent).toBe("1");

      // 4番目（demo-visit-fri 削除）のブロックに番号バッジ 4 が出る
      const friRemovedBlock = within(miniBoard).getByTestId("mini-removed-demo-visit-fri");
      const friBadge = within(friRemovedBlock).getByTestId("mini-change-badge");
      expect(friBadge.textContent).toBe("4");
    });

    it("変更一覧の項目をクリックすると、ミニボードの対応ブロックがハイライトされる", () => {
      render(<PlanActions {...createProps()} />);
      fireEvent.click(screen.getByText("変更の詳細（12件）"));

      const miniBoard = screen.getByLabelText("適用後の週間予定");
      const wedBlock = within(miniBoard).getByTestId("mini-placement-demo-daycare-wed");
      expect(wedBlock.getAttribute("data-highlighted")).toBeNull();

      // 変更一覧の1番目（demo-daycare-wed）をクリック
      const firstChangeItem = screen.getByTestId("change-item-demo-daycare-wed");
      fireEvent.click(firstChangeItem);

      // 一覧項目が選択状態になり、ミニボード側ブロックがハイライトされる
      expect(firstChangeItem.getAttribute("data-selected")).toBe("true");
      expect(wedBlock.getAttribute("data-highlighted")).toBe("true");

      // もう一度クリックするとハイライト解除
      fireEvent.click(firstChangeItem);
      expect(firstChangeItem.getAttribute("data-selected")).toBe("false");
      expect(wedBlock.getAttribute("data-highlighted")).toBeNull();
    });

    it("ミニボード側の差分ブロックをクリックしてもハイライトが切り替わる", () => {
      render(<PlanActions {...createProps()} />);
      fireEvent.click(screen.getByText("変更の詳細（12件）"));

      const miniBoard = screen.getByLabelText("適用後の週間予定");
      const wedBlock = within(miniBoard).getByTestId("mini-placement-demo-daycare-wed");
      const firstChangeItem = screen.getByTestId("change-item-demo-daycare-wed");

      // ミニボード側をクリック
      fireEvent.click(wedBlock);
      expect(wedBlock.getAttribute("data-highlighted")).toBe("true");
      expect(firstChangeItem.getAttribute("data-selected")).toBe("true");

      // 再度クリックで解除
      fireEvent.click(wedBlock);
      expect(wedBlock.getAttribute("data-highlighted")).toBeNull();
      expect(firstChangeItem.getAttribute("data-selected")).toBe("false");
    });

    it("細いレーンや削除ブロックでも overflow-hidden と truncate が適用され、文字被りを防ぐ", () => {
      render(<PlanActions {...createProps()} />);
      const miniBoard = screen.getByLabelText("適用後の週間予定");

      // 金曜朝の母の付き添い（追加ブロック）と訪問介護（削除ブロック）
      const friMother = within(miniBoard).getByTestId("mini-placement-demo-mother-fri-morning");
      const friRemoved = within(miniBoard).getByTestId("mini-removed-demo-visit-fri");

      // コンテナに overflow-hidden が付いていること
      expect(friMother.className).toContain("overflow-hidden");
      expect(friRemoved.className).toContain("overflow-hidden");

      // 細いレーンのため、px-0.5 が適用されていること
      expect(friMother.className).toContain("px-0.5");
      expect(friRemoved.className).toContain("px-0.5");

      // タイトルテキストが truncate されていること
      const titleEl = friMother.querySelector(".truncate");
      expect(titleEl).not.toBeNull();
    });
  });
});
