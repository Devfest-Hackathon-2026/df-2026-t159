"use client";

/**
 * デモルーム作成ボタン。
 * デモ登録確認画面（/rooms/demo-new）へ遷移する。
 */

import Link from "next/link";

export default function DemoCreateButton({ className }: { className?: string } = {}) {
  return (
    <Link
      href="/rooms/demo-new"
      className={
        className ??
        "inline-block rounded border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-white"
      }
    >
      <span className="block text-center leading-tight">デモルームを作成</span>{" "}
      <small className="block text-center text-xs font-medium">チュートリアル付き</small>
    </Link>
  );
}
