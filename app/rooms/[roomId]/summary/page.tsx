import { Suspense } from "react";
import SummaryClient from "./SummaryClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * ケアマネ面談用まとめシート画面（Issue 11）。
 * 確定スナップショット（summary の ConfirmedSnapshot）を読み、
 * 確定プラン・家族の希望と制約・負担の分担（付き添い時間）を1画面にまとめ、
 * 印刷用レイアウト（A4・@media print）で表示する。
 */
export default async function SummaryPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl px-4 py-8">
          <p className="text-neutral-500">読み込み中…</p>
        </main>
      }
    >
      <SummaryClient key={roomId} roomId={roomId} />
    </Suspense>
  );
}
