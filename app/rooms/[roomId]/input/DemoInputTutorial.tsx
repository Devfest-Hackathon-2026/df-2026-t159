"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  DEMO_INPUT_TUTORIAL_STEPS,
  getDemoInputTutorialStep,
  type DemoInputTutorialStepNumber,
} from "@/lib/demo-input-tutorial";
import { createPortal } from "react-dom";
import TutorialMessage from "@/components/TutorialMessage";
import "./DemoInputTutorial.css";

interface TargetRect {
  key: string;
  isPrimary: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface SpotlightState {
  vw: number;
  vh: number;
  rects: TargetRect[];
  placement: "top" | "bottom";
}

type PopoverCapableElement = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

const SPOTLIGHT_PADDING = 8;
const SETTLE_DEBOUNCE_MS = 120;
const STEP_SETTLE_TIMEOUT_MS = 300;

function getStickyTopInset(targetEl: HTMLElement | null, vh: number): number {
  let inset = 0;
  const shellSticky = document.querySelector<HTMLElement>("[data-room-page] > div");
  const headerEl = document.querySelector<HTMLElement>("header");
  const candidates: HTMLElement[] = [];
  if (shellSticky) candidates.push(shellSticky);
  if (headerEl && headerEl !== shellSticky && !shellSticky?.contains(headerEl)) {
    candidates.push(headerEl);
  }
  for (const el of candidates) {
    if (targetEl && el.contains(targetEl)) continue;
    const style = window.getComputedStyle(el);
    if (style.position !== "sticky" && style.position !== "fixed") continue;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0 || rect.height >= vh * 0.5) continue;
    if (rect.top <= 2 && rect.bottom > inset) {
      inset = rect.bottom;
    }
  }
  return inset;
}

function supportsNativePopover(): boolean {
  return (
    typeof HTMLElement !== "undefined" &&
    Object.hasOwn(HTMLElement.prototype, "popover")
  );
}

function openManualOverlay(
  el: PopoverCapableElement | null,
  fallbackAttr: "open" | "data-fallback-open",
): void {
  if (!el) return;
  if (supportsNativePopover() && typeof el.showPopover === "function") {
    try {
      el.setAttribute("popover", "manual");
      if (!el.matches(":popover-open")) {
        el.showPopover();
      }
      el.removeAttribute(fallbackAttr);
      return;
    } catch {
      el.removeAttribute("popover");
    }
  }
  el.removeAttribute("popover");
  el.setAttribute(fallbackAttr, fallbackAttr === "open" ? "" : "true");
}

function closeManualOverlay(
  el: PopoverCapableElement | null,
  fallbackAttr: "open" | "data-fallback-open",
): void {
  if (!el) return;
  el.removeAttribute(fallbackAttr);
  if (supportsNativePopover() && typeof el.hidePopover === "function") {
    try {
      if (el.matches(":popover-open")) {
        el.hidePopover();
      }
    } catch {
      // ignore
    }
  }
  el.removeAttribute("popover");
}

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const rx = Math.max(0, Math.min(r, w / 2));
  const ry = Math.max(0, Math.min(r, h / 2));
  return [
    `M ${x + rx} ${y}`,
    `H ${x + w - rx}`,
    `A ${rx} ${ry} 0 0 1 ${x + w} ${y + ry}`,
    `V ${y + h - ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}`,
    `H ${x + rx}`,
    `A ${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`,
    `V ${y + ry}`,
    `A ${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
    "Z",
  ].join(" ");
}

function isRectContainedIn(inner: TargetRect, outer: TargetRect): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.left + outer.width >= inner.left + inner.width &&
    outer.top + outer.height >= inner.top + inner.height
  );
}

function filterOuterHoles(rects: readonly TargetRect[]): TargetRect[] {
  return rects.filter((rect, index) => {
    return !rects.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      const sameBounds =
        other.left === rect.left &&
        other.top === rect.top &&
        other.width === rect.width &&
        other.height === rect.height;
      if (sameBounds) {
        return otherIndex < index;
      }
      return isRectContainedIn(rect, other);
    });
  });
}

export function buildBackdropPath(
  vw: number,
  vh: number,
  rects: readonly TargetRect[],
): string {
  const outer = `M 0 0 H ${vw} V ${vh} H 0 Z`;
  const holesSource = filterOuterHoles(rects);
  if (holesSource.length === 0) return outer;
  const holes = holesSource.map((r) =>
    roundedRectPath(r.left, r.top, r.width, r.height, 12),
  );
  return `${outer} ${holes.join(" ")}`;
}

export default function DemoInputTutorial({
  step,
  memoGuideSlot,
  onNext,
  onClose,
}: {
  step: DemoInputTutorialStepNumber;
  memoGuideSlot: HTMLDivElement | null;
  onNext: () => void;
  onClose: () => void;
}) {
  const stepConfig = getDemoInputTutorialStep(step);
  const inlineMemo = stepConfig.primaryTargetKey === "memo-section" && memoGuideSlot !== null;
  const titleId = useId();
  const descId = useId();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const exitBarRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const prevStepRef = useRef<DemoInputTutorialStepNumber | null>(null);

  const [spotlight, setSpotlight] = useState<SpotlightState>(() => ({
    vw: typeof window !== "undefined" ? window.innerWidth : 1024,
    vh: typeof window !== "undefined" ? window.innerHeight : 768,
    rects: [],
    placement: "bottom",
  }));

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!inlineMemo) openManualOverlay(dialog, "open");
    return () => {
      if (!inlineMemo) closeManualOverlay(dialog, "open");
    };
  }, [inlineMemo]);

  useLayoutEffect(() => {
    const exitBar = exitBarRef.current;
    openManualOverlay(exitBar, "data-fallback-open");
    return () => closeManualOverlay(exitBar, "data-fallback-open");
  }, []);

  useEffect(() => {
    const primaryEl = document.querySelector<HTMLElement>(
      `[data-tutorial-target="${stepConfig.primaryTargetKey}"]`,
    );
    if (!primaryEl || typeof primaryEl.scrollIntoView !== "function") return;
    let appliedMargin = false;
    const prevScrollMarginTop = primaryEl.style.scrollMarginTop;
    try {
      const rect = primaryEl.getBoundingClientRect();
      const vh = window.innerHeight || 768;
      const safeTop = getStickyTopInset(primaryEl, vh);
      const reducedMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const block: ScrollLogicalPosition =
        rect.height > (vh - safeTop) * 0.6 ? "start" : "center";
      if (safeTop > 0) {
        primaryEl.style.scrollMarginTop = `${Math.ceil(safeTop + SPOTLIGHT_PADDING + 8)}px`;
        appliedMargin = true;
      }
      primaryEl.scrollIntoView({
        behavior: reducedMotion ? "auto" : "smooth",
        block,
      });
    } catch {
      // ignore in unsupported environments
    }
    return () => {
      if (appliedMargin) {
        primaryEl.style.scrollMarginTop = prevScrollMarginTop;
      }
    };
  }, [step, stepConfig.primaryTargetKey]);

  useLayoutEffect(() => {
    let disposed = false;
    let rafId: number | null = null;
    let stepRaf1: number | null = null;
    let stepRaf2: number | null = null;
    let settleTimerId: number | null = null;
    let stepSettleTimerId: number | null = null;

    const measure = () => {
      if (disposed) return;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const measuredRects: TargetRect[] = [];

      for (const key of stepConfig.targetKeys) {
        const el = document.querySelector<HTMLElement>(
          `[data-tutorial-target="${key}"]`,
        );
        if (!el) continue;
        const raw = el.getBoundingClientRect();
        if (raw.width <= 0 || raw.height <= 0) continue;
        const safeTop = getStickyTopInset(el, vh);
        const left = Math.max(0, raw.left - SPOTLIGHT_PADDING);
        const top = Math.max(safeTop, raw.top - SPOTLIGHT_PADDING);
        const right = Math.min(vw, raw.right + SPOTLIGHT_PADDING);
        const bottom = Math.min(vh, raw.bottom + SPOTLIGHT_PADDING);
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width <= 0 || height <= 0) continue;
        measuredRects.push({
          key,
          isPrimary: key === stepConfig.primaryTargetKey,
          left,
          top,
          width,
          height,
        });
      }

      const primary = measuredRects.find((r) => r.isPrimary) ?? measuredRects[0];
      const placement: "top" | "bottom" =
        primary && primary.top + primary.height / 2 > vh * 0.55
          ? "top"
          : "bottom";

      setSpotlight({
        vw,
        vh,
        rects: measuredRects,
        placement,
      });
    };

    const scheduleMeasure = () => {
      if (disposed || rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        if (!disposed) measure();
      });
    };

    const scheduleSettledMeasure = () => {
      scheduleMeasure();
      if (settleTimerId !== null) {
        window.clearTimeout(settleTimerId);
      }
      settleTimerId = window.setTimeout(() => {
        settleTimerId = null;
        if (!disposed) measure();
      }, SETTLE_DEBOUNCE_MS);
    };

    measure();

    stepRaf1 = window.requestAnimationFrame(() => {
      stepRaf1 = null;
      if (disposed) return;
      measure();
      stepRaf2 = window.requestAnimationFrame(() => {
        stepRaf2 = null;
        if (!disposed) measure();
      });
    });
    stepSettleTimerId = window.setTimeout(() => {
      stepSettleTimerId = null;
      if (!disposed) measure();
    }, STEP_SETTLE_TIMEOUT_MS);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSettledMeasure);
    for (const key of stepConfig.targetKeys) {
      const el = document.querySelector<HTMLElement>(
        `[data-tutorial-target="${key}"]`,
      );
      if (el) observer?.observe(el);
    }
    const headerEl = document.querySelector<HTMLElement>("header");
    if (headerEl) observer?.observe(headerEl);
    if (document.body) observer?.observe(document.body);
    if (document.documentElement) observer?.observe(document.documentElement);

    window.addEventListener("resize", scheduleSettledMeasure);
    window.addEventListener("scroll", scheduleSettledMeasure, {
      capture: true,
      passive: true,
    });
    window.addEventListener("scrollend", scheduleMeasure, {
      capture: true,
      passive: true,
    });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", scheduleSettledMeasure);
    vv?.addEventListener("scroll", scheduleSettledMeasure);

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (stepRaf1 !== null) window.cancelAnimationFrame(stepRaf1);
      if (stepRaf2 !== null) window.cancelAnimationFrame(stepRaf2);
      if (settleTimerId !== null) window.clearTimeout(settleTimerId);
      if (stepSettleTimerId !== null) window.clearTimeout(stepSettleTimerId);
      observer?.disconnect();
      window.removeEventListener("resize", scheduleSettledMeasure);
      window.removeEventListener("scroll", scheduleSettledMeasure, {
        capture: true,
      });
      window.removeEventListener("scrollend", scheduleMeasure, {
        capture: true,
      });
      vv?.removeEventListener("resize", scheduleSettledMeasure);
      vv?.removeEventListener("scroll", scheduleSettledMeasure);
    };
  }, [step, stepConfig.targetKeys, stepConfig.primaryTargetKey]);

  useEffect(() => {
    // 初回ページ読み込み直後はフォーカスを奪わず、ステップ遷移時のみ案内カードへ移す
    if (prevStepRef.current !== null && prevStepRef.current !== step) {
      if (stepConfig.allowManualNext) {
        nextBtnRef.current?.focus({ preventScroll: true });
      } else if (stepConfig.isFinal) {
        headingRef.current?.focus({ preventScroll: true });
      }
    }
    prevStepRef.current = step;
  }, [step, stepConfig.allowManualNext, stepConfig.isFinal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const hasPrimaryAnchor = spotlight.rects.some((r) => r.isPrimary);

  const guide = (
    <dialog
      ref={dialogRef}
      open={inlineMemo || undefined}
      data-testid="demo-tutorial-dialog"
      data-tutorial-step={step}
      data-placement={spotlight.placement}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={`demo-tutorial-popover ${
        inlineMemo ? "demo-tutorial-popover--memo" : hasPrimaryAnchor ? "demo-tutorial-popover--anchored" : ""
      }`}
    >
      <div className="p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center rounded-full bg-[#EFEAF6] border border-[#DDD4EC] px-2.5 py-0.5 text-[11px] font-extrabold text-[#574468]">
            デモ案内 {step} / {DEMO_INPUT_TUTORIAL_STEPS.length}
          </span>
          <div className="flex items-center gap-1" aria-hidden="true">
            {DEMO_INPUT_TUTORIAL_STEPS.map((item) => (
              <span
                key={item.step}
                className={`h-2 w-2 rounded-full ${
                  item.step === step
                    ? "bg-[#65519A]"
                    : item.step < step
                      ? "bg-[#B8AAD8]"
                      : "bg-[#E6DFD2]"
                }`}
              />
            ))}
          </div>
        </div>

        <h2
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="text-sm font-extrabold text-[#403346] focus:outline-hidden"
        >
          {stepConfig.title}
        </h2>

        <TutorialMessage id={descId} title={stepConfig.title} message={stepConfig.message} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6DFD2] pt-3">
          {stepConfig.allowManualNext ? (
            <button
              ref={nextBtnRef}
              type="button"
              onClick={onNext}
              className="demo-tutorial-btn ml-auto rounded-xl bg-[#65519A] px-4 py-2 text-xs font-bold text-white hover:bg-[#564385] transition-colors"
            >
              次へ
            </button>
          ) : stepConfig.isFinal ? (
            <button
              type="button"
              onClick={onClose}
              className="demo-tutorial-btn ml-auto rounded-xl bg-[#65519A] px-4 py-2 text-xs font-bold text-white hover:bg-[#564385] transition-colors"
            >
              チュートリアルを完了
            </button>
          ) : (
            <p className="text-[11px] font-semibold text-[#574468]">
              ハイライトされた操作を行うと次へ進みます
            </p>
          )}
        </div>
      </div>
    </dialog>
  );

  return (
    <>
      {/* 暗転＋スポットライト穴あき（穴の内側だけ背面の本物UIへクリック透過） */}
      <svg
        aria-hidden="true"
        data-testid="demo-tutorial-backdrop"
        className="demo-tutorial-backdrop"
        viewBox={`0 0 ${spotlight.vw} ${spotlight.vh}`}
        preserveAspectRatio="none"
      >
        <path
          d={buildBackdropPath(spotlight.vw, spotlight.vh, spotlight.rects)}
          fill="rgb(40 31 46 / 0.56)"
          fillRule="evenodd"
          style={{ pointerEvents: "auto" }}
        />
      </svg>

      {/* スポットライト強調枠（プライマリ要素には CSS Anchor Positioning 用アンカー名を付与） */}
      {spotlight.rects.map((rect) => (
        <div
          key={rect.key}
          aria-hidden="true"
          data-testid={`demo-tutorial-ring-${rect.key}`}
          className={`demo-tutorial-ring ${rect.isPrimary ? "demo-tutorial-anchor" : ""}`}
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
      ))}

      {/* 右上の常時終了ボタン（手動ポップオーバーで常に最前面に表示） */}
      <div
        ref={exitBarRef}
        data-testid="demo-tutorial-exit-bar"
        className="demo-tutorial-exit-bar"
      >
        <button
          type="button"
          onClick={onClose}
          className="demo-tutorial-btn rounded-xl border-2 border-[#65519A] bg-white px-4 py-2 text-xs font-bold text-[#65519A] shadow-md hover:bg-[#EFEAF6] transition-colors"
        >
          案内を終わる
        </button>
      </div>

      {/* ガイド本体（非モーダル手動ポップオーバー：操作対象はそのまま操作可能） */}
      {inlineMemo ? createPortal(guide, memoGuideSlot) : guide}
    </>
  );
}
