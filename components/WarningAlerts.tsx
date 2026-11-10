"use client";

/**
 * 検証結果の警告・エラー表示部品（Issue 4）。
 *
 * 入力は ValidationResult のみ（検証計算そのものはしない）。
 * ボード画面への組み込みや負担ビューでの共通警告表示として利用する。
 *
 * 表示項目：
 * - 枠オーバー（月換算の超過単位と金額、自己負担の内訳＝枠内分／超過分、総額）
 * - 空白時間（careWindows 内の無配置時間の一覧）
 * - hardViolations（対応不可時間重複、重なり、介護不可者配置などの違反）
 * - validationErrors（「計算できなかった項目があります」と分かる表示）
 * - 負担過多（週20時間超の付き添い）
 * - 金額近くの概算注記（null の項目は「算出不可」と表示）
 */

import {
  formatBudgetSummary,
  formatGaps,
  formatHardViolations,
  formatMemberBurdens,
  formatValidationErrors,
  getWarningsStatus,
} from "@/lib/burden-view";
import type { Person, ValidationResult } from "@/lib/types";
import { SceneColumnNotice } from "./SceneColumn";

export interface WarningAlertsProps {
  validation: ValidationResult;
  people?: Person[];
  /** コンパクト表示モード（ボード上部など向け） */
  compact?: boolean;
}

export default function WarningAlerts({
  validation,
  people,
  compact = false,
}: WarningAlertsProps) {
  const status = getWarningsStatus(validation);
  const budget = formatBudgetSummary(validation);
  const gaps = formatGaps(validation.gaps);
  const violations = formatHardViolations(validation.hardViolations);
  const errors = formatValidationErrors(validation.validationErrors);
  const burden = formatMemberBurdens(
    validation.memberHours,
    validation.overloads,
    people,
  );

  if (status.ok) {
    return (
      <div
        role="status"
        className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900"
      >
        <div className="flex items-center gap-2 font-semibold">
          <span aria-hidden="true">✅</span>
          <span>対応ルール内で検証済み</span>
        </div>
        <p className="mt-1 text-xs text-emerald-700">
          枠オーバー・空白時間・負担集中・配置ルールの違反はありません。
        </p>
        <p className="mt-1 text-xs">医療面での適切さやサービスの予約は保証しません。</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" role="region" aria-label="プランの警告一覧">
      {budget.hasNullCalculation && <div role="status" className="rounded-lg border border-purple-300 bg-purple-50 p-4 text-sm">
        <p className="font-semibold">単位数・費用に未判定の項目があります</p>
        <p>月換算：{budget.monthlyUnitsText} ／ 超過単位：{budget.overUnitsText}</p>
        <p>自己負担：{budget.selfPayTotalText}（枠内：{budget.withinYenText} ／ 超過分：{budget.overYenText}）</p>
        <p className="mt-1 text-xs">{budget.disclaimerNote}</p>
      </div>}
      {/* 枠オーバー警告 */}
      {status.isOverLimit && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
        >
          <div className="flex items-center gap-2 font-semibold text-amber-900">
            <span aria-hidden="true">⚠️</span>
            <span>保険の上限を超えています</span>
          </div>
          <div className="mt-2 text-sm space-y-1">
            <p>
              限度額超過：
              <span className="font-bold text-amber-900">
                {budget.overUnitsText}
              </span>
              （全額自己負担：
              <span className="font-bold text-amber-900">
                {budget.overYenText}
              </span>
              ）
            </p>
            <p className="text-xs text-amber-800">
              月換算：{budget.monthlyUnitsText} ／ 上限：
              {budget.limitUnitsText}（1単位＝10円の目安）
            </p>
            <p className="text-xs text-amber-800">
              月の自己負担（目安）：
              <span className="font-bold">{budget.selfPayTotalText}</span>
              （枠内：{budget.withinYenText} ＋ 超過分：{budget.overYenText}）
            </p>
            <p className="mt-2 text-[11px] text-amber-700">
              {budget.disclaimerNote}
            </p>
          </div>
          <SceneColumnNotice sceneId="overLimit" validation={validation} className="mt-3" />
        </div>
      )}

      {/* 空白時間警告 */}
      {status.hasGaps && (
        <div
          role="alert"
          className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-blue-950"
        >
          <div className="flex items-center gap-2 font-semibold text-blue-900">
            <span aria-hidden="true">🕒</span>
            <span>介護が必要な時間の空白（計 {gaps.totalHours} 時間）</span>
          </div>
          <p className="mt-1 text-xs text-blue-800">
            有効なサービス・家族の付き添いがない時間です。
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {gaps.items.map((g, idx) => (
              <li key={`${g.day}-${g.startHour}-${idx}`} className="font-medium text-blue-900">
                ・{g.label}
              </li>
            ))}
          </ul>
          <SceneColumnNotice sceneId="careGap" validation={validation} className="mt-3" />
        </div>
      )}

      {/* 負担集中（過労）警告 */}
      {status.hasOverload && (
        <div
          role="alert"
          className="rounded-lg border border-orange-300 bg-orange-50 p-4 text-orange-950"
        >
          <div className="flex items-center gap-2 font-semibold text-orange-900">
            <span aria-hidden="true">🏃</span>
            <span>付き添いの負担が集中しています</span>
          </div>
          <p className="mt-1 text-xs text-orange-800">
            週20時間超は、負担を見直す目安です。
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {burden.members
              .filter((m) => m.isOverload)
              .map((m) => (
                <li key={m.personId} className="font-bold text-orange-900">
                  ・{m.name}：週 {m.hoursText}（目安20時間超）
                </li>
              ))}
          </ul>
          <SceneColumnNotice sceneId="caregiverOverload" validation={validation} className="mt-3" />
        </div>
      )}

      {/* hardViolations 警告 */}
      {status.hasHardViolations && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-950"
        >
          <div className="flex items-center gap-2 font-semibold text-red-900">
            <span aria-hidden="true">🚫</span>
            <span>予定の置き方を確認してください（{violations.length}件）</span>
          </div>
          <p className="mt-1 text-xs text-red-700">
            ルールに合わない予定は、有効な介護に数えられません。
          </p>
          <ul className="mt-2 space-y-1.5 text-xs">
            {violations.map((v, idx) => (
              <li key={`${v.type}-${idx}`} className="rounded bg-white/70 p-2">
                <span className="font-bold text-red-800">[{v.title}]</span>{" "}
                <span className="text-red-900">{v.detail}</span>
              </li>
            ))}
          </ul>
          <SceneColumnNotice sceneId="hardViolation" validation={validation} className="mt-3" />
        </div>
      )}

      {/* validationErrors 警告 */}
      {status.hasValidationErrors && (
        <div
          role="alert"
          className="rounded-lg border border-purple-300 bg-purple-50 p-4 text-purple-950"
        >
          <div className="flex items-center gap-2 font-semibold text-purple-900">
            <span aria-hidden="true">⚠️</span>
            <span>計算・判定できない項目があります（{errors.length}件）</span>
          </div>
          <p className="mt-1 text-xs text-purple-800">
            設定や入力が不足し、一部の単位数・金額を計算できません。
          </p>
          <ul className="mt-2 space-y-1.5 text-xs">
            {errors.map((e, idx) => (
              <li key={`${e.code}-${idx}`} className="rounded bg-white/70 p-2">
                <span className="font-bold text-purple-900">[{e.title}]</span>{" "}
                <span className="text-purple-800">{e.reason}</span>
              </li>
            ))}
          </ul>
          <SceneColumnNotice sceneId="validationUnavailable" validation={validation} className="mt-3" />
        </div>
      )}
      <p className="text-xs text-neutral-600">医療面での適切さやサービスの予約は保証しません。</p>
    </div>
  );
}
