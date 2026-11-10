"use client";

/**
 * ケアマネ面談用まとめシートコンポーネント（Issue 11）。
 *
 * 確定スナップショットを読み、確定プラン・家族の希望と制約・負担の分担を
 * 1画面にまとめ、印刷用レイアウト（A4・1〜2枚）で表示する。
 *
 * 仕様：
 * - 画面は /rooms/{roomId}/summary で開ける
 * - 印刷CSS（@media print）で A4・余白・改ページを制御
 * - 金額には概算注記（「30日の月を仮定した概算」「食費・居住費・加算は含まない」）
 * - 確定済みでない（confirmedRevision が一致しない）ときは「未確定」と分かる表示
 * - PDF 生成・ケアマネ側編集機能は行わない
 */

import Link from "next/link";
import { DAYS, HOURS } from "@/lib/board";
import {
  SUMMARY_DISCLAIMER_NOTE,
  formatConstraints,
  formatSummaryBurden,
  isSummaryConfirmed,
} from "@/lib/summary-sheet";
import type { Person, Placement, PlacementKind, SummaryDoc } from "@/lib/types";
import { getServiceMaster, unitsMaster } from "@/lib/units";

const CALENDAR_COLORS: Record<PlacementKind, string> = {
  visit: "bg-sky-100 border-sky-300 text-sky-950",
  daycare: "bg-emerald-100 border-emerald-300 text-emerald-950",
  dayrehab: "bg-fuchsia-200 border-fuchsia-400 text-fuchsia-950",
  shortstay: "bg-violet-100 border-violet-300 text-violet-950",
  family: "bg-amber-100 border-amber-300 text-amber-950",
};

const KIND_DISPLAY_LABELS: Record<PlacementKind, string> = {
  visit: "訪問介護",
  daycare: "通所介護",
  dayrehab: "デイケア",
  shortstay: "ショートステイ",
  family: "家族付き添い",
};

function getPlacementDisplayInfo(
  placement: Placement,
  people: readonly Person[],
): { title: string; timeRange: string } {
  const timeRange = `${placement.startHour}:00〜${placement.endHour}:00`;
  if (placement.kind === "family") {
    const person = people.find((p) => p.id === placement.personId);
    return {
      title: person ? `${person.name}（付き添い）` : "家族の付き添い",
      timeRange,
    };
  }
  const master = placement.serviceId
    ? getServiceMaster(unitsMaster, placement.serviceId)
    : unitsMaster.find((u) => u.kind === placement.kind);
  return {
    title: master?.name ?? KIND_DISPLAY_LABELS[placement.kind] ?? "サービス",
    timeRange,
  };
}

export interface SummarySheetProps {
  roomId: string;
  summary: SummaryDoc | null;
  /** 現在のルームから読むのは確定状態照合用の版番号だけ。 */
  currentRevision: number | null;
  roomName?: string;
}

export default function SummarySheet({
  roomId,
  summary,
  currentRevision,
  roomName,
}: SummarySheetProps) {
  const confirmed = isSummaryConfirmed(summary, currentRevision);

  if (!summary) return <main className="mx-auto max-w-3xl p-6">
    <h1 className="text-2xl font-bold">ケアマネ面談用 まとめシート</h1>
    <p role="status" className="my-4">未確定：確定した内容がありません。週間ボードでプランを確定してください。</p>
    <Link className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700" href={`/rooms/${roomId}/board`}>
      <span>週間ボードで確認する</span>
      <span>→</span>
    </Link>
  </main>;

  // 表示内容は、現在の入力ではなく保存された確定スナップショットだけ。
  const activeSnapshot = summary.snapshot;
  const activeValidation = summary.validation;

  const people = activeSnapshot?.people ?? [];
  const placements = activeSnapshot?.placements ?? [];
  const constraints = activeSnapshot?.constraints ?? [];
  const hopes = activeSnapshot?.hopes ?? [];
  const unknowns = activeSnapshot?.unknowns ?? [];

  const formattedConstraints = formatConstraints(constraints, people);
  const burden = activeValidation
    ? formatSummaryBurden(activeValidation, people)
    : null;

  const handlePrint = () => {
    // Safari でもタップによる操作として扱われるよう、非同期処理を挟まない。
    window.print();
  };

  return (
    <div className="max-sm:px-0 summary-sheet-root mx-auto max-w-4xl px-4 py-8 print:p-0 print:max-w-none">
      {/* 画面用操作バー（印刷時は非表示） */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden border-b border-neutral-200 pb-4">
        <Link
          href={`/rooms/${roomId}/board`}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-5 py-2.5 text-sm font-bold text-neutral-700 shadow-2xs hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
        >
          <span aria-hidden="true">←</span>
          <span>週間ボードで確認する</span>
        </Link>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={handlePrint}
            aria-describedby="summary-print-help"
            className="relative z-10 flex min-h-[44px] min-w-[140px] items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 active:bg-indigo-800 transition-colors touch-manipulation cursor-pointer select-none"
            style={{ touchAction: "manipulation" }}
          >
            <span className="text-base" aria-hidden="true">🖨️</span>
            <span>印刷する</span>
          </button>
          <p id="summary-print-help" className="text-[11px] text-neutral-500">
            ※ 印刷できない場合はブラウザのメニューから印刷してください
          </p>
        </div>
      </div>

      {/* 確定／未確定ステータスバナー */}
      <div className="mb-6">
        {confirmed ? (
          <div
            role="status"
            className="max-sm:flex-wrap max-sm:gap-2 flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-emerald-900 print:border-emerald-700 print:bg-white"
          >
            <div className="max-sm:flex-wrap flex items-center gap-2">
              <span className="font-bold text-emerald-800">✅ 確定済みプラン</span>
              <span className="text-xs text-emerald-700">
                （確定版: {summary?.confirmedRevision}）
              </span>
            </div>
            <span className="text-xs text-emerald-700">ケアマネ面談用</span>
          </div>
        ) : (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 print:border-amber-700 print:bg-white"
          >
            <div className="max-sm:flex-wrap flex items-center gap-2 font-bold text-amber-900">
              <span aria-hidden="true">⚠️</span>
              <span>未確定プラン</span>
            </div>
            <p className="mt-1 text-xs text-amber-800">
              {currentRevision === null
                ? "現在の入力の版が分からないため、確定状態は未判定です。以前に確定した内容を表示しています。"
                : `現在の入力は未確定です（保存時の版: ${summary.confirmedRevision} ／ 現在の版: ${currentRevision}）。以前に確定した内容を表示しています。面談前に週間ボードで確定し直してください。`}
            </p>
            <div className="mt-3 print:hidden">
              <Link
                href={`/rooms/${roomId}/board`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-900 hover:bg-amber-200 transition-colors"
              >
                <span>週間ボードで確認・確定する</span>
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* シート本文（印刷対象） */}
      <article className="max-sm:p-4 sheet-paper rounded-lg border border-neutral-200 bg-white p-8 shadow-sm print:border-none print:p-0 print:shadow-none space-y-6">
        {/* ヘッダー情報 */}
        <header className="border-b-2 border-neutral-900 pb-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-black tracking-tight text-neutral-900">
              ケアマネ面談用 まとめシート
            </h1>
            <div className="text-right text-xs text-neutral-500">
              <p className="font-bold text-neutral-800">{roomName ?? "佐藤家のケア会議"}</p>
              <p>
                状態:{" "}
                <span className={`font-bold ${confirmed ? "text-emerald-700" : "text-amber-700"}`}>
                  {confirmed ? "確定済み" : "現在は未確定（掲載内容は以前の確定版）"}
                </span>
                {`（掲載版: ${summary.confirmedRevision}）`}
              </p>
            </div>
          </div>
          <p className="mt-1 text-xs text-neutral-600">
            ケアマネジャーとの面談用資料です。
          </p>
        </header>

        {/* 1. 家族の希望と制約 */}
        <section className="sheet-section break-inside-avoid">
          <h2 className="text-base font-bold text-neutral-900 border-b border-neutral-300 pb-1.5 flex items-center gap-1.5">
            <span>📋</span>
            <span>1. 家族の希望と事情</span>
          </h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
            {/* 本人の様子・希望 */}
            <div className="rounded border border-neutral-200 p-3 bg-neutral-50/50">
              <h3 className="text-xs font-bold text-neutral-700 mb-1.5">ご本人・家族の希望</h3>
              {hopes.length > 0 ? (
                <ul className="list-disc pl-4 text-xs text-neutral-800 space-y-1">
                  {hopes.map((hope, i) => (
                    <li key={i}>{hope}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-500">登録された希望はありません。</p>
              )}

              {unknowns.length > 0 && (
                <div className="mt-3 border-t border-neutral-200 pt-2">
                  <h4 className="text-[11px] font-bold text-neutral-600 mb-1">検討・確認事項</h4>
                  <ul className="list-disc pl-4 text-xs text-neutral-700 space-y-0.5">
                    {unknowns.map((u, i) => (
                      <li key={i}>{u}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 家族の制約 */}
            <div className="rounded border border-neutral-200 p-3 bg-neutral-50/50">
              <h3 className="text-xs font-bold text-neutral-700 mb-1.5">家族の事情</h3>
              {formattedConstraints.length > 0 ? (
                <ul className="space-y-1.5 text-xs text-neutral-800">
                  {formattedConstraints.map((c, i) => (
                    <li key={i} className="flex flex-col border-b border-neutral-100 pb-1 last:border-none">
                      <div className="max-sm:flex-wrap flex items-center gap-1.5 font-medium">
                        <span className="rounded bg-neutral-200 px-1.5 py-0.2 text-[10px] font-bold text-neutral-700">
                          {c.typeLabel}
                        </span>
                        <span className="font-bold text-neutral-900">{c.personName}</span>
                        <span className="text-neutral-500">[{c.daysText} {c.timeRangeText ?? ""}]</span>
                      </div>
                      <span className="text-neutral-700 text-[11px] mt-0.5">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-500">登録した家族の事情はありません。</p>
              )}
            </div>
          </div>
        </section>

        {/* 2. 確定プラン（週間カレンダー） */}
        <section className="sheet-section schedule-section break-inside-avoid">
          <div className="flex flex-wrap items-baseline justify-between border-b border-neutral-300 pb-1.5 gap-2">
            <h2 className="text-base font-bold text-neutral-900 flex items-center gap-1.5">
              <span>📅</span>
              <span>2. 週間ケアプラン（予定）</span>
            </h2>
            {/* 凡例 */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] print:text-[8px] text-neutral-600">
              {(Object.keys(KIND_DISPLAY_LABELS) as PlacementKind[]).map((kind) => (
                <span
                  key={kind}
                  className={`inline-flex items-center rounded border px-1.5 py-0.2 font-medium ${CALENDAR_COLORS[kind]}`}
                >
                  {KIND_DISPLAY_LABELS[kind]}
                </span>
              ))}
            </div>
          </div>

          <div className="summary-calendar mt-3 overflow-x-auto rounded border border-neutral-300 bg-white">
            <style>{`.summary-calendar-grid { --cal-row-h: 22px; }`}</style>
            <div className="summary-calendar-grid min-w-[620px] text-xs">
              {/* 曜日ヘッダー */}
              <div className="summary-calendar-heading grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-neutral-300 bg-neutral-100 font-bold text-center text-neutral-800">
                <div className="p-1.5 border-r border-neutral-300 text-[11px] print:text-[9px]">時刻</div>
                {DAYS.map((d) => (
                  <div key={d} className="p-1.5 border-r border-neutral-300 last:border-r-0 text-[11px] print:text-[9px]">
                    {d}曜
                  </div>
                ))}
              </div>

              {/* グリッド本体 */}
              <div className="summary-calendar-body grid grid-cols-[48px_repeat(7,minmax(0,1fr))]">
                {/* 時刻軸 */}
                <div className="border-r border-neutral-300 bg-neutral-50/70 font-mono text-[10px] print:text-[8px] text-neutral-500">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      style={{ height: "var(--cal-row-h)" }}
                      className="border-b border-neutral-200 pr-1 text-right leading-none flex items-start justify-end pt-0.5"
                    >
                      {h}:00
                    </div>
                  ))}
                  <div
                    style={{ height: "var(--cal-row-h)" }}
                    className="pr-1 text-right leading-none flex items-start justify-end pt-0.5"
                  >
                    24:00
                  </div>
                </div>

                {/* 曜日ごとの列 */}
                {DAYS.map((_, dayIndex) => {
                  // 保存順に依存せず、スマホの縦積みリストも開始時刻順にする。
                  const dayPlacements = placements.filter((p) => p.day === dayIndex)
                    .sort((a, b) => a.startHour - b.startHour);
                  return (
                    <div
                      key={dayIndex}
                      className="summary-calendar-day relative isolate border-r border-neutral-300 last:border-r-0"
                      style={{ height: "calc(18 * var(--cal-row-h))" }}
                    >
                      {/* 背景セル罫線 */}
                      {HOURS.map((h) => (
                        <div
                          key={h}
                          style={{ height: "var(--cal-row-h)" }}
                          className="summary-calendar-hour border-b border-neutral-200"
                        />
                      ))}

                      {/* 配置ブロック */}
                      {dayPlacements.map((p) => {
                        const info = getPlacementDisplayInfo(p, people);
                        const topCalc = `calc(${p.startHour - 6} * var(--cal-row-h))`;
                        const heightCalc = `calc(${p.endHour - p.startHour} * var(--cal-row-h))`;
                        return (
                          <div
                            key={p.id}
                            className={`summary-calendar-placement absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-[10px] print:text-[8px] leading-tight font-medium shadow-2xs z-10 flex flex-col justify-start ${CALENDAR_COLORS[p.kind]}`}
                            style={{
                              top: topCalc,
                              height: heightCalc,
                              // PCの隣接ブロックの罫線は、元の描画順を保つ。
                              zIndex: placements.indexOf(p) + 10,
                            }}
                            title={`${info.title} ${info.timeRange}${p.note ? ` (${p.note})` : ""}`}
                          >
                            <div className="font-bold truncate">{info.title}</div>
                            <div className="font-mono text-[9px] print:text-[7px] text-neutral-600 truncate">
                              {info.timeRange}
                            </div>
                            {p.note && (
                              <div className="text-[9px] print:text-[7px] text-neutral-500 truncate hidden print:block sm:block">
                                {p.note}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* 3. 負担の分担（家族の付き添い時間と概算費用） */}
        <section className="sheet-section break-inside-avoid">
          <h2 className="text-base font-bold text-neutral-900 border-b border-neutral-300 pb-1.5 flex items-center gap-1.5">
            <span>⚖️</span>
            <span>3. 負担の分担と月次概算費用</span>
          </h2>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
            {/* 家族ごとの付き添い時間 */}
            <div className="rounded border border-neutral-200 p-3 bg-neutral-50/50">
              <h3 className="text-xs font-bold text-neutral-700 mb-2">家族の付き添い時間（週あたり）</h3>
              {burden ? (
                <div className="space-y-2">
                  <table className="w-full text-xs">
                    <tbody>
                      {burden.memberHours.map((m) => (
                        <tr key={m.personId} className="border-b border-neutral-100 last:border-none">
                          <td className="py-1 font-semibold text-neutral-800">{m.name}</td>
                          <td className="py-1 text-right font-mono font-bold text-neutral-900">{m.hoursText} / 週</td>
                        </tr>
                      ))}
                      <tr className="border-t border-neutral-300 font-bold">
                        <td className="py-1.5 text-neutral-900">付き添い合計</td>
                        <td className="py-1.5 text-right font-mono text-neutral-900">{burden.totalCareHoursText} / 週</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">集計データがありません。</p>
              )}
            </div>

            {/* 介護保険費用（月次概算） */}
            <div className="rounded border border-neutral-200 p-3 bg-neutral-50/50">
              <h3 className="text-xs font-bold text-neutral-700 mb-2">介護費用の月次概算（要介護3）</h3>
              {burden ? (
                <div className="space-y-2">
                  <table className="w-full text-xs">
                    <tbody>
                      <tr className="border-b border-neutral-100">
                        <td className="py-1 text-neutral-600">月換算単位数（限度額: {burden.limitUnitsText}）</td>
                        <td className="py-1 text-right font-mono font-bold text-neutral-900">{burden.monthlyUnitsText}</td>
                      </tr>
                      {burden.isOverLimit && (
                        <tr className="border-b border-neutral-100 text-amber-800 font-semibold">
                          <td className="py-1">限度額超過単位（全額負担）</td>
                          <td className="py-1 text-right font-mono">{burden.overUnitsText}</td>
                        </tr>
                      )}
                      <tr className="border-b border-neutral-100">
                        <td className="py-1 text-neutral-600">内訳（枠内自己負担 / 枠外自己負担）</td>
                        <td className="py-1 text-right font-mono text-[11px] text-neutral-700">
                          {burden.withinYenText} / {burden.overYenText}
                        </td>
                      </tr>
                      <tr className="border-t border-neutral-300 font-bold text-sm">
                        <td className="py-1.5 text-neutral-900">自己負担総額（月額概算）</td>
                        <td className="py-1.5 text-right font-mono text-indigo-900">{burden.selfPayTotalText}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">費用データがありません。</p>
              )}
            </div>
          </div>

          {/* 概算注記（必須表示） */}
          <div className="mt-3 rounded border border-neutral-200 bg-neutral-50 p-2.5 text-neutral-600 text-[11px] leading-relaxed">
            <p className="font-medium">{SUMMARY_DISCLAIMER_NOTE}</p>
          </div>
        </section>
      </article>

      {/* 画面下部の誘導ボタン（印刷時は非表示） */}
      <div className="mt-8 flex justify-center print:hidden">
        <Link
          href={`/rooms/${roomId}/board`}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-neutral-300 bg-white px-6 py-2.5 text-sm font-bold text-neutral-700 shadow-xs hover:bg-neutral-50 active:bg-neutral-100 transition-colors"
        >
          <span aria-hidden="true">←</span>
          <span>週間ボードで確認する</span>
        </Link>
      </div>

      {/* 印刷用CSS（A4 1〜2枚に収めるスタイル） */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 12mm 15mm;
        }

        @media print {
          body {
            background: white !important;
            color: black !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          .print\\:hidden {
            display: none !important;
          }

          .summary-sheet-root {
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .sheet-paper {
            border: none !important;
            box-shadow: none !important;
            padding: 0 !important;
          }

          .sheet-paper > header {
            padding-bottom: 8px !important;
          }

          .sheet-paper > .sheet-section {
            margin-block: 12px 0 !important;
          }

          .sheet-section {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          /* カレンダー全体を一枚に保ち、短い配置も時刻・注記まで収める。 */
          .summary-calendar {
            overflow: visible !important;
          }

          .summary-calendar-grid {
            min-width: 0 !important;
            width: 100% !important;
            --cal-row-h: 32px;
          }

          .summary-calendar-grid [title] {
            padding: 0 2px !important;
            box-shadow: none !important;
          }

          .summary-calendar-grid [title] > div {
            font-size: 8px !important;
            line-height: 10px !important;
          }
          .sheet-section h2 { break-after: avoid; }
          tr { break-inside: avoid; page-break-inside: avoid; }

          table {
            border-collapse: collapse !important;
          }

          .sheet-paper td:last-child {
            white-space: nowrap;
          }
        }
      `}</style>
    </div>
  );
}
