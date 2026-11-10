import { Suspense } from "react";
import RoomHomeClient from "./RoomHomeClient";

/** ログイン中のユーザーと Firestore に依存するため、静的生成はしない */
export const dynamic = "force-dynamic";

/**
 * ルームの入口画面（Issue 2）。
 * 招待リンクからの参加確定・招待リンクの発行・参加状態の表示を行う。
 * membership の発行はサーバー側（Route Handler ＋ Admin SDK）に集約する。
 */
export default async function RoomPage({
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
      <RoomHomeClient roomId={roomId} />
    </Suspense>
  );
}
