"use client";

/**
 * 負担ビューのクライアントコンポーネント（Issue 4）。
 *
 * 入力は ValidationResult のみ（＋表示用の people）。
 * useRoomValidationで実エンジンの結果と入力版を取得し、表示部品へ渡す。
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import RoomHeader from "@/components/RoomHeader";
import { demoFixture } from "@/lib/demo-fixture";
import type { RoomSnapshot } from "@/lib/types";
import { useRoomValidation } from "@/lib/useRoomValidation";
import BurdenView from "@/components/BurdenView";

export async function loadMemberSnapshot(roomId: string): Promise<RoomSnapshot> {
  const [{ ensureAnonymousUser }, { readOwnMembership, readRoomSnapshot }] = await Promise.all([
    import("@/lib/auth"), import("@/lib/rooms"),
  ]);
  const user = await ensureAnonymousUser();
  const member = await readOwnMembership(roomId, user.uid);
  if (!member) throw new Error("membership-required");
  const snapshot = await readRoomSnapshot(roomId);
  if (!snapshot) throw new Error("snapshot-unavailable");
  return snapshot;
}

export default function BurdenClient({ roomId, loadSnapshot = loadMemberSnapshot }: { roomId: string; loadSnapshot?: (roomId: string) => Promise<RoomSnapshot> }) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [useFixturePreview, setUseFixturePreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const { validation, pending, error: validationError } = useRoomValidation(snapshot);

  const loadData = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setSnapshot(null);
    setError(null);
    try {
      const snap = await loadSnapshot(roomId);
      if (request === requestId.current) setSnapshot(snap);
    } catch {
      if (request === requestId.current) setError("ルームを読み込めませんでした。参加状態と接続設定を確認して再読み込みしてください。");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [roomId, loadSnapshot]);

  useEffect(() => {
    void loadData();
    return () => { requestId.current++; };
  }, [loadData]);

  // デモ用プレビュー表示（fixture の揉めるプラン）
  const activeValidation = useFixturePreview
    ? demoFixture.troubledPlan.expectedValidationResult
    : validation?.revision === snapshot?.revision ? validation?.result : null;
  const activePeople = useFixturePreview
    ? demoFixture.people
    : (snapshot?.people ?? []);

  return (
    <div className="min-h-screen bg-neutral-100/60 pb-16">
      {/* 全画面共通ヘッダー */}
      <RoomHeader roomId={roomId} activeKey="burden" />

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-8">
        {/* 操作サブバー */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-neutral-500">
              {snapshot ? `入力の版：${snapshot.revision}` : "読み込み中"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/rooms/${roomId}/board`}
              className="rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500 transition-colors"
            >
              ← 週間ボードに戻る
            </Link>
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadData()}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 transition-colors"
            >
              再読み込み
            </button>
            <button
              type="button"
              onClick={() => setUseFixturePreview((prev) => !prev)}
              className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition-colors"
            >
              {useFixturePreview
                ? "ルームのデータに戻す"
                : "デモ過密プランの警告をプレビュー"}
            </button>
          </div>
        </div>

        {/* 画面ヘッダー */}
        <div className="mb-6">
          <h1 className="text-2xl font-black tracking-tight text-neutral-900">
            負担ビュー
          </h1>
          <p className="mt-1 text-sm text-neutral-600">
            家族で会話するときの話の論点整理用シートです。誰に負担が寄っているか、どこが空白か、保険の枠の状況を一目で確認できます。
          </p>
        </div>

      {useFixturePreview && <p role="status" className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm">架空の「揉めるプラン」の期待値を表示しています。ルームの実データや判定結果ではなく、保存も行いません。</p>}
      {!useFixturePreview && (loading || pending) ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
          データを読み込んでいます…
        </div>
      ) : !useFixturePreview && (error || validationError) ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="font-bold">検証結果は未判定です</h2>
          <p className="mt-1 text-sm">
            {error ?? validationError}
          </p>
          <div className="mt-4">
            <Link
              href={`/rooms/${roomId}`}
              className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
            >
              ルーム入口へ
            </Link>
          </div>
        </div>
      ) : activeValidation ? (
        <>
          {!useFixturePreview && validation && <p className="mb-4 text-sm" data-testid="burden-validation-revision">入力の版：{validation.revision}</p>}
          <BurdenView validation={activeValidation} people={activePeople} />
        </>
      ) : (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-600">
          <p>配置データがまだありません。週間ボードで配置を行ってください。</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link
              href={`/rooms/${roomId}/board`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white"
            >
              週間ボードへ
            </Link>
            <button
              type="button"
              onClick={() => setUseFixturePreview(true)}
              className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700"
            >
              デモ過密プランを表示してみる
            </button>
          </div>
        </div>
      )}
      </main>
    </div>
  );
}
