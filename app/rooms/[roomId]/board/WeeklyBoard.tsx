"use client";

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useDndMonitor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  computePlacementColumns,
  computeBlockSegments,
  findTextSegment,
  type BlockSegment,
  DAYS,
  getDefaultPlacementHours,
  HOURS,
  KIND_LABELS,
  SERVICE_ICONS,
  moveBlock,
  placementInputError,
  type BoardService,
} from "@/lib/board";
import { createBoardCollisionDetection, dropStartHour } from "@/lib/board-drag";
import { resizeBlock, type ResizeEdge } from "@/lib/block-resize";
import { getCheckNotesForPlacement } from "@/lib/check-notes";
import { serviceContentFor } from "@/lib/service-contents";
import type {
  DayIndex,
  Gap,
  Person,
  Placement,
  PlacementKind,
  RevisionedValidation,
  RoomSnapshot,
  ValidationResult,
} from "@/lib/types";
import { getServiceMaster, unitsForMinutes, unitsMaster } from "@/lib/units";
import WarningAlerts from "@/components/WarningAlerts";
import { useBoardDnd } from "./BoardDndContext";
import BoardScrollNav from "./BoardScrollNav";

export const COLORS: Record<PlacementKind, string> = {
  visit: "bg-sky-100 border-sky-300 text-sky-950",
  daycare: "bg-emerald-100 border-emerald-300 text-emerald-950",
  dayrehab: "bg-fuchsia-200 border-fuchsia-400 text-fuchsia-950",
  shortstay: "bg-violet-100 border-violet-300 text-violet-950",
  family: "bg-amber-100 border-amber-300 text-amber-950",
};

/**
 * 18時間（6:00〜24:00）が一般的なノートPC（高さ約800px）の画面に
 * 収まるよう行の高さを 28px に設定（18時間 × 28px = 504px）。
 */
export const ROW_HEIGHT = 28;
const boardCollisionDetection = createBoardCollisionDetection(ROW_HEIGHT);
const emptyGaps: Gap[] = [];

/** 単位数の取得（ツールチップおよび編集フォームで使用） */
export function getPlacementUnitsText(placement: Placement): string {
  if (placement.kind === "family") return "";
  const master = placement.serviceId
    ? getServiceMaster(unitsMaster, placement.serviceId)
    : unitsMaster.find(s => s.kind === placement.kind);
  if (!master) return "";
  const minutes = (placement.endHour - placement.startHour) * 60;
  const units = unitsForMinutes(master, minutes);
  return units !== null ? `${units.toLocaleString()}単位` : "";
}

const Cell = React.memo(function Cell({
  day,
  hour,
  gap,
  gapStart,
  gapRange,
  focused,
  isDraggingAny,
  isOver,
}: {
  day: number;
  hour: number;
  gap: boolean;
  gapStart: boolean;
  gapRange?: { startHour: number; endHour: number };
  focused: boolean;
  isDraggingAny: boolean;
  isOver: boolean;
}) {
  return (
    <div
      aria-label={`${DAYS[day]}曜 ${hour}:00${gap ? " 介護の空白" : ""}`}
      className={`relative border-b border-neutral-200 transition-colors ${
        gap ? "bg-red-50 text-red-950" : ""
      } ${
        isOver
          ? "bg-indigo-100/90 outline-2 outline-indigo-600 -outline-offset-2 z-20"
          : isDraggingAny
          ? "bg-neutral-50/50 hover:bg-indigo-50/40"
          : ""
      }`}
      style={{
        height: ROW_HEIGHT,
        ...(gap ? { backgroundColor: "#fef2f2" } : {}),
      }}
    >
      {gap && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 z-20 w-1 bg-red-500" />
      )}
      {gap && gapStart && gapRange && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1.5 right-1.5 top-0.5 z-20 inline-flex flex-wrap items-center gap-1 leading-tight rounded bg-red-100/95 border border-red-300 px-1.5 py-0.5 text-[10px] font-bold text-red-800 shadow-2xs"
        >
          <span>⚠ 介護が必要</span>
          <span className="shrink-0 font-mono">{`${String(gapRange.startHour).padStart(2, "0")}:00–${String(gapRange.endHour).padStart(2, "0")}:00`}</span>
        </div>
      )}
      {focused && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-30 border-2 border-blue-700" />
      )}
      {isOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-30">
          <span className="rounded bg-indigo-600 text-white text-[10px] font-bold px-1.5 py-0.2 shadow-xs">
            ここに配置
          </span>
        </div>
      )}
    </div>
  );
});

const DayCells = React.memo(function DayCells({ day, gaps, focus, dragging }: {
  day: number; gaps: Gap[]; focus: Gap | null; dragging: boolean;
}) {
  // 衝突判定がhourだけを更新する表示用データ。入力スナップショットには含めない。
  const data = useMemo(() => ({ day, hour: 6 }), [day]);
  const { setNodeRef } = useDroppable({ id: `day-${day}`, data });
  const [overHour, setOverHour] = useState<number | null>(null);
  const update = ({ over }: { over: { data: { current?: { day?: number; hour?: number } } } | null }) => {
    setOverHour(over?.data.current?.day === day ? over.data.current.hour ?? null : null);
  };
  useDndMonitor({ onDragMove: update, onDragOver: update,
    onDragEnd: () => setOverHour(null), onDragCancel: () => setOverHour(null) });
  return (
    <div ref={setNodeRef} data-board-day={day} className="absolute inset-0">
      {HOURS.map(hour => {
        const matchingGap = gaps.find(g => g.day === day && g.startHour <= hour && hour < g.endHour);
        const gapStart = matchingGap ? matchingGap.startHour === hour : false;
        return (
          <Cell
            key={hour}
            day={day}
            hour={hour}
            gap={Boolean(matchingGap)}
            gapStart={gapStart}
            gapRange={gapStart && matchingGap ? { startHour: matchingGap.startHour, endHour: matchingGap.endHour } : undefined}
            focused={focus !== null && focus.day === day && focus.startHour <= hour && hour < focus.endHour}
            isDraggingAny={dragging}
            isOver={overHour === hour}
          />
        );
      })}
    </div>
  );
});

function Block({
  placement: p,
  label,
  icon,
  segments,
  editable,
  onSelect,
  onResizePreview,
  onResizeCommit,
}: {
  placement: Placement;
  label: string;
  icon?: string;
  segments?: BlockSegment[];
  editable: boolean;
  onSelect: () => void;
  onResizePreview: (p: Placement | null) => void;
  onResizeCommit: (p: Placement) => void;
}) {
  const grabOffsetY = useRef(0);
  const { hasProvider } = useBoardDnd();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: p.id,
    disabled: !editable,
    data: { type: "block", placement: p, grabOffsetY },
  });
  const unitsText = useMemo(() => getPlacementUnitsText(p), [p]);
  const notes = useMemo(() => getCheckNotesForPlacement(p), [p]);
  const durationHours = p.endHour - p.startHour;
  const resizing = useRef<{
    pointerId: number; edge: ResizeEdge; original: Placement;
    startY: number; scrollY: number; preview: Placement; cleanup: () => void;
  } | null>(null);
  useEffect(() => () => { resizing.current?.cleanup(); resizing.current = null; }, []);

  const activeSegments = useMemo(() => {
    if (segments && segments.length > 0) return segments;
    return [{
      startHour: p.startHour,
      endHour: p.endHour,
      widthPct: 100,
      leftPct: 0,
      isSplit: false,
      colIndex: 0,
    }];
  }, [segments, p.startHour, p.endHour]);

  const textSegment = useMemo(() => findTextSegment(activeSegments), [activeSegments]);

  const cancelResize = () => {
    const session = resizing.current;
    if (!session) return;
    resizing.current = null;
    session.cleanup();
    onResizePreview(null);
  };
  useEffect(() => { if (!editable) cancelResize(); }, [editable]);
  const resizeAt = (clientY: number) => {
    const session = resizing.current;
    if (!session) return;
    const next = resizeBlock(session.original, session.edge, clientY - session.startY + window.scrollY - session.scrollY, ROW_HEIGHT);
    if (next) { session.preview = next; onResizePreview(next); }
  };
  const beginResize = (event: React.PointerEvent<HTMLButtonElement>, edge: ResizeEdge) => {
    event.stopPropagation();
    if (!editable || p.kind === "shortstay" || event.button !== 0 || resizing.current) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    handle.setPointerCapture(pointerId);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); cancelResize(); } };
    window.addEventListener("keydown", escape);
    resizing.current = {
      pointerId, edge, original: p, startY: event.clientY, scrollY: window.scrollY, preview: p,
      cleanup: () => {
        window.removeEventListener("keydown", escape);
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      },
    };
    onResizePreview(p);
  };
  const endResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const session = resizing.current;
    if (!session || event.pointerId !== session.pointerId) return;
    resizeAt(event.clientY);
    resizing.current = null;
    session.cleanup();
    if (session.original.startHour === session.preview.startHour && session.original.endHour === session.preview.endHour) onResizePreview(null);
    else onResizeCommit(session.preview);
  };

  const firstSeg = activeSegments[0];
  const lastSeg = activeSegments[activeSegments.length - 1];

  return (<>
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${label} ${DAYS[p.day]}曜 ${p.startHour}:00の詳細`}
      aria-roledescription={editable ? "移動できる配置" : "配置"}
      aria-disabled={undefined}
      aria-describedby={undefined}
      tabIndex={0}
      style={{
        // 外側にDragOverlayがあるときは元のブロックを動かさない。
        // 二重の移動で盤面のスクロール領域が膨らむことを防ぐ。
        transform: hasProvider ? undefined : CSS.Translate.toString(transform),
        opacity: hasProvider && isDragging ? 0.35 : undefined,
        transition: isDragging ? "none" : undefined,
        zIndex: isDragging ? 30 : 10,
        height: "100%",
      }}
      onPointerDownCapture={event => {
        // ブロックの余白も含め、配置枠の開始線からの位置を記録する。
        const frame = event.currentTarget.parentElement ?? event.currentTarget;
        grabOffsetY.current = event.clientY - frame.getBoundingClientRect().top;
      }}
      onClick={() => { if (!isDragging) onSelect(); }}
      onKeyDown={event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      title={`${label} (${p.startHour}:00–${p.endHour}:00${unitsText ? ` / ${unitsText}` : ""})`}
      className={`group relative w-full h-full min-w-0 pointer-events-none text-xs transition-all hover:z-30 touch-none ${
        editable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
      }`}
    >
      {activeSegments.map((seg, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === activeSegments.length - 1;
        const isTextTarget = seg === textSegment;
        const isNarrow = seg.widthPct < 100;
        const segDuration = seg.endHour - seg.startHour;

        return (
          <div
            key={`${seg.startHour}-${seg.endHour}-${seg.leftPct}`}
            data-testid={`segment-${seg.startHour}-${seg.endHour}`}
            data-segment-width={seg.widthPct}
            data-segment-left={seg.leftPct}
            className="pointer-events-auto absolute"
            style={{
              top: `${(seg.startHour - p.startHour) * ROW_HEIGHT}px`,
              height: `${segDuration * ROW_HEIGHT}px`,
              left: `${seg.leftPct}%`,
              width: `${seg.widthPct}%`,
            }}
          >
            <div
              className={`absolute inset-x-0.5 flex flex-col justify-center overflow-hidden border shadow-2xs transition-all group-hover:shadow-md ${
                COLORS[p.kind]
              } ${
                isFirst && isLast
                  ? "rounded"
                  : isFirst
                  ? "rounded-t rounded-b-none"
                  : isLast
                  ? "rounded-b rounded-t-none"
                  : "rounded-none"
              } ${isNarrow ? "px-1 py-0.5" : "px-1.5 py-0.5"}`}
              style={{
                top: isFirst ? 2 : 0,
                bottom: isLast ? 2 : 0,
              }}
            >
              {isTextTarget && (
                <>
                  {/* 1行目：サービス名／付き添い名（最低12px: text-xs） */}
                  <div className={`flex items-center justify-between min-w-0 ${isNarrow ? "pr-0" : "max-sm:pr-0 pr-2"}`}>
                    <span className="flex w-full min-w-0 items-center gap-1 text-left font-bold text-xs leading-tight">
                      <span aria-hidden="true" className={`shrink-0 ${isNarrow ? "text-xs" : "text-sm"} leading-none`}>
                        {icon ?? SERVICE_ICONS[p.kind]}
                      </span>
                      <span className="truncate">
                        <span className="max-sm:hidden">{label}</span>
                        <span className="hidden max-sm:inline">{p.kind === "family" ? label : KIND_LABELS[p.kind]}</span>
                      </span>
                    </span>
                  </div>

                  {/* ⠿ 移動可能飾り（全幅かつ編集可能な場合のみ） */}
                  {editable && !isNarrow && (
                    <span aria-hidden="true" className="pointer-events-none absolute top-1 right-0.5 flex h-4 w-4 items-center justify-center text-neutral-500">
                      <span aria-hidden="true" className="text-[10px] leading-none select-none">⠿</span>
                    </span>
                  )}

                  {/* 2時間以上の場合：時刻を表示 */}
                  {durationHours >= 2 && segDuration >= 2 && (
                    <div className={`font-mono font-medium leading-none opacity-85 whitespace-nowrap mt-0.5 ${
                      isNarrow ? "text-[10px]" : "text-[11px]"
                    }`}>
                      {p.startHour}:00–{p.endHour}:00
                    </div>
                  )}

                  {/* 3時間以上かつ注記がある場合：注記を表示 */}
                  {durationHours >= 3 && segDuration >= 3 && notes.length > 0 && !isNarrow && (
                    <div
                      className="mt-0.5 flex items-center gap-1 text-[10px] text-teal-900 truncate"
                      title={notes.join(" / ")}
                    >
                      <span aria-hidden="true">ℹ️</span>
                      <span className="truncate font-medium">{notes[0]}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
    {editable && !isDragging && p.kind !== "shortstay" && (["start", "end"] as const).map(edge => {
      const seg = edge === "start" ? firstSeg : lastSeg;
      const segLeftPct = seg ? seg.leftPct : 0;
      const segWidthPct = seg ? seg.widthPct : 100;
      return (
        <button key={edge} type="button" aria-label={`${label} ${DAYS[p.day]}曜 ${p.startHour}:00の${edge === "start" ? "開始" : "終了"}時刻を変更`}
          className={`pointer-events-auto absolute z-40 flex h-1.5 touch-none cursor-ns-resize items-center justify-center rounded hover:bg-indigo-300/80 focus-visible:bg-indigo-300 ${edge === "start" ? "top-0" : "bottom-0"}`}
          style={{
            left: `calc(${segLeftPct}% + 4px)`,
            width: `calc(${segWidthPct}% - 8px)`,
          }}
          onPointerDown={event => beginResize(event, edge)}
          onPointerMove={event => { if (resizing.current?.pointerId === event.pointerId) { event.stopPropagation(); resizeAt(event.clientY); } }}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
          onLostPointerCapture={cancelResize}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              const next = resizeBlock(p, edge, event.key === "ArrowUp" ? -ROW_HEIGHT : ROW_HEIGHT, ROW_HEIGHT);
              if (next && (next.startHour !== p.startHour || next.endHour !== p.endHour)) onResizeCommit(next);
            }
          }}>
          <span aria-hidden="true" className="h-0.5 w-4 rounded bg-current opacity-50" />
        </button>
      );
    })}
  </>);
}

export function BoardValidationStatus({
  validation,
  pending,
  error,
  people,
}: {
  validation: RevisionedValidation | null;
  pending: boolean;
  error: string | null;
  people?: Person[];
}) {
  const r = validation?.result;
  return (
    <section
      aria-label="検証結果"
      aria-live="polite"
      data-testid={validation ? "validation-revision" : undefined}
      data-revision={validation?.revision}
      className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"
    >
      <h2 className="font-semibold text-neutral-900">
        検証結果
      </h2>
      {pending ? (
        <p className="mt-1">検証中…</p>
      ) : error ? (
        <p className="mt-1" role="alert">{error}</p>
      ) : !r ? (
        <p className="mt-1">未判定</p>
      ) : (
        <WarningAlerts validation={r} people={people} />
      )}
      <p className="mt-1.5 text-[10px] text-neutral-500">
        30日分の目安で、実際の請求額とは異なります。食費・居住費・各種加算は含みません。上限を超えた分は全額自己負担です。
      </p>
    </section>
  );
}

export interface WeeklyBoardProps {
  snapshot: RoomSnapshot;
  canEdit: boolean;
  saving: boolean;
  services: BoardService[];
  validation: ValidationResult | null;
  onSave: (placements: Placement[]) => Promise<boolean>;
  activeDraftPlacement?: Placement | null;
  onSelectPlacement?: (p: Placement) => void;
  onClearDraft?: () => void;
}

export default React.memo(function WeeklyBoard({
  snapshot,
  canEdit,
  saving,
  services,
  validation,
  onSave,
  activeDraftPlacement = null,
  onSelectPlacement,
  onClearDraft,
}: WeeklyBoardProps) {
  const [desktop, setDesktop] = useState(false);
  const [internalDraft, setInternalDraft] = useState<Placement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gapFocus, setGapFocus] = useState<Gap | null>(null);
  const [resizePreview, setResizePreview] = useState<Placement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const boardViewportRef = useRef<HTMLDivElement>(null);

  const { hasProvider, activeDrag } = useBoardDnd();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // 親から渡された activeDraftPlacement の変更を反映
  useEffect(() => {
    if (activeDraftPlacement !== undefined && activeDraftPlacement !== null) {
      setInternalDraft(activeDraftPlacement);
      formRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [activeDraftPlacement]);

  const draft = internalDraft;

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const editable = canEdit && desktop && !saving;
  const people = snapshot.people.filter(p => p.canProvideCare);

  const labelFor = (p: Placement) => {
    if (p.kind === "family") {
      const person = snapshot.people.find(person => person.id === p.personId);
      return `${person?.name ?? p.personId}の付き添い`;
    }
    const service = services.find(s => s.serviceId === p.serviceId);
    if (service?.title) return service.title;
    if (p.serviceId === "visit-body") return "訪問介護（身体）";
    if (p.serviceId === "visit-life") return "訪問介護（生活）";
    if (p.serviceId === "daycare-basic") return "通所介護";
    if (p.serviceId === "dayrehab-basic") return "通所リハビリ";
    if (p.serviceId === "shortstay-basic") return "ショートステイ";
    return KIND_LABELS[p.kind];
  };

  const iconFor = (p: Placement) => {
    if (p.kind === "family") {
      const person = snapshot.people.find(person => person.id === p.personId);
      const customIcon = person?.icon?.trim();
      if (customIcon) return customIcon;
    }
    return SERVICE_ICONS[p.kind];
  };

  const select = (p: Placement) => {
    setInternalDraft({ ...p });
    if (onSelectPlacement) onSelectPlacement(p);
    setError(null);
    formRef.current?.scrollIntoView({ block: "nearest" });
  };

  const closeDraft = () => {
    setInternalDraft(null);
    if (onClearDraft) onClearDraft();
    setGapFocus(null);
  };

  // 空白ガイドから追加フォームへ曜日・開始・終了を渡す
  const presetFromGap = (gap: Gap) => {
    setGapFocus(gap);
    if (!editable) return;
    const service = services.find(s => s.kind === "visit") ?? services[0];
    if (service) {
      select({
        id: crypto.randomUUID(),
        day: gap.day,
        startHour: gap.startHour,
        endHour: gap.endHour,
        kind: service.kind,
        serviceId: service.serviceId,
      });
    } else if (people.length > 0) {
      select({
        id: crypto.randomUUID(),
        day: gap.day,
        startHour: gap.startHour,
        endHour: gap.endHour,
        kind: "family",
        personId: people[0].id,
      });
    }
  };

  const persist = async (p: Placement) => {
    if (!editable) return;
    const inputError = placementInputError(p, snapshot.placements);
    if (inputError) {
      setError(inputError);
      return;
    }
    if (p.kind === "family" ? !people.some(person => person.id === p.personId) : !p.serviceId) {
      setError("サービスまたは付き添いができる家族を選択してください。");
      return;
    }
    const next = snapshot.placements.some(other => other.id === p.id)
      ? snapshot.placements.map(other => (other.id === p.id ? p : other))
      : [...snapshot.placements, p];
    if (await onSave(next)) {
      closeDraft();
      setError(null);
    }
  };

  const commitResize = async (p: Placement) => {
    try { await persist(p); }
    finally { setResizePreview(null); }
  };

  // スタンドアローン描画時（テスト等で外部DndProviderがない場合）のdragEnd
  const handleStandaloneDragEnd = ({ active, over }: DragEndEvent) => {
    if (!editable || !over) return;

    if (active.data.current?.type === "palette") {
      const kind = active.data.current.kind as PlacementKind;
      const cellDay = over.data.current?.day as DayIndex | undefined;
      const cellHour = over.data.current?.hour as number | undefined;
      if (cellDay !== undefined && cellHour !== undefined) {
        const service = services.find(s => s.kind === kind);
        const { startHour, endHour } = getDefaultPlacementHours(kind, cellHour);
        const newPlacement = {
          id: crypto.randomUUID(),
          day: cellDay,
          startHour,
          endHour,
          kind,
          ...(kind === "family"
            ? { personId: people[0]?.id ?? "" }
            : { serviceId: service?.serviceId ?? "" }),
        };
        void persist(newPlacement);
      }
      return;
    }

    const p = snapshot.placements.find(item => item.id === active.id);
    if (!p) return;
    const moved = moveBlock(p, over.data.current?.day, dropStartHour(over.data.current?.hour, active.data.current?.grabOffsetY?.current ?? 0, ROW_HEIGHT));
    if (!moved) {
      setError("6:00〜24:00を越える移動はできません。長さは変更しません。");
      return;
    }
    if (moved.day === p.day && moved.startHour === p.startHour) return;
    void persist(moved);
  };

  const sortedGaps = [...(validation?.gaps ?? [])].sort(
    (a, b) => a.day - b.day || a.startHour - b.startHour,
  );
  const draftServiceContent = draft ? serviceContentFor(draft.kind, draft.serviceId) : undefined;
  const draftNotes = draft ? getCheckNotesForPlacement(draft) : [];

  const dayLayouts = useMemo(() => DAYS.map((_, day) => {
    const placements = snapshot.placements.filter(p => p.day === day)
      .map(p => resizePreview?.id === p.id ? resizePreview : p);
    return { placements, columns: computePlacementColumns(placements) };
  }), [snapshot.placements, resizePreview]);

  const boardContent = (
    <div ref={boardViewportRef} tabIndex={0} className="max-sm:max-h-[60svh] max-sm:overflow-auto max-sm:isolate overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-2xs" aria-label="週間ボード 月〜日 6:00〜24:00">
      <div className="grid min-w-[840px] grid-cols-[48px_repeat(7,minmax(0,1fr))]">
        <div className="max-sm:sticky max-sm:left-0 max-sm:top-0 max-sm:z-40 border-b border-neutral-200 bg-neutral-50 p-1 text-center text-[11px] font-semibold text-neutral-500">
          時刻
        </div>
        {DAYS.map(day => (
          <div
            key={day}
            className="max-sm:sticky max-sm:top-0 max-sm:z-20 border-b border-l border-neutral-200 bg-neutral-50 p-1 text-center text-xs font-bold text-neutral-800"
          >
            {day}曜日
          </div>
        ))}

        {/* 各時間の開始線にラベルをそろえる（スマホの6時はヘッダーとの重なりを避ける）。 */}
        <div aria-label="時刻の目盛り" className="max-sm:sticky max-sm:left-0 max-sm:z-30 bg-white font-mono text-[11px] text-neutral-600">
          {HOURS.map(hour => (
            <div key={hour} className="relative border-b border-neutral-100" style={{ height: ROW_HEIGHT }}>
              <span className={`absolute right-1.5 top-0 bg-white px-0.5 leading-none ${hour === 6 ? "sm:-translate-y-1/2" : "-translate-y-1/2"}`}>{hour}:00</span>
            </div>
          ))}
          <div className="relative h-[18px]">
            <span className="absolute right-1.5 top-0 -translate-y-1/2 bg-white px-0.5 leading-none">24:00</span>
          </div>
        </div>

        {/* 曜日ごとのセルとブロック */}
        {DAYS.map((_, day) => (
          <div
            key={day}
            className="relative border-l border-neutral-200"
            style={{ height: 18 * ROW_HEIGHT }}
          >
            {/* セル群 */}
            <DayCells day={day} gaps={validation?.gaps ?? emptyGaps} focus={gapFocus} dragging={activeDrag !== null} />

            {/* 配置ブロック群 */}
            <div
              className="pointer-events-none absolute inset-0 grid grid-cols-[minmax(0,1fr)]"
              style={{ gridTemplateRows: `repeat(18, ${ROW_HEIGHT}px)` }}
            >
              {(() => {
                const { placements: dayPlacements, columns: columnLayouts } = dayLayouts[day];
                return dayPlacements.map(p => {
                  const layout = columnLayouts.get(p.id) ?? { column: 0, totalColumns: 1 };
                  const isOverlapping = layout.totalColumns > 1;
                  const isCascade = layout.totalColumns >= 3;
                  // 3カラム以上の重なりは従来のカスケード表示。
                  // 1カラム（単独）および2カラム（重なり）は全幅（width: 100%, marginLeft: 0%）で、
                  // 2カラム重なりの区間のみセグメント分割する。
                  const widthPct = isCascade
                    ? Math.max(50, 100 - (layout.totalColumns - 1) * 15)
                    : 100;
                  const leftPct = isCascade
                    ? (layout.column * (100 - widthPct)) / (layout.totalColumns - 1)
                    : 0;
                  const zIndex = isOverlapping ? 10 + layout.column : 10;
                  const segments = computeBlockSegments(p, dayPlacements, columnLayouts);

                  return (
                    <div
                      key={p.id}
                      className="pointer-events-auto relative grid grid-cols-[minmax(0,1fr)] min-w-0 transition-all hover:z-30 focus-within:z-30"
                      style={{
                        gridRow: `${p.startHour - 5} / ${p.endHour - 5}`,
                        gridColumn: "1",
                        width: `${widthPct}%`,
                        marginLeft: `${leftPct}%`,
                        zIndex,
                      }}
                    >
                      <Block
                        placement={p}
                        label={labelFor(p)}
                        icon={iconFor(p)}
                        segments={segments}
                        editable={editable && (!resizePreview || resizePreview.id === p.id)}
                        onSelect={() => select(p)}
                        onResizePreview={setResizePreview}
                        onResizeCommit={p => void commitResize(p)}
                      />
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <section className="space-y-3">
      {/* 補助案内 */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-600">
        {!desktop && <p className="text-amber-700 text-[11px]">※ 配置の編集はPC幅（1024px以上）で利用できます。</p>}
        {!canEdit && <p className="text-neutral-500 text-[11px]">※ ケアマネは閲覧のみです。</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-2 text-xs text-red-700 font-bold border border-red-200">
          {error}
        </p>
      )}

      {/* 空白ガイド（1行チップ表示に圧縮） */}
      <section
        aria-label="空白ガイド"
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-red-200 bg-red-50/70 px-3 py-1.5 text-xs shadow-2xs"
      >
        <span className="font-bold text-red-950 flex items-center gap-1 shrink-0 text-[11px]">
          <span>🕒</span> まだ空いている時間帯:
        </span>
        {!validation ? (
          <span className="text-neutral-500 text-[11px]">検証中…</span>
        ) : snapshot.careWindows.length === 0 ? (
          <span className="text-neutral-500 text-[11px]">
            介護が必要な時間帯を入力画面で設定してください。
          </span>
        ) : sortedGaps.length === 0 ? (
          <span className="text-emerald-800 font-semibold text-[11px]">
            ✅ すべての介護が必要な時間帯が配置でカバーされています
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {sortedGaps.map(gap => (
              <button
                key={`${gap.day}-${gap.startHour}-${gap.endHour}`}
                type="button"
                onClick={() => presetFromGap(gap)}
                aria-pressed={
                  gapFocus?.day === gap.day &&
                  gapFocus?.startHour === gap.startHour &&
                  gapFocus?.endHour === gap.endHour
                }
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all cursor-pointer ${
                  gapFocus?.day === gap.day &&
                  gapFocus?.startHour === gap.startHour &&
                  gapFocus?.endHour === gap.endHour
                    ? "border-red-600 bg-red-600 text-white shadow-2xs"
                    : "border-red-300 bg-white text-red-900 hover:bg-red-50"
                }`}
              >
                {DAYS[gap.day]}曜 {gap.startHour}:00〜{gap.endHour}:00 がまだ空いています
              </button>
            ))}
          </div>
        )}
        {gapFocus && (
          <button
            type="button"
            className="text-[11px] text-red-700 underline ml-auto"
            onClick={() => setGapFocus(null)}
          >
            強調解除
          </button>
        )}
      </section>

      {/* 週間ボード本体 */}
      <BoardScrollNav viewportRef={boardViewportRef} />
      {hasProvider ? (
        boardContent
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollisionDetection}
          onDragEnd={handleStandaloneDragEnd}
        >
          {boardContent}
        </DndContext>
      )}

      {/* 配置追加・編集フォーム */}
      {draft && (
        <form
          ref={formRef}
          aria-label="配置の編集"
          className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3.5 shadow-sm"
          onSubmit={e => {
            e.preventDefault();
            void persist(draft);
          }}
        >
          <div className="flex items-center justify-between border-b border-indigo-100 pb-1.5">
            <h3 className="font-bold text-indigo-950 text-xs">{KIND_LABELS[draft.kind]}の配置</h3>
            <button
              type="button"
              className="text-xs text-neutral-500 hover:text-neutral-800 underline"
              onClick={closeDraft}
            >
              閉じる ✕
            </button>
          </div>

          {draftServiceContent && (
            <div className="mt-2.5 rounded-lg border border-neutral-200 bg-white p-2.5 text-xs leading-relaxed text-neutral-800">
              <p className="font-bold text-neutral-900">{draftServiceContent.title}とは</p>
              <p className="mt-0.5 whitespace-pre-line text-neutral-600">{draftServiceContent.body}</p>
            </div>
          )}

          {draftNotes.length > 0 && (
            <div className="mt-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-xs text-teal-900">
              <p className="font-bold">ℹ️ 確認事項（面談時に確認してください）</p>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5 text-[11px]">
                {draftNotes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <fieldset disabled={!editable} className="max-sm:grid max-sm:grid-cols-2 mt-2.5 flex flex-wrap items-end gap-2.5 text-xs">
            <label className="max-sm:min-w-0 flex flex-col gap-1">
              <span className="font-bold text-neutral-700 text-[11px]">曜日</span>
              <select
                aria-label="曜日"
                className="max-sm:w-full max-sm:min-w-0 max-sm:text-base rounded border border-neutral-300 bg-white p-1.5 text-xs"
                value={draft.day}
                onChange={e =>
                  setInternalDraft(prev => (prev ? { ...prev, day: Number(e.target.value) as DayIndex } : null))
                }
              >
                {DAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}曜日
                  </option>
                ))}
              </select>
            </label>

            {draft.kind === "family" ? (
              <label className="max-sm:col-span-2 max-sm:min-w-0 flex flex-col gap-1">
                <span className="font-bold text-neutral-700 text-[11px]">付き添う家族</span>
                <select
                  aria-label="付き添う家族"
                  className="max-sm:w-full max-sm:min-w-0 max-sm:text-base rounded border border-neutral-300 bg-white p-1.5 text-xs"
                  value={draft.personId}
                  onChange={e =>
                    setInternalDraft(prev => (prev ? { ...prev, personId: e.target.value } : null))
                  }
                >
                  {people.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.icon?.trim() ? `${p.icon.trim()} ${p.name}` : p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="max-sm:col-span-2 max-sm:min-w-0 flex flex-col gap-1">
                <span className="font-bold text-neutral-700 text-[11px]">サービス</span>
                <select
                  aria-label="サービス"
                  className="max-sm:w-full max-sm:min-w-0 max-sm:text-base rounded border border-neutral-300 bg-white p-1.5 text-xs"
                  value={draft.serviceId}
                  onChange={e => {
                    const newServiceId = e.target.value;
                    setInternalDraft(prev => {
                      if (!prev) return null;
                      let newEnd = prev.endHour;
                      if (prev.kind === "visit" && newServiceId !== "visit-life" && newEnd - prev.startHour > 3) {
                        newEnd = prev.startHour + 3;
                      }
                      return { ...prev, serviceId: newServiceId, endHour: newEnd };
                    });
                  }}
                >
                  {!services.some(s => s.serviceId === draft.serviceId) && (
                    <option value={draft.serviceId}>{draft.serviceId || "未接続"}</option>
                  )}
                  {services
                    .filter(s => s.kind === draft.kind)
                    .map(s => (
                      <option key={s.serviceId} value={s.serviceId}>
                        {s.title}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {(["startHour", "endHour"] as const).map((key, i) => {
              const isBodyVisit = draft.kind === "visit" && draft.serviceId !== "visit-life";
              const rawHours = i === 0 ? HOURS : [...HOURS.slice(1), 24];
              const availableHours = rawHours.filter(h => {
                if (i === 1 && isBodyVisit) {
                  return h > draft.startHour && h <= draft.startHour + 3;
                }
                return true;
              });

              return (
                <label key={key} className="max-sm:min-w-0 flex flex-col gap-1">
                  <span className="font-bold text-neutral-700 text-[11px]">
                    {i === 0 ? "開始" : "終了"}
                  </span>
                  <select
                    aria-label={i === 0 ? "開始" : "終了"}
                    className="max-sm:w-full max-sm:min-w-0 max-sm:text-base rounded border border-neutral-300 bg-white p-1.5 text-xs"
                    disabled={draft.kind === "shortstay"}
                    value={draft[key]}
                    onChange={e => {
                      const val = Number(e.target.value);
                      setInternalDraft(prev => {
                        if (!prev) return null;
                        if (key === "startHour") {
                          const nextStart = val;
                          let nextEnd = prev.endHour;
                          if (nextEnd <= nextStart) nextEnd = Math.min(24, nextStart + 1);
                          if (isBodyVisit && nextEnd - nextStart > 3) nextEnd = nextStart + 3;
                          return { ...prev, startHour: nextStart, endHour: nextEnd };
                        } else {
                          return { ...prev, endHour: val };
                        }
                      });
                    }}
                  >
                    {availableHours.map(hour => (
                      <option key={hour} value={hour}>
                        {hour}:00
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}

            <label className="max-sm:col-span-2 max-sm:min-w-0 flex flex-col gap-1 min-w-40 flex-1">
              <span className="font-bold text-neutral-700 text-[11px]">メモ</span>
              <input
                aria-label="メモ"
                className="max-sm:w-full max-sm:min-w-0 max-sm:text-base rounded border border-neutral-300 bg-white p-1.5 text-xs"
                value={draft.note ?? ""}
                onChange={e =>
                  setInternalDraft(prev => (prev ? { ...prev, note: e.target.value } : null))
                }
                placeholder="例：通院付き添い、見守りなど"
              />
            </label>

            <div className="max-sm:col-span-2 max-sm:flex-wrap flex gap-2">
              <button
                className="rounded bg-neutral-900 px-3.5 py-1.5 font-bold text-white hover:bg-neutral-800 text-xs shadow-2xs"
                type="submit"
              >
                保存
              </button>
              {snapshot.placements.some(p => p.id === draft.id) && (
                <button
                  type="button"
                  className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                  onClick={async () => {
                    if (editable && (await onSave(snapshot.placements.filter(p => p.id !== draft.id)))) {
                      closeDraft();
                    }
                  }}
                >
                  削除
                </button>
              )}
            </div>
          </fieldset>

          {draft.kind === "shortstay" && (
            <p className="mt-1.5 text-[10px] text-neutral-500">
              ※ ショートステイは終日6:00〜24:00固定です。複数日に置く場合は日ごとに追加してください。
            </p>
          )}
          {draft.kind === "visit" && draft.serviceId !== "visit-life" && (
            <p className="mt-1.5 text-[10px] text-neutral-500">
              ※ 訪問介護（身体介護）は最大3時間（表の範囲内）まで設定できます。生活援助は上限なし。
            </p>
          )}
          {draft.kind === "visit" && draft.serviceId === "visit-life" && (
            <p className="mt-1.5 text-[10px] text-neutral-500">
              ※ 訪問介護（生活援助）は45分以上で上限はありません。
            </p>
          )}
        </form>
      )}
    </section>
  );
});
