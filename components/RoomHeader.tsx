"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "./Logo";

export type RoomNavKey =
  | "top"
  | "input"
  | "board"
  | "burden"
  | "proposals"
  | "summary"
  | "columns";

export interface RoomHeaderProps {
  roomId: string;
  activeKey?: RoomNavKey;
  className?: string;
  containerClassName?: string;
}

interface NavItem {
  key: RoomNavKey;
  label: string;
  getPath: (roomId: string) => string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "input", label: "事情を入れる", getPath: (id) => `/rooms/${id}/input` },
  { key: "board", label: "週間ボード", getPath: (id) => `/rooms/${id}/board` },
  { key: "proposals", label: "代替案", getPath: (id) => `/rooms/${id}/proposals` },
  { key: "summary", label: "まとめシート", getPath: (id) => `/rooms/${id}/summary` },
];

function resolveActiveKey(pathname: string | null, roomId: string): RoomNavKey {
  if (!pathname) return "top";
  const prefix = `/rooms/${roomId}`;
  if (pathname === prefix || pathname === `${prefix}/`) return "top";
  if (pathname.startsWith(`${prefix}/input`)) return "input";
  if (pathname.startsWith(`${prefix}/board`)) return "board";
  if (pathname.startsWith(`${prefix}/burden`)) return "burden";
  if (pathname.startsWith(`${prefix}/proposals`)) return "proposals";
  if (pathname.startsWith(`${prefix}/summary`)) return "summary";
  if (pathname.startsWith(`${prefix}/columns`)) return "columns";
  return "top";
}

export default function RoomHeader({
  roomId,
  activeKey,
  className = "",
  containerClassName = "max-w-7xl",
}: RoomHeaderProps) {
  const pathname = usePathname();
  const currentKey = activeKey ?? resolveActiveKey(pathname, roomId);

  const handleBackToRoomTop = () => {
    if (typeof window !== "undefined") {
      window.location.href = `/rooms/${roomId}`;
    }
  };

  return (
    <header
      className={`max-sm:static sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur-xs shadow-xs print:hidden ${className}`}
    >
      <div className={`mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 sm:px-6 py-2.5 ${containerClassName}`}>
        <div className="flex items-center gap-2.5">
          {/* (1) CarePact のロゴと名前。クリックでサイトのトップページ「/」へ戻れる */}
          <Link
            href="/"
            className="group flex items-center gap-2.5 rounded-lg py-0.5 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-500"
            title="CarePact トップページへ"
          >
            <Logo className="h-6 w-auto shrink-0 transition-transform group-hover:scale-105" />
            <span className="text-base font-extrabold tracking-tight text-neutral-900 group-hover:text-indigo-600 transition-colors">
              CarePact
            </span>
          </Link>

          {/* ルームトップへ戻るボタン（Issue #74） */}
          {currentKey !== "top" && (
            <button
              type="button"
              onClick={handleBackToRoomTop}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors shadow-2xs"
              aria-label="ルームトップへ戻る"
            >
              <span>←</span>
              <span>ルームトップ</span>
            </button>
          )}
        </div>

        {/* (2) そのルームの各画面へのリンク (3) 今いる画面がどれか分かる見た目 */}
        <nav
          aria-label="ルーム内メニュー"
          className="max-sm:grid max-sm:w-full max-sm:grid-cols-2 flex flex-wrap items-center gap-1 sm:gap-1.5 overflow-x-auto py-0.5"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = currentKey === item.key;
            return (
              <Link
                key={item.key}
                href={item.getPath(roomId)}
                aria-current={isActive ? "page" : undefined}
                className={`max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:justify-center max-sm:text-sm rounded-lg px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-semibold transition-all ${
                  isActive
                    ? "bg-indigo-50 text-indigo-700 border-b-2 border-indigo-600 shadow-xs"
                    : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
