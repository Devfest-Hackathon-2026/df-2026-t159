"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import "./SpotlightTutorial.css";
import TutorialMessage from "./TutorialMessage";

export interface SpotlightTutorialStep {
  id: string;
  title: string;
  message: string;
  targetKey: string;
  extraTargetKeys?: readonly string[];
  fallbackTargetKey?: string;
  allowManualNext?: boolean;
  rawTitle?: boolean;
  waitHint?: string;
}

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
  canAnchor: boolean;
  placement: "top" | "bottom";
}

type PopoverCapableElement = HTMLElement & {
  showPopover?: () => void;
  hidePopover?: () => void;
};

const SPOTLIGHT_PADDING = 8;
const ANCHOR_MIN_CLEARANCE = 180;
const SETTLE_DEBOUNCE_MS = 120;
const STEP_SETTLE_TIMEOUT_MS = 300;

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

function buildBackdropPath(
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

function findTargetElement(
  targetAttr: string,
  stepItem: SpotlightTutorialStep,
): { el: HTMLElement | null; resolvedKey: string } {
  const primary = document.querySelector<HTMLElement>(
    `[${targetAttr}="${stepItem.targetKey}"]`,
  );
  if (primary) {
    return { el: primary, resolvedKey: stepItem.targetKey };
  }
  if (stepItem.fallbackTargetKey) {
    const fallback = document.querySelector<HTMLElement>(
      `[${targetAttr}="${stepItem.fallbackTargetKey}"]`,
    );
    if (fallback) {
      return { el: fallback, resolvedKey: stepItem.fallbackTargetKey };
    }
  }
  return { el: null, resolvedKey: stepItem.targetKey };
}

function findTargetElements(
  targetAttr: string,
  stepItem: SpotlightTutorialStep,
): {
  primaryEl: HTMLElement | null;
  items: Array<{ el: HTMLElement; key: string; isPrimary: boolean }>;
} {
  const primary = findTargetElement(targetAttr, stepItem);
  const items: Array<{ el: HTMLElement; key: string; isPrimary: boolean }> = [];
  if (primary.el) {
    items.push({ el: primary.el, key: primary.resolvedKey, isPrimary: true });
  }
  for (const extraKey of stepItem.extraTargetKeys ?? []) {
    if (extraKey === primary.resolvedKey) continue;
    const extraEl = document.querySelector<HTMLElement>(
      `[${targetAttr}="${extraKey}"]`,
    );
    if (extraEl) {
      items.push({ el: extraEl, key: extraKey, isPrimary: false });
    }
  }
  return { primaryEl: primary.el, items };
}

function collectStickyHeaders(hostDialog: HTMLDialogElement | null): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  if (hostDialog) {
    if (hostDialog.firstElementChild instanceof HTMLElement) {
      candidates.push(hostDialog.firstElementChild);
    }
    return candidates;
  }
  const shellSticky = document.querySelector<HTMLElement>("[data-room-page] > div");
  const headerEl = document.querySelector<HTMLElement>("header");
  if (shellSticky) candidates.push(shellSticky);
  if (headerEl && headerEl !== shellSticky && !shellSticky?.contains(headerEl)) {
    candidates.push(headerEl);
  }
  return candidates;
}

function getStickyTopInset(
  hostDialog: HTMLDialogElement | null,
  targetEl: HTMLElement | null,
  vh: number,
): number {
  let inset = 0;
  for (const el of collectStickyHeaders(hostDialog)) {
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

export interface SpotlightTutorialProps {
  steps: readonly SpotlightTutorialStep[];
  step: number;
  targetAttr: string;
  testIdPrefix: string;
  badgeLabel?: string;
  measureKey?: number;
  showBackButton?: boolean;
  nextDisabled?: boolean;
  feedbackMessage?: string | null;
  onMeasure?: () => void;
  onStepChange: (nextStep: number) => void;
  onClose: () => void;
}

export default function SpotlightTutorial({
  steps,
  step,
  targetAttr,
  testIdPrefix,
  badgeLabel = "デモ案内",
  measureKey = 0,
  showBackButton = true,
  nextDisabled = false,
  feedbackMessage = null,
  onMeasure,
  onStepChange,
  onClose,
}: SpotlightTutorialProps) {
  const titleId = useId();
  const descId = useId();
  const anchorRawId = useId();
  const anchorToken = `--spotlight-tutorial-${anchorRawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const exitBarRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const completeBtnRef = useRef<HTMLButtonElement>(null);
  const prevStepRef = useRef<number | null>(null);
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [spotlight, setSpotlight] = useState<SpotlightState>(() => ({
    vw: typeof window !== "undefined" ? window.innerWidth : 1024,
    vh: typeof window !== "undefined" ? window.innerHeight : 768,
    rects: [],
    canAnchor: false,
    placement: "bottom",
  }));

  const effectiveStep = Math.max(1, Math.min(step, steps.length));
  const currentStep = steps[effectiveStep - 1];
  const isFirst = effectiveStep === 1;
  const isFinal = effectiveStep === steps.length;
  const allowManualNext = currentStep.allowManualNext ?? true;
  const extraTargetsKey = (currentStep.extraTargetKeys ?? []).join(",");

  useLayoutEffect(() => {
    openManualOverlay(dialogRef.current as PopoverCapableElement | null, "open");
    openManualOverlay(
      exitBarRef.current as PopoverCapableElement | null,
      "data-fallback-open",
    );
    return () => {
      closeManualOverlay(
        dialogRef.current as PopoverCapableElement | null,
        "open",
      );
      closeManualOverlay(
        exitBarRef.current as PopoverCapableElement | null,
        "data-fallback-open",
      );
    };
  }, []);

  useEffect(() => {
    const { primaryEl } = findTargetElements(targetAttr, currentStep);
    if (!primaryEl || typeof primaryEl.scrollIntoView !== "function") return;
    let appliedMargin = false;
    const prevScrollMarginTop = primaryEl.style.scrollMarginTop;
    try {
      const raw = primaryEl.getBoundingClientRect();
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const hostDialog = dialogRef.current?.parentElement?.closest("dialog") ?? null;
      const safeTop = getStickyTopInset(hostDialog, primaryEl, vh);
      const viewportContainer = primaryEl.closest<HTMLElement>(".board-viewport");
      const containerRect = viewportContainer?.getBoundingClientRect();
      const outOfContainerX =
        Boolean(containerRect && containerRect.width > 0) &&
        (raw.left < containerRect!.left || raw.right > containerRect!.right);
      const outOfView =
        raw.top < safeTop + SPOTLIGHT_PADDING ||
        raw.bottom > vh ||
        raw.left < 0 ||
        raw.right > vw ||
        outOfContainerX;
      if (outOfView) {
        const reducedMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const block: ScrollLogicalPosition =
          raw.height > (vh - safeTop) * 0.6 ? "start" : "center";
        const inline: ScrollLogicalPosition = outOfContainerX ? "center" : "nearest";
        if (safeTop > 0) {
          primaryEl.style.scrollMarginTop = `${Math.ceil(safeTop + SPOTLIGHT_PADDING + 8)}px`;
          appliedMargin = true;
        }
        primaryEl.scrollIntoView({
          behavior: reducedMotion ? "auto" : "smooth",
          block,
          inline,
        });
      }
    } catch {
      // ignore in unsupported environments
    }
    return () => {
      if (appliedMargin) {
        primaryEl.style.scrollMarginTop = prevScrollMarginTop;
      }
    };
  }, [
    targetAttr,
    effectiveStep,
    currentStep.id,
    currentStep.targetKey,
    currentStep.fallbackTargetKey,
    measureKey,
  ]);

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

      onMeasureRef.current?.();

      const hostDialog = dialogRef.current?.parentElement?.closest("dialog") ?? null;
      const { items } = findTargetElements(targetAttr, currentStep);
      const measuredRects: TargetRect[] = [];

      for (const item of items) {
        const raw = item.el.getBoundingClientRect();
        if (raw.width <= 0 || raw.height <= 0) continue;
        const safeTop = getStickyTopInset(hostDialog, item.el, vh);
        const left = Math.max(0, raw.left - SPOTLIGHT_PADDING);
        const top = Math.max(safeTop, raw.top - SPOTLIGHT_PADDING);
        const right = Math.min(vw, raw.right + SPOTLIGHT_PADDING);
        const bottom = Math.min(vh, raw.bottom + SPOTLIGHT_PADDING);
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width > 0 && height > 0) {
          measuredRects.push({
            key: item.key,
            isPrimary: item.isPrimary,
            left,
            top,
            width,
            height,
          });
        }
      }

      const primaryRect =
        measuredRects.find((r) => r.isPrimary) ?? measuredRects[0] ?? null;

      const canAnchor = Boolean(
        primaryRect &&
          (primaryRect.top >= ANCHOR_MIN_CLEARANCE ||
            vh - (primaryRect.top + primaryRect.height) >= ANCHOR_MIN_CLEARANCE),
      );
      const placement: "top" | "bottom" =
        primaryRect && primaryRect.top + primaryRect.height / 2 > vh * 0.55
          ? "top"
          : "bottom";

      setSpotlight({
        vw,
        vh,
        rects: measuredRects,
        canAnchor,
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

    // ステップ切替直後のレイアウト確定（2フレーム後＋トランジション／スクロール完了後）に再計測
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
    const { items } = findTargetElements(targetAttr, currentStep);
    const boardEl = document.querySelector<HTMLElement>(
      '[data-board-tutorial-target="weekly-board"]',
    );
    const hostDialog = dialogRef.current?.parentElement?.closest("dialog") ?? null;

    const observed = new Set<Element>();
    const observe = (el: Element | null | undefined) => {
      if (!el || observed.has(el)) return;
      observed.add(el);
      observer?.observe(el);
    };

    for (const item of items) observe(item.el);
    observe(boardEl);
    observe(boardEl?.firstElementChild);
    observe(hostDialog);
    for (const headerEl of collectStickyHeaders(hostDialog)) observe(headerEl);
    observe(document.body);
    observe(document.documentElement);

    const handleAnimationOrTransitionEnd = () => scheduleSettledMeasure();
    hostDialog?.addEventListener("animationend", handleAnimationOrTransitionEnd);
    hostDialog?.addEventListener("transitionend", handleAnimationOrTransitionEnd);

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

    if (typeof document !== "undefined" && document.fonts?.ready) {
      void document.fonts.ready.then(() => {
        if (!disposed) measure();
      });
    }

    return () => {
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      if (stepRaf1 !== null) window.cancelAnimationFrame(stepRaf1);
      if (stepRaf2 !== null) window.cancelAnimationFrame(stepRaf2);
      if (settleTimerId !== null) window.clearTimeout(settleTimerId);
      if (stepSettleTimerId !== null) window.clearTimeout(stepSettleTimerId);
      observer?.disconnect();
      hostDialog?.removeEventListener("animationend", handleAnimationOrTransitionEnd);
      hostDialog?.removeEventListener("transitionend", handleAnimationOrTransitionEnd);
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
  }, [
    targetAttr,
    effectiveStep,
    currentStep.id,
    currentStep.targetKey,
    extraTargetsKey,
    currentStep.fallbackTargetKey,
    measureKey,
  ]);

  const primaryRect =
    spotlight.rects.find((r) => r.isPrimary) ?? spotlight.rects[0] ?? null;

  useLayoutEffect(() => {
    const dialogEl = dialogRef.current;
    const ringEl = ringRef.current;
    const supportsAnchor =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("position-area: block-end");

    if (supportsAnchor && spotlight.canAnchor && primaryRect && ringEl && dialogEl) {
      ringEl.style.setProperty("anchor-name", anchorToken);
      dialogEl.style.setProperty("position-anchor", anchorToken);
    } else {
      ringEl?.style.removeProperty("anchor-name");
      dialogEl?.style.removeProperty("position-anchor");
    }

    return () => {
      ringEl?.style.removeProperty("anchor-name");
      dialogEl?.style.removeProperty("position-anchor");
    };
  }, [anchorToken, spotlight.canAnchor, primaryRect]);

  useEffect(() => {
    // 初回表示直後や自動遷移・入力編集中はフォーカスを奪わず、手動のステップ遷移時のみ案内カードへ移す
    if (prevStepRef.current !== null && prevStepRef.current !== effectiveStep) {
      const prevStepItem = steps[prevStepRef.current - 1];
      const activeTag = document.activeElement?.tagName;
      const isEditingControl =
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SELECT";
      if (prevStepItem?.allowManualNext !== false && !isEditingControl) {
        if (isFinal) {
          completeBtnRef.current?.focus({ preventScroll: true });
        } else if (allowManualNext && !nextDisabled) {
          nextBtnRef.current?.focus({ preventScroll: true });
        } else {
          headingRef.current?.focus({ preventScroll: true });
        }
      }
    }
    prevStepRef.current = effectiveStep;
  }, [effectiveStep, isFinal, allowManualNext, nextDisabled, steps]);

  useEffect(() => {
    const hostDialog = dialogRef.current?.parentElement?.closest("dialog") ?? null;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const handleHostCancel = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    hostDialog?.addEventListener("cancel", handleHostCancel, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      hostDialog?.removeEventListener("cancel", handleHostCancel, { capture: true });
    };
  }, []);

  return (
    <>
      {/* 暗転＋スポットライト穴あき */}
      <svg
        aria-hidden="true"
        data-testid={`${testIdPrefix}-backdrop`}
        className="spotlight-tutorial-backdrop"
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

      {/* スポットライト強調枠 */}
      {spotlight.rects.map((rect) => (
        <div
          key={rect.key}
          ref={rect.isPrimary ? ringRef : undefined}
          aria-hidden="true"
          data-testid={`${testIdPrefix}-ring-${rect.key}`}
          className="spotlight-tutorial-ring"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        />
      ))}

      {/* 右上の常時終了ボタン */}
      <div
        ref={exitBarRef}
        data-testid={`${testIdPrefix}-exit-bar`}
        className="spotlight-tutorial-exit-bar"
      >
        <button
          type="button"
          onClick={onClose}
          className="spotlight-tutorial-btn rounded-xl border-2 border-[#65519A] bg-white px-4 py-2 text-xs font-bold text-[#65519A] shadow-md hover:bg-[#EFEAF6] transition-colors"
        >
          案内を終わる
        </button>
      </div>

      {/* ガイド本体（非モーダル手動ポップオーバー） */}
      <dialog
        ref={dialogRef}
        data-testid={`${testIdPrefix}-dialog`}
        data-tutorial-step={effectiveStep}
        data-tutorial-step-id={currentStep.id}
        data-placement={spotlight.placement}
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={`spotlight-tutorial-popover ${
          spotlight.canAnchor ? "spotlight-tutorial-popover--anchored" : ""
        }`}
      >
        <div className="p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center rounded-full bg-[#EFEAF6] border border-[#DDD4EC] px-2.5 py-0.5 text-[11px] font-extrabold text-[#574468]">
              {badgeLabel} {effectiveStep} / {steps.length}
            </span>
            <div className="flex items-center gap-1" aria-hidden="true">
              {steps.map((item, idx) => {
                const itemStep = idx + 1;
                return (
                  <span
                    key={item.id}
                    className={`h-2 w-2 rounded-full ${
                      itemStep === effectiveStep
                        ? "bg-[#65519A]"
                        : itemStep < effectiveStep
                          ? "bg-[#B8AAD8]"
                          : "bg-[#E6DFD2]"
                    }`}
                  />
                );
              })}
            </div>
          </div>

          <h2
            id={titleId}
            ref={headingRef}
            tabIndex={-1}
            className="text-sm font-extrabold text-[#403346] focus:outline-hidden"
          >
            {currentStep.rawTitle
              ? currentStep.title
              : `ステップ ${effectiveStep} / ${steps.length}：${currentStep.title}`}
          </h2>

          <TutorialMessage id={descId} title={currentStep.title} message={currentStep.message} />

          {feedbackMessage && (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
            >
              {feedbackMessage}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E6DFD2] pt-3">
            {showBackButton && !isFirst && (
              <button
                type="button"
                onClick={() => onStepChange(effectiveStep - 1)}
                className="spotlight-tutorial-btn rounded-xl border border-[#E6DFD2] bg-white px-4 py-2 text-xs font-bold text-[#574468] hover:bg-[#EFEAF6] transition-colors"
              >
                戻る
              </button>
            )}
            {isFinal ? (
              <button
                ref={completeBtnRef}
                type="button"
                onClick={onClose}
                className="spotlight-tutorial-btn ml-auto rounded-xl bg-[#65519A] px-4 py-2 text-xs font-bold text-white hover:bg-[#564385] transition-colors"
              >
                チュートリアルを完了
              </button>
            ) : allowManualNext ? (
              <button
                ref={nextBtnRef}
                type="button"
                disabled={nextDisabled}
                onClick={() => onStepChange(effectiveStep + 1)}
                className="spotlight-tutorial-btn ml-auto rounded-xl bg-[#65519A] px-4 py-2 text-xs font-bold text-white enabled:hover:bg-[#564385] disabled:opacity-50 transition-colors"
              >
                次へ
              </button>
            ) : (
              <p className="text-[11px] font-semibold text-[#574468]">
                {currentStep.waitHint ?? "ハイライトされた操作を行うと次へ進みます"}
              </p>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
