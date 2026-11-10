import React from "react";
import { DAYS, HOURS, computePlacementColumns } from "@/lib/board";
import type { Person, Placement, PlacementKind, ProposalChange } from "@/lib/types";
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
  dayrehab: "通所リハビリ",
  shortstay: "ショートステイ",
  family: "家族付き添い",
};

export function getMiniBoardPlacementInfo(
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

export interface ProposalMiniBoardProps {
  placements: readonly Placement[];
  people: readonly Person[];
  originalPlacements?: readonly Placement[];
  changes?: readonly ProposalChange[];
  highlightedPlacementId?: string | null;
  onSelectPlacement?: (placementId: string | null) => void;
}

/**
 * 代替案適用後の週間予定を表示する読み取り専用ミニボード。
 * components/SummarySheet.tsx の週間カレンダー表示方式（静的グリッド）を流用。
 */
export default function ProposalMiniBoard({
  placements,
  people,
  originalPlacements = [],
  changes = [],
  highlightedPlacementId,
  onSelectPlacement,
}: ProposalMiniBoardProps) {
  // 変更メタ情報マップ（placementId -> { action, number, index }）
  const changeMetaByPlacementId = new Map<
    string,
    { action: "add" | "remove" | "change"; number: number; index: number }
  >();
  changes.forEach((change, idx) => {
    if (change.placementId) {
      changeMetaByPlacementId.set(change.placementId, {
        action:
          change.action === "add"
            ? "add"
            : change.action === "remove"
            ? "remove"
            : "change",
        number: idx + 1,
        index: idx,
      });
    }
  });

  const removed = originalPlacements.filter(
    (p) => changeMetaByPlacementId.get(p.id)?.action === "remove"
  );
  const displayed = [...placements, ...removed];
  const markers = {
    add: "＋ 追加",
    change: "↻ 変更",
    remove: "− 削除（元の位置）",
  };

  // 差分がある曜日を収集して列幅を広げる
  const daysWithChanges = new Set<number>();
  changes.forEach((c) => {
    if ("day" in c && typeof c.day === "number") {
      daysWithChanges.add(c.day);
    } else if (c.placementId) {
      const orig = originalPlacements.find((p) => p.id === c.placementId);
      if (orig) daysWithChanges.add(orig.day);
      const curr = placements.find((p) => p.id === c.placementId);
      if (curr) daysWithChanges.add(curr.day);
    }
  });

  // グリッド列テンプレート（差分がある曜日は幅を広めに確保して文字を見やすくする）
  const gridTemplate = `44px ${DAYS.map((_, d) =>
    daysWithChanges.has(d) ? "minmax(105px, 1.4fr)" : "minmax(72px, 1fr)"
  ).join(" ")}`;

  return (
    <div
      aria-label="適用後の週間予定"
      className="rounded-lg border border-neutral-100 bg-neutral-50 p-4 text-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200/80 pb-2">
        <h4 className="flex items-center gap-1.5 font-bold text-neutral-900">
          <span>📅</span>
          <span>適用後の週間予定（ミニボード）</span>
        </h4>
        {/* 凡例 */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-600">
          {(Object.keys(KIND_DISPLAY_LABELS) as PlacementKind[]).map((kind) => (
            <span
              key={kind}
              className={`inline-flex items-center rounded border px-1.5 py-0.5 font-medium ${CALENDAR_COLORS[kind]}`}
            >
              {KIND_DISPLAY_LABELS[kind]}
            </span>
          ))}
        </div>
      </div>
      {changes.length > 0 && (
        <div aria-label="差分の凡例" className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
          <span className="rounded border-2 border-emerald-600 px-2 py-1 text-emerald-800">＋ 追加</span>
          <span className="rounded border-2 border-amber-600 px-2 py-1 text-amber-900">↻ 変更</span>
          <span className="rounded border-2 border-dashed border-rose-600 px-2 py-1 text-rose-800">− 削除（元の位置）</span>
          <span className="ml-auto text-[11px] font-normal text-neutral-500">
            ※ 番号は変更一覧と連動しています（クリックで強調表示）
          </span>
        </div>
      )}

      <div className="proposal-mini-calendar-container mt-3 overflow-x-auto rounded border border-neutral-300 bg-white">
        <style>{`.proposal-mini-calendar-grid { --mini-row-h: 20px; }`}</style>
        <div className="proposal-mini-calendar-grid min-w-[700px] text-xs">
          {/* 曜日ヘッダー */}
          <div
            style={{ gridTemplateColumns: gridTemplate }}
            className="grid border-b border-neutral-300 bg-neutral-100 text-center font-bold text-neutral-800"
          >
            <div className="border-r border-neutral-300 p-1 text-[10px]">時刻</div>
            {DAYS.map((d, dIdx) => (
              <div
                key={d}
                className={`border-r border-neutral-300 p-1 text-[10px] last:border-r-0 ${
                  daysWithChanges.has(dIdx) ? "bg-indigo-50/70 text-indigo-900 font-extrabold" : ""
                }`}
              >
                {d}曜{daysWithChanges.has(dIdx) && <span className="ml-1 text-[9px] text-indigo-600">●</span>}
              </div>
            ))}
          </div>

          {/* グリッド本体 */}
          <div
            style={{ gridTemplateColumns: gridTemplate }}
            className="grid"
          >
            {/* 時刻軸 */}
            <div className="border-r border-neutral-300 bg-neutral-50/70 font-mono text-[9px] text-neutral-500">
              {HOURS.map((h) => (
                <div
                  key={h}
                  style={{ height: "var(--mini-row-h)" }}
                  className="flex items-start justify-end border-b border-neutral-200 pr-1 pt-0.5 leading-none"
                >
                  {h}:00
                </div>
              ))}
              <div
                style={{ height: "var(--mini-row-h)" }}
                className="flex items-start justify-end pr-1 pt-0.5 leading-none"
              >
                24:00
              </div>
            </div>

            {/* 曜日ごとの列 */}
            {DAYS.map((_, dayIndex) => {
              const dayPlacements = displayed.filter((p) => p.day === dayIndex);
              const columns = computePlacementColumns(dayPlacements);
              return (
                <div
                  key={dayIndex}
                  data-testid={`mini-day-column-${dayIndex}`}
                  className={`relative border-r border-neutral-300 last:border-r-0 ${
                    daysWithChanges.has(dayIndex) ? "bg-neutral-50/30" : ""
                  }`}
                  style={{ height: "calc(18 * var(--mini-row-h))" }}
                >
                  {/* 背景セル罫線 */}
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      style={{ height: "var(--mini-row-h)" }}
                      className="border-b border-neutral-200"
                    />
                  ))}

                  {/* 配置ブロック */}
                  {dayPlacements.map((p) => {
                    const info = getMiniBoardPlacementInfo(p, people);
                    const changeMeta = changeMetaByPlacementId.get(p.id);
                    const change = changeMeta?.action;
                    const changeNumber = changeMeta?.number;
                    const isHighlighted = highlightedPlacementId === p.id;
                    const layout = columns.get(p.id);
                    const totalColumns = layout?.totalColumns ?? 1;
                    const column = layout?.column ?? 0;
                    const marker = change ? markers[change] : "";
                    const topCalc = `calc(${p.startHour - 6} * var(--mini-row-h))`;
                    const heightCalc = `calc(${p.endHour - p.startHour} * var(--mini-row-h))`;
                    const durationHours = p.endHour - p.startHour;
                    const isNarrow = totalColumns >= 2;

                    return (
                      <div
                        key={p.id}
                        data-testid={`mini-${change === "remove" ? "removed" : "placement"}-${p.id}`}
                        data-change={change}
                        data-highlighted={isHighlighted ? "true" : undefined}
                        role="group"
                        aria-label={`${marker} ${info.title} ${info.timeRange}`.trim()}
                        onClick={() => {
                          if (change) {
                            onSelectPlacement?.(isHighlighted ? null : p.id);
                          }
                        }}
                        className={`absolute z-10 flex flex-col justify-start overflow-hidden rounded border text-[9px] font-medium leading-tight transition-all ${
                          isNarrow ? "px-0.5 py-0.5" : "px-1 py-0.5"
                        } ${
                          change ? "cursor-pointer" : ""
                        } ${
                          change === "remove"
                            ? "border-2 border-dashed border-rose-600 bg-rose-50 text-rose-900"
                            : CALENDAR_COLORS[p.kind]
                        } ${
                          change === "add"
                            ? "ring-2 ring-inset ring-emerald-600"
                            : change === "change"
                            ? "ring-2 ring-inset ring-amber-600"
                            : ""
                        } ${
                          isHighlighted
                            ? "ring-4 ring-indigo-600 ring-offset-1 z-30 shadow-md scale-[1.02] !bg-white"
                            : "shadow-2xs"
                        }`}
                        style={{
                          top: topCalc,
                          height: heightCalc,
                          left: `calc(${(column * 100) / totalColumns}% + 2px)`,
                          width: `calc(${100 / totalColumns}% - 4px)`,
                        }}
                        title={`${marker} ${info.title} ${info.timeRange}${p.note ? ` (${p.note})` : ""}`.trim()}
                      >
                        {/* タイトル行（番号バッジ＋記号＋サービス名/家族名：箱に収まるようtruncate） */}
                        <div className="flex items-center gap-0.5 min-w-0 font-bold">
                          {changeNumber !== undefined && (
                            <span
                              data-testid="mini-change-badge"
                              className={`inline-flex shrink-0 items-center justify-center rounded-full text-[9px] font-black h-3.5 w-3.5 leading-none text-white shadow-2xs ${
                                isHighlighted
                                  ? "bg-indigo-600 ring-1 ring-white"
                                  : change === "add"
                                  ? "bg-emerald-700"
                                  : change === "remove"
                                  ? "bg-rose-700"
                                  : "bg-amber-700"
                              }`}
                            >
                              {changeNumber}
                            </span>
                          )}
                          <span
                            className={`min-w-0 flex-1 truncate leading-tight ${
                              change === "remove" ? "line-through text-rose-800" : ""
                            }`}
                          >
                            {change && !isNarrow && (
                              <span aria-hidden="true" className="shrink-0 mr-0.5">
                                {change === "add" ? "＋" : change === "change" ? "↻" : "−"}
                              </span>
                            )}
                            {info.title}
                          </span>
                        </div>

                        {/* 時刻表示（1行固定・はみ出しは省略。極端に細く短いブロックでは非表示） */}
                        {!(isNarrow && durationHours <= 1) && (
                          <div className="font-mono text-[8px] text-neutral-600 leading-tight mt-0.5 whitespace-nowrap truncate min-w-0">
                            {info.timeRange}
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
    </div>
  );
}
