"use client";

/**
 * コラム・決めることリスト・サービス説明のクライアントコンポーネント（Issue 13 / UX改善）。
 *
 * 入力：data/columns.json と ValidationResult。
 * 仕様：
 * - 初期表示は「決めることリスト」だけにする（「すべて表示」を初期選択にしない）
 * - 決めることリストの各項目はタイトルと1行の要約を表示し、クリックで全文が開く
 * - 場面連動コラムとサービス説明は、タブを切り替えたときだけ表示する
 * - 共通ヘッダーを上部に配置
 */

import { useCallback, useEffect, useRef, useState } from "react";
import DecisionList from "@/components/DecisionList";
import RoomHeader from "@/components/RoomHeader";
import SceneColumnList from "@/components/SceneColumn";
import ServiceDescription from "@/components/ServiceDescription";
import {
  columnsData,
  determineActiveScenes,
  getDecisionContents,
  getServiceContents,
  SCENE_LABELS,
} from "@/lib/columns";
import { demoFixture } from "@/lib/demo-fixture";
import type { RoomSnapshot } from "@/lib/types";
import { useRoomValidation } from "@/lib/useRoomValidation";

type TabMode = "decisions" | "sceneColumns" | "services" | "all";
type PlanSource = "room" | "troubled" | "accepted";

async function loadMemberSnapshot(roomId: string): Promise<RoomSnapshot> {
  const [{ ensureAnonymousUser }, { readOwnMembership, readRoomSnapshot }] =
    await Promise.all([import("@/lib/auth"), import("@/lib/rooms")]);
  const user = await ensureAnonymousUser();
  if (!(await readOwnMembership(roomId, user.uid))) {
    throw new Error("membership-required");
  }
  const snapshot = await readRoomSnapshot(roomId);
  if (!snapshot) throw new Error("snapshot-unavailable");
  return snapshot;
}

export default function ColumnsClient({
  roomId,
  loadSnapshot = loadMemberSnapshot,
}: {
  roomId: string;
  loadSnapshot?: (roomId: string) => Promise<RoomSnapshot>;
}) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestId = useRef(0);
  const { validation, pending, error: validationError } =
    useRoomValidation(snapshot);
  const roomValidation =
    validation?.revision === snapshot?.revision ? validation?.result ?? null : null;

  // 初期表示は「決めることリスト」だけにする（「すべて表示」を初期選択にしない）
  const [currentTab, setCurrentTab] = useState<TabMode>("decisions");
  const [planSource, setPlanSource] = useState<PlanSource>("room");
  const [showAllSceneColumns, setShowAllSceneColumns] = useState(false);

  const loadData = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setSnapshot(null);
    setError(false);
    try {
      const snap = await loadSnapshot(roomId);
      if (request === requestId.current) setSnapshot(snap);
    } catch {
      if (request === requestId.current) setError(true);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [roomId, loadSnapshot]);

  useEffect(() => {
    void loadData();
    return () => {
      requestId.current++;
    };
  }, [loadData]);

  // 現在評価対象とする ValidationResult
  const activeValidation =
    planSource === "troubled"
      ? demoFixture.troubledPlan.expectedValidationResult
      : planSource === "accepted"
        ? demoFixture.acceptedPlan.expectedValidationResult
        : roomValidation;

  const activeScenes = activeValidation
    ? determineActiveScenes(activeValidation)
    : [];
  const decisions = getDecisionContents(columnsData);
  const services = getServiceContents(columnsData);

  return (
    <div className="min-h-screen bg-neutral-100/60 pb-16">
      {/* 全画面共通ヘッダー */}
      <RoomHeader roomId={roomId} activeKey="columns" />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-8">
        {/* サブバー：プラン選択・再読み込み */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 shadow-2xs">
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="column-plan-source" className="font-semibold text-neutral-600">
              表示するプラン：
            </label>
            <select
              id="column-plan-source"
              value={planSource}
              onChange={(e) => setPlanSource(e.target.value as PlanSource)}
              className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-800 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              <option value="room">ルームの現在データ</option>
              <option value="troubled">架空デモ：揉めるプラン</option>
              <option value="accepted">架空デモ：納得プラン</option>
            </select>
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void loadData()}
            className="rounded-lg border border-neutral-200 px-3 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            再読み込み
          </button>
        </div>

        {/* 画面見出し */}
        <div className="mb-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h1 className="text-2xl font-black tracking-tight text-neutral-900">
                コラム・決めることリスト
              </h1>
              <p className="mt-1 text-sm text-neutral-600">
                退院後の在宅移行に向けた決めることリスト（8項目）と、現在の検証状況に連動したコラム、各サービスの特徴を確認できます。
              </p>
            </div>

            {/* 場面判定ステータスバッジ */}
            <div className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs shadow-2xs">
              <span className="text-neutral-500">現在の検出場面:</span>
              {!activeValidation ? (
                <span className="text-neutral-600">未判定</span>
              ) : activeScenes.length === 0 ? (
                <span className="font-semibold text-emerald-700">
                  {activeValidation.ok ? "対応ルール内で検証済み" : "未判定・要確認"}
                </span>
              ) : (
                <span className="font-bold text-amber-800">
                  {activeScenes.map((s) => SCENE_LABELS[s]).join("、")}
                </span>
              )}
            </div>
          </div>
        </div>

        {planSource !== "room" ? (
          <p
            role="status"
            className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"
          >
            架空デモの期待値を表示しています。ルームの現在の判定ではありません。
          </p>
        ) : error || validationError ? (
          <p
            role="status"
            className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            ルームの結果を取得できませんでした。参加状態と接続設定を確認して再読み込みしてください。場面は未判定です。
          </p>
        ) : loading || pending ? (
          <p role="status" className="mb-6 text-sm text-neutral-500">
            ルームの検証結果を読み込み中です。
          </p>
        ) : (
          <p className="mb-4 text-xs text-neutral-500 font-mono">
            入力の版：{validation?.revision}
          </p>
        )}

        {/* タブ切り替え（タブ構成自体は維持） */}
        <div className="mb-6 border-b border-neutral-200">
          <div className="flex flex-wrap gap-2 text-xs sm:text-sm font-bold">
            <button
              type="button"
              onClick={() => setCurrentTab("decisions")}
              className={`border-b-2 px-3 py-2.5 transition-colors ${
                currentTab === "decisions"
                  ? "border-indigo-600 text-indigo-700 font-extrabold"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              決めることリスト（8項目）
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("sceneColumns")}
              className={`border-b-2 px-3 py-2.5 transition-colors ${
                currentTab === "sceneColumns"
                  ? "border-indigo-600 text-indigo-700 font-extrabold"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              場面連動コラム（{activeValidation ? `${activeScenes.length}件該当` : "未判定"}）
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("services")}
              className={`border-b-2 px-3 py-2.5 transition-colors ${
                currentTab === "services"
                  ? "border-indigo-600 text-indigo-700 font-extrabold"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              サービス説明（{services.length}件）
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("all")}
              className={`border-b-2 px-3 py-2.5 transition-colors ${
                currentTab === "all"
                  ? "border-indigo-600 text-indigo-700 font-extrabold"
                  : "border-transparent text-neutral-500 hover:text-neutral-800"
              }`}
            >
              すべて表示
            </button>
          </div>
        </div>

        {/* コンテンツエリア */}
        <div className="space-y-10">
          {/* 決めることリスト */}
          {(currentTab === "decisions" || currentTab === "all") && (
            <section>
              <DecisionList decisions={decisions} />
            </section>
          )}

          {/* 場面連動コラム */}
          {(currentTab === "sceneColumns" || currentTab === "all") && (
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-end">
                <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAllSceneColumns}
                    onChange={(e) => setShowAllSceneColumns(e.target.checked)}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  未検出のコラムもすべて表示する
                </label>
              </div>
              <SceneColumnList
                validation={activeValidation}
                showAll={showAllSceneColumns}
              />
            </section>
          )}

          {/* サービス説明 */}
          {(currentTab === "services" || currentTab === "all") && (
            <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
              <ServiceDescription services={services} />
            </section>
          )}
        </div>

        {/* フッター注記 */}
        <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-500">
          <p>
            ※ 本コラムおよび決めることリストは、介護保険法および関連通知に基づく一般的な目安の解説です。具体的なプランの適用やサービス予約については、担当のケアマネジャーまたは地域包括支援センターにご相談ください。
          </p>
        </footer>
      </main>
    </div>
  );
}
