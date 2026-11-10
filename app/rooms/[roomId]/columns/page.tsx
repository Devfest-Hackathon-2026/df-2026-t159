import { Suspense } from "react";
import ColumnsClient from "./ColumnsClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * コラム・決めることリスト画面（Issue 13）。
 *
 * 入力は data/columns.json と ValidationResult。
 * - 決めることリスト（8項目の一覧と詳細。「進み具合」は MVP 外）
 * - 場面連動コラム（ValidationResult と sceneId で出し分け）
 * - サービス説明（4サービス＋家族の付き添い）
 */
export default async function ColumnsPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-5xl px-4 py-8">
          <p className="text-neutral-500">読み込み中…</p>
        </main>
      }
    >
      <ColumnsClient key={roomId} roomId={roomId} />
    </Suspense>
  );
}
