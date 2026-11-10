"use client";

import { useEffect, useState, type RefObject } from "react";
import { DAYS } from "@/lib/board";

const TIME_AXIS_WIDTH = 48;

/** スマホの横スクロール位置を曜日で示し、目的の列へ移動する。 */
export default function BoardScrollNav({ viewportRef }: {
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const [visible, setVisible] = useState({ first: 0, last: 0 });
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = () => {
      const columnWidth = (viewport.scrollWidth - TIME_AXIS_WIDTH) / DAYS.length;
      if (columnWidth <= 0) return;
      const first = Math.min(6, Math.floor(viewport.scrollLeft / columnWidth));
      const last = Math.min(6, Math.max(first,
        Math.ceil((viewport.scrollLeft + viewport.clientWidth - TIME_AXIS_WIDTH) / columnWidth) - 1));
      setVisible(prev => prev.first === first && prev.last === last ? prev : { first, last });
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(viewport);
    return () => {
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer?.disconnect();
    };
  }, [viewportRef]);

  return (
    <nav aria-label="ボードの表示する曜日" className="space-y-1.5 sm:hidden">
      <p role="status" className="text-xs text-neutral-600">
        表示中：{DAYS[visible.first]}{visible.last !== visible.first ? `〜${DAYS[visible.last]}` : ""}曜（左右にスクロールできます）
      </p>
      <div className="flex gap-1">
        {DAYS.map((day, index) => (
          <button key={day} type="button" aria-label={`${day}曜日を表示`}
            aria-pressed={index >= visible.first && index <= visible.last}
            className={`min-h-11 min-w-0 flex-1 rounded-lg border text-sm font-bold ${
              index >= visible.first && index <= visible.last
                ? "border-indigo-300 bg-indigo-50 text-indigo-800"
                : "border-neutral-300 bg-white text-neutral-700"}`}
            onClick={() => {
              const viewport = viewportRef.current;
              if (!viewport) return;
              const columnWidth = (viewport.scrollWidth - TIME_AXIS_WIDTH) / DAYS.length;
              viewport.scrollTo({ left: Math.min(viewport.scrollWidth - viewport.clientWidth, index * columnWidth), behavior: "smooth" });
            }}>
            {day}
          </button>
        ))}
      </div>
    </nav>
  );
}
