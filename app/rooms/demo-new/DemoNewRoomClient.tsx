"use client";

/**
 * デモルーム登録確認画面（/rooms/demo-new）。
 *
 * 見本データ（佐藤家）の構成を確認したうえで、ルーム名や長男の表示名を入力し、
 * 「この内容でデモルームを作る」からデモルームを作成して入力画面へ遷移する。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type FormEvent,
} from "react";
import Logo from "@/components/Logo";
import MemberAvatar from "@/components/MemberAvatar";
import { getIdToken, useAnonymousAuth } from "@/lib/auth";
import { demoFixture } from "@/lib/demo-fixture";
import {
  clearDemoRegistrationTutorialDone,
  isDemoRegistrationTutorialDone,
  markDemoRegistrationTutorialDone,
  type DemoRegistrationTutorialStepNumber,
} from "@/lib/demo-registration-tutorial";
import { createDemoRoomClient } from "@/lib/demo/client";
import { MAX_DEMO_SON_NAME_LENGTH } from "@/lib/demo/types";
import { getPersonRoleLabel } from "@/lib/people";
import { saveRecentRoom } from "@/lib/recent-rooms";
import {
  MAX_ROOM_NAME_LENGTH,
  resolveRoomDisplayName,
} from "@/lib/room-display-name";
import { scopeCopy } from "@/lib/scope-copy";
import DemoRegistrationTutorial from "./DemoRegistrationTutorial";

const DEFAULT_DEMO_ROOM_NAME = "デモルーム（佐藤家）";

const ROLE_DESCRIPTIONS = [
  "介護を受ける人：介護が必要なご本人（1人だけ）",
  "付き添いができる家族：見守りや介助を担当できる家族",
  "付き添いはできない家族：付き添いはしない家族（話し合いには参加）",
] as const;

export default function DemoNewRoomClient() {
  const router = useRouter();
  const roomNameInputId = useId();
  const roomNameHelpId = useId();
  const sonNameInputId = useId();
  const sonNameHelpId = useId();
  const sonCareAbilityId = useId();
  const createBtnHintId = useId();
  const {
    user,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAnonymousAuth();

  const [roomName, setRoomName] = useState(DEFAULT_DEMO_ROOM_NAME);
  const [sonName, setSonName] = useState("");
  const [sonCanProvideCare, setSonCanProvideCare] = useState(true);
  const [isSonNameComposing, setIsSonNameComposing] = useState(false);
  const [tutorialStep, setTutorialStep] =
    useState<DemoRegistrationTutorialStepNumber | null>(null);
  const [reviewPrefilledName, setReviewPrefilledName] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedSonName = sonName.trim();
  const isSonNameEmpty = trimmedSonName.length === 0;

  useEffect(() => {
    if (!isDemoRegistrationTutorialDone()) {
      setTutorialStep(1);
    }
  }, []);

  const finishTutorial = useCallback(() => {
    markDemoRegistrationTutorialDone();
    setTutorialStep(null);
  }, []);

  const handleSonNameChange = (value: string) => {
    setSonName(value);
    if (tutorialStep === 4 && value.trim().length === 0) {
      setTutorialStep(3);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting || user === null || isSonNameEmpty) return;
    finishTutorial();
    setError(null);
    setSubmitting(true);
    try {
      const token = await getIdToken();
      const trimmedRoomName = roomName.trim();
      const { roomId } = await createDemoRoomClient(token, {
        initialState: "troubled",
        ...(trimmedRoomName.length > 0 ? { name: trimmedRoomName } : {}),
        sonName: trimmedSonName,
      });
      const displayName = resolveRoomDisplayName({
        name: trimmedRoomName,
        isDemo: true,
      });
      saveRecentRoom({ roomId, roomName: displayName });
      router.push(`/rooms/${roomId}/input`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "デモルームを作成できませんでした。もう一度お試しください。",
      );
      setSubmitting(false);
    }
  };

  return (
    <>
      <main className="min-h-screen bg-gradient-to-b from-violet-50 via-white to-indigo-50/60">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-10 py-10">
          <div className="mb-4 flex items-center gap-2.5 border-b border-indigo-100 pb-5">
            <Link
              href="/"
              className="flex items-center gap-2.5"
              aria-label="CarePact トップページへ"
            >
              <Logo className="h-9 w-auto shrink-0" />
              <span className="text-3xl font-extrabold tracking-tight text-indigo-950">
                CarePact
              </span>
            </Link>
          </div>

          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-neutral-600 hover:text-neutral-900 mb-6 transition-colors"
          >
            <span>←</span>
            <span>トップページへ戻る</span>
          </Link>

          <h1 className="text-2xl font-bold">デモルームの登録確認</h1>
          <p className="mt-2 text-neutral-600">
            サンプル家族（佐藤家）の見本データでデモルームを作成します。
          </p>
          <p className="mt-2 text-neutral-600">
            {scopeCopy.fictionalOnly}
            {scopeCopy.supportedCare}
          </p>

          <form onSubmit={(e) => void handleSubmit(e)}>
            <section className="mt-8">
              <h2 className="text-lg font-semibold">
                <label htmlFor={roomNameInputId}>ルーム名</label>
              </h2>
              <p id={roomNameHelpId} className="mt-1 text-sm text-neutral-600">
                必要に応じて変更できます。空欄のまま作成した場合は「デモルーム（佐藤家）」になります（最大{MAX_ROOM_NAME_LENGTH}文字）。
              </p>
              <div
                data-registration-tutorial-target="room-name"
                className="mt-3 max-w-md"
              >
                <input
                  id={roomNameInputId}
                  name="roomName"
                  type="text"
                  maxLength={MAX_ROOM_NAME_LENGTH}
                  aria-describedby={roomNameHelpId}
                  className="w-full rounded border border-neutral-300 bg-white px-3 py-2 text-base sm:text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
                <p className="mt-2 rounded-lg bg-violet-50 px-3 py-2 text-sm leading-relaxed text-violet-950">
                  これはデモ（チュートリアル）です。案内に沿って、家族の登録からまとめシートの作成まで体験できます。
                </p>
              </div>
            </section>

            <section className="mt-8">
              <h2 className="text-lg font-semibold">家族の一覧（見本データ）</h2>
              <ul
                aria-label="家族の一覧"
                data-registration-tutorial-target="family-list"
                className="mt-3 space-y-2"
              >
                {demoFixture.people.map((person, index) => {
                  if (person.id === "person-son") {
                    return (
                      <li
                        key={person.id}
                        data-registration-tutorial-target="son-trial-form"
                        className="rounded-lg border border-indigo-200 bg-white px-3.5 py-3 shadow-xs"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <MemberAvatar name={sonName} index={index} />
                          <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
                            <div className="flex flex-col gap-1 min-w-0 flex-1 sm:flex-initial">
                              <label
                                htmlFor={sonNameInputId}
                                className="text-xs font-semibold text-neutral-800"
                              >
                                長男の名前{" "}
                                <span
                                  className="text-red-700"
                                  aria-hidden="true"
                                >
                                  *
                                </span>
                                <span className="sr-only">（必須）</span>
                              </label>
                              <input
                                id={sonNameInputId}
                                name="sonName"
                                type="text"
                                maxLength={MAX_DEMO_SON_NAME_LENGTH}
                                placeholder="長男"
                                required
                                aria-required="true"
                                aria-describedby={sonNameHelpId}
                                enterKeyHint="done"
                                className="w-full sm:w-44 rounded border border-neutral-300 bg-white px-3 py-1.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                value={sonName}
                                onChange={(e) =>
                                  handleSonNameChange(e.target.value)
                                }
                                onCompositionStart={() => setIsSonNameComposing(true)}
                                onCompositionEnd={() => setIsSonNameComposing(false)}
                                onKeyDown={(e) => {
                                  if (
                                    e.key === "Enter" &&
                                    (tutorialStep === 3 ||
                                      e.nativeEvent.isComposing ||
                                      isSonNameComposing)
                                  ) {
                                    e.preventDefault();
                                  }
                                }}
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label
                                htmlFor={sonCareAbilityId}
                                className="text-xs font-semibold text-neutral-800"
                              >
                                付き添いの可否
                              </label>
                              <select
                                id={sonCareAbilityId}
                                name="sonCanProvideCare"
                                className="rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                value={sonCanProvideCare ? "can" : "cannot"}
                                onChange={(e) =>
                                  setSonCanProvideCare(e.target.value === "can")
                                }
                              >
                                <option value="can">付き添いができる</option>
                                <option value="cannot">付き添いはできない</option>
                              </select>
                            </div>
                          </div>
                        </div>
                        <p
                          id={sonNameHelpId}
                          className="mt-2 text-xs text-neutral-600"
                        >
                          お試し登録として、長男の表示名を入力してください（最大
                          {MAX_DEMO_SON_NAME_LENGTH}
                          文字）。見本データでは長男は「付き添いができる家族」として登録されます。
                        </p>
                      </li>
                    );
                  }

                  const role =
                    person.careRole ??
                    (person.canProvideCare ? "caregiver" : "recipient");
                  return (
                    <li
                      key={person.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-neutral-50/50 px-3.5 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <MemberAvatar name={person.name} index={index} />
                        <span className="font-semibold text-neutral-900 text-sm">
                          {person.name}
                        </span>
                      </div>
                      <span
                        className={`rounded-md border px-2.5 py-0.5 text-xs font-medium ${
                          role === "recipient"
                            ? "border-purple-200/60 bg-purple-50 text-purple-800"
                            : role === "caregiver"
                              ? "border-emerald-200/60 bg-emerald-50 text-emerald-800"
                              : "border-neutral-200/60 bg-neutral-100 text-neutral-600"
                        }`}
                      >
                        {getPersonRoleLabel(person)}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <ul className="mt-4 space-y-1 text-sm text-neutral-700">
                {ROLE_DESCRIPTIONS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </section>

            {authError && !user && (
              <div
                role="alert"
                className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                <span>{authError}</span>
                <button
                  type="button"
                  onClick={retryAuth}
                  className="rounded border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-800 hover:bg-red-100"
                >
                  再試行
                </button>
              </div>
            )}

            {error && (
              <p role="alert" className="mt-6 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              data-registration-tutorial-target="create-btn"
              aria-describedby={isSonNameEmpty ? createBtnHintId : undefined}
              className="mt-8 rounded bg-neutral-900 px-5 py-2 text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              disabled={submitting || user === null || isSonNameEmpty}
            >
              {user === null
                ? authLoading
                  ? "ログイン中…"
                  : "ログイン未完了"
                : submitting
                  ? "作成中…"
                  : "この内容でデモルームを作る"}
            </button>
            {isSonNameEmpty && (
              <p id={createBtnHintId} className="mt-2 text-sm text-neutral-600">
                長男の名前を入力するとデモルームを作成できます。
              </p>
            )}
          </form>
          {tutorialStep === null && (
            <button
              type="button"
              disabled={submitting}
              onClick={() => {
                clearDemoRegistrationTutorialDone();
                setReviewPrefilledName(!isSonNameEmpty);
                setTutorialStep(1);
              }}
              className="mt-3 rounded px-1 py-2 text-sm font-semibold text-indigo-700 underline underline-offset-4 hover:text-indigo-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50"
            >
              チュートリアルをもう一度見る
            </button>
          )}
        </div>
      </main>

      {tutorialStep !== null && (
        <DemoRegistrationTutorial
          step={tutorialStep}
          nameReady={!isSonNameEmpty && !isSonNameComposing}
          reviewPrefilledName={reviewPrefilledName && !isSonNameEmpty}
          measureKey={isSonNameEmpty ? 0 : 1}
          onStepChange={setTutorialStep}
          onClose={finishTutorial}
        />
      )}
    </>
  );
}
