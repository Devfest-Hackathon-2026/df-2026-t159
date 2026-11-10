import { Suspense } from "react";
import ProposalsClient from "./ProposalsClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * 代替案画面（Issue 8・14）。
 * 現在のプランの検証結果と Gemini の代替案（検証済みのみ）を表示し、
 * 代替案の本適用とプランの確定を行う。
 */
export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-3xl px-6 py-10">読み込み中…</main>
      }
    >
      <ProposalsClient roomId={roomId} />
    </Suspense>
  );
}
