"use client";

import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { KIND_LABELS, type BoardService } from "@/lib/board";
import { serviceShortDescription } from "@/lib/service-contents";
import { paletteUnitHints } from "@/lib/palette-units";
import type { PlacementKind, RoomSnapshot } from "@/lib/types";

const KIND_BAR_COLORS: Record<PlacementKind, string> = {
  visit: "bg-sky-500",
  daycare: "bg-emerald-500",
  dayrehab: "bg-fuchsia-500",
  shortstay: "bg-violet-500",
  family: "bg-amber-500",
};

export interface BoardLeftNavProps {
  snapshot: RoomSnapshot;
  canEdit: boolean;
  services: BoardService[];
  onAddPlacement: (kind: PlacementKind) => void;
  defaultShowDetails?: boolean;
  defaultOpen?: boolean;
}

function DraggablePaletteItem({
  kind,
  disabled,
  onAdd,
  shortDesc,
  unitHints,
  showDetails,
}: {
  kind: PlacementKind;
  disabled: boolean;
  onAdd: () => void;
  shortDesc?: string;
  unitHints: string[];
  showDetails: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${kind}`,
    data: { type: "palette", kind },
    disabled,
  });

  const describedBy =
    [
      "palette-help",
      ...(showDetails
        ? [shortDesc ? `palette-desc-${kind}` : "", unitHints.length ? `palette-units-${kind}` : ""]
        : []),
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      aria-label={`＋ ${KIND_LABELS[kind]}`}
      onClick={() => {
        if (!isDragging) {
          onAdd();
        }
      }}
      {...attributes}
      {...listeners}
      aria-describedby={describedBy}
      className={`max-sm:touch-auto group relative flex h-full w-full flex-col justify-start rounded-lg border border-neutral-200 bg-neutral-50/80 pl-3 pr-2 py-2 text-left transition-all hover:border-indigo-400 hover:bg-indigo-50/50 active:cursor-grabbing cursor-grab disabled:cursor-not-allowed disabled:opacity-40 touch-none shadow-2xs overflow-hidden ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {/* 種類を示す左端の色バー（絵文字アイコンの代わり） */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 ${KIND_BAR_COLORS[kind]}`}
      />

      {/* ラベル行（絵文字なし、家族アバターなし、全アイテム同じ高さ・フォントサイズで truncate なし） */}
      <div className="flex w-full items-center min-w-0">
        <span className="text-xs font-bold text-neutral-900 group-hover:text-indigo-900 leading-tight">
          ＋ {KIND_LABELS[kind]}
        </span>
      </div>
      {showDetails && (
        <div className="mt-1.5 w-full border-t border-neutral-200/70 pt-1.5">
          {shortDesc && (
            <p id={`palette-desc-${kind}`} className="text-[11px] text-neutral-600 leading-snug">
              {shortDesc}
            </p>
          )}
          {unitHints.length > 0 && (
            <div
              id={`palette-units-${kind}`}
              className="mt-1 text-[10px] leading-snug text-neutral-700"
              aria-label={`${KIND_LABELS[kind]}の単位数の目安`}
            >
              {unitHints.map(hint => <p key={hint}>{hint}</p>)}
              {kind === "visit" && <p className="text-neutral-500 font-medium">※ 身体介護は最大3時間まで（生活援助は上限なし）</p>}
            </div>
          )}
        </div>
      )}
    </button>
  );
}

export default React.memo(function BoardLeftNav({
  snapshot,
  canEdit,
  services,
  onAddPlacement,
  defaultShowDetails = true,
  defaultOpen = true,
}: BoardLeftNavProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [showDetails, setShowDetails] = useState(defaultShowDetails);

  const people = snapshot.people;
  const careProviders = people.filter(p => p.canProvideCare);

  const kindsOrder: PlacementKind[] = ["visit", "daycare", "dayrehab", "shortstay", "family"];

  return (
    <aside aria-label="サービスパレット" className="w-full">
      {/* サービスと家族の横並びパレット帯 */}
      <section aria-label="配置パレット" className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold text-neutral-900 text-sm flex items-center gap-1.5">
              <span>🧩</span>
              <span>介護を追加する</span>
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {isOpen && (
              <button
                type="button"
                aria-pressed={showDetails}
                onClick={() => setShowDetails(prev => !prev)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  showDetails
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {showDetails ? "詳細表示を隠す" : "詳細を表示"}
              </button>
            )}
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setIsOpen(prev => !prev)}
              className="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition-colors"
            >
              {isOpen ? "パレットを隠す ▲" : "パレットを表示 ▼"}
            </button>
          </div>
        </div>

        <p id="palette-help" className="mt-2 leading-snug">
          <span className="block text-[13px] font-bold text-neutral-900">ドラッグ＆ドロップで追加します。</span>
          <span className="mt-0.5 block text-[11px] text-neutral-600">基本単位の目安は時間区分によって異なります（ショートステイは1日分）。</span>
        </p>

        {isOpen && (
          <>
            <div className="mt-2.5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {kindsOrder.map(kind => {
                const shortDesc = serviceShortDescription(kind);
                const disabled =
                  !canEdit ||
                  (kind === "family"
                    ? careProviders.length === 0
                    : !services.some(s => s.kind === kind));

                return (
                  <DraggablePaletteItem
                    key={kind}
                    kind={kind}
                    disabled={disabled}
                    onAdd={() => onAddPlacement(kind)}
                    shortDesc={shortDesc}
                    unitHints={paletteUnitHints(kind, services)}
                    showDetails={showDetails}
                  />
                );
              })}
            </div>
            {services.length === 0 && (
              <p className="mt-2 text-[10px] text-neutral-500">
                ※ サービス情報を読み込めない場合も、今ある予定は編集・移動できます。
              </p>
            )}
          </>
        )}
      </section>
    </aside>
  );
});
