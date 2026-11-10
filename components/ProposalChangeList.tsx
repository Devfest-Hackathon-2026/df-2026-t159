import React from "react";
import { DAYS, KIND_LABELS } from "@/lib/board";
import type { DayIndex, Person, Placement, PlacementKind, ProposalChange } from "@/lib/types";

export interface FormattedChangeItem {
  id: string;
  action: "change" | "remove" | "add";
  actionLabel: string;
  text: string;
}

function getServiceName(
  kind: PlacementKind,
  personId?: string,
  people?: readonly Person[],
): string {
  if (kind === "family") {
    const person = people?.find((p) => p.id === personId);
    return person ? `${person.name}の付き添い` : "家族の付き添い";
  }
  return KIND_LABELS[kind] ?? "サービス";
}

function dayText(day: DayIndex | number): string {
  if (day >= 0 && day < DAYS.length) {
    return `${DAYS[day as DayIndex]}曜`;
  }
  return "曜日不明";
}

/**
 * 変更1件を表示用テキストに変換する純粋関数。
 * 書式：「曜日：サービス名 開始–終了」の変化が分かる形
 * 例：「水曜：通所介護 9:00–12:00 → 9:00–16:00」
 * 追加・削除・変更を区別できる言葉（例: （変更）、（削除）、（追加））を含める。
 */
export function formatProposalChange(
  change: ProposalChange,
  placements: readonly Placement[],
  people: readonly Person[],
  index: number = 0,
): FormattedChangeItem {
  const orig =
    "placementId" in change && change.placementId
      ? placements.find((p) => p.id === change.placementId)
      : undefined;

  switch (change.action) {
    case "resize": {
      const day = orig ? orig.day : 0;
      const dText = dayText(day);
      const service = orig
        ? getServiceName(orig.kind, orig.personId, people)
        : "サービス";
      const beforeTime = orig ? `${orig.startHour}:00–${orig.endHour}:00` : "";
      const afterTime = `${change.startHour}:00–${change.endHour}:00`;
      const text = `${dText}：${service} ${beforeTime} → ${afterTime}（変更）`;
      return {
        id: change.placementId ?? `resize-${index}`,
        action: "change",
        actionLabel: "変更",
        text,
      };
    }
    case "move": {
      const origDay = orig ? orig.day : 0;
      const origDayTxt = dayText(origDay);
      const newDayTxt = dayText(change.day);
      const service = orig
        ? getServiceName(orig.kind, orig.personId, people)
        : "サービス";
      const duration = orig ? orig.endHour - orig.startHour : 1;
      const newEndHour = change.startHour + duration;
      const beforeTime = orig ? `${orig.startHour}:00–${orig.endHour}:00` : "";
      const afterTime = `${change.startHour}:00–${newEndHour}:00`;

      const text =
        origDay === change.day
          ? `${origDayTxt}：${service} ${beforeTime} → ${afterTime}（変更）`
          : `${origDayTxt}：${service} ${beforeTime} → ${newDayTxt} ${afterTime}（変更）`;

      return {
        id: change.placementId ?? `move-${index}`,
        action: "change",
        actionLabel: "変更",
        text,
      };
    }
    case "remove": {
      const day = orig ? orig.day : 0;
      const dText = dayText(day);
      const service = orig
        ? getServiceName(orig.kind, orig.personId, people)
        : "サービス";
      const time = orig ? `${orig.startHour}:00–${orig.endHour}:00` : "";
      const text = `${dText}：${service} ${time}（削除）`;
      return {
        id: change.placementId ?? `remove-${index}`,
        action: "remove",
        actionLabel: "削除",
        text,
      };
    }
    case "add": {
      const dText = dayText(change.day);
      const service = getServiceName(change.kind, change.personId, people);
      const time = `${change.startHour}:00–${change.endHour}:00`;
      const text = `${dText}：${service} ${time}（追加）`;
      return {
        id: change.placementId ?? `add-${index}`,
        action: "add",
        actionLabel: "追加",
        text,
      };
    }
  }
}

export function formatProposalChanges(
  changes: readonly ProposalChange[],
  placements: readonly Placement[],
  people: readonly Person[],
): FormattedChangeItem[] {
  return changes.map((c, i) => formatProposalChange(c, placements, people, i));
}

const ACTION_BADGE_STYLES = {
  change: "border-indigo-200 bg-indigo-50 text-indigo-700",
  remove: "border-rose-200 bg-rose-50 text-rose-700",
  add: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export interface ProposalChangeListProps {
  changes: readonly ProposalChange[];
  placements: readonly Placement[];
  people: readonly Person[];
  selectedChangeId?: string | null;
  onSelectChange?: (changeId: string | null) => void;
}

export default function ProposalChangeList({
  changes,
  placements,
  people,
  selectedChangeId,
  onSelectChange,
}: ProposalChangeListProps) {
  const items = formatProposalChanges(changes, placements, people);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-4 text-xs text-neutral-500">
        予定の変更はありません。
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-4 text-sm">
      <h4 className="flex items-center gap-1.5 font-bold text-neutral-900">
        <span>🔄</span>
        <span>変更の一覧（{items.length}件）</span>
      </h4>
      <ul
        aria-label="変更の一覧"
        className="mt-3 divide-y divide-neutral-200/80 rounded-md border border-neutral-200/60 bg-white overflow-hidden shadow-2xs"
      >
        {items.map((item, index) => {
          const isSelected = selectedChangeId === item.id;
          const badgeNumber = index + 1;
          return (
            <li
              key={`${item.id}-${index}`}
              onClick={() => onSelectChange?.(isSelected ? null : item.id)}
              className={`flex items-center gap-2.5 px-3 py-2 text-xs sm:text-[13px] text-neutral-800 transition-colors cursor-pointer select-none ${
                isSelected
                  ? "bg-indigo-50/90 ring-2 ring-inset ring-indigo-500 font-semibold"
                  : "hover:bg-neutral-50"
              }`}
              data-testid={`change-item-${item.id}`}
              data-selected={isSelected ? "true" : "false"}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectChange?.(isSelected ? null : item.id);
                }
              }}
            >
              {/* 番号バッジ */}
              <span
                data-testid="change-number-badge"
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold shadow-2xs ${
                  isSelected
                    ? "bg-indigo-600 text-white ring-2 ring-indigo-300"
                    : "bg-neutral-800 text-white"
                }`}
              >
                {badgeNumber}
              </span>
              <span
                className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-bold ${ACTION_BADGE_STYLES[item.action]}`}
              >
                {item.actionLabel}
              </span>
              <span className="font-medium tracking-tight flex-1">{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
