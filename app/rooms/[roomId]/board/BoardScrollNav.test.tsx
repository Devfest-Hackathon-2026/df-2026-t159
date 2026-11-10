// @vitest-environment jsdom
import React, { useRef } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BoardScrollNav from "./BoardScrollNav";

let width = 358;
const scrollTo = vi.fn(function(this: HTMLElement, options: ScrollToOptions) {
  this.scrollLeft = options.left ?? 0;
  fireEvent.scroll(this);
});
beforeEach(() => {
  width = 358;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(840);
  vi.stubGlobal("ResizeObserver", undefined);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); scrollTo.mockClear(); });

function setup() {
  function Harness() {
    const viewportRef = useRef<HTMLDivElement>(null);
    return <><BoardScrollNav viewportRef={viewportRef} /><div data-testid="viewport" ref={viewportRef} /></>;
  }
  render(<Harness />);
}

it("見えている曜日を表示し、日曜ボタンはスクロール上限まで移動する", () => {
  setup();
  expect(screen.getByRole("status").textContent).toContain("表示中：月〜水曜");
  expect(screen.getAllByRole("button")).toHaveLength(7);
  fireEvent.click(screen.getByRole("button", { name: "日曜日を表示" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 482, behavior: "smooth" });
  expect(screen.getByRole("status").textContent).toContain("表示中：金〜日曜");
  expect(screen.getByRole("button", { name: "日曜日を表示" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "月曜日を表示" }));
  expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
  expect(screen.getByRole("status").textContent).toContain("表示中：月〜水曜");
});

it("手動スクロールと幅変更でも表示中の曜日を更新する", () => {
  setup();
  const viewport = screen.getByTestId("viewport");
  viewport.scrollLeft = (840 - 48) / 7 * 2;
  fireEvent.scroll(viewport);
  expect(screen.getByRole("status").textContent).toContain("表示中：水〜金曜");
  width = 160;
  fireEvent(window, new Event("resize"));
  expect(screen.getByRole("status").textContent).toContain("表示中：水曜");
});
