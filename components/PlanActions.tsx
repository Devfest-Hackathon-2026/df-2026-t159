"use client";

/**
 * プランの確定・代替案の適用の操作部品（Issue 14 / UX改善）。
 *
 * props の契約は lib/types.ts の PlanActionsProps（Issue 0 で固定）。
 * この部品は「薄い操作 UI」で、保存・検証・認可はすべて呼び出し側と
 * サーバー（Route Handler）が担う。
 *
 * 表示の約束：
 * - 「確定済み」と言えるのは confirmed（summary.confirmedRevision ＝ 現在の
 *   revision）のときだけ。版が進んだら呼び出し側が confirmed=false を渡す
 * - 代替案は baseRevision が現在の revision と一致しないものは適用できない
 *   （古い版への案は破棄する。仕様の確定事項）
 * - 検証が ok でない間は確定ボタンを押せない（理由は検証表示側で出す）
 * - プラン確定の欄はカードにする
 * - 代替案はカード（要約、変更件数、採用ボタン）で表示する
 */

import Link from "next/link";
import { useId, useState } from "react";
import { ConfirmPlanButton, ConfirmationBlockers } from "./ConfirmationControls";
import { applyChanges } from "@/lib/apply-changes";
import type { PlanActionsProps, Proposal } from "@/lib/types";
import ProposalChangeList from "./ProposalChangeList";
import ProposalChangeSummary from "./ProposalChangeSummary";
import ProposalMiniBoard from "./ProposalMiniBoard";

/**
 * 代替案の説明文を表示用に整形する純粋関数。
 * 固定デモの説明文（約135文字）が長いため、狙いが伝わる短い文に短縮する。
 * 実AIの説明文はそのまま表示する。
 */
export function formatProposalSummary(summary: string): string {
  if (
    summary.includes("水曜の通所介護を終日（9時から16時）に延ばして昼の空白を埋め") ||
    summary.includes("水曜の通所介護を終日")
  ) {
    return "通所時間を調整して上限内に収め、家族で付き添いを分担して長女の負担を軽減します。";
  }
  return summary;
}

export default function PlanActions({
  snapshot,
  validation,
  proposals,
  confirmed,
  canEdit,
  onApplyProposal,
  onConfirm,
  roomId,
  suppressSuccessNotice = false,
}: PlanActionsProps) {
  const [busy, setBusy] = useState(false);
  const confirmationReasonId = useId();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = async (action: () => void | Promise<void>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await action();
      if (successMessage && !suppressSuccessNotice) {
        setSuccess(successMessage);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "操作に失敗しました。もう一度お試しください",
      );
    } finally {
      setBusy(false);
    }
  };

  const isStale = (proposal: Proposal) =>
    proposal.baseRevision !== snapshot.revision;

  return (
    <section aria-label="プランの確定と代替案" className="space-y-6">
      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 font-bold text-sm shadow-xs flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <span className="text-emerald-700">✓</span>
            <span>{success}</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSuccess(null)}
              className="text-xs text-emerald-700 hover:text-emerald-950"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* プラン確定カード */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">📋</span>
            <h2 className="text-base font-bold text-neutral-900">プランの確定</h2>
          </div>
          {confirmed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              確定済み
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-3 py-1 text-xs font-bold text-neutral-600">
              未確定
            </span>
          )}
        </div>

        <div className="mt-4">
          {confirmed ? (
            <div className="space-y-4">
              <p className="text-sm text-neutral-600 leading-relaxed">
                確定済みです。まとめシートで確認・印刷できます。
              </p>
              <div>
                <Link
                  href={roomId ? `/rooms/${roomId}/summary` : "/rooms/summary"}
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 transition-colors"
                >
                  <span>まとめシートで確認・印刷する</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-neutral-600">
                問題がなければプランを確定し、まとめシートを作成できます。
              </p>
              <div>
                <ConfirmPlanButton snapshot={snapshot} validation={validation} canEdit={canEdit} busy={busy}
                  describedBy={confirmationReasonId}
                  onConfirm={() => void run(onConfirm, "プランを確定しました")} />
              </div>
              <ConfirmationBlockers snapshot={snapshot} validation={validation} canEdit={canEdit} roomId={roomId} id={confirmationReasonId} />
            </div>
          )}
        </div>
      </div>

      {/* 代替案カード一覧 */}
      {proposals.length > 0 && (
        <div className="space-y-3">
          <div className="max-sm:flex-wrap max-sm:gap-2 flex items-center justify-between">
            <h3 className="text-base font-bold text-neutral-900 flex items-center gap-2">
              <span>💡</span>
              <span>提示された代替案（{proposals.length}件）</span>
            </h3>
            <span className="text-xs text-neutral-500">
              検証済みの案のみ表示
            </span>
          </div>
          <ul className="space-y-4">
            {proposals.map((proposal, index) => (
              <ProposalCard
                key={`${proposal.baseRevision}-${index}`}
                proposal={proposal}
                index={index}
                snapshot={snapshot}
                validation={validation}
                canEdit={canEdit}
                busy={busy}
                stale={isStale(proposal)}
                onApply={(p) =>
                  void run(
                    () => onApplyProposal(p),
                    "代替案を採用しました。現在のプランに反映されました。"
                  )
                }
              />
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200">
          {error}
        </p>
      )}
    </section>
  );
}

interface ProposalCardProps {
  proposal: Proposal;
  index: number;
  snapshot: PlanActionsProps["snapshot"];
  validation: PlanActionsProps["validation"];
  canEdit: boolean;
  busy: boolean;
  stale: boolean;
  onApply: (proposal: Proposal) => void;
}

function ProposalCard({
  proposal,
  index,
  snapshot,
  validation,
  canEdit,
  busy,
  stale,
  onApply,
}: ProposalCardProps) {
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const summaryText = formatProposalSummary(proposal.summary);
  const appliedPlacements = !stale
    ? applyChanges(snapshot.placements, proposal.changes)
    : [];

  return (
    <li
      key={`${proposal.baseRevision}-${index}`}
      className="rounded-xl border border-neutral-200 bg-white p-5 shadow-xs transition-shadow hover:shadow-sm"
    >
      <div className="max-sm:flex-col max-sm:items-stretch flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-bold text-indigo-700">
              {index + 1}
            </span>
            {/* 1. 説明文 */}
            <p className="text-sm font-bold text-neutral-900">
              {summaryText}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span className="rounded bg-neutral-100 px-2 py-0.5 font-medium text-neutral-700">
              変更 {proposal.changes.length} 件
            </span>
            {stale && (
              <span className="text-red-600">
                ※ 古い版への提案のため適用できません
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          disabled={!canEdit || busy || stale}
          onClick={() => onApply(proposal)}
          className="rounded-xl bg-neutral-900 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 transition-colors shrink-0"
        >
          採用する
        </button>
      </div>

      {!stale && (
        <div className="mt-5 space-y-4 border-t border-neutral-100 pt-4">
          {/* 2. 変更の一覧 */}
          <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <summary className="min-h-11 cursor-pointer content-center text-sm font-bold">
              変更の詳細（{proposal.changes.length}件）
            </summary>
            <ProposalChangeList
              changes={proposal.changes}
              placements={snapshot.placements}
              people={snapshot.people}
              selectedChangeId={selectedChangeId}
              onSelectChange={setSelectedChangeId}
            />
          </details>

          {/* 3. ミニボード */}
          <ProposalMiniBoard
            placements={appliedPlacements}
            people={snapshot.people}
            originalPlacements={snapshot.placements}
            changes={proposal.changes}
            highlightedPlacementId={selectedChangeId}
            onSelectPlacement={setSelectedChangeId}
          />

          {/* 4. 変更の要約 */}
          <ProposalChangeSummary
            people={snapshot.people}
            current={validation}
            proposed={proposal.validation}
          />

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={!canEdit || busy || stale}
              onClick={() => onApply(proposal)}
              className="rounded-xl bg-neutral-900 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow-xs hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300 transition-colors shrink-0"
            >
              採用する
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
