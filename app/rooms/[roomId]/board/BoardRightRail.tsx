"use client";

import Link from "next/link";
import ValidationGroups, { type ValidationGroup } from "@/components/ValidationGroups";
import React, { useState } from "react";
import { getCheckNoteItems } from "@/lib/check-notes";
import {
  formatBudgetSummary,
  formatGaps,
  formatHardViolations,
  formatMemberBurdens,
  formatValidationErrors,
  getWarningsStatus,
} from "@/lib/burden-view";
import type { CopayRate, Person, RoomSnapshot, ValidationResult } from "@/lib/types";

interface BoardRightRailProps {
  roomId: string;
  snapshot: RoomSnapshot;
  validation: ValidationResult | null;
  validationRevision?: number;
  people: Person[];
  onOpenProposals?: () => void;
}

interface IssueItem {
  group: ValidationGroup;
  id: string;
  severity: number;
  badge: string;
  title: string;
  detail: string;
  hint: string;
  accentClass: string;
}

export default React.memo(function BoardRightRail({
  roomId,
  snapshot,
  validation,
  validationRevision,
  people,
  onOpenProposals,
}: BoardRightRailProps) {
  // 1割/2割/3割のシミュレーション切り替え（初期値は snapshot.copayRate）
  const [selectedCopay, setSelectedCopay] = useState<CopayRate>(
    snapshot.copayRate ?? 1,
  );
  // 検証結果の詳細表示トグル（初期表示は要約のみ）
  const [showValidationDetails, setShowValidationDetails] = useState(false);
  // 面談での確認事項の詳細表示トグル（初期表示は折りたたみ）
  const [showCheckNotes, setShowCheckNotes] = useState(false);
  const proposalButtonClass = "group block w-full rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 p-3 text-white shadow-xs transition-all hover:shadow-md hover:from-purple-700 hover:to-purple-800 text-center";
  const proposalButtonContents = <>
    <div className="flex items-center justify-center gap-1.5 font-bold text-xs">
      <span>✨ 代替案を見る</span><span className="transition-transform group-hover:translate-x-1">→</span>
    </div>
    <p className="mt-0.5 text-[10px] text-purple-100 font-medium">AIの提案（数字は計算で確認済み）</p>
  </>;

  const budget = validation ? formatBudgetSummary(validation) : null;
  const status = validation ? getWarningsStatus(validation) : null;
  const gaps = validation ? formatGaps(validation.gaps) : null;
  const violations = validation ? formatHardViolations(validation.hardViolations) : [];
  const errors = validation ? formatValidationErrors(validation.validationErrors) : [];
  const burden = validation
    ? formatMemberBurdens(validation.memberHours, validation.overloads, people)
    : null;

  // 注記アイテムの抽出
  const checkNotes = getCheckNoteItems(snapshot.placements);

  // 1割/2割/3割シミュレーション計算
  const monthlyUnits = validation?.monthlyUnits ?? null;
  const limitUnits = validation?.limitUnits ?? 27048;
  const overUnits = validation?.overUnits ?? (monthlyUnits !== null && monthlyUnits > limitUnits ? monthlyUnits - limitUnits : 0);
  const withinUnits = monthlyUnits !== null ? Math.min(monthlyUnits, limitUnits) : null;

  const simWithinYen = withinUnits !== null ? Math.floor((withinUnits * 10 * selectedCopay) / 10) : null;
  const simOverYen = overUnits !== null ? overUnits * 10 : null;
  const simTotalYen = simWithinYen !== null && simOverYen !== null ? simWithinYen + simOverYen : null;

  // 上限に対するバーの割合（最大100%＋超過表示）
  const usagePercent = monthlyUnits !== null && limitUnits > 0
    ? Math.min(100, Math.round((monthlyUnits / limitUnits) * 100))
    : 0;
  const isOverLimit = monthlyUnits !== null && monthlyUnits > limitUnits;

  // 問題一覧の収集（重要度順）
  const issues: IssueItem[] = [];

  // 1. hardViolations（対応不可などの重大違反）
  for (let idx = 0; idx < violations.length; idx++) {
    const v = violations[idx];
    issues.push({
      id: `hard-${v.type}-${v.placementId ?? idx}`,
      group: "hardViolation",
      severity: 1,
      badge: "🚫 重大な問題",
      title: v.title,
      detail: v.detail,
      hint: "家族が対応できる曜日・時間に予定を変えてください。",
      accentClass: "border-rose-600 bg-rose-50/80 text-rose-950",
    });
  }

  // 2. 枠オーバー
  if (status?.isOverLimit) {
    issues.push({
      id: "overLimit",
      group: "overLimit",
      severity: 2,
      badge: "⚠️ 枠超過",
      title: `保険の上限超過（+${overUnits.toLocaleString()}単位）`,
      detail: `上限を ${budget?.overUnitsText} 超過。超過分（${budget?.overYenText}）は全額自己負担です。`,
      hint: "訪問介護・デイサービスの回数を減らす、家族が付き添う、自己負担で続ける方法を検討しましょう。",
      accentClass: "border-amber-500 bg-amber-50/80 text-amber-950",
    });
  }

  // 3. 空白時間
  if (status?.hasGaps && gaps) {
    issues.push({
      id: "gaps",
      group: "careGap",
      severity: 3,
      badge: "🕒 空白時間",
      title: `介護が必要な時間の空白（計 ${gaps.totalHours} 時間）`,
      detail: `有効なサービス・付き添いがない時間：${gaps.items.map(g => g.label).join("、")}`,
      hint: "空白の時間にデイサービス・訪問介護や家族の付き添いを追加してください。",
      accentClass: "border-red-500 bg-red-50/80 text-red-950",
    });
  }

  // 4. 負担集中
  if (status?.hasOverload && burden) {
    issues.push({
      id: "overload",
      group: "caregiverOverload",
      severity: 4,
      badge: "🏃 負担集中",
      title: `負担が集中（${burden.overloadedNames.join("・")}）`,
      detail: `${burden.overloadedNames.join("・")}の付き添いが週20時間超です（負担を見直す目安）。`,
      hint: "週20時間を超える付き添いは、他の家族や介護サービスと分担しましょう。",
      accentClass: "border-orange-500 bg-orange-50/80 text-orange-950",
    });
  }

  // 5. validationErrors
  for (const e of errors) {
    const hint = e.code === "unsupportedBand"
      ? "通所介護・通所リハビリは3時間以上など、利用可能な時間区分に合わせて予定の長さを変更してください。"
      : "入力画面で家族の都合と介護が必要な時間帯を確認してください。";
    issues.push({
      id: `err-${e.code}-${e.placementId ?? ""}`,
      group: "validationUnavailable",
      severity: 1.5,
      badge: "❓ 未判定・不備",
      title: e.title,
      detail: e.reason,
      hint,
      accentClass: "border-purple-500 bg-purple-50/80 text-purple-950",
    });
  }

  // 重大度順にソート（初期表示の上位2件に重大な問題や未判定が優先して表示されるようにする）
  issues.sort((a, b) => a.severity - b.severity);

  const issueCount = issues.length;

  return (
    <aside aria-label="プランの検証と負担" className="w-full shrink-0 space-y-4 lg:w-72 xl:w-80">
      {/* 1. 介護保険の枠カード */}
      <section aria-label="介護保険の枠" className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
          <h2 className="font-bold text-neutral-900 flex items-center gap-1 text-xs">
            <span>📊</span> 介護保険の枠
          </h2>
          <span className="text-[10px] font-medium text-neutral-500">要介護3（上限27,048単位）</span>
        </div>

        <div className="mt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] text-neutral-600">月換算単位数</span>
            <div className="text-right">
              <span className="text-lg font-extrabold text-neutral-900">
                {budget ? budget.monthlyUnitsText : "未判定"}
              </span>
              <span className="text-[10px] text-neutral-500 ml-1">/ 27,048単位</span>
            </div>
          </div>

          {/* プログレスバー */}
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100 p-0.5 border border-neutral-200">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isOverLimit
                  ? "bg-gradient-to-r from-amber-500 to-red-600"
                  : "bg-gradient-to-r from-sky-400 to-indigo-600"
              }`}
              style={{ width: `${Math.min(100, usagePercent)}%` }}
            />
          </div>

          {/* 超過分の表示 */}
          {monthlyUnits === null || (validation && validation.validationErrors.length > 0) ? (
            <p className="mt-1 text-right text-[10px] text-amber-700 font-semibold">
              ⚠️ 単位数・自己負担は未判定
            </p>
          ) : isOverLimit ? (
            <p className="mt-1.5 rounded bg-red-50 px-2 py-0.5 text-[11px] font-bold text-red-700 flex items-center justify-between">
              <span>⚠️ 保険の上限を超過</span>
              <span>+{overUnits.toLocaleString()} 単位</span>
            </p>
          ) : (
            <p className="mt-1 text-right text-[10px] text-emerald-700">
              {validation ? "✓ 保険の上限内です" : "確認中…"}
            </p>
          )}
          {monthlyUnits === null && errors.length > 0 && (
            <p className="mt-0.5 text-right text-[10px] text-amber-600">
              ※ {errors[0].title}
            </p>
          )}
          <p className="mt-1 text-[10px] text-neutral-500">1単位＝10円の目安</p>

          {/* 自己負担の内訳と割合切り替え */}
          <div className="mt-2.5 rounded-lg bg-neutral-50 p-2.5 border border-neutral-100">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-neutral-700">自己負担割合</span>
              <div className="flex gap-1" role="group" aria-label="自己負担割合切替">
                {([1, 2, 3] as CopayRate[]).map(rate => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setSelectedCopay(rate)}
                    className={`max-sm:min-w-11 rounded px-1.5 py-0.2 text-[10px] font-bold transition-all ${
                      selectedCopay === rate
                        ? "bg-indigo-600 text-white shadow-2xs"
                        : "bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-100"
                    }`}
                  >
                    {rate}割
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between text-neutral-600">
                <span>枠内分（{selectedCopay}割）:</span>
                <span className="font-semibold text-neutral-800">
                  {simWithinYen !== null ? `${simWithinYen.toLocaleString()} 円` : "未判定"}
                </span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span className={isOverLimit ? "font-medium text-red-700" : ""}>
                  超過分（全額負担）:
                </span>
                <span className={`font-semibold ${isOverLimit ? "text-red-700" : "text-neutral-800"}`}>
                  {simOverYen !== null ? `${simOverYen.toLocaleString()} 円` : "0 円"}
                </span>
              </div>
              <div className="border-t border-neutral-200 pt-1 flex justify-between items-baseline">
                <span className="font-bold text-neutral-900 text-xs">月の自己負担（目安）:</span>
                <span className="text-sm font-extrabold text-indigo-900">
                  {simTotalYen !== null ? `${simTotalYen.toLocaleString()} 円` : "未判定"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 代替案を見るボタン */}
      <section aria-label="AI代替案への導線">
        {onOpenProposals
          ? <button type="button" className={proposalButtonClass} onClick={onOpenProposals}>{proposalButtonContents}</button>
          : <Link href={`/rooms/${roomId}/proposals`} className={proposalButtonClass}>{proposalButtonContents}</Link>}
      </section>

      {/* 3. 警告・確認事項（初期表示は件数と見出し1〜2件のみ、詳しく見るで全文＋解消のヒント） */}
      <section aria-label="警告一覧" data-testid={validationRevision === undefined ? undefined : "validation-revision"} data-revision={validationRevision} className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm space-y-2">
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
          <h2 className="text-xs font-bold text-neutral-800 flex items-center gap-1.5">
            <span>⚠️</span> 警告・確認事項
          </h2>
          {validation && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                issueCount > 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"
              }`}
            >
              {issueCount > 0 ? `問題 ${issueCount}件` : "問題なし"}
            </span>
          )}
        </div>

        {!validation ? (
          <div className="rounded-lg border-l-4 border-neutral-300 bg-neutral-50 p-2 text-xs text-neutral-600">
            確認中、または未判定です。
          </div>
        ) : (
          <div className="space-y-3">
            {/* 1. 問題・解消のヒント（問題0件時は「問題なし」表示のみで開閉トグルは出さない） */}
            {issueCount === 0 ? (
              <div className="rounded-lg border-l-4 border-emerald-500 bg-emerald-50 p-2.5 text-xs text-emerald-900">
                <p className="font-bold">✅ 対応ルール内で検証済み</p>
                <p className="mt-0.5 text-[11px] text-emerald-700">枠オーバー・空白・負担集中などの警告はありません。</p>
              </div>
            ) : (
              <div>
                {/* 初期表示：一番重い問題の見出し1〜2件のみ */}
                {!showValidationDetails ? (
                  <div className="space-y-1.5">
                    {issues.slice(0, 2).map(issue => (
                      <div
                        key={issue.id}
                        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 text-xs"
                      >
                        <span className="font-bold text-neutral-800 truncate">{issue.title}</span>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setShowValidationDetails(true)}
                      className="mt-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
                    >
                      <span>詳しく見る・解消のヒント（全{issueCount}件）</span>
                      <span>▼</span>
                    </button>
                  </div>
                ) : (
                  /* 詳しく見る展開時：個別の問題の説明と「解消のヒント」全文 */
                  <div className="space-y-2 mt-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => setShowValidationDetails(false)}
                        className="text-xs font-semibold text-neutral-500 hover:text-neutral-800"
                      >
                        閉じる ▲
                      </button>
                    </div>

                    <ValidationGroups
                      issues={issues}
                      renderIssues={items => (
                        <div className="space-y-2">
                          {items.map((issue, index) => (
                            <div
                              key={`${issue.id}-${index}`}
                              className={`rounded-lg border-l-4 p-2.5 text-xs shadow-2xs ${issue.accentClass}`}
                            >
                              <p className="font-bold flex items-center justify-between">
                                <span>{issue.title}</span>
                                <span className="text-[10px] opacity-75">{issue.badge}</span>
                              </p>
                              <p className="mt-1 leading-relaxed text-[11px]">{issue.detail}</p>
                              <div className="mt-2 rounded bg-white/80 p-2 border border-black/5 text-[11px] leading-snug">
                                <span className="font-bold text-neutral-900">💡 解消のヒント: </span>
                                <span>{issue.hint}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    />

                    <div className="mt-3 pt-2 border-t border-neutral-100 text-[10px] text-neutral-500 space-y-0.5">
                      <p>※ 30日の月で計算した目安で、実際の請求額ではありません。食費・居住費・各種加算は含みません。上限を超えた分は全額自己負担です。</p>
                      <p>※ 医療面での適切さやサービスの予約は保証しません。</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. 面談での確認事項（独立した開閉表示） */}
            {checkNotes.length > 0 && (
              <div className="pt-2 border-t border-neutral-100">
                {!showCheckNotes ? (
                  <button
                    type="button"
                    onClick={() => setShowCheckNotes(true)}
                    className="text-xs font-bold text-teal-700 hover:text-teal-900 hover:underline flex items-center gap-1"
                  >
                    <span>面談での確認事項を見る（{checkNotes.length}件）</span>
                    <span>▼</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-teal-900 flex items-center gap-1">
                        <span>ℹ️</span> 面談での確認事項（{checkNotes.length}件）
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowCheckNotes(false)}
                        className="text-xs font-semibold text-neutral-500 hover:text-neutral-800"
                      >
                        閉じる ▲
                      </button>
                    </div>

                    {checkNotes.map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg border-l-4 border-teal-500 bg-teal-50/80 p-2.5 text-xs text-teal-950 shadow-2xs"
                      >
                        <p className="font-bold flex items-center gap-1">
                          <span>ℹ️</span> {item.title}
                        </p>
                        <p className="mt-1 leading-relaxed text-[11px] text-teal-900">{item.text}</p>
                        <p className="mt-1 text-[10px] text-teal-700">※ 面談での確認事項です。プランの確定には影響しません。</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4. 家族の負担（1行要約＋過労警告色＋負担ビューへのリンク） */}
      <section
        role="region"
        aria-label="家族ごとの付き添い時間"
        className="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-2">
          <h2 className="font-bold text-neutral-900 text-xs flex items-center gap-1.5">
            <span>👥</span> 家族の負担
          </h2>
          <span className="text-[11px] font-semibold text-neutral-600">
            合計: {burden ? burden.totalHoursText : "未判定"}
          </span>
        </div>

        {!burden || burden.members.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">付き添い可能な家族の集計はありません。</p>
        ) : (
          <div className="mt-2 space-y-1.5 text-xs">
            {burden.members.map(member => {
              const person = people.find(p => p.id === member.personId);
              const memberIcon = person?.icon?.trim() || "👤";
              return (
                <div
                  key={member.personId}
                  className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 transition-colors ${
                    member.isOverload
                      ? "bg-red-50 text-red-950 border border-red-200 font-bold"
                      : "bg-neutral-50 text-neutral-800"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm ${member.isOverload ? "text-red-600" : "text-neutral-500"}`}>
                      {member.isOverload ? "⚠️" : memberIcon}
                    </span>
                    <span>{member.name}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-mono ${
                        member.isOverload ? "text-red-700 font-extrabold" : "text-neutral-700 font-semibold"
                      }`}
                    >
                      {member.hours}時間／週
                    </span>
                    {member.isOverload && (
                      <span className="rounded bg-red-600 px-1 py-0.2 text-[10px] font-bold text-white">
                        過労警告
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="pt-2 border-t border-neutral-100 flex justify-between items-center text-xs">
              <span className="text-[10px] text-neutral-500">※ 週20時間超は過労目安</span>
              <Link
                href={`/rooms/${roomId}/burden`}
                className="max-sm:min-h-11 font-bold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1 text-[11px]"
              >
                <span>負担ビューで詳しく見る</span>
                <span>→</span>
              </Link>
            </div>
          </div>
        )}
      </section>
    </aside>
  );
});
