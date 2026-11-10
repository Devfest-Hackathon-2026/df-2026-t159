import { Suspense } from "react";
import InputClient from "./InputClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * 入力画面（Issue 7）。
 * 書類＋事情メモ → Gemini 構造化 → 制約の確認（personId への結びつけ）・保存と、
 * careWindows の初期設定・編集、自己負担割合の選択をこの画面に置く。
 * 保存は構造化結果が既存の保存 API（/api/structure/save）、設定の変更が
 * commitRoomChange 経由。
 */
export default async function InputPage({
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
      <InputClient roomId={roomId} />
    </Suspense>
  );
}
