// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HomeReveal from "./HomeReveal";

const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void;
let observers = 0;

beforeEach(() => {
  observers = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: typeof notify) { notify = callback; observers++; }
    observe = observe;
    unobserve = unobserve;
    disconnect = disconnect;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

function setup() {
  const view = render(<><HomeReveal /><section data-home-reveal>予定の見本</section><section data-home-reveal>使い方</section></>);
  return { ...view, sections: [...view.container.querySelectorAll("section")] };
}

it("画面内に入ったセクションだけを表示演出し、繰り返し監視しない", () => {
  const { sections } = setup();
  expect(observe).toHaveBeenCalledTimes(2);
  expect(sections.every(s => s.hasAttribute("data-reveal-pending"))).toBe(true);
  notify([{ target: sections[0], isIntersecting: false }]);
  expect(sections[0].classList.contains("home-revealed")).toBe(false);
  notify([{ target: sections[0], isIntersecting: true }]);
  expect(sections[0].hasAttribute("data-reveal-pending")).toBe(false);
  expect(sections[0].classList.contains("home-revealed")).toBe(true);
  expect(unobserve).toHaveBeenCalledWith(sections[0]);
  expect(sections[1].hasAttribute("data-reveal-pending")).toBe(true);
});

it("動きを減らす設定では監視も非表示化も行わない", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { sections } = setup();
  expect(observers).toBe(0);
  expect(sections.every(s => !s.hasAttribute("data-reveal-pending"))).toBe(true);
});

it("IntersectionObserverが利用できなくても本文を表示する", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { sections } = setup();
  expect(sections.every(s => !s.hasAttribute("data-reveal-pending"))).toBe(true);
});

it("画面を離れたら監視と表示演出の状態を片付ける", () => {
  const { unmount, sections } = setup();
  notify([{ target: sections[0], isIntersecting: true }]);
  unmount();
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(sections.every(s => !s.hasAttribute("data-reveal-pending") && !s.classList.contains("home-revealed"))).toBe(true);
});
