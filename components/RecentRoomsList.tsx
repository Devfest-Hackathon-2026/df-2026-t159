"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getRecentRooms,
  removeRecentRoom,
  type RecentRoom,
} from "@/lib/recent-rooms";

function formatLastAccessed(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return "";
    const month = d.getMonth() + 1;
    const date = d.getDate();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${month}月${date}日 ${hours}:${minutes}`;
  } catch {
    return "";
  }
}

export default function RecentRoomsList() {
  const [rooms, setRooms] = useState<RecentRoom[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setRooms(getRecentRooms());
  }, []);

  const handleRemove = (roomId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    removeRecentRoom(roomId);
    setRooms(getRecentRooms());
  };

  if (!mounted || rooms.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="あなたのルーム"
      className="mx-auto mt-8 max-w-3xl rounded-2xl border border-violet-100 bg-white/90 p-5 sm:p-6 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
        <h2 className="text-base font-bold text-neutral-900 flex items-center gap-2">
          <span>🏠</span>
          <span>あなたのルーム</span>
        </h2>
        <span className="text-xs text-neutral-500">{rooms.length}件</span>
      </div>

      <ul className="mt-3 divide-y divide-neutral-100">
        {rooms.map((room) => (
          <li
            key={room.roomId}
            className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
          >
            <Link
              href={`/rooms/${room.roomId}`}
              className="flex-1 min-w-[200px] group flex flex-col"
            >
              <span className="text-sm font-bold text-neutral-900 group-hover:text-indigo-600 transition-colors flex items-center gap-1.5">
                <span>{room.roomName}</span>
                <span className="text-xs text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">
                  →
                </span>
              </span>
              <span className="mt-0.5 text-xs text-neutral-400">
                最終アクセス: {formatLastAccessed(room.lastAccessedAt)}
              </span>
            </Link>

            <div className="flex items-center gap-3">
              <Link
                href={`/rooms/${room.roomId}`}
                className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
              >
                開く
              </Link>
              <button
                type="button"
                className="text-xs text-neutral-400 hover:text-red-600 transition-colors px-1 py-1"
                title="一覧から削除"
                onClick={(e) => handleRemove(room.roomId, e)}
              >
                削除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
