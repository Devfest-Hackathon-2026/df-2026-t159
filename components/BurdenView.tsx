"use client";

/**
 * 警告表示と負担の見える化ビューコンポーネント（Issue 4 / 最終チェック改善）。
 *
 * 役割：「家族で会話するときの、話の論点整理用」。
 * - 誰に負担が寄っているか、どこが空白か、保険の枠の状況など、話し合いの論点をグラフや色分けなどの視覚的な形で一目で分かるようにする。
 * - 文章での説明は最小限に減らす（長い説明文は削るか折りたたむ）。
 * - 表示する数値（負担時間・単位数・空白）は既存の計算結果をそのまま使う。
 */

import {
  ESTIMATE_DISCLAIMER_NOTE,
  formatBudgetSummary,
  formatGaps,
  formatHardViolations,
  formatMemberBurdens,
  formatValidationErrors,
  getWarningsStatus,
} from "@/lib/burden-view";
import type { Person, ValidationResult } from "@/lib/types";

export interface BurdenViewProps {
  validation: ValidationResult;
  people?: Person[];
}

// 負担シェアバー用のカラーパレット
const SHARE_COLORS = [
  { bar: "bg-indigo-500", text: "text-indigo-700", dot: "bg-indigo-500" },
  { bar: "bg-sky-500", text: "text-sky-700", dot: "bg-sky-500" },
  { bar: "bg-emerald-500", text: "text-emerald-700", dot: "bg-emerald-500" },
  { bar: "bg-amber-500", text: "text-amber-700", dot: "bg-amber-500" },
  { bar: "bg-purple-500", text: "text-purple-700", dot: "bg-purple-500" },
  { bar: "bg-rose-500", text: "text-rose-700", dot: "bg-rose-500" },
];

export default function BurdenView({ validation, people }: BurdenViewProps) {
  const status = getWarningsStatus(validation);
  const budget = formatBudgetSummary(validation);
  const gaps = formatGaps(validation.gaps);
  const burden = formatMemberBurdens(
    validation.memberHours,
    validation.overloads,
    people,
  );
  const violations = formatHardViolations(validation.hardViolations);
  const errors = formatValidationErrors(validation.validationErrors);
  const gapsKnown = !validation.validationErrors.some(
    (e) => e.code === "missingCareWindows" || e.code === "incompleteConstraint",
  );

  // 話し合いの論点カウント
  let discussionTopicCount = 0;
  if (burden.hasOverload) discussionTopicCount++;
  if (!gapsKnown || gaps.count > 0) discussionTopicCount++;
  if (budget.hasNullCalculation || budget.isOverLimit) discussionTopicCount++;
  if (violations.length > 0 || errors.length > 0) discussionTopicCount++;

  // 保険枠メーターの計算（上限 27,048 単位）
  const LIMIT_UNITS = 27048;
  const monthlyUnits = validation.monthlyUnits;
  const isOverUnits = validation.overUnits !== null && validation.overUnits > 0;
  const usagePercentage =
    monthlyUnits !== null
      ? Math.min(100, Math.round((monthlyUnits / LIMIT_UNITS) * 100))
      : 0;

  return (
    <div className="space-y-6">
      {/* ── 話し合い論点サマリー（一番上で3秒で状況把握） ── */}
      <section
        aria-label="話し合いの論点まとめ"
        className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-neutral-50 p-5 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100/70 pb-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white text-sm shadow-2xs">
              💬
            </span>
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                家族の話し合い論点シート
              </h2>
              <p className="text-xs text-neutral-500">
                集まったときに話し合いたい重要ポイントの整理です
              </p>
            </div>
          </div>
          <div>
            {status.ok ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                <span>✅</span>
                <span>論点なし（合意しやすい状態です）</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">
                <span>⚠️</span>
                <span>論点 {discussionTopicCount} 点</span>
              </span>
            )}
          </div>
        </div>

        {/* 3大論点のクイックカード */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 論点1: 負担偏り */}
          <div
            className={`rounded-xl border p-3 transition-colors ${
              burden.hasOverload
                ? "border-orange-200 bg-orange-50/70 text-orange-950"
                : "border-neutral-200 bg-white/80 text-neutral-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-neutral-600 flex items-center gap-1">
                <span>①</span> 家族の負担
              </span>
              {burden.hasOverload ? (
                <span className="rounded bg-orange-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  偏りあり
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-emerald-700">
                  ✓ バランス良好
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-extrabold truncate">
              {burden.hasOverload
                ? `${burden.overloadedNames.join("・")}（週20h超）`
                : `合計: ${burden.totalHoursText}`}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-600">
              {burden.hasOverload ? "付き添いの分担を見直す目安" : "極端な偏りはありません"}
            </p>
          </div>

          {/* 論点2: 介護の空白 */}
          <div
            className={`rounded-xl border p-3 transition-colors ${
              !gapsKnown
                ? "border-purple-200 bg-purple-50/70 text-purple-950"
                : gaps.count > 0
                ? "border-sky-200 bg-sky-50/70 text-sky-950"
                : "border-neutral-200 bg-white/80 text-neutral-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-neutral-600 flex items-center gap-1">
                <span>②</span> 介護の空白
              </span>
              {!gapsKnown ? (
                <span className="rounded bg-purple-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  未判定
                </span>
              ) : gaps.count > 0 ? (
                <span className="rounded bg-sky-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  要調整
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-emerald-700">
                  ✓ 空白なし
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-extrabold truncate">
              {!gapsKnown
                ? "空白時間は未判定"
                : gaps.count > 0
                ? `計 ${gaps.totalHours} 時間（${gaps.count}件）`
                : "全時間帯カバー済み"}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-600">
              {!gapsKnown
                ? "介護が必要な時間を確認"
                : gaps.count > 0
                ? "デイやヘルパー等で埋めるか相談"
                : "介護で満たされています"}
            </p>
          </div>

          {/* 論点3: 保険の枠と費用 */}
          <div
            className={`rounded-xl border p-3 transition-colors ${
              budget.hasNullCalculation
                ? "border-purple-200 bg-purple-50/70 text-purple-950"
                : budget.isOverLimit
                ? "border-amber-200 bg-amber-50/70 text-amber-950"
                : "border-neutral-200 bg-white/80 text-neutral-800"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-neutral-600 flex items-center gap-1">
                <span>③</span> 保険の枠・費用
              </span>
              {budget.hasNullCalculation ? (
                <span className="rounded bg-purple-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  未判定
                </span>
              ) : budget.isOverLimit ? (
                <span className="rounded bg-amber-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  枠オーバー
                </span>
              ) : (
                <span className="text-[10px] font-semibold text-emerald-700">
                  ✓ 上限内
                </span>
              )}
            </div>
            <p className="mt-2 text-sm font-extrabold truncate">
              {budget.hasNullCalculation
                ? "費用は未判定"
                : budget.isOverLimit
                ? `超過: +${budget.overUnitsText}`
                : budget.monthlyUnitsText}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-600">
              {budget.hasNullCalculation
                ? "単位数・金額の計算待ち"
                : budget.isOverLimit
                ? `超過分は全額自己負担（${budget.overYenText}）`
                : `自己負担目安: ${budget.selfPayTotalText}`}
            </p>
          </div>
        </div>
      </section>

      {/* ── 論点①：家族ごとの付き添い時間（誰に負担が寄っているか） ── */}
      <section
        role="region"
        aria-label="家族ごとの付き添い時間"
        className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
              <span>👥</span>
              <span>家族の付き添い時間（週あたり）</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              付き添いできる家族全員の予定時間です（週20時間超は負担を見直す目安）。
            </p>
          </div>
          <div className="text-right">
            <span className="text-xs text-neutral-500">家族の付き添い合計: </span>
            <span className="text-base font-bold text-neutral-900">
              {burden.totalHoursText}
            </span>
          </div>
        </div>

        {burden.members.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4 text-center">
            {people?.some((p) => p.canProvideCare)
              ? "付き添い時間は未判定です。"
              : "付き添い可能な家族の結果はありません。"}
          </p>
        ) : (
          <div className="space-y-5">
            {/* 視覚的シェアバー（全体の何割を誰が担っているか一目でわかる） */}
            {burden.totalHours > 0 && (
              <div className="rounded-xl bg-neutral-50 p-3.5 border border-neutral-100 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-neutral-700">負担シェア（誰がどれだけ背負っているか）</span>
                  <span className="text-neutral-500">週 {burden.totalHours} 時間中</span>
                </div>
                {/* 1本のスタックバー */}
                <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200 flex">
                  {burden.members.map((member, idx) => {
                    if (member.hours <= 0) return null;
                    const sharePct = (member.hours / burden.totalHours) * 100;
                    const palette = SHARE_COLORS[idx % SHARE_COLORS.length];
                    const barColor = member.isOverload
                      ? "bg-orange-500"
                      : palette.bar;
                    return (
                      <div
                        key={member.personId}
                        style={{ width: `${sharePct}%` }}
                        className={`${barColor} h-full transition-all`}
                        title={`${member.name}: ${member.hours}時間 (${Math.round(sharePct)}%)`}
                      />
                    );
                  })}
                </div>
                {/* 凡例ピル */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs pt-1">
                  {burden.members.map((member, idx) => {
                    const sharePct =
                      burden.totalHours > 0
                        ? Math.round((member.hours / burden.totalHours) * 100)
                        : 0;
                    const palette = SHARE_COLORS[idx % SHARE_COLORS.length];
                    return (
                      <div
                        key={member.personId}
                        className="flex items-center gap-1.5"
                      >
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-full ${
                            member.isOverload ? "bg-orange-500" : palette.dot
                          }`}
                        />
                        <span className="font-semibold text-neutral-800">
                          {member.name}
                        </span>
                        <span className="text-neutral-500 font-mono">
                          {sharePct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* メンバー別の付き添い時間バーグラフ（20時間基準ラインつき） */}
            <div className="space-y-4">
              {burden.members.map((member) => (
                <div
                  key={member.personId}
                  className={`rounded-xl border p-3.5 space-y-2 transition-colors ${
                    member.isOverload
                      ? "border-orange-200 bg-orange-50/40"
                      : "border-neutral-100 bg-neutral-50/30"
                  }`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-neutral-900">
                        {member.name}
                      </span>
                      {member.isOverload && (
                        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-orange-800 flex items-center gap-1">
                          <span>⚠️</span>
                          <span>負担集中（週20時間超）</span>
                        </span>
                      )}
                    </div>
                    <span
                      className={`font-mono font-bold ${
                        member.isOverload ? "text-orange-700" : "text-neutral-700"
                      }`}
                    >
                      {member.hoursText} / 週
                    </span>
                  </div>

                  {/* バーグラフ（20h目安線つき） */}
                  <div className="relative pt-1 pb-1">
                    <div className="h-4 w-full overflow-hidden rounded-full bg-neutral-100 border border-neutral-200/80">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          member.isOverload
                            ? "bg-gradient-to-r from-orange-400 to-red-500"
                            : "bg-gradient-to-r from-blue-400 to-indigo-500"
                        }`}
                        style={{ width: `${member.barPercentage}%` }}
                        role="progressbar"
                        aria-label={`${member.name}の週の付き添い時間`}
                        aria-valuenow={member.hours}
                        aria-valuemin={0}
                        aria-valuemax={burden.maxHours}
                      />
                    </div>
                    {/* 20時間基準ラインの破線マーク */}
                    {burden.maxHours >= 20 && (
                      <div
                        className="absolute top-0 bottom-0 pointer-events-none flex flex-col items-center"
                        style={{
                          left: `${Math.min(100, (20 / burden.maxHours) * 100)}%`,
                        }}
                      >
                        <div className="w-px h-full border-r border-dashed border-neutral-400" />
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] text-neutral-600 px-0.5">
                    <span>0時間</span>
                    <span className="text-neutral-600 font-semibold">
                      目安20時間
                    </span>
                    <span>{burden.maxHours}時間</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 補足注記（折りたたみ） */}
        <details className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 border border-neutral-100">
          <summary className="font-semibold text-neutral-700 cursor-pointer select-none">
            💡 負担の見える化について（補足）
          </summary>
          <p className="mt-1 text-neutral-500 leading-relaxed">
            家族別に比べるのは付き添い時間のみです。費用は月の総額を表示し、家族別の分担額・請求額は計算しません。週20時間超は負担を見直す目安です。
          </p>
        </details>
      </section>

      {/* ── 論点②：介護が必要な時間の空白（どこが空白か） ── */}
      <section
        aria-label="空白時間一覧"
        className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
              <span>🕒</span>
              <span>介護が必要な時間の空白</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              有効なサービスや家族の付き添いが配置されていない時間帯です
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              !gapsKnown
                ? "bg-purple-100 text-purple-900"
                : gaps.count === 0
                ? "bg-emerald-100 text-emerald-900"
                : "bg-sky-100 text-sky-950"
            }`}
          >
            {gapsKnown
              ? `計 ${gaps.totalHours} 時間（${gaps.count}件）`
              : "未判定"}
          </span>
        </div>

        {!gapsKnown && (
          <p className="text-sm font-semibold text-purple-800 bg-purple-50 p-4 rounded-xl border border-purple-200">
            空白は未判定です。介護が必要な時間と家族の都合を確認してください。
          </p>
        )}

        {gaps.count === 0 && gapsKnown && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-900 flex items-center gap-2.5">
            <span className="text-xl">✅</span>
            <p className="text-sm font-medium">
              介護が必要な時間はすべてサービス・家族の付き添いで埋まっています。
            </p>
          </div>
        )}

        {gaps.count > 0 && gapsKnown && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {gaps.groupedByDay.map((group) => (
              <div
                key={group.day}
                className="rounded-xl border border-sky-200 bg-sky-50/50 p-4 space-y-3 shadow-2xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-sky-600 text-white font-bold text-xs shadow-2xs">
                      {group.dayLabel}
                    </span>
                    <span className="font-bold text-sm text-sky-950">
                      {group.dayLabel}曜日
                    </span>
                  </div>
                  <span className="text-xs font-bold text-sky-800">
                    計 {group.gaps.reduce((acc, g) => acc + g.durationHours, 0)} 時間
                  </span>
                </div>

                <div className="space-y-1.5">
                  {group.gaps.map((g, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-lg bg-white p-2.5 text-xs text-sky-900 border border-sky-100 shadow-2xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sky-500">🕒</span>
                        <span className="font-semibold">
                          {g.dayLabel}曜 {g.timeRangeText}
                        </span>
                      </div>
                      <span className="font-bold text-sky-800">
                        {g.durationHours} 時間
                      </span>
                    </div>
                  ))}
                </div>

                {/* 1日タイムラインの視覚化（6:00〜24:00の18時間） */}
                <div className="space-y-1 pt-1 border-t border-sky-100">
                  <div className="relative h-2.5 w-full rounded-full bg-neutral-200/80 overflow-hidden">
                    {group.gaps.map((g, idx) => {
                      const left = Math.max(0, ((g.startHour - 6) / 18) * 100);
                      const width = Math.min(
                        100 - left,
                        (g.durationHours / 18) * 100,
                      );
                      return (
                        <div
                          key={idx}
                          className="absolute top-0 bottom-0 bg-sky-500 rounded-full"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${g.timeRangeText} (${g.durationHours}時間)`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex justify-between text-[10px] text-neutral-600 px-0.5">
                    <span>6:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>24:00</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 論点③：保険の枠と費用（保険枠の状況） ── */}
      <section
        aria-label="介護保険費用と枠の状況"
        className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 shadow-xs space-y-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-100 pb-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-900 flex items-center gap-2">
              <span>📊</span>
              <span>月の介護費用の目安（要介護3）</span>
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              区分支給限度額（27,048単位）に対する月換算の概算です
            </p>
          </div>
          <div>
            {budget.hasNullCalculation ? (
              <span className="rounded-full bg-purple-100 px-3 py-1 text-xs font-bold text-purple-900">
                ⚠️ 未判定
              </span>
            ) : budget.isOverLimit ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900 flex items-center gap-1">
                <span>⚠️</span>
                <span>上限超過（+{budget.overUnitsText}）</span>
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                ✓ 保険の上限内
              </span>
            )}
          </div>
        </div>

        {/* 視覚的保険枠メーター（プログレスバー） */}
        <div className="rounded-xl bg-neutral-50 p-4 border border-neutral-100 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-neutral-700">保険枠の使用状況</span>
            <span className="font-semibold text-neutral-600 font-mono">
              {monthlyUnits !== null ? `${monthlyUnits.toLocaleString()} / 27,048 単位` : "未判定"}
            </span>
          </div>

          <div className="relative pt-1 pb-1">
            <div className="h-4 w-full overflow-hidden rounded-full bg-neutral-200 border border-neutral-300/80 flex">
              <div
                className={`h-full transition-all duration-500 ${
                  isOverUnits
                    ? "bg-gradient-to-r from-amber-500 to-rose-600"
                    : "bg-gradient-to-r from-sky-400 to-indigo-600"
                }`}
                style={{ width: `${usagePercentage}%` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-neutral-600 px-0.5">
            <span>0単位</span>
            <span className="text-neutral-600 font-semibold">
              上限 27,048単位（要介護3）
            </span>
            <span>{isOverUnits ? "超過あり" : "100%"}</span>
          </div>
        </div>

        {/* 3指標カード */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* 月換算単位 */}
          <div className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-neutral-500">
                月換算単位数（週×30÷7）
              </p>
              <p className="mt-1 text-2xl font-black text-neutral-900">
                {budget.monthlyUnitsText}
              </p>
            </div>
            <p className="mt-2 text-xs text-neutral-500 border-t border-neutral-200/50 pt-2">
              保険の上限:{" "}
              <span className="font-semibold text-neutral-800">
                {budget.limitUnitsText}
              </span>
            </p>
          </div>

          {/* 限度額超過 */}
          <div
            className={`rounded-xl border p-4 flex flex-col justify-between transition-colors ${
              budget.isOverLimit
                ? "border-amber-300 bg-amber-50/80 text-amber-950"
                : "border-neutral-100 bg-neutral-50/70 text-neutral-800"
            }`}
          >
            <div>
              <p className="text-xs font-medium text-neutral-500">
                限度額超過単位
              </p>
              <p
                className={`mt-1 text-2xl font-black ${
                  budget.isOverLimit ? "text-amber-800" : "text-neutral-900"
                }`}
              >
                {budget.overUnitsText}
              </p>
              {budget.isOverLimit && (
                <p className="mt-1 text-xs font-bold text-amber-900">
                  全額自己負担: {budget.overYenText}
                </p>
              )}
            </div>
            <div className="mt-2 border-t border-neutral-200/50 pt-2 text-xs text-neutral-500 space-y-0.5">
              <p>1単位＝10円の目安</p>
              <p>
                {validation.overUnits === null
                  ? "上限内かは未判定です"
                  : budget.isOverLimit
                  ? "超えた分は全額自己負担"
                  : "保険の上限内です"}
              </p>
            </div>
          </div>

          {/* 月次自己負担総額 */}
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:col-span-2 lg:col-span-1 flex flex-col justify-between">
            <div>
              <p className="text-xs font-medium text-indigo-700">
                月の自己負担総額（目安）
              </p>
              <p className="mt-1 text-2xl font-black text-indigo-950 font-mono">
                {budget.selfPayTotalText}
              </p>
            </div>
            <div className="mt-2 border-t border-indigo-100 pt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
              <span>
                枠内負担: <strong>{budget.withinYenText}</strong>
              </span>
              <span>
                超過分: <strong>{budget.overYenText}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* 概算注記 */}
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-3">
          <p className="text-xs text-neutral-600 font-medium">
            {ESTIMATE_DISCLAIMER_NOTE}
          </p>
        </div>
      </section>

      {/* ── 論点④：予定・計算の問題（あれば表示） ── */}
      {(violations.length > 0 || errors.length > 0) && (
        <section
          aria-label="違反とエラー詳細"
          className="rounded-2xl border border-rose-200 bg-rose-50/30 p-5 sm:p-6 shadow-xs space-y-4"
        >
          <div className="flex items-center justify-between border-b border-rose-100 pb-3">
            <h2 className="text-base font-bold text-rose-950 flex items-center gap-2">
              <span>⚠️</span>
              <span>予定・計算の確認事項（{violations.length + errors.length}件）</span>
            </h2>
            <span className="text-xs text-rose-700">
              合意前に修正が必要な内容です
            </span>
          </div>

          {violations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-rose-900">
                予定の置き方の問題（{violations.length}件）
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {violations.map((v, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-rose-100 bg-white p-3 text-xs text-rose-950 shadow-2xs space-y-1"
                  >
                    <p className="font-bold text-rose-900">【{v.title}】</p>
                    <p className="text-rose-800 leading-snug">{v.detail}</p>
                    {v.placementId && (
                      <p className="font-mono text-[10px] text-rose-500">
                        配置ID: {v.placementId}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="space-y-2 pt-2">
              <h3 className="text-xs font-bold text-purple-900">
                計算・判定エラー（{errors.length}件）
              </h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {errors.map((e, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-purple-100 bg-white p-3 text-xs text-purple-950 shadow-2xs space-y-1"
                  >
                    <p className="font-bold text-purple-900">
                      【{e.title}】({e.code})
                    </p>
                    <p className="text-purple-800 leading-snug">{e.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
