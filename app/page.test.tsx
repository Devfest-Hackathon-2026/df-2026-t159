// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  getIdToken: () => Promise.resolve("test-token"),
  useAnonymousUser: () => ({ uid: "anon-123" }),
}));

vi.mock("@/lib/demo/client", () => ({
  createDemoRoomClient: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HomePage (トップ画面ヒーロー)", () => {
  it("ヒーロー要素（ロゴ、見出し、説明、アクションボタン、見本ボード）が表示される", () => {
    render(<HomePage />);

    // ロゴ・タイトル
    expect(screen.getByText("CarePact")).toBeTruthy();
    expect(screen.getByText(/家族で決める、/)).toBeTruthy();
    expect(screen.getByText(/介護のかたち。/)).toBeTruthy();

    // アクションボタン
    expect(screen.getByRole("button", { name: "デモルームを作成" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "新しくルームを作成" })).toBeTruthy();

    // 見本ボード
    expect(screen.getByText("できあがるプランのイメージ")).toBeTruthy();
    expect(screen.getByRole("region", { name: /週間ボードの見本/ })).toBeTruthy();
  });
});
