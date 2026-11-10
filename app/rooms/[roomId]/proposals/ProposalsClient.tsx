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

import Link from "next/link";
import { doc, getDocFromServer } from "firebase/firestore";
import { useCallback, useEffect, useState } from "react";
import PlanActions from "@/components/PlanActions";
import type { ValidationGroup } from "@/components/ValidationGroups";
import RoomHeader from "@/components/RoomHeader";
import { getIdToken, useAnonymousUser } from "@/lib/auth";
import { DAYS } from "@/lib/board";
import { getServiceMaster, unitsForMinutes, unitsMaster } from "@/lib/units";
import { validateRoom } from "@/lib/validation";
import { useRoomValidation } from "@/lib/useRoomValidation";
import { db } from "@/lib/firebase";
import { applyProposal, confirmPlan } from "@/lib/plan/client";
import { confirmBlockReasons } from "@/lib/plan/logic";
import { readOwnMembership, readRoomSnapshot } from "@/lib/rooms";
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
  const [{ ensureAnonymousUser }, { readOwnMembership: readMember, readRoomSnapshot: readSnap }] =
    await Promise.all([import("@/lib/auth"), import("@/lib/rooms")]);
  const user = await ensureAnonymousUser();
  const member = await readMember(roomId, user.uid);
  if (!member) throw new Error("membership-required");
  const snapshot = await readSnap(roomId);
  if (!snapshot) throw new Error("snapshot-unavailable");
  return snapshot;
}

export default function ProposalsClient({
  roomId,
  loadSnapshot = readRoomSnapshot,
  embedded = false,
  onRoomChanged,
}: {
  roomId: string;
  loadSnapshot?: (roomId: string) => Promise<RoomSnapshot | null>;
  embedded?: boolean;
  onRoomChanged?: () => void | Promise<void>;
}) {
  const user = useAnonymousUser();

  const [membership, setMembership] = useState<MemberDoc | null | undefined>(
    undefined,
  );
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(
    null,
  );
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);

  const refresh = useCallback(
    async (expectedMinRevision?: number) => {
      if (!user) return;
      const member = await readOwnMembership(roomId, user.uid);
      setMembership(member);
      if (!member) return;
      try {
        let snap = await loadSnapshot(roomId);
        if (
          expectedMinRevision !== undefined &&
          snap &&
          snap.revision < expectedMinRevision
        ) {
          // 採用後のサーバー反映を待って最大数回リトライ
          for (let i = 0; i < 5; i++) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            snap = await loadSnapshot(roomId);
            if (snap && snap.revision >= expectedMinRevision) break;
          }
        }
        setSnapshot(snap);
      } catch {
        setSnapshot(null);
      }
      try {
        const roomSnap = await getDocFromServer(
          doc(db, firestorePaths.room(roomId)),
        );
        setIsDemo(
          roomSnap.exists()
            ? ((roomSnap.data() as RoomDoc).isDemo ?? false)
            : false,
        );
      } catch {
        setIsDemo(false);
      }
      try {
        const summarySnap = await getDocFromServer(
          doc(db, firestorePaths.summary(roomId)),
        );
        setConfirmedRevision(
          summarySnap.exists()
            ? (summarySnap.data() as SummaryDoc).confirmedRevision
            : null,
        );
      } catch {
        setConfirmedRevision(null);
      }
    },
    [roomId, user, loadSnapshot],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFetchProposals = async () => {
    if (!snapshot) return;
    setFetching(true);
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
          ...(isDemo ? { demo: true } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        proposals?: Proposal[];
        message?: string;
      };
      if (!res.ok) {
        setFetchError(
          data.message ??
            "代替案を取得できませんでした。もう一度お試しください",
        );
        return;
      }
      setProposals(data.proposals ?? []);
      if ((data.proposals ?? []).length === 0) {
        setFetchError("代替案は提示されませんでした。");
      }
    } catch {
      setFetchError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setFetching(false);
    }
  };

  const handleApplyProposal = async (proposal: Proposal) => {
    const outcome = await applyProposal(roomId, proposal);
    // 適用で revision が進むため、取得済みの代替案は古くなる。破棄して取り直す
    setProposals([]);
    setAppliedMessage("代替案を採用しました。現在のプランに反映されました。");
    await refresh(outcome.revision);
    await onRoomChanged?.();
  };

  const handleConfirm = async () => {
    if (!snapshot) return;
    await confirmPlan(roomId, snapshot.revision);
    setAppliedMessage("プランを確定しました");
    await refresh();
    await onRoomChanged?.();
  };

  const { validation: roomValidation } = useRoomValidation(snapshot);
  const validation =
    roomValidation && snapshot && roomValidation.revision === snapshot.revision
      ? roomValidation.result
      : (snapshot ? validateRoom(snapshot) : null);
  const shellClass = embedded ? "mobile-page bg-neutral-100/60 pb-6" : "mobile-page min-h-screen bg-neutral-100/60 pb-16";
  const contentClass = embedded ? "min-w-0 p-4 sm:p-6" : "mx-auto max-w-4xl px-4 sm:px-6 py-8";

  if (user === null || membership === undefined) {
    return (
      <div className={shellClass}>
        {!embedded && <RoomHeader roomId={roomId} activeKey="proposals" />}
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
        {!embedded && <RoomHeader roomId={roomId} activeKey="proposals" />}
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

  // 検証の問題点を短い箇条書きリストとして収集
  const issuesList: { group: ValidationGroup; message: string }[] = [];
  if (validation) {
    if (validation.overUnits !== null && validation.overUnits > 0) {
      issuesList.push({ group: "overLimit", message: `介護保険の上限を ${validation.overUnits.toLocaleString()} 単位超えています。` });
    }
    for (const v of validation.hardViolations) {
      issuesList.push({ group: "hardViolation", message: v.detail || "利用不可の時間帯に配置されています。" });
    }
    if (validation.gaps.length > 0) {
      issuesList.push({ group: "careGap", message: `介護が必要な時間に空白が ${validation.gaps.length} か所あります。` });
    }
    if (validation.overloads.length > 0) {
      issuesList.push({ group: "caregiverOverload", message: `付き添いの負担が集中しています（${validation.overloads.length}件）。` });
    }
    for (const e of validation.validationErrors) {
      issuesList.push({ group: "validationUnavailable", message: e.reason || "家族の事情や設定を確認してください。" });
    }
  }

  const renderFetchButton = (isTop = false) => (
    <div
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
        className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {fetching ? "代替案を取得中…" : "代替案を取得する"}
      </button>
      {fetchError && (
        <div role="alert" className="space-y-1.5 text-xs text-red-700">
          <p>{fetchError}</p>
          {isDemo && (
            <p>
              <Link
                href={`/rooms/${roomId}`}
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
      {/* 全画面共通ヘッダー */}
      {!embedded && <RoomHeader roomId={roomId} activeKey="proposals" />}

      <main className={contentClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200/80 pb-4 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
              代替案とプラン確定
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              検証済みの代替案を比較し、プランを確定します。
            </p>
            {isDemo && (
              <p className="mt-2 text-xs font-semibold text-indigo-700 bg-indigo-50 inline-block px-2.5 py-1 rounded-md border border-indigo-200/60">
                デモモード：サンプル家族に合わせた固定の代替案が返ります。
              </p>
            )}
            {snapshot && validation && renderFetchButton(true)}
          </div>
          {snapshot && (
            <span className="font-mono text-xs text-neutral-500">
              入力の版：{snapshot.revision}
            </span>
          )}
        </div>

        {!snapshot || !validation ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 shadow-sm">
            プランを読み込めませんでした。
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
              className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-4">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📊</span>
                  <h2 className="text-base font-bold text-neutral-900">
                    現在のプランの状態
                  </h2>
                </div>
                <div>
                  {validation.ok ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                      {snapshot && confirmBlockReasons(snapshot, validation).length === 0 ? "問題なし（確定できます）" : "未確認事項を確認してください"}
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
                      <span className="text-sm font-bold">問題なし（基準を満たしています）</span>
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
                            <span>⚠️</span>
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
                              （枠内分{" "}
                              {validation.selfPayBreakdown?.withinYen !== null &&
                              validation.selfPayBreakdown?.withinYen !== undefined
                                ? `${validation.selfPayBreakdown.withinYen.toLocaleString()} 円`
                                : "未判定"}{" "}
                              ＋ 超過分 {overYen.toLocaleString()} 円）
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
                                    className="flex justify-between items-center bg-white/80 border border-amber-200/60 px-2.5 py-1.5 rounded"
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
                        <div className="mt-4 rounded-lg bg-indigo-50/80 border border-indigo-200/80 p-3 text-xs text-indigo-950">
                          <span className="font-bold">💡 解消のヒント: </span>
                          <span>
                            訪問介護・デイサービスの回数を減らす、家族が付き添う、自己負担で続ける方法を検討しましょう。
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
                            <span>🕒</span>
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
                        <div className="mt-4 rounded-lg bg-indigo-50/80 border border-indigo-200/80 p-3 text-xs text-indigo-950">
                          <span className="font-bold">💡 解消のヒント: </span>
                          <span>
                            空白の時間にデイサービス・訪問介護や家族の付き添いを追加してください。
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
                            <span>🏃</span>
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
                            <div className="mt-1 rounded bg-white/80 border border-orange-200/60 p-2 font-mono text-neutral-900 font-bold">
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
                        <div className="mt-4 rounded-lg bg-indigo-50/80 border border-indigo-200/80 p-3 text-xs text-indigo-950">
                          <span className="font-bold">💡 解消のヒント: </span>
                          <span>
                            週20時間を超える付き添いは、他の家族や介護サービスと分担しましょう。
                          </span>
                        </div>
                      </div>
                    )}

                    {/* ルール違反カード */}
                    {validation.hardViolations.length > 0 && (
                      <div
                        role="region"
                        aria-label="ルール違反"
                        className="rounded-xl border border-rose-300 bg-rose-50/60 p-5 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-rose-200/70 pb-2">
                          <h3 className="text-sm font-bold text-rose-950 flex items-center gap-1.5">
                            <span>🚫</span>
                            <span>予定の重なり・違反（{validation.hardViolations.length}件）</span>
                          </h3>
                          <span className="rounded bg-rose-200/80 px-2 py-0.5 text-[11px] font-bold text-rose-900">
                            要修正
                          </span>
                        </div>

                        {/* 大きな数字 */}
                        <div className="mt-3">
                          <span className="text-xs font-semibold text-rose-900">件数</span>
                          <div className="mt-0.5 text-xl sm:text-2xl font-black text-rose-900 tracking-tight">
                            {validation.hardViolations.length} 件の予定重複・違反
                          </div>
                        </div>

                        {/* 説明 */}
                        <div className="mt-3 text-xs">
                          <span className="font-bold text-neutral-800">違反内容：</span>
                          <ul className="mt-1.5 space-y-1.5 text-neutral-700">
                            {validation.hardViolations.map((v, idx) => (
                              <li
                                key={idx}
                                className="bg-white/80 border border-rose-200/60 px-3 py-2 rounded-lg text-rose-950 flex items-start gap-2"
                              >
                                <span className="text-rose-600 mt-0.5 font-bold">•</span>
                                <span className="leading-snug">{v.detail}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-indigo-50/80 border border-indigo-200/80 p-3 text-xs text-indigo-950">
                          <span className="font-bold">💡 解消のヒント: </span>
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
                            <span>❓</span>
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
                                className="bg-white/80 border border-purple-200/60 px-3 py-2 rounded-lg text-purple-950 flex items-start gap-2"
                              >
                                <span className="text-purple-600 mt-0.5 font-bold">•</span>
                                <span className="leading-snug">{e.reason}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 解消のヒント */}
                        <div className="mt-4 rounded-lg bg-indigo-50/80 border border-indigo-200/80 p-3 text-xs text-indigo-950">
                          <span className="font-bold">💡 解消のヒント: </span>
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
              {renderFetchButton(false)}
            </section>

            {/* プラン確定カードと代替案カード一覧 */}
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
          </div>
        )}
      </main>
    </div>
  );
}
