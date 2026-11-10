"use client";

/**
 * ルームの入口画面（Issue 2 / UX改善）：
 * - 共通ヘッダー（CarePactロゴ、各画面へのリンク、現在位置表示）
 * - ルームの状態に応じた「次にやること」案内カードと手順ステップ表示
 * - 招待リンク（?invite=トークン）からの参加確定
 * - 自分の参加状態と role の表示
 * - family による招待リンクの発行（family用／careManager用）
 * - 登録済みの家族（people）と revision の確認
 * - 白いカード、角丸、紫のアクセントに揃えたUIデザイン
 */

import { doc, getDocFromServer } from "firebase/firestore";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import CommentPanel from "@/components/CommentPanel";
import RoomHeader from "@/components/RoomHeader";
import { getIdToken, useAnonymousUser } from "@/lib/auth";
import {
  resetDemoRoomClient,
  seedDemoTroubledPlanClient,
} from "@/lib/demo/client";
import { db } from "@/lib/firebase";
import { listComments, postComment } from "@/lib/plan/client";
import {
  canDeletePerson,
  getPersonAvatarText,
  getPersonRoleLabel,
  normalizePeople,
  validatePeopleCareRoles,
} from "@/lib/people";
import PersonIconPicker from "@/components/PersonIconPicker";
import { saveRecentRoom } from "@/lib/recent-rooms";
import {
  commitRoomChange,
  readOwnMembership,
  readRoomSnapshot,
} from "@/lib/rooms";
import {
  firestorePaths,
  type CareRole,
  type MemberDoc,
  type MemberRole,
  type Person,
  type RoomComment,
  type RoomDoc,
  type RoomSnapshot,
  type SummaryDoc,
} from "@/lib/types";

const JOIN_ERROR_MESSAGES: Record<string, string> = {
  invite_not_found:
    "招待リンクが正しくありません。リンクを発行した人に確認してください。",
  invite_already_used:
    "この招待リンクは使用済みです。新しいリンクを発行してもらってください。",
  invite_expired:
    "この招待リンクは期限切れです（有効期間は24時間）。新しいリンクを発行してもらってください。",
  invalid_token: "招待リンクが正しくありません。",
};

const ROLE_LABELS: Record<MemberRole, string> = {
  family: "家族（プランを編集できます）",
  careManager: "ケアマネ（閲覧とコメントのみ）",
};

export default function RoomHomeClient({ roomId }: { roomId: string }) {
  const user = useAnonymousUser();
  const searchParams = useSearchParams();
  const router = useRouter();
  const inviteToken = searchParams.get("invite");

  const [membership, setMembership] = useState<MemberDoc | null | undefined>(
    undefined,
  );
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [snapshotLoaded, setSnapshotLoaded] = useState(false);
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(
    null,
  );
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [inviteUrls, setInviteUrls] = useState<
    Partial<Record<MemberRole, string>>
  >({});
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [comments, setComments] = useState<RoomComment[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoMessage, setDemoMessage] = useState<string | null>(null);

  // 家族の追加・編集（Issue #71, #72）
  const [isEditingPeople, setIsEditingPeople] = useState(false);
  const [draftPeople, setDraftPeople] = useState<Person[]>([]);
  const [peopleSaving, setPeopleSaving] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleDeleteWarnings, setPeopleDeleteWarnings] = useState<
    Record<string, string>
  >({});

  const refresh = useCallback(async () => {
    if (!user) return;
    const member = await readOwnMembership(roomId, user.uid);
    setMembership(member);
    if (member) {
      let currentSnapshot: RoomSnapshot | null = null;
      try {
        currentSnapshot = await readRoomSnapshot(roomId);
        setSnapshot(currentSnapshot);
      } catch {
        setSnapshot(null);
      } finally {
        setSnapshotLoaded(true);
      }
      try {
        setComments(await listComments(roomId));
      } catch {
        setComments([]);
      }
      let currentIsDemo = false;
      try {
        const roomSnap = await getDocFromServer(
          doc(db, firestorePaths.room(roomId)),
        );
        currentIsDemo = roomSnap.exists()
          ? ((roomSnap.data() as RoomDoc).isDemo ?? false)
          : false;
        setIsDemo(currentIsDemo);
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

      // 最近アクセスしたルームを端末に記録（Issue #73）
      if (currentSnapshot) {
        const recipient = currentSnapshot.people.find(
          (p) => p.careRole === "recipient",
        );
        const roomName = currentIsDemo
          ? "デモルーム（佐藤家）"
          : recipient?.name
          ? `${recipient.name}のルーム`
          : currentSnapshot.people[0]?.name
          ? `${currentSnapshot.people[0].name}のルーム`
          : "ルーム";
        saveRecentRoom({ roomId, roomName });
      }
    }
  }, [roomId, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleJoin = async () => {
    if (!inviteToken) return;
    setJoining(true);
    setJoinError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: inviteToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setJoinError(
          JOIN_ERROR_MESSAGES[data.error ?? ""] ??
            "参加できませんでした。リンクを発行した人に確認してください。",
        );
        return;
      }
      // トークンをURLに残さない（履歴・共有で漏れるのを防ぐ）
      router.replace(`/rooms/${roomId}`);
      await refresh();
    } catch {
      setJoinError("通信に失敗しました。もう一度お試しください。");
    } finally {
      setJoining(false);
    }
  };

  const handleIssueInvite = async (role: MemberRole) => {
    setInviteError(null);
    try {
      const token = await getIdToken();
      const res = await fetch(`/api/rooms/${roomId}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        setInviteError("招待リンクを発行できませんでした。");
        return;
      }
      const data = (await res.json()) as { joinPath: string };
      setInviteUrls((prev) => ({
        ...prev,
        [role]: `${window.location.origin}${data.joinPath}`,
      }));
    } catch {
      setInviteError("通信に失敗しました。もう一度お試しください。");
    }
  };

  const handleSubmitComment = async (body: string) => {
    await postComment(roomId, body);
    setComments(await listComments(roomId));
  };

  const handleSeedDemo = async () => {
    setDemoBusy(true);
    setDemoMessage(null);
    try {
      const token = await getIdToken();
      await seedDemoTroubledPlanClient(token, roomId);
      setDemoMessage(
        "「揉めるプラン」を投入しました。週間ボードで確認できます。",
      );
      await refresh();
    } catch (err) {
      setDemoMessage(
        err instanceof Error ? err.message : "デモの投入に失敗しました。",
      );
    } finally {
      setDemoBusy(false);
    }
  };

  const handleResetDemo = async () => {
    const ok = window.confirm(
      "デモルームを初期状態に戻します。予定や家族の事情は元に戻りますが、ケアマネのコメントは残ります。よろしいですか？",
    );
    if (!ok) return;
    setDemoBusy(true);
    setDemoMessage(null);
    try {
      const token = await getIdToken();
      await resetDemoRoomClient(token, roomId);
      setDemoMessage("デモルームを初期状態に戻しました。");
      await refresh();
    } catch (err) {
      setDemoMessage(
        err instanceof Error ? err.message : "リセットに失敗しました。",
      );
    } finally {
      setDemoBusy(false);
    }
  };

  const handleStartEditingPeople = () => {
    if (!snapshot) return;
    setDraftPeople(snapshot.people.map((p) => ({ ...p })));
    setPeopleError(null);
    setPeopleDeleteWarnings({});
    setIsEditingPeople(true);
  };

  const handleCancelEditingPeople = () => {
    setIsEditingPeople(false);
    setPeopleError(null);
    setPeopleDeleteWarnings({});
  };

  const handleAddPerson = () => {
    setDraftPeople((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "",
        canProvideCare: true,
        careRole: "caregiver",
      },
    ]);
  };

  const handleUpdatePerson = (personId: string, patch: Partial<Person>) => {
    setDraftPeople((prev) =>
      prev.map((p) => {
        if (p.id !== personId) return p;
        const next = { ...p, ...patch };
        if (patch.careRole !== undefined) {
          next.canProvideCare = patch.careRole === "caregiver";
        }
        return next;
      }),
    );
  };

  const handleDeletePerson = (personId: string) => {
    if (!snapshot) return;
    const check = canDeletePerson(
      personId,
      snapshot.placements,
      snapshot.constraints,
    );
    if (!check.canDelete) {
      setPeopleDeleteWarnings((prev) => ({
        ...prev,
        [personId]: check.reason || "この家族は削除できません。",
      }));
      return;
    }
    setDraftPeople((prev) => prev.filter((p) => p.id !== personId));
    setPeopleDeleteWarnings((prev) => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
  };

  const handleSavePeople = async () => {
    if (!snapshot) return;
    const validation = validatePeopleCareRoles(draftPeople);
    if (!validation.valid) {
      setPeopleError(validation.errors.join(" "));
      return;
    }

    setPeopleSaving(true);
    setPeopleError(null);
    try {
      const normalized = normalizePeople(
        draftPeople.map((p) => ({
          id: p.id,
          name: p.name.trim(),
          canProvideCare: p.careRole === "caregiver",
          careRole: p.careRole,
          icon: p.icon,
        })),
      );
      await commitRoomChange(roomId, snapshot.revision, {
        people: normalized,
      });
      setIsEditingPeople(false);
      await refresh();
    } catch (err) {
      setPeopleError(
        err instanceof Error ? err.message : "家族の保存に失敗しました。",
      );
    } finally {
      setPeopleSaving(false);
    }
  };

  // 案内カード用の判定
  const isConfirmed = Boolean(
    snapshot &&
      confirmedRevision !== null &&
      confirmedRevision !== undefined &&
      confirmedRevision === snapshot.revision,
  );
  const hasPlacements = Boolean(
    snapshot && snapshot.placements && snapshot.placements.length > 0,
  );
  const hasInputs = Boolean(
    snapshot &&
      ((snapshot.constraints && snapshot.constraints.length > 0) ||
        (snapshot.hopes && snapshot.hopes.length > 0) ||
        (snapshot.unknowns && snapshot.unknowns.length > 0) ||
        (snapshot.careWindows && snapshot.careWindows.length > 0)),
  );

  let nextAction: {
    step: 1 | 2 | 3;
    title: string;
    description: string;
    buttonText: string;
    href: string;
    badgeText: string;
  };

  if (isConfirmed) {
    nextAction = {
      step: 3,
      title: "まとめシートで面談の準備をする",
      description:
        "プランが確定しました。ケアマネジャーとの面談に向けて、まとめシートの確認や印刷ができます。",
      buttonText: "まとめシートで面談の準備をする",
      href: `/rooms/${roomId}/summary`,
      badgeText: "確定済み",
    };
  } else if (hasPlacements) {
    nextAction = {
      step: 2,
      title: "代替案を見て、プランを決める",
      description:
        "週間ボードで予定が組まれています。枠オーバーや空白時間がないか検証し、代替案を確認してプランを決めましょう。",
      buttonText: "代替案を見て、プランを決める",
      href: `/rooms/${roomId}/proposals`,
      badgeText: "配置あり・未確定",
    };
  } else if (hasInputs) {
    nextAction = {
      step: 2,
      title: "週間ボードで予定を組む",
      description:
        "ご家族の事情が入力されました。デイサービスや訪問介護、付き添いなどの予定を週間ボードで配置しましょう。",
      buttonText: "週間ボードで予定を組む",
      href: `/rooms/${roomId}/board`,
      badgeText: "入力済み・配置なし",
    };
  } else {
    nextAction = {
      step: 1,
      title: "まず、家族の事情を入れる",
      description:
        "退院書類の写真やご家族の予定・希望を入力して、介護が必要な時間帯や家族の事情を整理しましょう。",
      buttonText: "まず、家族の事情を入れる",
      href: `/rooms/${roomId}/input`,
      badgeText: "最初のステップ",
    };
  }

  return (
    <div className="mobile-page min-h-screen bg-neutral-100/60 pb-16">
      {/* 全画面共通ヘッダー */}
      <RoomHeader roomId={roomId} activeKey="top" />

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200/80 pb-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-neutral-900">
              ルーム
            </h1>
          </div>
          {membership && (
            <div className="text-right">
              <span className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 border border-indigo-200/60">
                {ROLE_LABELS[membership.role]}
              </span>
            </div>
          )}
        </div>

        {user === null || membership === undefined ? (
          <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 shadow-sm">
            読み込み中…
          </div>
        ) : membership === null ? (
          <section className="mt-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-neutral-900">
              ルームへの参加
            </h2>
            <p className="mt-2 text-sm text-neutral-700">
              このルームにはまだ参加していません。
            </p>
            {inviteToken ? (
              <div className="mt-4">
                <button
                  type="button"
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  disabled={joining}
                  onClick={handleJoin}
                >
                  {joining ? "参加中…" : "招待リンクで参加する"}
                </button>
                {joinError && (
                  <p className="mt-3 text-sm text-red-700">{joinError}</p>
                )}
                <p className="mt-3 text-xs text-neutral-500">
                  招待の有効期間は24時間で、1回だけ使えます。role（家族／ケアマネ）は招待した側の設定で決まります。
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-neutral-600">
                参加には招待リンクが必要です。ルームを作った人から招待リンクを受け取って、そのリンクから開いてください。
              </p>
            )}
          </section>
        ) : (
          <div className="mt-6 space-y-6">
            {/* ルームトップの上部：「次にやること」案内カード ＋ 手順全体の小さなステップ表示 */}
            {!snapshotLoaded ? (
              <div
                aria-label="読み込み中"
                className="rounded-2xl border border-neutral-200/80 bg-white/70 p-6 shadow-xs text-center text-xs text-neutral-400"
              >
                読み込み中…
              </div>
            ) : (
              <section
                aria-label="次にやること"
                className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-white to-indigo-50/40 p-6 shadow-sm"
              >
                {/* 手順全体が分かる小さなステップ表示 */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-indigo-100/70 pb-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-bold">
                      ✓
                    </span>
                    <span className="text-xs font-bold tracking-wider uppercase text-indigo-700">
                      次にやること
                    </span>
                    <span className="rounded-md bg-indigo-100/70 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                      {nextAction.badgeText}
                    </span>
                  </div>

                  <nav aria-label="手続きの進行状況">
                    <ol className="max-sm:flex-wrap flex items-center gap-1.5 text-xs font-bold">
                      <li
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${
                          nextAction.step === 1
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        <span>1. 事情を入れる</span>
                      </li>
                      <span className="text-neutral-300">→</span>
                      <li
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${
                          nextAction.step === 2
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        <span>2. ボードで組む</span>
                      </li>
                      <span className="text-neutral-300">→</span>
                      <li
                        className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${
                          nextAction.step === 3
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        <span>3. 確定・印刷</span>
                      </li>
                    </ol>
                  </nav>
                </div>

                {/* 案内カード本文と遷移ボタン */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                  <div className="max-w-xl">
                    <h2 className="text-lg sm:text-xl font-bold text-neutral-900">
                      {nextAction.title}
                    </h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-neutral-600">
                      {nextAction.description}
                    </p>
                  </div>

                  <Link
                    href={nextAction.href}
                    className="max-sm:w-full max-sm:justify-center max-sm:min-h-11 inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-indigo-700 transition-colors shrink-0"
                  >
                    <span>{nextAction.buttonText}</span>
                    <span>→</span>
                  </Link>
                </div>
              </section>
            )}

            {/* 登録されている家族カード（Issue #71, #72） */}
            {snapshot && (
              <section
                aria-label="登録されている家族"
                className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                      <span>👥</span>
                      <span>登録されている家族</span>
                    </h2>
                    <span className="text-xs text-neutral-500">
                      {snapshot.people.length}名
                    </span>
                  </div>
                  {membership?.role === "family" && !isEditingPeople && (
                    <button
                      type="button"
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-2xs"
                      onClick={handleStartEditingPeople}
                    >
                      家族を追加・編集
                    </button>
                  )}
                </div>

                {!isEditingPeople ? (
                  <ul className="mt-4 divide-y divide-neutral-100">
                    {snapshot.people.map((person) => {
                      const role = person.careRole ?? (person.canProvideCare ? "caregiver" : "recipient");
                      return (
                        <li
                          key={person.id}
                          className="max-sm:flex-wrap max-sm:gap-2 flex items-center justify-between py-2.5 text-sm first:pt-0 last:pb-0"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 font-bold text-lg text-neutral-700 shadow-2xs">
                              {getPersonAvatarText(person)}
                            </span>
                            <span className="font-semibold text-neutral-800">
                              {person.name}
                            </span>
                          </div>
                          <span
                            className={`rounded-md px-2.5 py-0.5 text-xs font-medium border ${
                              role === "recipient"
                                ? "bg-purple-50 text-purple-800 border-purple-200/60"
                                : role === "caregiver"
                                ? "bg-emerald-50 text-emerald-800 border-emerald-200/60"
                                : "bg-neutral-100 text-neutral-600 border-neutral-200/60"
                            }`}
                          >
                            {getPersonRoleLabel(person)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="mt-4 space-y-4">
                    <p className="text-xs text-neutral-600">
                      名前や区分（3択）を編集できます。介護を受ける人をちょうど1人、付き添いができる家族を1人以上指定してください。
                    </p>
                    <div className="space-y-3">
                      {draftPeople.map((person) => (
                        <div
                          key={person.id}
                          className="rounded-lg border border-neutral-200 bg-neutral-50/50 p-3 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white border border-neutral-200 font-bold text-lg text-neutral-700 shadow-2xs"
                            >
                              {getPersonAvatarText(person) || "？"}
                            </span>
                            <input
                              className="w-36 sm:w-44 rounded border bg-white px-2.5 py-1.5 text-sm"
                              placeholder="名前（例：父、長女）"
                              value={person.name}
                              onChange={(e) =>
                                handleUpdatePerson(person.id, {
                                   name: e.target.value,
                                })
                              }
                            />
                            <select
                              aria-label="家族の区分"
                              className="rounded border bg-white px-2.5 py-1.5 text-sm"
                              value={person.careRole ?? (person.canProvideCare ? "caregiver" : "recipient")}
                              onChange={(e) =>
                                handleUpdatePerson(person.id, {
                                  careRole: e.target.value as CareRole,
                                })
                              }
                            >
                              <option value="recipient">介護を受ける人</option>
                              <option value="caregiver">付き添いができる家族</option>
                              <option value="family">付き添いはできない家族</option>
                            </select>
                            <button
                              type="button"
                              className="text-xs text-red-600 hover:text-red-800 font-medium ml-auto px-2 py-1"
                              onClick={() => handleDeletePerson(person.id)}
                            >
                              削除
                            </button>
                          </div>
                          <div className="pt-1">
                            <span className="text-[11px] font-semibold text-neutral-500 mb-1 block">
                              アイコンを選択：
                            </span>
                            <PersonIconPicker
                              value={person.icon}
                              onChange={(icon) =>
                                handleUpdatePerson(person.id, { icon })
                              }
                            />
                          </div>
                          {peopleDeleteWarnings[person.id] && (
                            <p className="text-xs text-red-600 font-medium">
                              ⚠️ {peopleDeleteWarnings[person.id]}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="rounded border border-dashed border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      onClick={handleAddPerson}
                    >
                      ＋ 家族を追加
                    </button>

                    {peopleError && (
                      <p className="text-xs text-red-700 font-semibold">
                        {peopleError}
                      </p>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-neutral-100">
                      <button
                        type="button"
                        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                        disabled={peopleSaving}
                        onClick={handleCancelEditingPeople}
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-50"
                        disabled={peopleSaving}
                        onClick={() => void handleSavePeople()}
                      >
                        {peopleSaving ? "保存中…" : "変更を保存"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* コラムへの導線 */}
            <div className="flex justify-end items-center px-1">
              <Link
                href={`/rooms/${roomId}/columns`}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
              >
                <span>コラムを読む</span>
                <span>→</span>
              </Link>
            </div>

            {/* デモ操作カード */}
            {isDemo && (
              <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>🧪</span>
                  <span>デモ操作</span>
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  このルームはデモ用です。サンプル家族（佐藤家）の初期状態に戻したり、「揉めるプラン」を投入したりできます。
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm">
                  <button
                    type="button"
                    className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors shadow-2xs"
                    disabled={demoBusy}
                    onClick={() => void handleSeedDemo()}
                  >
                    「揉めるプラン」を投入
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors shadow-2xs"
                    disabled={demoBusy}
                    onClick={() => void handleResetDemo()}
                  >
                    デモをリセット
                  </button>
                </div>
                {demoMessage && (
                  <p className="mt-3 rounded-lg bg-neutral-50 p-2.5 text-xs text-neutral-700 border border-neutral-200">
                    {demoMessage}
                  </p>
                )}
              </section>
            )}

            {/* コメントパネル */}
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <CommentPanel
                comments={comments}
                canComment={membership.role === "careManager"}
                onSubmitComment={handleSubmitComment}
              />
            </section>

            {/* 招待リンクの発行（familyのみ） */}
            {membership.role === "family" && (
              <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
                <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
                  <span>✉️</span>
                  <span>招待リンクの発行</span>
                </h2>
                <p className="mt-1 text-xs text-neutral-600">
                  リンクは24時間有効で、1回だけ使えます。送る相手に合わせて発行してください。
                </p>
                <div className="mt-4 flex flex-wrap gap-2 text-xs sm:text-sm">
                  <button
                    type="button"
                    className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 font-semibold text-neutral-700 hover:bg-neutral-50 shadow-2xs transition-colors"
                    onClick={() => handleIssueInvite("family")}
                  >
                    家族用リンクを発行
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 font-semibold text-neutral-700 hover:bg-neutral-50 shadow-2xs transition-colors"
                    onClick={() => handleIssueInvite("careManager")}
                  >
                    ケアマネ用リンクを発行
                  </button>
                </div>
                {inviteError && (
                  <p className="mt-3 text-xs text-red-700">{inviteError}</p>
                )}
                {(["family", "careManager"] as MemberRole[]).map((role) =>
                  inviteUrls[role] ? (
                    <div key={role} className="mt-4">
                      <label className="text-xs font-semibold text-neutral-700">
                        {role === "family" ? "家族用" : "ケアマネ用"}リンク
                      </label>
                      <input
                        readOnly
                        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-mono text-neutral-800 bg-neutral-50 focus:bg-white"
                        value={inviteUrls[role]}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                  ) : null,
                )}
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
