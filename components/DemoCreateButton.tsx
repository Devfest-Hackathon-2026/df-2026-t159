"use client";

/**
 * デモルーム作成ボタン（Issue 15 の配線）。
 * サンプル家族（佐藤家）の「揉めるプラン」が入ったデモルームを作り、
 * そのルーム画面へ移動する。作成はサーバー側（POST /api/rooms/demo）に集約。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getIdToken, useAnonymousUser } from "@/lib/auth";
import { createDemoRoomClient } from "@/lib/demo/client";
import { saveRecentRoom } from "@/lib/recent-rooms";

export default function DemoCreateButton() {
  const user = useAnonymousUser();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await getIdToken();
      const { roomId } = await createDemoRoomClient(token, {
        initialState: "troubled",
      });
      saveRecentRoom({ roomId, roomName: "デモルーム（佐藤家）" });
      router.push(`/rooms/${roomId}/input`);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "デモルームを作成できませんでした。もう一度お試しください",
      );
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={!user || busy}
        onClick={() => void handleCreate()}
        className="rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "作成中…" : "デモルームを作成"}
      </button>
      {error && <span className="text-sm text-red-700">{error}</span>}
    </span>
  );
}
