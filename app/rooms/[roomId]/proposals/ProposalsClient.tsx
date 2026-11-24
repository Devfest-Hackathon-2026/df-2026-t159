"use client";

/**
 * 代替案画面（Issue 8・14 / UX改善）：
 * - 共通ヘッダー（CarePactロゴ、各画面へのリンク）
 * - 現在のプランの状態（月換算単位数、検証の問題の箇条書き）カード
 * - Gemini の代替案を取得（POST /api/proposals）
 * - 検証済みの代替案カード（要約、変更件数、採用ボタン）
 * - プラン確定カード
 * - 白いカード、角丸、紫のアクセントで他画面と統一
 */

import { Activity, Ban, ChartColumn, CircleHelp, Clock, Lightbulb, TriangleAlert } from "lucide-react";
import { applyChanges } from "@/lib/apply-changes";
import Link from "next/link";
import { doc, getDocFromServer } from "firebase/firestore";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import TutorialReplayButton from "@/components/TutorialReplayButton";
import SpotlightTutorial from "@/components/SpotlightTutorial";
import {
  drawerTutorialProgress,
  getDemoBoardTutorialSteps,
  isDrawerTutorialStepId,
  type TutorialProposalState,
} from "@/lib/demo-board-tutorial";
import PlanActions from "@/components/PlanActions";
import type { ValidationGroup } from "@/components/ValidationGroups";
import { getIdToken, useAnonymousAuth } from "@/lib/auth";
import { DAYS } from "@/lib/board";
import { getServiceMaster, unitsForMinutes, unitsMaster } from "@/lib/units";
import { validateRoom } from "@/lib/validation";
import { useRoomValidation } from "@/lib/useRoomValidation";
import { db } from "@/lib/firebase";
import { applyProposal, confirmPlan } from "@/lib/plan/client";
import { confirmBlockReasons } from "@/lib/plan/logic";
import { readOwnMembership, readRoomSnapshot } from "@/lib/rooms";
import { scopeCopy } from "@/lib/scope-copy";
import {
  firestorePaths,
  type MemberDoc,
  type Proposal,
  type RoomDoc,
  type RoomSnapshot,
  type SummaryDoc,
} from "@/lib/types";

/** 既存画面（BurdenClient・ColumnsClient）に準拠したスナップショット取得関数 */
export async function loadMemberSnapshot(roomId: string): Promise<RoomSnapshot> {
  const [authMod, roomsMod] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/rooms"),
  ]);
  let user;
  try {
    user = await authMod.ensureAnonymousUser();
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "AnonymousAuthError" && err.message
        ? err.message
        : scopeCopy.authFailed,
    );
  }
  let member;
  try {
    member = await roomsMod.readOwnMembership(roomId, user.uid);
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "MembershipReadError" && err.message
        ? err.message
        : scopeCopy.membershipLoadFailed,
    );
  }
  if (!member) throw new Error("membership-required");
  const snapshot = await roomsMod.readRoomSnapshot(roomId);
  if (!snapshot) throw new Error("snapshot-unavailable");
  return snapshot;
}

export default function ProposalsClient({
  roomId,
  loadSnapshot = readRoomSnapshot,
  embedded = false,
  boardTutorialActive = false,
  onCloseDrawer,
  renderTutorial,
  onTutorialFetch,
  onTutorialApply,
  initialIsDemo,
  onRoomChanged,
}: {
  roomId: string;
  loadSnapshot?: (roomId: string) => Promise<RoomSnapshot | null>;
  embedded?: boolean;
  boardTutorialActive?: boolean;
  onCloseDrawer?: () => void;
  renderTutorial?: (proposalState: TutorialProposalState) => ReactNode;
  onTutorialFetch?: () => void;
  onTutorialApply?: () => void;
  initialIsDemo?: boolean;
  onRoomChanged?: () => void | Promise<void>;
}) {
  const {
    user,
    error: authError,
    retry: retryAuth,
  } = useAnonymousAuth();

  const [membership, setMembership] = useState<MemberDoc | null | undefined>(
    undefined,
  );
  const [membershipError, setMembershipError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState(false);
  const requestId = useRef(0);
  const [isDemo, setIsDemo] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(
    null,
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [proposalScrollKey, setProposalScrollKey] = useState(0);
  const planActionsContainerRef = useRef<HTMLFieldSetElement>(null);

  const refresh = useCallback(
    async (expectedMinRevision?: number) => {
      if (!user) return;
      const req = ++requestId.current;
      setMembershipError(null);
      if (expectedMinRevision === undefined) {
        setSnapshotError(false);
        setSnapshotLoading(true);
      }
      let member: MemberDoc | null;
      try {
        member = await readOwnMembership(roomId, user.uid);
      } catch {
        if (req !== requestId.current) return;
        if (expectedMinRevision === undefined) setSnapshotLoading(false);
        setMembershipError(scopeCopy.membershipLoadFailed);
        return;
      }
      if (req !== requestId.current) return;
      setMembership(member);
      if (!member) {
        if (expectedMinRevision === undefined) setSnapshotLoading(false);
        return;
      }
      try {
        const snap = await loadSnapshot(roomId);
        if (req !== requestId.current) return;
        if (expectedMinRevision === undefined) {
          setSnapshot(snap);
          setSnapshotError(snap === null);
        } else if (snap && snap.revision >= expectedMinRevision) {
          setSnapshot(snap);
          setSnapshotError(false);
        }
      } catch {
        if (req !== requestId.current) return;
        if (expectedMinRevision === undefined) {
          setSnapshot(null);
          setSnapshotError(true);
        }
      } finally {
        if (req === requestId.current && expectedMinRevision === undefined) {
          setSnapshotLoading(false);
        }
      }
      try {
        const roomSnap = await getDocFromServer(
          doc(db, firestorePaths.room(roomId)),
        );
        if (req !== requestId.current) return;
        setIsDemo(
          roomSnap.exists()
            ? ((roomSnap.data() as RoomDoc).isDemo ?? false)
            : false,
        );
      } catch {
        if (req === requestId.current) setIsDemo(false);
      }
      try {
        const summarySnap = await getDocFromServer(
          doc(db, firestorePaths.summary(roomId)),
        );
        if (req !== requestId.current) return;
        setConfirmedRevision(
          summarySnap.exists()
            ? (summarySnap.data() as SummaryDoc).confirmedRevision
            : null,
        );
      } catch {
        if (req === requestId.current) setConfirmedRevision(null);
      }
    },
    [roomId, user, loadSnapshot],
  );

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current++;
    };
  }, [refresh]);

  const effectiveIsDemo = initialIsDemo !== undefined ? initialIsDemo : isDemo;

  const [drawerStep, setDrawerStep] = useState(0);
  const [drawerFetchStart, setDrawerFetchStart] = useState(0);
  const [demoMismatch, setDemoMismatch] = useState(false);
  const proposalState: TutorialProposalState = demoMismatch ? "unavailable" : proposals.length ? "card" : effectiveIsDemo && fetchError ? "retry" : "fetch";
  const drawerEligible = embedded && effectiveIsDemo && membership?.role === "family" && !!snapshot;
  const drawerSteps = getDemoBoardTutorialSteps(
    false,
    proposalState === "card" && proposalScrollKey === drawerFetchStart ? "fetch" : proposalState,
    true,
  ).filter(step => isDrawerTutorialStepId(step.id));
  const currentDrawerStepId = drawerStep > 0 ? drawerSteps[drawerStep - 1]?.id : undefined;

  useEffect(() => {
    if (!drawerEligible) return;
    if (renderTutorial) {
      drawerTutorialProgress.startOnce(roomId);
    } else if (!boardTutorialActive && drawerTutorialProgress.startOnce(roomId)) {
      setDrawerStep(1);
    }
  }, [drawerEligible, boardTutorialActive, renderTutorial, roomId]);

  function finishDrawerTutorial() {
    drawerTutorialProgress.finish(roomId);
    setDrawerStep(0);
  }

  const handleFetchProposals = async () => {
    if (!snapshot) return;
    setFetching(true);
    setDemoMismatch(false);
    setFetchError(null);
    try {
      const token = await getIdToken();
      const res = await fetch("/api/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId,
          baseRevision: snapshot.revision,
          ...(effectiveIsDemo ? { demo: true } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        proposals?: Proposal[];
        error?: string;
        message?: string;
      };
      if (!res.ok) {
        setDemoMismatch(data.error === "demo_snapshot_mismatch");
        setFetchError(
          data.message ??
            "代替案を取得できませんでした。もう一度お試しください",
        );
        return;
      }
      setProposals(data.proposals ?? []);
      if ((data.proposals ?? []).length === 0) {
        setFetchError("代替案は提示されませんでした。");
      } else {
        setProposalScrollKey(k => k + 1);
        onTutorialFetch?.();
        if (!boardTutorialActive && currentDrawerStepId === "proposal-fetch") {
          const compareIndex = drawerSteps.findIndex(step => step.id === "proposal-compare");
          if (compareIndex !== -1) setDrawerStep(compareIndex + 1);
        }
      }
    } catch {
      setFetchError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setFetching(false);
    }
  };

  const handleApplyProposal = async (proposal: Proposal) => {
    if (!snapshot || snapshot.revision !== proposal.baseRevision) return;
    const outcome = await applyProposal(roomId, proposal);
    setSnapshot({
      ...snapshot,
      placements: applyChanges(snapshot.placements, proposal.changes),
      revision: outcome.revision,
    });
    // 適用で revision が進むため、取得済みの代替案は古くなる。破棄して取り直す
    setProposals([]);
    setAppliedMessage("代替案を採用しました。現在のプランに反映されました。");
    if (onTutorialApply || currentDrawerStepId === "proposal-apply") {
      finishDrawerTutorial();
      if (onTutorialApply) onTutorialApply();
      else onCloseDrawer?.();
    } else {
      await refresh(outcome.revision);
    }
    await onRoomChanged?.();
  };

  const handleConfirm = async () => {
    if (!snapshot) return;
    await confirmPlan(roomId, snapshot.revision);
    setAppliedMessage("プランを確定しました");
    await refresh();
    await onRoomChanged?.();
  };

  useEffect(() => {
    if (proposalScrollKey === 0) return;
    const container = planActionsContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>("[data-proposals-results]") ?? container;
    if (typeof target.scrollIntoView !== "function") return;
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
  }, [proposalScrollKey]);

  const { validation: roomValidation } = useRoomValidation(snapshot);
  const validation =
    roomValidation && snapshot && roomValidation.revision === snapshot.revision
      ? roomValidation.result
      : (snapshot ? validateRoom(snapshot) : null);
  const shellClass = embedded ? "mobile-page bg-white pb-6" : "mobile-page min-h-screen pb-16";
  const contentClass = embedded ? "min-w-0 p-4 sm:p-6" : "mx-auto max-w-4xl px-4 sm:px-6 lg:px-10 py-8";

  if (authError) {
    return (
      <div className={shellClass}>
        <main className={contentClass}>
          <h1 className="text-2xl font-black text-neutral-900">代替案</h1>
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-3"
          >
            <p>{authError}</p>
            <button
              type="button"
              onClick={retryAuth}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100 transition-colors"
            >
              再試行
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (membershipError) {
    return (
      <div className={shellClass}>
        <main className={contentClass}>
          <h1 className="text-2xl font-black text-neutral-900">代替案</h1>
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 space-y-3"
          >
            <p>{membershipError}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-xs font-bold text-red-800 hover:bg-red-100 transition-colors"
            >
              再試行
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (user === null || membership === undefined) {
    return (
      <div className={shellClass}>
        <main className={contentClass}>
          <h1 className="text-2xl font-black text-neutral-900">代替案</h1>
          <p className="mt-4 text-sm text-neutral-600">読み込み中…</p>
        </main>
      </div>
    );
  }

  if (membership === null) {
    return (
      <div className={shellClass}>
        <main className={contentClass}>
          <h1 className="text-2xl font-black text-neutral-900">代替案</h1>
          <p className="mt-4 text-sm text-neutral-700">
            このルームにはまだ参加していません。ルーム画面から招待リンクで参加してください。
          </p>
        </main>
      </div>
    );
  }

  const confirmed =
    snapshot !== null &&
    confirmedRevision !== null &&
    confirmedRevision === snapshot.revision;

  const statusNote = confirmed ? "確定済み"
    : snapshot && validation && confirmBlockReasons(snapshot, validation).length > 0
      ? "未確認事項を確認してください"
      : membership.role === "family" && snapshot ? "相談用に確定できます" : null;

  // 検証の問題点を短い箇条書きリストとして収集（通常ページ用）
  const issuesList: { group: ValidationGroup; message: string }[] = [];
  // ドロワー表示用の短い文リスト
  const drawerIssues: string[] = [];
  if (validation) {
    if (validation.gaps.length > 0) {
      const sortedGaps = [...validation.gaps].sort(
        (a, b) => a.day - b.day || a.startHour - b.startHour,
      );
      const first = sortedGaps[0];
      const firstText = `${DAYS[first.day] ?? first.day}曜 ${first.startHour}:00–${first.endHour}:00`;
      drawerIssues.push(
        sortedGaps.length === 1
          ? `${firstText} に介護の空白があります`
          : `${firstText} ほか ${sortedGaps.length - 1} 件に介護の空白があります`,
      );
    }
    if (validation.overUnits !== null && validation.overUnits > 0) {
      issuesList.push({
        group: "overLimit",
        message: `枠超過：介護保険の上限を +${validation.overUnits.toLocaleString()} 単位超えています（月換算 ${validation.monthlyUnits?.toLocaleString() ?? "未判定"} 単位）。`,
      });
      drawerIssues.push(
        `介護保険の上限を ${validation.overUnits.toLocaleString()} 単位超えています`,
      );
    }
    for (const v of validation.hardViolations) {
      issuesList.push({ group: "hardViolation", message: v.detail || "利用不可の時間帯に配置されています。" });
    }
    if (validation.gaps.length > 0) {
      const gapText = validation.gaps
        .map(g => `${DAYS[g.day] ?? g.day}曜 ${g.startHour}:00–${g.endHour}:00`)
        .join("、");
      issuesList.push({
        group: "careGap",
        message: `空白時間：介護が必要な時間に空白が ${validation.gaps.length} か所あります（${gapText}）。`,
      });
    }
    if (validation.overloads.length > 0) {
      const overloadText = validation.overloads
        .map(o => `${snapshot?.people.find(p => p.id === o.personId)?.name ?? o.personId} ${o.hours}時間/週`)
        .join("・");
      issuesList.push({
        group: "caregiverOverload",
        message: `付き添いの負担集中：${overloadText}（週20時間超）。`,
      });
      if (validation.overloads.length === 1) {
        const o = validation.overloads[0];
        const name = snapshot?.people.find(p => p.id === o.personId)?.name ?? o.personId;
        drawerIssues.push(
          `${name}の付き添いが週 ${o.hours} 時間で、見直しの目安（週20時間）を超えています`,
        );
      } else {
        const overloadSummary = validation.overloads
          .map(o => {
            const name = snapshot?.people.find(p => p.id === o.personId)?.name ?? o.personId;
            return `${name}（週 ${o.hours} 時間）`;
          })
          .join("・");
        drawerIssues.push(
          `${overloadSummary}の付き添いが、見直しの目安（週20時間）を超えています`,
        );
      }
    }
    for (const v of validation.hardViolations) {
      drawerIssues.push(v.detail || "対応できない時間帯に予定が入っています");
    }
    for (const e of validation.validationErrors) {
      issuesList.push({ group: "validationUnavailable", message: e.reason || "家族の事情や設定を確認してください。" });
      drawerIssues.push(e.reason || "家族の事情や設定を確認してください");
    }
  }

  const renderFetchButton = ({
    isTop = false,
    withTutorialTarget = false,
  }: {
    isTop?: boolean;
    withTutorialTarget?: boolean;
  } = {}) => (
    <div
      data-proposals-tutorial-target={withTutorialTarget ? "proposal-fetch" : undefined}
      className={
        isTop
          ? "mt-4 flex flex-wrap items-center gap-3"
          : "mt-6 border-t border-neutral-100 pt-4 flex flex-wrap items-center gap-3"
      }
    >
      <button
        type="button"
        disabled={fetching}
        onClick={() => void handleFetchProposals()}
        className={`rounded-xl border px-5 py-2.5 text-sm font-bold shadow-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          validation?.ok
            ? "border-gray-400 bg-white text-gray-600 hover:bg-gray-50"
            : "border-transparent bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        {fetching ? "代替案を取得中…" : "代替案を取得する"}
      </button>
      {fetchError && (
        <div role="alert" className="space-y-1.5 text-xs text-red-700">
          <p>{fetchError}</p>
          {effectiveIsDemo && (
            <p>
              <Link
                href={`/rooms/${roomId}`}
                data-proposals-tutorial-target="proposal-recovery"
                className="font-bold text-indigo-700 underline hover:text-indigo-900 inline-flex items-center gap-1"
              >
                ルームトップへ戻る（デモをリセットできます） →
              </Link>
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className={shellClass}>


      <main className={contentClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200/80 pb-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
              代替案とプラン確定
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              検証済みの代替案を比較し、プランを確定します。
            </p>
            {effectiveIsDemo && (
              <p className="mt-2 text-xs font-semibold text-indigo-700 bg-indigo-50 inline-block px-2.5 py-1 rounded-md border border-indigo-200/60">
                デモモード：サンプル家族に合わせた固定の代替案が返ります。
              </p>
            )}
            {!embedded && snapshot && validation && renderFetchButton({ isTop: true, withTutorialTarget: true })}
          </div>
          {drawerEligible && !boardTutorialActive && !drawerStep && (
            <TutorialReplayButton disabled={fetching} onClick={() => {
              drawerTutorialProgress.restart(roomId);
              setDrawerFetchStart(proposalScrollKey);
              setDemoMismatch(false);
              setDrawerStep(1);
            }} />
          )}
        </div>

        {snapshotLoading && !snapshot ? (
          <div
            role="status"
            className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 shadow-sm"
          >
            プランを読み込んでいます…
          </div>
        ) : snapshotError || !snapshot || !validation ? (
          <div
            role="alert"
            className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 shadow-sm space-y-3"
          >
            <p>プランを読み込めませんでした。</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-bold text-neutral-700 hover:bg-neutral-50 transition-colors"
            >
              再試行
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {appliedMessage && (
              <div
                role="status"
                className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 shadow-xs flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-emerald-700 font-bold text-base">✓</span>
                  <span className="text-sm font-bold">{appliedMessage}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAppliedMessage(null)}
                    className="text-xs text-emerald-700 hover:text-emerald-950 font-semibold"
                  >
                    閉じる ✕
                  </button>
                </div>
              </div>
            )}

            {/* 現在のプランの状態カード */}
            <section
              aria-label="現在のプランの状態"
              data-revision={snapshot.revision}
              data-proposals-tutorial-target="current-status"
              className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg"><ChartColumn className="ui-icon" aria-hidden="true" /></span>
                  <h2 className="text-base font-bold text-neutral-900">
                    現在のプランの状態
                  </h2>
                </div>
                <div>
                  {validation.ok ? statusNote && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      {statusNote}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                      問題あり（要調整）
                    </span>
                  )}
                </div>
              </div>

              {/* 注意点カード常時表示（検証OK時は問題なしメッセージのみ） */}
              {(() => {
                if (validation.ok) {
                  return (
                    <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 text-emerald-900 flex items-center gap-2.5">
                      <span className="text-emerald-600 font-bold text-base">✓</span>
                      <div className="text-sm">
                        <span className="font-bold">予定と費用の自動チェックを通過しました</span>
                        <p>月換算 {validation.monthlyUnits?.toLocaleString() ?? "未判定"} 単位 ／ 自己負担目安 {validation.selfPayYen?.toLocaleString() ?? "未判定"} 円</p>
                      </div>
                    </div>
                  );
                }

                if (embedded) {
                  return (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-bold text-[#C05B4D]">
                        注意点 {drawerIssues.length}件
                      </p>
                      <ul className="divide-y divide-neutral-100 text-sm leading-relaxed text-neutral-800">
                        {drawerIssues.map((message, idx) => (
                          <li key={idx} className="py-2 flex items-start gap-2">
                            <span aria-hidden="true" className="text-[#C05B4D] font-bold">•</span>
                            <span>{message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }

                const limitUnits = validation.limitUnits ?? 27048;
                const monthlyUnits = validation.monthlyUnits;
                const isOverLimit =
                  validation.overUnits !== null
                    ? validation.overUnits > 0
                    : monthlyUnits !== null && monthlyUnits > limitUnits;
                const overUnits =
                  validation.overUnits !== null
                    ? validation.overUnits
                    : isOverLimit && monthlyUnits !== null
                    ? monthlyUnits - limitUnits
                    : 0;
                const overYen = overUnits * 10;

                // サービス別月換算単位（上位）の算出
                const serviceUnitsMap = new Map<
                  string,
                  { serviceId: string; serviceName: string; weeklyUnits: number; monthlyUnits: number }
                >();
                if (snapshot) {
                  for (const p of snapshot.placements) {
                    if (p.kind === "family") continue;
                    const minutes = (p.endHour - p.startHour) * 60;
                    const sMaster = p.serviceId
                      ? getServiceMaster(unitsMaster, p.serviceId)
                      : unitsMaster.find((u) => u.kind === p.kind);
                    if (!sMaster) continue;
                    const units = unitsForMinutes(sMaster, minutes) ?? 0;
                    const existing = serviceUnitsMap.get(sMaster.serviceId) ?? {
                      serviceId: sMaster.serviceId,
                      serviceName: sMaster.name,
                      weeklyUnits: 0,
                      monthlyUnits: 0,
                    };
                    existing.weeklyUnits += units;
                    serviceUnitsMap.set(sMaster.serviceId, existing);
                  }
                  for (const item of serviceUnitsMap.values()) {
                    item.monthlyUnits = Math.round((item.weeklyUnits * 30) / 7);
                  }
                }
                const topServices = Array.from(serviceUnitsMap.values()).sort(
                  (a, b) => b.monthlyUnits - a.monthlyUnits,
                );

                // 家族別負担時間（週）
                const sortedMembers = [...validation.memberHours]
                  .map((m) => {
                    const person = snapshot?.people.find((p) => p.id === m.personId);
                    return {
                      personId: m.personId,
                      name: person?.name ?? m.personId,
                      hours: m.hours,
                      isOverload: m.hours > 20,
                    };
                  })
                  .sort((a, b) => b.hours - a.hours);
                const overloadDiff =
                  sortedMembers.length > 1
                    ? sortedMembers[0].hours - sortedMembers[sortedMembers.length - 1].hours
                    : 0;

                return (
                  <div className="mt-4 space-y-4">
                    <p className="text-xs font-bold text-neutral-700">
                      {issuesList.length} 件の注意点があります
                    </p>

                    {/* 枠超過カード */}
                    {isOverLimit && (
                      <div
                        role="region"
                        aria-label="介護保険の上限"
                        className="rounded-xl border border-amber-300 bg-amber-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-amber-200/70 pb-2">
                          <h3 className="text-sm font-bold text-amber-950 flex items-center gap-1.5">
                            <span><TriangleAlert className="ui-icon" aria-hidden="true" /></span>
                            <span>枠超過（介護保険の上限を超過）</span>
                          </h3>
                          <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                            要調整
                          </span>
                        </div>

                        {/* 大きな数字 */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-amber-900">超過単位数</span>
                          <div className="mt-0.5 text-2xl sm:text-3xl font-black text-amber-900 tracking-tight">
                            +{overUnits.toLocaleString()} 単位
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 space-y-2.5 text-xs text-amber-950">
                          <p className="leading-relaxed">
                            介護保険の区分支給限度額{" "}
                            <span className="font-bold">{limitUnits.toLocaleString()} 単位</span>
                            に対し、現在のプランは月換算で{" "}
                            <span className="font-bold text-amber-900">
                              {monthlyUnits !== null ? monthlyUnits.toLocaleString() : "未判定"} 単位
                            </span>
                            です。
                          </p>

                          <div className="rounded-lg bg-amber-100/70 border border-amber-200 p-3 leading-relaxed">
                            <span className="font-bold text-amber-950">自己負担への影響（目安）：</span>
                            <p className="mt-1">
                              限度額を超過した{" "}
                              <span className="font-bold text-amber-900">
                                +{overUnits.toLocaleString()} 単位
                              </span>{" "}
                              は保険が適用されず全額自己負担（
                              <span className="font-bold text-amber-900">
                                +{overYen.toLocaleString()} 円
                              </span>
                              の増額目安）となります。
                            </p>
                            <p className="mt-1.5 text-[11px] text-amber-900/90 font-medium">
                              現在の月額自己負担目安:{" "}
                              <span className="font-bold">
                                {validation.selfPayYen !== null
                                  ? `${validation.selfPayYen.toLocaleString()} 円`
                                  : "未判定"}
                              </span>
                              （限度内の自己負担{" "}
                              {validation.selfPayBreakdown?.withinYen !== null &&
                              validation.selfPayBreakdown?.withinYen !== undefined
                                ? `${validation.selfPayBreakdown.withinYen.toLocaleString()} 円`
                                : "未判定"}{" "}
                              ＋ 限度を超えた分（全額自己負担） {overYen.toLocaleString()} 円）
                            </p>
                          </div>

                          {/* サービス別内訳（上位） */}
                          {topServices.length > 0 && (
                            <div className="pt-1">
                              <span className="font-bold text-neutral-800">
                                サービス別の月換算単位（上位）：
                              </span>
                              <ul className="mt-1.5 space-y-1 text-neutral-700">
                                {topServices.slice(0, 3).map((item) => (
                                  <li
                                    key={item.serviceId}
                                    className="flex justify-between items-center bg-white border border-amber-200/60 px-2.5 py-1.5 rounded"
                                  >
                                    <span className="font-medium">・{item.serviceName}</span>
                                    <span className="font-mono font-bold text-neutral-900">
                                      約 {item.monthlyUnits.toLocaleString()} 単位/月
                                      <span className="text-[11px] text-neutral-500 font-normal ml-1">
                                        （週 {item.weeklyUnits.toLocaleString()} 単位）
                                      </span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-white border border-neutral-200 p-3 text-xs text-indigo-950">
                          <span className="font-bold"><Lightbulb className="ui-icon" aria-hidden="true" /> 解消のヒント: </span>
                          <span>
                            訪問介護・通所介護の回数を減らす、家族が付き添う、自己負担で続ける方法を検討しましょう。
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 空白カード */}
                    {validation.gaps.length > 0 && (
                      <div
                        role="region"
                        aria-label="空白（介護が必要な時間の空き）"
                        className="rounded-xl border border-red-300 bg-red-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-red-200/70 pb-2">
                          <h3 className="text-sm font-bold text-red-950 flex items-center gap-1.5">
                            <span><Clock className="ui-icon" aria-hidden="true" /></span>
                            <span>介護が必要な時間の空白（計 {validation.gaps.length} か所）</span>
                          </h3>
                          <span className="rounded bg-red-200/80 px-2 py-0.5 text-[11px] font-bold text-red-900">
                            要対応
                          </span>
                        </div>

                        {/* 大きな場所（複数あれば全件） */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-red-900">空白の時間帯</span>
                          <div className="mt-1 space-y-1">
                            {validation.gaps.map((g, idx) => {
                              const dayText = DAYS[g.day] ?? `${g.day}`;
                              const duration = g.endHour - g.startHour;
                              return (
                                <div
                                  key={idx}
                                  className="text-xl sm:text-2xl font-black text-red-800 tracking-tight flex items-baseline gap-2"
                                >
                                  <span>{dayText}曜 {g.startHour}:00–{g.endHour}:00</span>
                                  <span className="text-xs font-semibold text-neutral-600">
                                    （{duration}時間）
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 text-xs text-neutral-700 leading-relaxed">
                          <p>
                            ご家族が設定した「介護が必要な時間帯」のうち、介護サービスもご家族の付き添いも配置されていない時間帯があります。
                          </p>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-white border border-neutral-200 p-3 text-xs text-indigo-950">
                          <span className="font-bold"><Lightbulb className="ui-icon" aria-hidden="true" /> 解消のヒント: </span>
                          <span>
                            空白の時間に通所介護・訪問介護や家族の付き添いを追加してください。
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 負担集中カード */}
                    {validation.overloads.length > 0 && (
                      <div
                        role="region"
                        aria-label="付き添いの負担"
                        className="rounded-xl border border-orange-300 bg-orange-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-orange-200/70 pb-2">
                          <h3 className="text-sm font-bold text-orange-950 flex items-center gap-1.5">
                            <span><Activity className="ui-icon" aria-hidden="true" /></span>
                            <span>付き添いの負担集中（{validation.overloads.length}名）</span>
                          </h3>
                          <span className="rounded bg-orange-200/80 px-2 py-0.5 text-[11px] font-bold text-orange-900">
                            見直し推奨
                          </span>
                        </div>

                        {/* 大きな対象者と時間 */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-orange-900">対象者と時間</span>
                          <div className="mt-1 space-y-1">
                            {sortedMembers.filter(m => m.isOverload).map((m, idx) => (
                              <div
                                key={idx}
                                className="text-xl sm:text-2xl font-black text-orange-900 tracking-tight"
                              >
                                {m.name} {m.hours}時間／週
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 space-y-2 text-xs text-neutral-700">
                          <div>
                            <span className="font-bold text-neutral-800">家族別の付き添い時間（週）：</span>
                            <div className="mt-1 rounded bg-white border border-orange-200/60 p-2 font-mono text-neutral-900 font-bold">
                              {sortedMembers.map((m) => `${m.name} ${m.hours}時間`).join("／")}
                            </div>
                          </div>
                          <p className="text-orange-950 leading-relaxed">
                            ※ 週20時間を超える付き添いは、介護者の心身の負担を見直す目安です。
                            {sortedMembers.length > 1 && (
                              <span className="block text-neutral-600 font-normal mt-0.5">
                                他の介護者との差：最大 {overloadDiff} 時間
                              </span>
                            )}
                          </p>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-white border border-neutral-200 p-3 text-xs text-indigo-950">
                          <span className="font-bold"><Lightbulb className="ui-icon" aria-hidden="true" /> 解消のヒント: </span>
                          <span>
                            週20時間を超える付き添いは、他の家族や介護サービスと分担しましょう。
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 確認が必要な予定カード */}
                    {validation.hardViolations.length > 0 && (
                      <div
                        role="region"
                        aria-label="確認が必要な予定"
                        className="rounded-xl border border-rose-300 bg-rose-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-rose-200/70 pb-2">
                          <h3 className="text-sm font-bold text-rose-950 flex items-center gap-1.5">
                            <span><Ban className="ui-icon" aria-hidden="true" /></span>
                            <span>確認が必要な予定（{validation.hardViolations.length}件）</span>
                          </h3>
                          <span className="rounded bg-rose-200/80 px-2 py-0.5 text-[11px] font-bold text-rose-900">
                            要修正
                          </span>
                        </div>

                        {/* 大きな数字 */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-rose-900">件数</span>
                          <div className="mt-0.5 text-xl sm:text-2xl font-black text-rose-900 tracking-tight">
                            {validation.hardViolations.length} 件の確認が必要な予定
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 text-xs">
                          <span className="font-bold text-neutral-800">内容：</span>
                          <ul className="mt-1.5 space-y-1.5 text-neutral-700">
                            {validation.hardViolations.map((v, idx) => (
                              <li
                                key={idx}
                                className="bg-white border border-rose-200/60 px-3 py-2 rounded-lg text-rose-950 flex items-start gap-2"
                              >
                                <span className="text-rose-600 mt-0.5 font-bold">•</span>
                                <span className="leading-snug">{v.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-white border border-neutral-200 p-3 text-xs text-indigo-950">
                          <span className="font-bold"><Lightbulb className="ui-icon" aria-hidden="true" /> 解消のヒント: </span>
                          <span>家族が対応できる曜日・時間に予定を変えてください。</span>
                        </div>
                      </div>
                    )}

                    {/* 未判定カード */}
                    {validation.validationErrors.length > 0 && (
                      <div
                        role="region"
                        aria-label="未判定・不備"
                        className="rounded-xl border border-purple-300 bg-purple-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-purple-200/70 pb-2">
                          <h3 className="text-sm font-bold text-purple-950 flex items-center gap-1.5">
                            <span><CircleHelp className="ui-icon" aria-hidden="true" /></span>
                            <span>未判定・不備（{validation.validationErrors.length}件）</span>
                          </h3>
                          <span className="rounded bg-purple-200/80 px-2 py-0.5 text-[11px] font-bold text-purple-900">
                            要確認
                          </span>
                        </div>

                        {/* 大きな数字 */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-purple-900">件数</span>
                          <div className="mt-0.5 text-xl sm:text-2xl font-black text-purple-900 tracking-tight">
                            {validation.validationErrors.length} 件の未判定
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 text-xs">
                          <span className="font-bold text-neutral-800">未判定の理由：</span>
                          <ul className="mt-1.5 space-y-1.5 text-neutral-700">
                            {validation.validationErrors.map((e, idx) => (
                              <li
                                key={idx}
                                className="bg-white border border-purple-200/60 px-3 py-2 rounded-lg text-purple-950 flex items-start gap-2"
                              >
                                <span className="text-purple-600 mt-0.5 font-bold">•</span>
                                <span className="leading-snug">{e.reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-white border border-neutral-200 p-3 text-xs text-indigo-950">
                          <span className="font-bold"><Lightbulb className="ui-icon" aria-hidden="true" /> 解消のヒント: </span>
                          <span>
                            通所介護・通所リハビリの時間区分や、家族の都合・介護が必要な時間帯を確認してください。
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 代替案取得ボタン */}
              {renderFetchButton({ isTop: false, withTutorialTarget: embedded })}
            </section>

            {/* プラン確定カードと代替案カード一覧 */}
            <fieldset
              ref={planActionsContainerRef}
              disabled={
                Boolean(renderTutorial && !onTutorialApply) ||
                (drawerStep > 0 && currentDrawerStepId !== "proposal-apply")
              }
            >
              <PlanActions
                snapshot={snapshot}
                validation={validation}
                proposals={proposals}
                confirmed={confirmed}
                canEdit={membership.role === "family"}
                onApplyProposal={handleApplyProposal}
                onConfirm={handleConfirm}
                roomId={roomId}
                suppressSuccessNotice
              />
            </fieldset>
          </div>
        )}
      </main>
      {drawerEligible && !boardTutorialActive && drawerStep > 0 && (
        <SpotlightTutorial
          steps={drawerSteps}
          step={drawerStep}
          targetAttr="data-proposals-tutorial-target"
          testIdPrefix="demo-drawer-tutorial"
          onStepChange={setDrawerStep}
          onClose={finishDrawerTutorial}
        />
      )}
      {embedded && snapshot && validation && renderTutorial?.(proposalState)}
    </div>
  );
}
