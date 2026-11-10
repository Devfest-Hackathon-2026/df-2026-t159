import NewRoomClient from "./NewRoomClient";

/**
 * ルーム作成画面の受け皿（Issue 2）。
 * ログイン中のユーザーと Firestore に依存するため、静的生成はしない。
 */
export const dynamic = "force-dynamic";

export default function NewRoomPage() {
  return <NewRoomClient />;
}
