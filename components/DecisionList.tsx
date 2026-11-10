"use client";

/**
 * 決めることリストの表示部品（Issue 13 / UX改善）：
 *
 * 入力：data/columns.json の decision 項目（8項目）。
 * 仕様：
 * - 初期状態では各項目のタイトルと1行の要約だけを表示
 * - クリックでアコーディオンのように全文が開いて読める
 * - 完了状態や進捗バーなどの不要な状態は作らない
 */

import { useState } from "react";
import type { DecisionContent } from "@/lib/types";

export interface DecisionListProps {
  decisions: DecisionContent[];
  /** 初期選択・初期展開される項目ID */
  initialSelectedId?: string;
  className?: string;
}

export default function DecisionList({
  decisions,
  initialSelectedId,
  className = "",
}: DecisionListProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(initialSelectedId ? [initialSelectedId] : []),
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div
      className={`space-y-6 ${className}`}
      role="region"
      aria-label="決めることリスト（8項目）"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-3">
        <div>
          <h2 className="text-lg font-bold text-neutral-900">
            決めることリスト（{decisions.length}項目）
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            退院・在宅移行に向けて家族で話し合い、合意しておくべき重要事項のチェックリストです。各項目をクリックすると詳しい解説が読めます。
          </p>
        </div>
      </div>

      <ol className="space-y-3" aria-label="決めること項目一覧">
        {decisions.map((decision, index) => {
          const isOpen = expandedIds.has(decision.id);
          const itemNumber = String(index + 1).padStart(2, "0");
          // 1行の要約（改行で分割した先頭行）
          const firstLine = decision.body.split("\n")[0] ?? "";

          return (
            <li
              key={decision.id}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xs transition-shadow hover:shadow-sm"
            >
              <button
                type="button"
                onClick={() => toggleExpand(decision.id)}
                aria-expanded={isOpen}
                className="flex w-full items-start justify-between gap-4 p-4 text-left transition-colors hover:bg-neutral-50 sm:p-5"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3.5">
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                      isOpen
                        ? "bg-indigo-600 text-white"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {itemNumber}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm sm:text-base font-bold text-neutral-900">
                        {decision.title}
                      </span>
                    </div>
                    {/* 初期状態で見せる1行の要約 */}
                    <p className="mt-1 line-clamp-1 text-xs text-neutral-500">
                      {firstLine}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 pt-0.5">
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">
                    {isOpen ? "閉じる ▲" : "詳細を開く ▼"}
                  </span>
                </div>
              </button>

              {isOpen && (
                <article
                  aria-label={decision.title}
                  className="border-t border-neutral-100 bg-neutral-50/60 p-4 sm:p-6"
                >
                  <h3 className="sr-only">{decision.title}</h3>
                  <div className="rounded-lg border border-neutral-200/70 bg-white p-4 shadow-2xs">
                    <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">
                      {decision.body}
                    </p>
                  </div>
                  <p className="mt-3 text-xs text-neutral-500">
                    💡 ケアマネジャーとの面談や家族会議でこの項目を取り上げ、双方の合意のもとでプランに反映させましょう。
                  </p>
                </article>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
