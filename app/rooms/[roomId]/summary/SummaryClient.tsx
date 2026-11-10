"use client";

import { Timestamp } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import RoomHeader from "@/components/RoomHeader";
import { demoFixture } from "@/lib/demo-fixture";
import type { SummaryDoc } from "@/lib/types";
import type { SummaryReadState } from "@/lib/summary-store";
import SummarySheet from "@/components/SummarySheet";

async function loadSummary(roomId: string): Promise<SummaryReadState> {
  const [{ ensureAnonymousUser }, { readOwnMembership }, { readSummaryState }] =
    await Promise.all([
      import("@/lib/auth"),
      import("@/lib/rooms"),
      import("@/lib/summary-store"),
    ]);
  const user = await ensureAnonymousUser();
  if (!(await readOwnMembership(roomId, user.uid))) {
    throw new Error("membership-required");
  }
  return readSummaryState(roomId);
}

const fixtureSummary: SummaryDoc = {
  snapshot: {
    people: demoFixture.people,
    placements: demoFixture.acceptedPlan.placements,
    constraints: demoFixture.constraints,
    hopes: demoFixture.hopes,
    unknowns: demoFixture.unknowns,
    careWindows: demoFixture.careWindows,
    copayRate: demoFixture.copayRate,
    revision: 1,
  },
  validation: demoFixture.acceptedPlan.expectedValidationResult,
  confirmedRevision: 1,
  confirmedAt: Timestamp.fromMillis(0),
};

export default function SummaryClient({ roomId }: { roomId: string }) {
  const [state, setState] = useState<SummaryReadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState(false);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestId.current;
    setState(null);
    setLoading(true);
    setError(false);
    try {
      const loaded = await loadSummary(roomId);
      if (request === requestId.current) setState(loaded);
    } catch {
      if (request === requestId.current) setError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current++;
    };
  }, [reload]);

  return (
    <div className="mobile-page min-h-screen bg-neutral-100/60 pb-16 print:bg-white print:p-0">
      {/* 全画面共通ヘッダー */}
      <RoomHeader roomId={roomId} activeKey="summary" />

      {/* サブ操作バー（印刷時は非表示） */}
      <div className="border-b border-neutral-200 bg-white px-4 sm:px-6 py-2 shadow-2xs print:hidden">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 text-xs">
          <span className="font-semibold text-neutral-600">
            ケアマネ面談用 まとめシート
          </span>
          <div className="max-sm:flex-wrap flex items-center gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={() => void reload()}
              className="font-medium text-neutral-600 hover:text-neutral-900 underline disabled:opacity-40"
            >
              再読み込み
            </button>
            <button
              type="button"
              onClick={() => setPreview((value) => !value)}
              className="font-semibold text-indigo-700 hover:text-indigo-900 underline"
            >
              {preview
                ? "ルームのデータに戻す"
                : "架空の確定プランをプレビュー"}
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 sm:px-6 py-6 print:p-0 print:max-w-none">
        {preview ? (
          <>
            <p className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3.5 text-sm text-blue-900 print:hidden">
              架空の表示確認用サンプルです。ルームに保存された確定データではありません。
            </p>
            <SummarySheet
              roomId="sample"
              summary={fixtureSummary}
              currentRevision={1}
            />
          </>
        ) : loading ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 shadow-sm">
            まとめシートを読み込んでいます…
          </div>
        ) : error ? (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
          >
            確定内容を読み込めませんでした。参加状態と接続設定を確認して再読み込みしてください。
          </div>
        ) : (
          <SummarySheet
            roomId={roomId}
            summary={state?.summary ?? null}
            currentRevision={state?.currentRevision ?? null}
          />
        )}
      </main>
    </div>
  );
}
