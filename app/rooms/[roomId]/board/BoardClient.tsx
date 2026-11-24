"use client";

import { scopeCopy } from "@/lib/scope-copy";
import { useBoardConfirmationForHeader } from "@/components/RoomShell";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { getDefaultPlacementHours, KIND_LABELS, placementInputError, type BoardService } from "@/lib/board";
import type { CopayRate, DayIndex, MemberRole, Person, Placement, PlacementKind, RoomSnapshot } from "@/lib/types";
import { RevisionConflictError } from "@/lib/room-change";
import { createBoardCollisionDetection, blockDropPlacement } from "@/lib/board-drag";
import { useRoomValidation } from "@/lib/useRoomValidation";
import PlacementIcon from "@/components/PlacementIcon";
import ProposalDrawer from "@/components/ProposalDrawer";
import BoardAssistPanel from "./BoardAssistPanel";
import BoardLeftNav from "./BoardLeftNav";
import BoardMetricsCard from "./BoardMetricsCard";
import TutorialReplayButton from "@/components/TutorialReplayButton";
import DemoBoardTutorial from "./DemoBoardTutorial";
import PlacementTutorial from "./PlacementTutorial";
import BoardStatusBand from "./BoardStatusBand";
import WeeklyBoard, { ROW_HEIGHT } from "./WeeklyBoard";
import { BoardDndProvider, NonTouchPointerSensor, type ActiveDragInfo } from "./BoardDndContext";
import {
  buildNormalizedDemoTrialPlacements,
  DEMO_BOARD_TUTORIAL_STEPS,
  extractDemoTrialPlacement,
  boardTutorialProgress,
  getDemoBoardTutorialStepNumber,
  isDrawerTutorialStepId,
  type TutorialProposalState,
  isValidDemoTrialPlacementInput,
  isValidDemoTrialTargetSlot,
  markDemoBoardTutorialDone,
} from "@/lib/demo-board-tutorial";
import { confirmBlockReasons } from "@/lib/plan/logic";

export interface BoardConnection {
  load: (roomId: string) => Promise<{ snapshot: RoomSnapshot; role: MemberRole; isDemo: boolean; roomName?: string; confirmedRevision?: number | null }>;
  save: (roomId: string, expectedRevision: number, placements: Placement[]) => Promise<number>;
  saveCopayRate?: (roomId: string, expectedRevision: number, copayRate: CopayRate) => Promise<number>;
  seedDemoPlan?: (roomId: string) => Promise<void>;
  confirm?: (roomId: string, expectedRevision: number) => Promise<{ confirmedRevision: number }>;
}

const ProposalsClient = dynamic(() => import("../proposals/ProposalsClient"), {
  ssr: false,
  loading: () => <p className="p-4" role="status">読み込み中…</p>,
});

class BoardAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardAuthError";
  }
}

class BoardMembershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoardMembershipError";
  }
}

const firestoreConnection: BoardConnection = {
  async load(roomId) {
    const [{ ensureAnonymousUser }, { readOwnMembership, readRoomSnapshot }, { db }, { doc, getDocFromServer }] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/rooms"),
      import("@/lib/firebase"),
      import("firebase/firestore"),
    ]);
    let user;
    try {
      user = await ensureAnonymousUser();
    } catch (err) {
      throw new BoardAuthError(
        err instanceof Error && err.name === "AnonymousAuthError" && err.message
          ? err.message
          : scopeCopy.authFailed,
      );
    }
    let member;
    try {
      member = await readOwnMembership(roomId, user.uid);
    } catch (err) {
      throw new BoardMembershipError(
        err instanceof Error && err.name === "MembershipReadError" && err.message
          ? err.message
          : scopeCopy.membershipLoadFailed,
      );
    }
    if (!member) throw new Error("membership-required");
    const snapshot = await readRoomSnapshot(roomId);
    if (!snapshot) throw new Error("snapshot-unavailable");
    const root = await getDocFromServer(doc(db, "rooms", roomId));
    const { readSummaryState } = await import("@/lib/summary-store");
    const state = await readSummaryState(roomId);
    const rawName = root.data()?.name;
    const roomName =
      typeof rawName === "string" && rawName.trim().length > 0
        ? rawName.trim()
        : undefined;
    return {
      snapshot,
      role: member.role,
      isDemo: root.data()?.isDemo === true,
      roomName,
      confirmedRevision: state.currentRevision === snapshot.revision ? state.summary?.confirmedRevision ?? null : null,
    };
  },
  async confirm(roomId, expectedRevision) {
    const { confirmPlan } = await import("@/lib/plan/client");
    return confirmPlan(roomId, expectedRevision);
  },
  async save(roomId, expectedRevision, placements) {
    const { commitRoomChange } = await import("@/lib/rooms");
    return commitRoomChange(roomId, expectedRevision, { placements });
  },
  async saveCopayRate(roomId, expectedRevision, copayRate) {
    const { commitRoomChange } = await import("@/lib/rooms");
    return commitRoomChange(roomId, expectedRevision, { copayRate });
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
const PROPOSALS_STEP = getDemoBoardTutorialStepNumber("proposals");
const PROPOSAL_FETCH_STEP = getDemoBoardTutorialStepNumber("proposal-fetch");
const PROPOSAL_COMPARE_STEP = getDemoBoardTutorialStepNumber("proposal-compare");
const PROPOSAL_APPLY_STEP = getDemoBoardTutorialStepNumber("proposal-apply");
const CONFIRM_STEP = getDemoBoardTutorialStepNumber("confirm");

function isRevisionConflictError(err: unknown): boolean {
  if (err instanceof RevisionConflictError) return true;
  if (typeof err === "object" && err !== null) {
    const maybe = err as { name?: unknown; status?: unknown; code?: unknown };
    if (maybe.name === "RevisionConflictError") return true;
    if (maybe.status === 409) return true;
    if (maybe.code === "revision_mismatch") return true;
  }
  return false;
}

function PaletteDragPreview({
  kind,
  people,
}: {
  kind: PlacementKind;
  people: Person[];
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border-2 border-indigo-600 bg-white px-3 py-2 text-xs font-bold shadow-xl opacity-90 pointer-events-none">
      <span aria-hidden="true" className="text-lg">
        <PlacementIcon kind={kind} people={people} />
      </span>
      <span>＋ {KIND_LABELS[kind]} をドロップして配置</span>
    </div>
  );
}

export default function BoardClient({
  roomId,
  connection = firestoreConnection,
  services = unavailableServices,
  demoPlacements: _demoPlacements = null,
}: {
  roomId: string;
  connection?: BoardConnection;
  services?: BoardService[];
  demoPlacements?: Placement[] | null;
}) {
  const [pendingMove, setPendingMove] = useState<Placement | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [role, setRole] = useState<MemberRole | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);
  const [draftPlacement, setDraftPlacement] = useState<Placement | null>(null);
  const [familySelected, setFamilySelected] = useState(false);
  const [lastPersonId, setLastPersonId] = useState<string | null>(null);
  useEffect(() => {
    setFamilySelected(false);
    try { setLastPersonId(sessionStorage.getItem(`carepact:last-caregiver:${roomId}`)); }
    catch { setLastPersonId(null); }
  }, [roomId]);

  function rememberFamily(personId: string) {
    setLastPersonId(personId);
    try { sessionStorage.setItem(`carepact:last-caregiver:${roomId}`, personId); }
    catch { /* この画面内では state の値を使う */ }
  }
  const [activeDrag, setActiveDrag] = useState<ActiveDragInfo | null>(null);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [showProposals, setShowProposals] = useState(false);
  const [isAssistOpen, setIsAssistOpen] = useState(true);
  const [boardTutorialStep, setBoardTutorialStep] = useState<number | null>(null);
  const openProposals = useCallback(() => {
    if (busy.current) return;
    setShowProposals(true);
    setBoardTutorialStep(step => step === PROPOSALS_STEP ? PROPOSAL_FETCH_STEP : step);
  }, []);
  const closeProposals = useCallback(() => {
    setShowProposals(false);
    setBoardTutorialStep(step =>
      step !== null && isDrawerTutorialStepId(DEMO_BOARD_TUTORIAL_STEPS[step - 1]?.id)
        ? PROPOSALS_STEP
        : step,
    );
  }, []);
  const [replayingBoard, setReplayingBoard] = useState(false);
  const [trialPlacementCompleted, setTrialPlacementCompleted] = useState(false);
  const [trialFeedback, setTrialFeedback] = useState<string | null>(null);

  const finishBoardTutorial = useCallback(() => {
    markDemoBoardTutorialDone(roomId);
    setBoardTutorialStep(null);
    setTrialFeedback(null);
    setDraftPlacement(null);
  }, [roomId]);

  useEffect(() => {
    setBoardTutorialStep(null);
    setTrialPlacementCompleted(false);
    setReplayingBoard(false);
    setTrialFeedback(null);
  }, [roomId]);

  const trialExtraction = useMemo(
    () => (isDemo && snapshot ? extractDemoTrialPlacement(snapshot.placements) : null),
    [isDemo, snapshot],
  );
  const isBoardTutorialActive =
    isDemo && role === "family" && snapshot !== null && boardTutorialStep !== null;
  const isMaskingTrialPlacement =
    isBoardTutorialActive &&
    !trialPlacementCompleted &&
    (boardTutorialStep === 1 || boardTutorialStep === 2) &&
    trialExtraction !== null;
  const isTrialStep =
    isBoardTutorialActive &&
    !trialPlacementCompleted &&
    boardTutorialStep === 2 &&
    trialExtraction !== null;
  const displaySnapshot = useMemo(() => {
    if (!snapshot) return null;
    if (pendingMove) {
      return { ...snapshot, placements: snapshot.placements.map(p => p.id === pendingMove.id ? pendingMove : p) };
    }
    if (!isMaskingTrialPlacement || !trialExtraction) return snapshot;
    return { ...snapshot, placements: trialExtraction.maskedPlacements };
  }, [snapshot, isMaskingTrialPlacement, trialExtraction, pendingMove]);

  useEffect(() => {
    if (isBoardTutorialActive && boardTutorialStep === 1) {
      setIsAssistOpen(true);
    }
    if (!isTrialStep) {
      setTrialFeedback(null);
    }
  }, [isBoardTutorialActive, boardTutorialStep, isTrialStep]);

  const dndValue = useMemo(() => ({ hasProvider: true, activeDrag }), [activeDrag]);
  const clearDraft = useCallback(() => setDraftPlacement(null), []);
  const busy = useRef(false);
  const requestId = useRef(0);
  const { validation } = useRoomValidation(displaySnapshot);
  const sensors = useSensors(useSensor(NonTouchPointerSensor, { activationConstraint: { distance: 6 } }));

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
      const hasTrialTarget = extractDemoTrialPlacement(loaded.snapshot.placements) !== null;
      if (loaded.isDemo && loaded.role === "family") {
        const start = hasTrialTarget && boardTutorialProgress.startOnce(roomId);
        setBoardTutorialStep(prev => prev ?? (start ? 1 : null));
      } else {
        setBoardTutorialStep(null);
      }
    } catch (err) {
      if (request === requestId.current) {
        setBoardTutorialStep(null);
        if (err instanceof BoardAuthError) {
          setError(err.message);
        } else if (err instanceof BoardMembershipError) {
          setError(err.message);
        } else if (err instanceof Error && err.message === "membership-required") {
          setError("このルームにはまだ参加していません。ルームの入口から招待リンクで参加してください。");
        } else {
          setError("ルームを読み込めませんでした。参加状態と Firebase の接続設定を確認してください。");
        }
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
    if (!snapshot || role !== "family" || busy.current || loading) {
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

  const handleBoardSave = useCallback(
    async (placements: Placement[]): Promise<boolean> => {
      if (isTrialStep && trialExtraction) {
        const maskedIds = new Set(trialExtraction.maskedPlacements.map(p => p.id));
        const added = placements.filter(p => !maskedIds.has(p.id));
        if (
          added.length !== 1 ||
          !isValidDemoTrialPlacementInput(
            added[0],
            trialExtraction.canonicalPlacement.personId,
          )
        ) {
          setTrialFeedback(
            "土曜 8:00〜12:00 の点線枠に長女の付き添いを1件配置して保存してください。",
          );
          return false;
        }
        const normalizedPlacements = buildNormalizedDemoTrialPlacements(
          trialExtraction.maskedPlacements,
          trialExtraction.canonicalPlacement,
          trialExtraction.originalIndex,
        );
        setTrialFeedback(null);
        if (replayingBoard || await save(normalizedPlacements)) {
          setTrialPlacementCompleted(true);
          setBoardTutorialStep(3);
          return true;
        }
        return false;
      }
      return save(placements);
    },
    [isTrialStep, trialExtraction, save, replayingBoard],
  );

  const saveCopayRate = useCallback(async (copayRate: CopayRate): Promise<boolean> => {
    if (!snapshot || role !== "family" || busy.current || loading || !connection.saveCopayRate) {
      return false;
    }
    if (copayRate === snapshot.copayRate) {
      return true;
    }
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      await connection.saveCopayRate(roomId, snapshot.revision, copayRate);
      const loaded = await connection.load(roomId);
      setSnapshot(loaded.snapshot);
      setRole(loaded.role);
      setIsDemo(loaded.isDemo);
      setConfirmedRevision(loaded.confirmedRevision ?? null);
      return true;
    } catch (err) {
      if (isRevisionConflictError(err)) {
        setError("他の人が先に内容を更新しました。再読み込みして、最新の内容で確認し直してください。");
      } else {
        setError("自己負担割合の保存に失敗しました。再読み込みして確認してください。");
      }
      return false;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }, [snapshot, role, loading, connection, roomId]);

  const seedDemoPlan = async (): Promise<boolean> => {
    if (!snapshot || role !== "family" || busy.current || loading) {
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
      if (
        snapshot.placements.length === 0 &&
        loaded.isDemo &&
        loaded.role === "family" &&
        extractDemoTrialPlacement(loaded.snapshot.placements) !== null &&
        boardTutorialProgress.startOnce(roomId)
      ) {
        setTrialPlacementCompleted(false);
        setTrialFeedback(null);
        setBoardTutorialStep(1);
      }
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
  const openDraftFor = useCallback(
    (kind: PlacementKind, day: DayIndex = 0, hour: number = 6) => {
      if (!displaySnapshot) return;
      if (isTrialStep && trialExtraction) {
        if (kind !== "family") {
          setTrialFeedback(
            "体験ステップでは「＋ 家族の付き添い」を土曜 8:00〜12:00 の点線枠へ入れてください。",
          );
          return;
        }
        setTrialFeedback(null);
        setDraftPlacement({
          id: crypto.randomUUID(),
          day: trialExtraction.canonicalPlacement.day,
          startHour: trialExtraction.canonicalPlacement.startHour,
          endHour: trialExtraction.canonicalPlacement.endHour,
          kind: "family",
          personId: trialExtraction.canonicalPlacement.personId,
          note: trialExtraction.canonicalPlacement.note,
        });
        return;
      }
      const service = services.find(s => s.kind === kind);
      const careProviders = displaySnapshot.people.filter(p => p.canProvideCare);
      const chosenPersonId = careProviders.find(p => p.id === lastPersonId)?.id ?? careProviders[0]?.id ?? "";
      const { startHour, endHour } = getDefaultPlacementHours(kind, hour);
      setDraftPlacement({
        id: crypto.randomUUID(),
        day,
        startHour,
        endHour,
        kind,
        ...(kind === "family"
          ? { personId: chosenPersonId }
          : { serviceId: service?.serviceId ?? "" }),
      });
    },
    [displaySnapshot, services, lastPersonId, isTrialStep, trialExtraction],
  );

  // パレットからの追加を自動保存する
  const addPlacementFromPalette = useCallback(
    async (kind: PlacementKind, day: DayIndex = 0, hour: number = 6) => {
      if (!snapshot || role !== "family" || busy.current || loading || !desktop) return;
      const service = services.find(s => s.kind === kind);
      if (!service) {
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
        serviceId: service.serviceId,
      };
      const inputError = placementInputError(newPlacement, snapshot.placements);
      if (inputError) {
        setError(inputError);
        return;
      }
      await save([...snapshot.placements, newPlacement]);
    },
    [snapshot, role, loading, desktop, services, save],
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    if (active.data.current?.type === "palette") {
      setActiveDrag({
        type: "palette",
        kind: active.data.current.kind,
      });
    } else if (displaySnapshot && !isTrialStep) {
      const p = displaySnapshot.placements.find(item => item.id === active.id);
      if (p) {
        setActiveDrag({ type: "block", placement: p });
      }
    }
  };

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveDrag(null);
    if (!snapshot || role !== "family" || !desktop || saving) return;

    if (isTrialStep && trialExtraction) {
      if (active.data.current?.type !== "palette") {
        setTrialFeedback(
          "このステップでは「＋ 家族の付き添い」を土曜 8:00〜12:00 の点線枠にドロップしてください。",
        );
        return;
      }
      const kind = active.data.current.kind as PlacementKind;
      if (kind !== "family") {
        setTrialFeedback(
          "体験ステップでは「＋ 家族の付き添い」を選んで土曜 8:00〜12:00 の点線枠にドロップしてください。",
        );
        return;
      }
      const cellDay = over?.data.current?.day as DayIndex | undefined;
      const cellHour = over?.data.current?.hour as number | undefined;
      if (
        cellDay === undefined ||
        cellHour === undefined ||
        !isValidDemoTrialTargetSlot(cellDay, cellHour)
      ) {
        setTrialFeedback("土曜 8:00〜12:00 の点線枠以外には配置できません。");
        return;
      }
      openDraftFor("family", cellDay, cellHour);
      return;
    }

    if (!over) return;

    // パレットからのドロップ
    if (active.data.current?.type === "palette") {
      const kind = active.data.current.kind as PlacementKind;
      const cellDay = over.data.current?.day as DayIndex | undefined;
      const cellHour = over.data.current?.hour as number | undefined;
      if (cellDay !== undefined && cellHour !== undefined) {
        if (kind === "family") openDraftFor(kind, cellDay, cellHour);
        else await addPlacementFromPalette(kind, cellDay, cellHour);
      }
      return;
    }

    // 既存ブロックのドラッグ移動
    const p = snapshot.placements.find(item => item.id === active.id);
    if (!p) return;
    const moved = blockDropPlacement(p, { active, over }, ROW_HEIGHT);
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
    setPendingMove(moved);
    try {
      await save(snapshot.placements.map(other => (other.id === p.id ? moved : other)));
    } finally {
      setPendingMove(null);
    }
  };

  const boardGridClass =
    "grid grid-cols-1 gap-4 lg:gap-3 min-[1360px]:gap-4 items-start lg:grid-cols-[260px_minmax(0,1fr)] min-[1360px]:grid-cols-[296px_minmax(0,1fr)]";
  const showTutorial = displaySnapshot?.placements.length === 0 && desktop && role === "family" &&
    !activeDrag && !draftPlacement && !saving && !confirming && !isBoardTutorialActive;
  const tutorialKind = displaySnapshot?.people.some(person => person.canProvideCare) ? "family" : "visit";
  const currentValidation = displaySnapshot && validation?.revision === displaySnapshot.revision ? validation.result : null;
  const confirmed = snapshot !== null && confirmedRevision === snapshot.revision && !pendingMove;
  useBoardConfirmationForHeader(roomId, confirmed);
  const demoTrialTarget = useMemo(
    () =>
      isTrialStep && trialExtraction
        ? {
            day: trialExtraction.canonicalPlacement.day,
            startHour: trialExtraction.canonicalPlacement.startHour,
            endHour: trialExtraction.canonicalPlacement.endHour,
            personId: trialExtraction.canonicalPlacement.personId,
            note: trialExtraction.canonicalPlacement.note,
          }
        : null,
    [isTrialStep, trialExtraction],
  );

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

  const renderTutorial = (proposalState: TutorialProposalState) => (
    isBoardTutorialActive && boardTutorialStep !== null && (
      <DemoBoardTutorial
        step={boardTutorialStep}
        isDesktop={desktop}
        trialCompleted={trialPlacementCompleted}
        proposalState={proposalState}
        replay={replayingBoard}
        hasTrialTarget={!!trialExtraction}
        feedbackMessage={trialFeedback}
        measureKey={(snapshot?.revision ?? 0) * 2 + (trialPlacementCompleted ? 1000 : 0)}
        onStepChange={next => {
          if (showProposals && next === PROPOSALS_STEP) closeProposals();
          else {
            if (showProposals && next === CONFIRM_STEP) setShowProposals(false);
            setBoardTutorialStep(next);
          }
        }}
        onClose={finishBoardTutorial}
      />
    )
  );

  return (
    <div className="mobile-page min-h-screen pb-8">
      {/* メインコンテンツ */}
      <main className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10 py-3">
        <div className="mb-2.5 grid grid-cols-[1fr_auto] items-center gap-x-2 sm:flex">
          <h1 className="text-lg font-bold text-neutral-900">週間ボードで予定を組む</h1>
          {isDemo && role === "family" && snapshot && !isBoardTutorialActive && (
            <div className="col-span-2 row-start-2 justify-self-start">
              <TutorialReplayButton disabled={saving || confirming || loading} onClick={() => {
                boardTutorialProgress.restart(roomId);
                setReplayingBoard(true);
                setTrialPlacementCompleted(!trialExtraction);
                setTrialFeedback(null);
                setBoardTutorialStep(1);
              }} />
            </div>
          )}
          {snapshot && (
            <span
              role="status"
              className="col-start-2 row-start-1 ml-auto font-mono text-xs text-neutral-500"
            >
              {saving ? "保存中…" : "保存済み"}
            </span>
          )}
        </div>

        {loading && !snapshot && (
          <>
            <p role="status" className="mb-3 flex min-h-[42px] items-center rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-600">読み込み中…</p>
            <div aria-hidden="true">
              <div className="mb-3 h-12 rounded-xl border border-neutral-200 bg-white" />
              <div className={boardGridClass}>
                <div className="space-y-3">
                  <div className="h-44 rounded-xl border border-neutral-200 bg-white" />
                  <div className="h-48 rounded-xl border border-neutral-200 bg-white" />
                </div>
                <div className="space-y-3">
                  <div className="h-24 rounded-xl border border-neutral-200 bg-white" />
                  <div className="h-96 rounded-xl border border-neutral-200 bg-white bg-[repeating-linear-gradient(to_bottom,transparent_0_27px,var(--color-neutral-100)_27px_28px)]" />
                </div>
              </div>
            </div>
          </>
        )}
        {error && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 border border-red-200" role="alert">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void reload()}
              className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-800 hover:bg-red-100 transition-colors"
            >
              再試行
            </button>
          </div>
        )}

        {displaySnapshot && (
          <>
            {isDemo && displaySnapshot.placements.length === 0 && (
              <section className="mb-4 rounded-xl border border-neutral-200 bg-white p-4">
                <h2 className="text-sm font-bold text-indigo-950">デモ用のプランを読み込めます</h2>
                <p className="mt-1 text-sm text-indigo-900/80">デモ用の「揉めるプラン」は、読み込んだ場合だけ保存されます。</p>
                <div className="mt-3">
                  <button
                    type="button"
                    disabled={!connection.seedDemoPlan || role !== "family" || saving}
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

            {/* 上部の細いバー：確定状態・「代替案を見る」・「このプランで確定する」 */}
            <BoardStatusBand
              roomId={roomId}
              snapshot={displaySnapshot}
              validation={currentValidation}
              validationRevision={validation?.revision}
              people={displaySnapshot.people}
              canEdit={role === "family"}
              confirmed={confirmed}
              confirmBusy={saving || confirming || loading || !!activeDrag}
              confirmUnavailable={!connection.confirm}
              proposalsDisabled={loading || saving || confirming || !!activeDrag}
              onRestoreTroubledPlan={isDemo && role === "family" && snapshot && snapshot.placements.length > 0 && connection.seedDemoPlan
                ? () => {
                    const message = confirmed
                      ? "確定を取り消し、現在の配置を「揉めるプラン」に戻しますか？"
                      : "現在の配置を「揉めるプラン」に戻しますか？";
                    if (window.confirm(message)) void seedDemoPlan();
                  }
                : undefined}
              onOpenProposals={openProposals}
              onConfirm={() => void handleConfirm()}
            />

            {confirmationError && (
              <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {confirmationError}
              </p>
            )}
            {confirmed && (
              <div role="status" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                <p>現在のプランは確定済みです。{scopeCopy.confirmedMeaning}</p>
              </div>
            )}

            {/* ボード本体：左カラム（家族の事情＋数字カード）・右カラム（パレット帯＋週間ボード） */}
            <BoardDndProvider value={dndValue}>
              <DndContext
                sensors={sensors}
                collisionDetection={boardCollisionDetection}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveDrag(null)}
              >
                <div className={boardGridClass}>
                  {/* 1. 左カラム（家族の事情 ＋ 単位数・自己負担・家族の負担カード） */}
                  <div className="min-w-0 space-y-3">
                    <BoardAssistPanel
                      snapshot={displaySnapshot}
                      validation={currentValidation}
                      isOpen={isAssistOpen}
                      onToggle={setIsAssistOpen}
                    />
                    <BoardMetricsCard
                      snapshot={displaySnapshot}
                      validation={currentValidation}
                      people={displaySnapshot.people}
                      canEdit={role === "family"}
                      copaySaving={saving || confirming}
                      onChangeCopayRate={connection.saveCopayRate ? saveCopayRate : undefined}
                    />
                  </div>

                  {/* 2. 右カラム（パレット帯 ＋ 週間ボード本体） */}
                  <div className="relative min-w-0 flex flex-col gap-3">
                    {!isTrialStep && <BoardLeftNav
                      snapshot={displaySnapshot}
                      canEdit={role === "family" && !confirming}
                      canDrag={desktop}
                      services={services}
                      familySelected={familySelected}
                      onAddPlacement={kind => {
                        setFamilySelected(kind === "family");
                        if (kind !== "family") openDraftFor(kind);
                      }}
                      defaultShowDetails={false}
                      tutorialKind={showTutorial ? tutorialKind : undefined}
                    />}

                    <WeeklyBoard
                      snapshot={displaySnapshot}
                      canEdit={role === "family"}
                      saving={saving || confirming}
                      services={services}
                      validation={currentValidation}
                      onSave={handleBoardSave}
                      activeDraftPlacement={draftPlacement}
                      onSelectPlacement={setDraftPlacement}
                      onClearDraft={clearDraft}
                      demoTrialTarget={demoTrialTarget}
                      familySelected={familySelected}
                      defaultFamilyPersonId={lastPersonId}
                      onFamilyPlaced={replayingBoard && isTrialStep ? undefined : rememberFamily}
                      onSelectTrialFamily={() => setFamilySelected(true)}
                      onTrialReject={setTrialFeedback}
                    />
                    {showTutorial && <PlacementTutorial kind={tutorialKind} />}
                  </div>
                </div>

                <DragOverlay dropAnimation={null}>
                  {activeDrag?.type === "palette" && activeDrag.kind && (
                    <PaletteDragPreview
                      kind={activeDrag.kind}
                      people={displaySnapshot.people}
                    />
                  )}
                </DragOverlay>
              </DndContext>
            </BoardDndProvider>
          </>
        )}
      </main>
      <ProposalDrawer open={showProposals} onClose={closeProposals}>
        <ProposalsClient
          roomId={roomId}
          embedded
          initialIsDemo={isDemo}
          boardTutorialActive={isBoardTutorialActive}
          onCloseDrawer={closeProposals}
          renderTutorial={
            boardTutorialStep !== null &&
            isDrawerTutorialStepId(DEMO_BOARD_TUTORIAL_STEPS[boardTutorialStep - 1]?.id)
              ? renderTutorial
              : undefined
          }
          onTutorialFetch={boardTutorialStep === PROPOSAL_FETCH_STEP ? () => {
            setBoardTutorialStep(step => step === PROPOSAL_FETCH_STEP ? PROPOSAL_COMPARE_STEP : step);
          } : undefined}
          onTutorialApply={boardTutorialStep === PROPOSAL_APPLY_STEP ? () => {
            setBoardTutorialStep(step => step === PROPOSAL_APPLY_STEP || step === PROPOSALS_STEP ? CONFIRM_STEP : step);
            setShowProposals(false);
          } : undefined}
          onRoomChanged={reload}
        />
      </ProposalDrawer>
      {!showProposals && renderTutorial("fetch")}
    </div>
  );
}
