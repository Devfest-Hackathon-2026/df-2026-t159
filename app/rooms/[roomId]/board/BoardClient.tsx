"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { DAYS, getDefaultPlacementHours, KIND_LABELS, SERVICE_ICONS, moveBlock, placementInputError, type BoardService } from "@/lib/board";
import type { DayIndex, MemberRole, Person, Placement, PlacementKind, RoomSnapshot } from "@/lib/types";
import { createBoardCollisionDetection, dropStartHour } from "@/lib/board-drag";
import { useRoomValidation } from "@/lib/useRoomValidation";
import { getPersonAvatarText, getPersonRoleLabel } from "@/lib/people";
import RoomHeader from "@/components/RoomHeader";
import { ConfirmPlanButton, ConfirmationBlockers } from "@/components/ConfirmationControls";
import ProposalDrawer from "@/components/ProposalDrawer";
import { confirmBlockReasons } from "@/lib/plan/logic";
import BoardAssistPanel from "./BoardAssistPanel";
import BoardLeftNav from "./BoardLeftNav";
import BoardRightRail from "./BoardRightRail";
import WeeklyBoard, { BoardValidationStatus, COLORS, ROW_HEIGHT } from "./WeeklyBoard";
import { BoardDndProvider, type ActiveDragInfo } from "./BoardDndContext";

export interface BoardConnection {
  load: (roomId: string) => Promise<{ snapshot: RoomSnapshot; role: MemberRole; isDemo: boolean; confirmedRevision?: number | null }>;
  save: (roomId: string, expectedRevision: number, placements: Placement[]) => Promise<number>;
  seedDemoPlan?: (roomId: string) => Promise<void>;
  confirm?: (roomId: string, expectedRevision: number) => Promise<{ confirmedRevision: number }>;
}

const ProposalsClient = dynamic(() => import("../proposals/ProposalsClient"), {
  ssr: false,
  loading: () => <p className="p-4" role="status">読み込み中…</p>,
});

const firestoreConnection: BoardConnection = {
  async load(roomId) {
    const [{ ensureAnonymousUser }, { readOwnMembership, readRoomSnapshot }, { db }, { doc, getDocFromServer }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/rooms"),
      import("@/lib/firebase"),
      import("firebase/firestore"),
    ]);
    const user = await ensureAnonymousUser();
    const member = await readOwnMembership(roomId, user.uid);
    if (!member) throw new Error("membership-required");
    const snapshot = await readRoomSnapshot(roomId);
    if (!snapshot) throw new Error("snapshot-unavailable");
    const root = await getDocFromServer(doc(db, "rooms", roomId));
    const { readSummaryState } = await import("@/lib/summary-store");
    const state = await readSummaryState(roomId);
    return { snapshot, role: member.role, isDemo: root.data()?.isDemo === true,
      confirmedRevision: state.currentRevision === snapshot.revision ? state.summary?.confirmedRevision ?? null : null };
  },
  async confirm(roomId, expectedRevision) {
    const { confirmPlan } = await import("@/lib/plan/client");
    return confirmPlan(roomId, expectedRevision);
  },
  async save(roomId, expectedRevision, placements) {
    const { commitRoomChange } = await import("@/lib/rooms");
    return commitRoomChange(roomId, expectedRevision, { placements });
  },
  async seedDemoPlan(roomId) {
    const [{ ensureAnonymousUser }, { seedDemoTroubledPlanClient }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/demo/client"),
    ]);
    const user = await ensureAnonymousUser();
    const token = await user.getIdToken();
    await seedDemoTroubledPlanClient(token, roomId);
  },
};

const unavailableServices: BoardService[] = [];
const boardCollisionDetection = createBoardCollisionDetection(ROW_HEIGHT);

// メンバー丸アイコン用の色パレット
const AVATAR_COLORS = [
  "bg-emerald-500 text-white",
  "bg-purple-600 text-white",
  "bg-blue-600 text-white",
  "bg-amber-600 text-white",
  "bg-rose-600 text-white",
];

function DragPreview({
  activeDrag,
  services,
  people,
}: {
  activeDrag: ActiveDragInfo | null;
  services: BoardService[];
  people: Person[];
}) {
  if (!activeDrag) return null;

  if (activeDrag.type === "palette" && activeDrag.kind) {
    const kind = activeDrag.kind;
    const defaultPersonIcon =
      kind === "family"
        ? people.find(person => person.canProvideCare)?.icon?.trim()
        : undefined;
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-indigo-600 bg-white px-3 py-2 text-xs font-bold shadow-xl opacity-90 pointer-events-none">
        <span aria-hidden="true" className="text-lg">
          {defaultPersonIcon || SERVICE_ICONS[kind]}
        </span>
        <span>＋ {KIND_LABELS[kind]} をドロップして配置</span>
      </div>
    );
  }

  if (activeDrag.type === "block" && activeDrag.placement) {
    const p = activeDrag.placement;
    const person =
      p.kind === "family"
        ? people.find(item => item.id === p.personId)
        : undefined;
    const label =
      p.kind === "family"
        ? `${person?.name ?? p.personId}の付き添い`
        : services.find(s => s.serviceId === p.serviceId)?.title ?? KIND_LABELS[p.kind];
    const blockIcon =
      p.kind === "family"
        ? person?.icon?.trim() || SERVICE_ICONS.family
        : SERVICE_ICONS[p.kind];
    return (
      <div
        className={`h-full rounded border px-2.5 py-1 text-xs font-bold shadow-xl opacity-90 pointer-events-none ${COLORS[p.kind]}`}
      >
        <span aria-hidden="true" className="text-sm">{blockIcon} </span>
        <span>{label}</span>
      </div>
    );
  }

  return null;
}

export default function BoardClient({
  roomId,
  connection = firestoreConnection,
  services = unavailableServices,
  demoPlacements = null,
}: {
  roomId: string;
  connection?: BoardConnection;
  services?: BoardService[];
  demoPlacements?: Placement[] | null;
}) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [draftPlacement, setDraftPlacement] = useState<Placement | null>(null);
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const openProposals = useCallback(() => { if (!busy.current) setShowProposals(true); }, []);
  const closeProposals = useCallback(() => setShowProposals(false), []);
  const [isAssistOpen, setIsAssistOpen] = useState(true);

  const dndValue = useMemo(() => ({ hasProvider: true, activeDrag }), [activeDrag]);
  const clearDraft = useCallback(() => setDraftPlacement(null), []);
  const busy = useRef(false);
  const requestId = useRef(0);
  const { validation, pending, error: validationError } = useRoomValidation(snapshot);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const reload = useCallback(async () => {
    if (busy.current) return;
    const request = ++requestId.current;
    setLoading(true);
    setSnapshot(null);
    setConfirmedRevision(null);
    setConfirmationError(null);
    setError(null);
    setRole(null);
    try {
      const loaded = await connection.load(roomId);
      if (request !== requestId.current) return;
      setSnapshot(loaded.snapshot);
      setRole(loaded.role);
      setIsDemo(loaded.isDemo);
      setConfirmedRevision(loaded.confirmedRevision ?? null);
    } catch {
      if (request === requestId.current) {
        setError("ルームを読み込めませんでした。参加状態と Firebase の接続設定を確認してください。");
      }
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [roomId, connection]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current++;
    };
  }, [reload]);

  const save = useCallback(async (placements: Placement[]): Promise<boolean> => {
    if (!snapshot || role !== "family" || busy.current || loading || !window.matchMedia("(min-width: 1024px)").matches) {
      return false;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await connection.save(roomId, snapshot.revision, placements);
      const loaded = await connection.load(roomId);
      setSnapshot(loaded.snapshot);
      setRole(loaded.role);
      setIsDemo(loaded.isDemo);
      setConfirmedRevision(loaded.confirmedRevision ?? null);
      return true;
    } catch {
      setSnapshot(null);
      setError("保存または保存後の確認に失敗しました。変更は再読み込みして確認してください。他の編集と競合した可能性もあります。");
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [snapshot, role, loading, connection, roomId]);

  const seedDemoPlan = async (): Promise<boolean> => {
    if (!snapshot || role !== "family" || busy.current || loading || !window.matchMedia("(min-width: 1024px)").matches) {
      return false;
    }
    if (!connection.seedDemoPlan) return false;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await connection.seedDemoPlan(roomId);
      const loaded = await connection.load(roomId);
      setSnapshot(loaded.snapshot);
      setRole(loaded.role);
      setIsDemo(loaded.isDemo);
      setConfirmedRevision(loaded.confirmedRevision ?? null);
      return true;
    } catch {
      setSnapshot(null);
      setError("「揉めるプラン」の読み込みに失敗しました。再読み込みして確認してください。");
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };

  // パレットクリックまたはドロップで追加フォームを開く
  const openDraftFor = useCallback((kind: PlacementKind, day: DayIndex = 0, hour: number = 6) => {
    if (!snapshot) return;
    const service = services.find(s => s.kind === kind);
    const careProviders = snapshot.people.filter(p => p.canProvideCare);
    const { startHour, endHour } = getDefaultPlacementHours(kind, hour);
    setDraftPlacement({
      id: crypto.randomUUID(),
      day,
      startHour,
      endHour,
      kind,
      ...(kind === "family"
        ? { personId: careProviders[0]?.id ?? "" }
        : { serviceId: service?.serviceId ?? "" }),
    });
  }, [snapshot, services]);

  // パレットからの追加を自動保存する
  const addPlacementFromPalette = useCallback(async (kind: PlacementKind, day: DayIndex = 0, hour: number = 6) => {
    if (!snapshot || role !== "family" || busy.current || loading || !desktop) return;
    const service = services.find(s => s.kind === kind);
    const careProviders = snapshot.people.filter(p => p.canProvideCare);
    if (kind === "family" && careProviders.length === 0) {
      setError("付き添いができる家族が登録されていません。");
      return;
    }
    if (kind !== "family" && !service?.serviceId) {
      setError("利用可能なサービスが見つかりません。");
      return;
    }
    const { startHour, endHour } = getDefaultPlacementHours(kind, hour);
    const newPlacement: Placement = {
      id: crypto.randomUUID(),
      day,
      startHour,
      endHour,
      kind,
      ...(kind === "family"
        ? { personId: careProviders[0]?.id ?? "" }
        : { serviceId: service?.serviceId ?? "" }),
    };
    const inputError = placementInputError(newPlacement, snapshot.placements);
    if (inputError) {
      setError(inputError);
      return;
    }
    await save([...snapshot.placements, newPlacement]);
  }, [snapshot, role, loading, desktop, services, save]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "palette") {
      setActiveDrag({ type: "palette", kind: active.data.current.kind });
    } else if (snapshot) {
      const p = snapshot.placements.find(item => item.id === active.id);
      if (p) {
        setActiveDrag({ type: "block", placement: p });
      }
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDrag(null);
    if (!snapshot || role !== "family" || !desktop || saving || !over) return;

    // パレットからのドロップ
    if (active.data.current?.type === "palette") {
      const kind = active.data.current.kind as PlacementKind;
      const cellDay = over.data.current?.day as DayIndex | undefined;
      const cellHour = over.data.current?.hour as number | undefined;
      if (cellDay !== undefined && cellHour !== undefined) {
        await addPlacementFromPalette(kind, cellDay, cellHour);
      }
      return;
    }

    // 既存ブロックのドラッグ移動
    const p = snapshot.placements.find(item => item.id === active.id);
    if (!p) return;
    const moved = moveBlock(p, over.data.current?.day, dropStartHour(over.data.current?.hour, active.data.current?.grabOffsetY?.current ?? 0, ROW_HEIGHT));
    if (!moved) {
      setError("6:00〜24:00を越える移動はできません。長さは変更しません。");
      return;
    }
    if (moved.day === p.day && moved.startHour === p.startHour) return;

    const inputError = placementInputError(moved, snapshot.placements);
    if (inputError) {
      setError(inputError);
      return;
    }
    await save(snapshot.placements.map(other => (other.id === p.id ? moved : other)));
  };

  const roomName = isDemo ? "佐藤家のケア会議" : "佐藤家のケア会議";
  const currentValidation = snapshot && validation?.revision === snapshot.revision ? validation.result : null;
  const confirmed = snapshot !== null && confirmedRevision === snapshot.revision;
  const handleConfirm = async () => {
    if (!snapshot || role !== "family" || !currentValidation || confirmBlockReasons(snapshot, currentValidation).length > 0 || busy.current || loading || activeDrag || !connection.confirm) return;
    busy.current = true;
    setConfirming(true);
    setConfirmationError(null);
    try {
      await connection.confirm(roomId, snapshot.revision);
      const loaded = await connection.load(roomId);
      setSnapshot(loaded.snapshot);
      setRole(loaded.role);
      setIsDemo(loaded.isDemo);
      setConfirmedRevision(loaded.confirmedRevision ?? null);
    } catch (err) {
      setConfirmedRevision(null);
      setConfirmationError(err instanceof Error ? err.message : "確定または確定後の確認に失敗しました。再読み込みして確認してください。");
    } finally {
      busy.current = false;
      setConfirming(false);
    }
  };

  return (
    <div className="mobile-page min-h-screen bg-neutral-100/60 pb-8">
      {/* 固定表示ヘッダーコンテナ（タブ行＋アクション行を画面上部に固定） */}
      <div className="sticky top-0 z-30">
        {/* 全画面共通ヘッダー */}
        <RoomHeader roomId={roomId} activeKey="board" containerClassName="max-w-[1700px]" className="!static shadow-none" />

        {/* ボード用サブヘッダー（アクション行） */}
        <div className="border-b border-neutral-200 bg-white/95 backdrop-blur-xs shadow-2xs">
          <div className="mx-auto flex max-w-[1700px] flex-wrap items-center justify-between gap-4 px-4 sm:px-6 py-2">
            {/* 左：ルーム名＋家族丸アイコン */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-bold text-neutral-800">
                {roomName}
              </span>

              {/* 家族メンバーの色付き丸アイコン（アイコンまたは頭文字入り） */}
              {snapshot && snapshot.people.length > 0 && (
                <div
                  className="flex items-center gap-1.5 border-l border-neutral-200 pl-3"
                  aria-label="参加家族一覧"
                >
                  {snapshot.people.map((person, idx) => {
                    const avatarText = getPersonAvatarText(person);
                    const colorClass = AVATAR_COLORS[idx % AVATAR_COLORS.length];
                    const hasIcon = Boolean(person.icon?.trim());
                    return (
                      <div
                        key={person.id}
                        title={`${person.name}（${getPersonRoleLabel(person)}）`}
                        className={`flex h-11 w-11 items-center justify-center rounded-full ${
                          hasIcon ? "text-[26px]" : "text-lg"
                        } font-bold leading-none shadow-2xs ring-1 ring-white cursor-default select-none ${colorClass}`}
                      >
                        {avatarText}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 右：再読み込み＋まとめシートボタン＋プランを確定するボタン */}
            <div className="max-sm:flex-wrap flex items-center gap-2 sm:gap-3">
              {snapshot && (
                <span
                  role="status"
                  className="font-mono text-xs text-neutral-500 mr-1 hidden md:inline"
                >
                  {saving ? "保存中…" : "保存済み"}
                </span>
              )}
              <button
                type="button"
                className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
                disabled={loading || saving || confirming}
                onClick={() => void reload()}
              >
                再読み込み
              </button>
              <Link
                href={`/rooms/${roomId}/summary`}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold shadow-2xs transition-colors flex items-center gap-1.5 ${
                  confirmed
                    ? "border border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700"
                    : "border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50"
                }`}
              >
                <span>📄</span> まとめシート
              </Link>
              <button
                type="button"
                onClick={openProposals}
                disabled={loading || saving || confirming || !!activeDrag}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold shadow-2xs transition-colors flex items-center gap-1.5 ${
                  confirmed
                    ? "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                }`}
              >
                代替案を開く
              </button>
              {snapshot && !confirmed && <ConfirmPlanButton snapshot={snapshot} validation={currentValidation} canEdit={role === "family"}
                busy={saving || confirming || loading || !!activeDrag} unavailable={!connection.confirm}
                describedBy="board-confirmation-reasons" onConfirm={() => void handleConfirm()} />}
              {confirmed && <span className="text-sm font-bold text-emerald-800">確定済み</span>}
            </div>
          </div>
        </div>
      </div>

      {/* メインコンテンツ */}
      <main className="mx-auto max-w-[1700px] px-4 sm:px-6 py-3">
        <div className="mb-3">
          <h1 className="text-lg font-bold text-neutral-900">週間ボードで予定を組む</h1>
          <p className="mt-1 text-sm text-neutral-600">
            サービスと家族の付き添いを配置します。
          </p>
        </div>
        <ol aria-label="家族会議の流れ" className="mb-3 flex flex-wrap gap-2 text-xs">
          <li><Link className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 bg-white px-3" href={`/rooms/${roomId}/input`}>1. 事情を入れる</Link></li>
          <li aria-current="step" className="inline-flex min-h-11 items-center rounded-full bg-indigo-600 px-3 font-bold text-white">2. ボードで組む</li>
          <li><Link className="inline-flex min-h-11 items-center rounded-full border border-neutral-300 bg-white px-3" href={`/rooms/${roomId}/summary`}>3. 確定・印刷</Link></li>
        </ol>
        {snapshot && !confirmed && <div className="mb-3"><ConfirmationBlockers snapshot={snapshot} validation={currentValidation}
          canEdit={role === "family"} roomId={roomId} id="board-confirmation-reasons" /></div>}
        {confirmationError && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{confirmationError}</p>}
        {confirmed && <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p>現在のプランは確定済みです。まとめシートで内容を確認・印刷できます。</p>
          <Link href={`/rooms/${roomId}/summary`} className="inline-flex min-h-11 items-center font-bold underline">まとめシートで確認・印刷する</Link>
        </div>}
        {snapshot && (
          <div className="flex md:hidden items-center justify-end text-xs text-neutral-500 mb-2">
            <span role="status" className="font-mono text-neutral-600">
              {saving ? "保存中…" : "保存済み"}
            </span>
          </div>
        )}

        {loading && <p className="mt-4 text-sm text-neutral-600" role="status">読み込み中…</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200" role="alert">{error}</p>}

        {snapshot && (
          <>

            {/* ボード本体: 3カラムレイアウト（左：家族の事情パネル・中央：上段パレット帯＋ボード・右レール） */}
            {isDemo && snapshot.placements.length === 0 && (
              <section className="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <h2 className="text-sm font-bold text-indigo-950">デモ用のプランを読み込めます</h2>
                <p className="mt-1 text-sm text-indigo-900/80">デモ用の「揉めるプラン」は、読み込んだ場合だけ保存されます。</p>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={!connection.seedDemoPlan || role !== "family" || saving || !desktop}
                    className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-sm font-bold text-indigo-900 hover:bg-indigo-100 disabled:opacity-40"
                    onClick={() => { void seedDemoPlan(); }}
                  >
                    「揉めるプラン」を読み込む
                  </button>
                  {!connection.seedDemoPlan && (
                    <p className="mt-1 text-xs text-neutral-500">Issue #12 のデモ配置は未接続です。</p>
                  )}
                </div>
              </section>
            )}
            <BoardDndProvider value={dndValue}>
                <DndContext
                  sensors={sensors}
                  collisionDetection={boardCollisionDetection}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setActiveDrag(null)}
                >
                  <div
                    className={`grid grid-cols-1 gap-4 items-start ${
                      isAssistOpen
                        ? "lg:grid-cols-[250px_minmax(0,1fr)_290px] xl:grid-cols-[270px_minmax(0,1fr)_310px]"
                        : "lg:grid-cols-[minmax(0,1fr)_290px] xl:grid-cols-[minmax(0,1fr)_310px]"
                    }`}
                  >
                    {/* 1. 左カラム（整理した家族の事情・条件パネル） */}
                    <div
                      className={`max-sm:order-2 min-w-0 space-y-3 ${
                        isAssistOpen ? "lg:sticky lg:top-3" : "lg:col-span-full"
                      }`}
                    >
                      <BoardAssistPanel
                        snapshot={snapshot}
                        isOpen={isAssistOpen}
                        onToggle={setIsAssistOpen}
                      />
                    </div>

                    {/* 2. 中央（上段：サービスと家族のパレット帯 ＋ 下段：週間ボード本体） */}
                    <div className="max-sm:order-1 min-w-0 space-y-3">
                      <BoardLeftNav
                        snapshot={snapshot}
                        canEdit={role === "family" && !confirming}
                        services={services}
                        onAddPlacement={openDraftFor}
                        defaultShowDetails={false}
                      />

                      <WeeklyBoard
                        snapshot={snapshot}
                        canEdit={role === "family"}
                        saving={saving || confirming}
                        services={services}
                        validation={validation?.revision === snapshot.revision ? validation.result : null}
                        onSave={save}
                        activeDraftPlacement={draftPlacement}
                        onSelectPlacement={setDraftPlacement}
                        onClearDraft={clearDraft}
                      />
                    </div>

                    {/* 3. 右レール（介護保険の枠、警告一覧、代替案ボタン、家族の負担要約） */}
                    <div className="max-sm:order-3 min-w-0">
                      <BoardRightRail
                        roomId={roomId}
                        snapshot={snapshot}
                        validation={validation?.revision === snapshot.revision ? validation.result : null}
                        validationRevision={validation?.revision}
                        people={snapshot.people}
                        onOpenProposals={openProposals}
                      />
                    </div>
                  </div>

                  <DragOverlay>
                    <DragPreview
                      activeDrag={activeDrag}
                      services={services}
                      people={snapshot.people}
                    />
                  </DragOverlay>
                </DndContext>
            </BoardDndProvider>
          </>
        )}
      </main>
      <ProposalDrawer open={showProposals} onClose={closeProposals}>
        <ProposalsClient roomId={roomId} embedded onRoomChanged={reload} />
      </ProposalDrawer>
    </div>
  );
}
