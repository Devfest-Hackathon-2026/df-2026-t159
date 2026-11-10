"use client";

import React from "react";
import { PERSON_ICON_OPTIONS } from "@/lib/people";

export interface PersonIconPickerProps {
  value?: string;
  onChange: (icon?: string) => void;
  className?: string;
}

/**
 * 家族アイコンの大きなグリッドピッカーコンポーネント。
 * - 絵文字ボタンは32px以上（40px / h-10 w-10）で見やすく表示。
 * - 選択中は枠＋背景＋拡大で明示。
 * - 未設定（名前の頭文字）も選択可能。
 */
export default function PersonIconPicker({
  value,
  onChange,
  className = "",
}: PersonIconPickerProps) {
  // 保存済みのカスタムアイコン（PERSON_ICON_OPTIONS に含まれないもの）があれば追加
  const customIcon =
    value && !PERSON_ICON_OPTIONS.includes(value as (typeof PERSON_ICON_OPTIONS)[number])
      ? value
      : undefined;

  const isNoneSelected = !value;

  return (
    <div
      role="group"
      aria-label="家族のアイコン"
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
    >
      {/* 未設定（頭文字）ボタン */}
      <button
        type="button"
        aria-label="未設定（頭文字）"
        aria-pressed={isNoneSelected}
        onClick={() => onChange(undefined)}
        className={`h-10 min-w-[52px] px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 shrink-0 ${
          isNoneSelected
            ? "border-2 border-indigo-600 bg-indigo-50 text-indigo-900 shadow-xs ring-1 ring-indigo-500"
            : "border border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 hover:border-neutral-400"
        }`}
        title="名前の頭文字を表示（アイコンなし）"
      >
        <span>頭文字</span>
      </button>

      {/* 保存済みのカスタムアイコン */}
      {customIcon && (
        <button
          key={customIcon}
          type="button"
          aria-label={`アイコン ${customIcon}`}
          aria-pressed={true}
          onClick={() => onChange(customIcon)}
          className="h-10 w-10 rounded-lg text-2xl flex items-center justify-center shrink-0 border-2 border-indigo-600 bg-indigo-50 shadow-xs ring-1 ring-indigo-500 scale-105 transition-all"
          title={`${customIcon}（保存済み）`}
        >
          {customIcon}
        </button>
      )}

      {/* 候補アイコン一覧 */}
      {PERSON_ICON_OPTIONS.map((emoji) => {
        const isSelected = value === emoji;
        return (
          <button
            key={emoji}
            type="button"
            aria-label={`アイコン ${emoji}`}
            aria-pressed={isSelected}
            onClick={() => onChange(isSelected ? undefined : emoji)}
            className={`h-10 w-10 rounded-lg text-2xl flex items-center justify-center shrink-0 transition-all ${
              isSelected
                ? "border-2 border-indigo-600 bg-indigo-50 shadow-xs ring-1 ring-indigo-500 scale-105"
                : "border border-neutral-200 bg-white hover:bg-neutral-100 hover:border-neutral-300 active:scale-95"
            }`}
            title={emoji}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
