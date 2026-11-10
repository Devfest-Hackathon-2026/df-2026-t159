import { Suspense } from "react";
import BurdenClient from "./BurdenClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * 負担ビュー画面（Issue 4）。
 * 検証結果の警告表示と、家族ごとの付き添い時間の見える化。
 * 入力は ValidationResult のみ。お金は月次の総額だけを出し、
 * 家族別の金額配分は扱わない。数値が null の項目は「算出不可」と表示する。
 */
export default async function BurdenPage({
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
      <BurdenClient key={roomId} roomId={roomId} />
    </Suspense>
  );
}
