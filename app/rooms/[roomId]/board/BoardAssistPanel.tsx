"use client";

import React, { useMemo, useState } from "react";
import { DAYS } from "@/lib/board";
import { subtractCoverage } from "@/lib/validation";
import type { CareWindow, Constraint, ConstraintType, Gap, RoomSnapshot } from "@/lib/types";

const CONSTRAINT_TYPE_LABELS: Record<ConstraintType, string> = {
  unavailable: "対応不可",
  hope: "希望",
  other: "その他",
};

function isTimelessHope(constraint: Constraint): boolean {
  return (
    constraint.type === "hope" &&
    (constraint.startHour === undefined || constraint.endHour === undefined)
  );
}

function constraintSchedule(constraint: Constraint): string {
  const days = constraint.days.map(day => DAYS[day]).join("・");
  return constraint.startHour !== undefined && constraint.endHour !== undefined
    ? `${days} ${constraint.startHour}:00–${constraint.endHour}:00`
    : `${days}（時刻指定なし）`;
}

function formatUncoveredSummary(gaps: Gap[]): string {
  if (gaps.length === 0) {
    return "すべて埋まっています";
  }
  if (gaps.length === 1) {
    const g = gaps[0];
    return `まだ空いているのは ${DAYS[g.day]}曜 ${g.startHour}:00–${g.endHour}:00 だけ`;
  }
  const items = gaps.map(g => `${DAYS[g.day]}曜 ${g.startHour}:00–${g.endHour}:00`).join("、");
  return `まだ空いている時間帯が ${gaps.length}件あります（${items}）`;
}

export interface BoardAssistPanelProps {
  snapshot: RoomSnapshot;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: (nextOpen: boolean) => void;
}

/**
 * 配置しながら見られる、整理済み入力の読み取り専用パネル（配置補助）。
 * 左側に配置し、予定を入れながら参照できる。隠す・表示を切り替え可能。
 */
export default React.memo(function BoardAssistPanel({
  snapshot,
  defaultOpen = false,
  isOpen: controlledOpen,
  onToggle,
}: BoardAssistPanelProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    setInternalOpen(next);
    onToggle?.(next);
  };

  const covers = useMemo<CareWindow[]>(() => {
    return snapshot.placements
      .filter(p => p && typeof p.id === "string" && p.day >= 0 && p.day <= 6 && p.startHour >= 6 && p.endHour <= 24 && p.startHour < p.endHour)
      .map(p => ({ day: p.day, startHour: p.startHour, endHour: p.endHour }));
  }, [snapshot.placements]);

  const groupedCareWindows = useMemo(() => {
    const sorted = [...snapshot.careWindows].sort(
      (a, b) => a.day - b.day || a.startHour - b.startHour,
    );
    const map = new Map<number, CareWindow[]>();
    for (const w of sorted) {
      const list = map.get(w.day) ?? [];
      list.push(w);
      map.set(w.day, list);
    }
    return Array.from(map.entries()).map(([day, windows]) => ({ day, windows }));
  }, [snapshot.careWindows]);

  const { fullyCoveredDays, uncoveredDayGroups } = useMemo(() => {
    const fully: number[] = [];
    const uncovered: { day: number; windows: CareWindow[] }[] = [];

    for (const group of groupedCareWindows) {
      const hasGap = group.windows.some(w => subtractCoverage(w, covers).length > 0);
      if (hasGap) {
        uncovered.push(group);
      } else {
        fully.push(group.day);
      }
    }

    return { fullyCoveredDays: fully, uncoveredDayGroups: uncovered };
  }, [groupedCareWindows, covers]);

  const visibleConstraints = useMemo(() => {
    return snapshot.constraints.filter(c => !isTimelessHope(c));
  }, [snapshot.constraints]);

  const mergedHopes = useMemo(() => {
    const list: string[] = [];
    for (const c of snapshot.constraints) {
      if (isTimelessHope(c)) {
        const person = snapshot.people.find(p => p.id === c.personId);
        const personName = person?.name ?? c.personId;
        list.push(`${personName}：${c.detail}`);
      }
    }
    for (const hope of snapshot.hopes) {
      list.push(hope);
    }
    return list;
  }, [snapshot.constraints, snapshot.people, snapshot.hopes]);

  const allGaps = useMemo<Gap[]>(() => {
    const sorted = [...snapshot.careWindows].sort(
      (a, b) => a.day - b.day || a.startHour - b.startHour,
    );
    return sorted.flatMap(w => subtractCoverage(w, covers));
  }, [snapshot.careWindows, covers]);

  const uncoveredSummary = useMemo(() => formatUncoveredSummary(allGaps), [allGaps]);

  return (
    <aside
      aria-label="整理した内容"
      className="w-full shrink-0 rounded-xl border border-neutral-200 bg-white p-3.5 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="font-bold text-neutral-900 text-xs flex items-center gap-1.5">
            <span>📑</span> 家族の事情
          </h2>
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold text-neutral-600">
            家族の事情 {snapshot.constraints.length}件
          </span>
        </div>
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={handleToggle}
          className="shrink-0 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
        >
          {isOpen ? "閉じる ▲" : "開く ▼"}
        </button>
      </div>

      {isOpen && (
        <div className="mt-3 space-y-3 text-xs border-t border-neutral-100 pt-2.5">
          <p className="text-[11px] text-neutral-500 leading-tight">
            変更は入力画面で行えます。
          </p>

          {/* 家族の事情一覧（種類名を前に出す形に統一、時刻指定なしの希望は下の希望リストへ統合） */}
          <div className="space-y-1.5">
            {visibleConstraints.map((constraint, i) => {
              const person = snapshot.people.find(p => p.id === constraint.personId);
              const personName = person?.name ?? constraint.personId;
              return (
                <div
                  key={i}
                  className="rounded border border-neutral-200 bg-neutral-50/70 p-2 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-neutral-200 px-1.5 py-0.2 text-[10px] font-bold text-neutral-700">
                      {CONSTRAINT_TYPE_LABELS[constraint.type]}
                    </span>
                    {person?.icon?.trim() && (
                      <span
                        aria-hidden="true"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-2xl leading-none"
                      >
                        {person.icon.trim()}
                      </span>
                    )}
                    <span className="font-bold text-neutral-900">{personName}</span>
                    <span className="text-[10px] text-neutral-500">
                      {constraintSchedule(constraint)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-700 leading-snug break-words">
                    {constraint.detail}
                  </p>
                </div>
              );
            })}
            {visibleConstraints.length === 0 && snapshot.constraints.length === 0 && (
              <p className="text-neutral-500 text-[11px]">保存した家族の事情はまだありません。</p>
            )}
          </div>

          {/* 家族の希望 */}
          {mergedHopes.length > 0 && (
            <div className="border-t border-neutral-100 pt-2.5">
              <h3 className="font-bold text-neutral-800 text-[11px] mb-1">
                💭 家族の希望
              </h3>
              <ul className="space-y-1 text-neutral-700 text-[11px]">
                {mergedHopes.map((hope, i) => (
                  <li key={i}>• {hope}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 未確認事項 */}
          {snapshot.unknowns.length > 0 && (
            <div className="border-t border-neutral-100 pt-2.5">
              <h3 className="font-bold text-neutral-800 text-[11px] mb-1">
                ❓ 未確認事項
              </h3>
              <ul className="space-y-1 text-neutral-700 text-[11px]">
                {snapshot.unknowns.map((unknown, i) => (
                  <li key={i}>• {unknown}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 介護が必要な時間帯 */}
          <div className="border-t border-neutral-100 pt-2.5">
            <h3 className="font-bold text-neutral-800 text-[11px] mb-1.5 flex items-center gap-1">
              <span>🕒</span> 介護が必要な時間帯
            </h3>
            {groupedCareWindows.length > 0 ? (
              <div className="mt-1 space-y-1.5">
                {/* 全部の時間帯が埋まっている曜日はまとめて1行で表示 */}
                {fullyCoveredDays.length > 0 && (
                  <div className="flex items-center gap-1.5 rounded bg-neutral-100/80 px-2 py-1 text-[11px] text-neutral-700">
                    <span aria-hidden="true" className="font-bold text-emerald-600">✓</span>
                    <span>{`${fullyCoveredDays.map(d => DAYS[d]).join("・")}：すべて埋まっています`}</span>
                  </div>
                )}

                {/* 一部でも空き（未充足）がある曜日はチップを並べて表示 */}
                {uncoveredDayGroups.map(({ day, windows }) => (
                  <div key={day} className="flex items-center gap-2 text-[11px]">
                    <span className="w-8 shrink-0 font-bold text-neutral-700">
                      {DAYS[day]}曜
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      {windows.map((w, i) => {
                        const gaps = subtractCoverage(w, covers);
                        const isCovered = gaps.length === 0;
                        return isCovered ? (
                          <span
                            key={i}
                            title={`${DAYS[day]}曜 ${w.startHour}:00–${w.endHour}:00（充足済み）`}
                            className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600"
                          >
                            <span aria-hidden="true" className="text-emerald-600 font-bold">✓</span>
                            <span>{w.startHour}:00–{w.endHour}:00</span>
                          </span>
                        ) : (
                          <span
                            key={i}
                            title={`${DAYS[day]}曜 ${w.startHour}:00–${w.endHour}:00（未充足）`}
                            className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-950"
                          >
                            <span>{w.startHour}:00–{w.endHour}:00</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* 未充足がある場合のみ末尾サマリを表示（すべて埋まっている場合は上の1行で十分） */}
                {allGaps.length > 0 && (
                  <p className="mt-2 text-[11px] font-bold text-red-700 border-t border-neutral-100 pt-1.5">
                    {uncoveredSummary}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-1 text-neutral-500 text-[11px]">未設定です。入力画面で設定してください。</p>
            )}
          </div>
        </div>
      )}
    </aside>
  );
});
