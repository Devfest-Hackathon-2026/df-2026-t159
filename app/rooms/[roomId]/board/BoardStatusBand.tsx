"use client";

import { CircleCheck, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import React from "react";
import { ConfirmPlanButton } from "@/components/ConfirmationControls";
import ValidationGroups, { type ValidationGroup } from "@/components/ValidationGroups";
import { DAYS } from "@/lib/board";
import {
  formatHardViolations,
  formatValidationErrors,
  getWarningsStatus,
} from "@/lib/burden-view";
import { getCheckNoteItems } from "@/lib/check-notes";
import { confirmBlockReasons } from "@/lib/plan/logic";
import { scopeCopy } from "@/lib/scope-copy";
import type { Person, RoomSnapshot, ValidationResult } from "@/lib/types";

export interface BoardStatusBandProps {
  roomId: string;
  snapshot: RoomSnapshot;
  validation: ValidationResult | null;
  validationRevision?: number;
  people: Person[];
  canEdit?: boolean;
  confirmed?: boolean;
  confirmBusy?: boolean;
  confirmUnavailable?: boolean;
  proposalsDisabled?: boolean;
  onRestoreTroubledPlan?: () => void;
  onOpenProposals?: () => void;
  onConfirm?: () => void;
}

interface IssueItem {
  group: ValidationGroup;
  id: string;
  severity: number;
  title: string;
  summary: React.ReactNode;
  highlightNumber?: string;
}

export default React.memo(function BoardStatusBand({
  roomId,
  snapshot,
  validation,
  validationRevision,
  people,
  canEdit = true,
  confirmed = false,
  confirmBusy = false,
  confirmUnavailable = false,
  proposalsDisabled = false,
  onRestoreTroubledPlan,
  onOpenProposals,
  onConfirm,
}: BoardStatusBandProps) {
  const status = validation ? getWarningsStatus(validation) : null;
  const violations = validation ? formatHardViolations(validation.hardViolations) : [];
  const errors = validation ? formatValidationErrors(validation.validationErrors) : [];
  const checkNotes = getCheckNoteItems(snapshot.placements);

  const issues: IssueItem[] = [];

  const provisionalConstraints = snapshot.constraints.filter(c => c.provisional === true);
  if (provisionalConstraints.length > 0) {
    const provisionalSummaries = provisionalConstraints.map(c => {
      const personName = people.find(p => p.id === c.personId)?.name ?? c.personId;
      const daysText = c.days.length > 0 ? `${c.days.map(d => DAYS[d]).join("・")}曜` : "";
      const timeText =
        c.startHour !== undefined && c.endHour !== undefined
          ? `${c.startHour}:00〜${c.endHour}:00`
          : "";
      return `${personName}（${[daysText, timeText].filter(Boolean).join(" ") || c.detail}）`;
    });
    issues.push({
      id: "provisional-time-check",
      group: "provisionalTime",
      severity: 0,
      title: `時刻の確認（仮置き時刻が ${provisionalConstraints.length}件あります）`,
      highlightNumber: `${provisionalConstraints.length}件`,
      summary: `AIが仮置きした時刻です。入力画面で正しい時刻を設定してください（${provisionalSummaries.join("、")}）。`,
    });
  }

  for (let idx = 0; idx < violations.length; idx++) {
    const v = violations[idx];
    issues.push({
      id: `hard-${v.type}-${v.placementId ?? idx}`,
      group: "hardViolation",
      severity: 1,
      title: v.title,
      summary: v.detail,
    });
  }

  for (const e of errors) {
    issues.push({
      id: `err-${e.code}-${e.placementId ?? ""}`,
      group: "validationUnavailable",
      severity: 1.5,
      title: e.title,
      summary: e.reason,
    });
  }

  issues.sort((a, b) => a.severity - b.severity);
  const issueCount = issues.length + Number(!!status?.isOverLimit) + Number(!!status?.hasGaps) + Number(!!status?.hasOverload);

  const reasons = validation ? confirmBlockReasons(snapshot, validation) : [];
  let confirmStatusNote: string = scopeCopy.saveByMember;
  if (!validation) {
    confirmStatusNote = "検証中です。最新の検証結果を確認してから確定できます。";
  } else if (reasons.includes("validation_not_ok")) {
    confirmStatusNote = "問題があるため確定できません";
  } else if (reasons.includes("validation_errors")) {
    confirmStatusNote = "計算・判定できない項目が残っています";
  } else if (snapshot.unknowns.length > 0) {
    confirmStatusNote = "未確認事項が残っているため確定できません";
  } else if (!canEdit) {
    confirmStatusNote = "※ プランを確定できるのは家族だけです（ケアマネは閲覧・コメントのみ）";
  }

  const proposalButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-indigo-600 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 shadow-2xs transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40";

  const renderCheckNotesSection = () => (
    <div className="divide-y divide-neutral-200 bg-white">
      {checkNotes.map(item => (
        <div key={item.id} className="py-2 first:pt-0 last:pb-0 text-sm">
          <p className="font-bold text-teal-900 flex items-center gap-1">
            <Info className="ui-icon" aria-hidden="true" />
            <span>{item.title}</span>
          </p>
          <p className="mt-0.5 text-sm leading-relaxed text-neutral-700">{item.text}</p>
        </div>
      ))}
    </div>
  );

  return (
    <section
      aria-label="プランの状態"
      data-testid={validationRevision === undefined ? undefined : "validation-revision"}
      data-revision={validationRevision}
      className="mb-3"
    >
      <div className="rounded-xl border border-neutral-200 bg-white shadow-2xs overflow-hidden">
        {/* 上部の細いアクションバー：状態文・「代替案を見る」・「このプランで確定する」 */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            <div
              className="inline-flex flex-wrap items-center gap-2 shrink-0"
            >
              {!validation ? (
                <span className="text-xs text-neutral-500">確認中…</span>
              ) : issueCount === 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                  <CircleCheck className="ui-icon" aria-hidden="true" />
                  警告はありません
                </span>
              ) : null}
            </div>

            {!confirmed && (onConfirm || !validation || reasons.length > 0 || !canEdit) && (
              <p
                id="board-confirmation-reasons"
                className="text-xs font-semibold text-neutral-600"
              >
                {confirmStatusNote}
              </p>
            )}
          </div>

          <div
            role="group"
            aria-label="プラン操作"
            className="ml-auto flex flex-wrap items-center gap-2 shrink-0"
          >
            {onRestoreTroubledPlan && (
              <button
                type="button"
                disabled={confirmBusy}
                onClick={onRestoreTroubledPlan}
                className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
              >
                揉めるプランに戻す
              </button>
            )}
            {onOpenProposals ? (
              <button
                type="button"
                data-board-tutorial-target="status-proposals"
                disabled={proposalsDisabled}
                onClick={onOpenProposals}
                className={proposalButtonClass}
              >
                <Sparkles className="ui-icon" aria-hidden="true" />
                <span>代替案を見る</span>
              </button>
            ) : (
              <Link
                href={`/rooms/${roomId}/proposals`}
                data-board-tutorial-target="status-proposals"
                className={proposalButtonClass}
              >
                <Sparkles className="ui-icon" aria-hidden="true" />
                <span>代替案を見る</span>
              </Link>
            )}

            {(onConfirm || confirmed) && (
              <div data-board-tutorial-target="confirm-btn" className="inline-flex items-center">
                {!confirmed && onConfirm ? (
                  <ConfirmPlanButton
                    snapshot={snapshot}
                    validation={validation}
                    canEdit={canEdit}
                    busy={confirmBusy}
                    unavailable={confirmUnavailable}
                    describedBy="board-confirmation-reasons"
                    onConfirm={onConfirm}
                  />
                ) : (
                  <span className="inline-flex items-center rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm font-bold text-emerald-800">
                    確定済み
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 未確認事項があるときのコンパクトな警告帯 */}
        {!confirmed && snapshot.unknowns.length > 0 && (
          <div className="border-t border-amber-200/80 bg-amber-50/70 px-3.5 py-2 text-xs text-amber-900">
            <p className="font-bold">未確認事項が残っているため、まだ確定できません。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {snapshot.unknowns.map((unknown, index) => (
                <li key={index}>{unknown}</li>
              ))}
            </ul>
          </div>
        )}

        {issues.length > 0 && (
          <div className="border-t border-neutral-200 px-4 py-3">
            <ValidationGroups
              issues={issues}
              headingLevel={3}
              renderIssues={items => (
                <ul className="divide-y divide-neutral-200 bg-white">
                  {items.map((issue, index) => (
                    <li
                      key={`${issue.id}-${index}`}
                      className="py-2.5 first:pt-0.5 last:pb-0.5 space-y-1 bg-white"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-neutral-900">{issue.title}</span>
                        {issue.highlightNumber && (
                          <span className="font-numeric tabular-nums text-sm font-bold text-[#C05B4D]">
                            {issue.highlightNumber}
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-snug text-neutral-700">{issue.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            />

          </div>
        )}

        {checkNotes.length > 0 && (
          <div className="space-y-2 border-t border-neutral-200 px-4 py-3">
            <h3 className="flex items-center gap-1 text-sm font-bold text-teal-900">
              <Info className="ui-icon" aria-hidden="true" /> 面談での確認事項（{checkNotes.length}件）
            </h3>
            {renderCheckNotesSection()}
          </div>
        )}
      </div>
    </section>
  );
});
