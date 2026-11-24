// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewRoomClient from "../new/NewRoomClient";
import DemoNewRoomClient from "./DemoNewRoomClient";
import { DEMO_BOARD_TUTORIAL_STORAGE_PREFIX, markDemoBoardTutorialDone, clearDemoBoardTutorialDone } from "@/lib/demo-board-tutorial";
import { DEMO_INPUT_TUTORIAL_STORAGE_PREFIX, markDemoInputTutorialDone, clearDemoInputTutorialDone } from "@/lib/demo-input-tutorial";
import {
  clearDemoRegistrationTutorialDone,
  DEMO_REGISTRATION_TUTORIAL_STEPS,
  DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY,
  getDemoRegistrationTutorialStep,
  isDemoRegistrationTutorialDone,
  markDemoRegistrationTutorialDone,
} from "@/lib/demo-registration-tutorial";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockGetIdToken = vi.fn(async () => "test-token");
vi.mock("@/lib/auth", () => ({
  useAnonymousUser: () => ({ uid: "anon-1" }),
  useAnonymousAuth: () => ({
    user: { uid: "anon-1" },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
  getIdToken: () => mockGetIdToken(),
}));

const mockCreateDemoRoomClient = vi.fn();
vi.mock("@/lib/demo/client", () => ({
  createDemoRoomClient: (...args: unknown[]) => mockCreateDemoRoomClient(...args),
}));

describe("デモ登録画面チュートリアル（/rooms/demo-new）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    clearDemoRegistrationTutorialDone();
    clearDemoInputTutorialDone();
    clearDemoBoardTutorialDone();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    clearDemoRegistrationTutorialDone();
    clearDemoInputTutorialDone();
    clearDemoBoardTutorialDone();
    vi.restoreAllMocks();
  });

  it("ステップ定義（4ステップ・対象・文面・allowManualNext）とストレージキーが仕様どおりで、入力/ボードと分離されている", () => {
    expect(DEMO_REGISTRATION_TUTORIAL_STEPS).toHaveLength(4);
    expect(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY).not.toContain(
      DEMO_INPUT_TUTORIAL_STORAGE_PREFIX,
    );
    expect(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY).not.toContain(
      DEMO_BOARD_TUTORIAL_STORAGE_PREFIX,
    );

    expect(getDemoRegistrationTutorialStep(1)).toEqual({
      step: 1,
      title: "ステップ 1 / 4：ルーム名",
      message:
        "ルーム名は任意で設定できます。最初から『デモルーム（佐藤家）』が入っています。変えたい場合は書き換えてください。",
      targetKeys: ["room-name"],
      primaryTargetKey: "room-name",
      allowManualNext: true,
    });
    expect(getDemoRegistrationTutorialStep(2)).toEqual({
      step: 2,
      title: "ステップ 2 / 4：家族の一覧",
      message:
        "このルームでは、介護を受ける父と、付き添いができる家族が登場します。まず3人が登録済みです。",
      targetKeys: ["family-list"],
      primaryTargetKey: "family-list",
      allowManualNext: true,
    });
    expect(getDemoRegistrationTutorialStep(3)).toEqual({
      step: 3,
      title: "ステップ 3 / 4：長男の試し登録",
      message:
        "最後の1人、長男を登録してみましょう。名前を入力して、『付き添いができる』を選んでください。",
      targetKeys: ["son-trial-form"],
      primaryTargetKey: "son-trial-form",
      allowManualNext: true,
    });
    expect(getDemoRegistrationTutorialStep(4)).toEqual({
      step: 4,
      title: "ステップ 4 / 4：作成",
      message: "『この内容でデモルームを作る』を押すと、デモが始まります。",
      targetKeys: ["create-btn"],
      primaryTargetKey: "create-btn",
      allowManualNext: false,
      isFinal: true,
    });

    // localStorage 不可時もメモリ保持フォールバックが機能する
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(isDemoRegistrationTutorialDone()).toBe(false);
    markDemoRegistrationTutorialDone();
    expect(isDemoRegistrationTutorialDone()).toBe(true);
  });

  it("初回は自動開始し、ステップ3は名前の入力後に「次へ」で進み、完了後は再表示されない", async () => {
    markDemoInputTutorialDone("any-room");
    markDemoBoardTutorialDone("any-room");

    const { unmount } = render(<DemoNewRoomClient />);

    // ステップ 1
    const dialog = await screen.findByTestId("demo-registration-tutorial-dialog");
    expect(dialog.getAttribute("data-tutorial-step")).toBe("1");
    expect(dialog.textContent).toContain("デモ案内 1 / 4");
    expect(dialog.textContent).toContain(
      "ルーム名は任意で設定できます。最初から『デモルーム（佐藤家）』が入っています。変えたい場合は書き換えてください。",
    );
    const roomNameTarget = document.querySelector('[data-registration-tutorial-target="room-name"]');
    expect(roomNameTarget?.contains(screen.getByRole("textbox", { name: "ルーム名" }))).toBe(true);
    expect(roomNameTarget?.contains(screen.getByText(/これはデモ（チュートリアル）です/))).toBe(true);

    // ステップ 2
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("2");
    expect(dialog.textContent).toContain(
      "このルームでは、介護を受ける父と、付き添いができる家族が登場します。まず3人が登録済みです。",
    );
    expect(
      document.querySelector('[data-registration-tutorial-target="family-list"]'),
    ).toBeTruthy();

    // ステップ 3
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    expect(dialog.textContent).toContain(
      "最後の1人、長男を登録してみましょう。名前を入力して、『付き添いができる』を選んでください。",
    );
    const nextButton = screen.getByRole<HTMLButtonElement>("button", { name: "次へ" });
    expect(nextButton.disabled).toBe(true);
    expect(
      document.querySelector('[data-registration-tutorial-target="son-trial-form"]'),
    ).toBeTruthy();

    const sonNameInput = screen.getByLabelText(/長男の名前/) as HTMLInputElement;
    sonNameInput.focus();
    expect(document.activeElement).toBe(sonNameInput);

    fireEvent.change(sonNameInput, { target: { value: "　 " } });
    expect(nextButton.disabled).toBe(true);
    fireEvent.click(nextButton);
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");

    // IME変換中は進まない
    fireEvent.compositionStart(sonNameInput);
    fireEvent.change(sonNameInput, { target: { value: "けんた" } });
    expect(nextButton.disabled).toBe(true);
    expect(fireEvent.keyDown(sonNameInput, { key: "Enter", isComposing: true })).toBe(false);
    fireEvent.click(nextButton);
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");

    // IME確定後も入力欄にフォーカスが残り、本人が「次へ」を押して進む
    fireEvent.change(sonNameInput, { target: { value: "健太" } });
    fireEvent.compositionEnd(sonNameInput, { data: "健太" });
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    expect(document.activeElement).toBe(sonNameInput);
    expect(nextButton.disabled).toBe(false);
    fireEvent.click(nextButton);
    expect(dialog.getAttribute("data-tutorial-step")).toBe("4");
    expect(dialog.textContent).toContain(
      "『この内容でデモルームを作る』を押すと、デモが始まります。",
    );
    expect(
      document.querySelector('[data-registration-tutorial-target="create-btn"]'),
    ).toBeTruthy();

    // ステップ 4 で名前を空に戻すとステップ 3 へ戻る
    fireEvent.change(sonNameInput, { target: { value: "" } });
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");

    // 英字の1文字目でも、貼り付けでも、自分で「次へ」を押すまで進まない
    const nextAfterClear = screen.getByRole<HTMLButtonElement>("button", { name: "次へ" });
    expect(nextAfterClear.disabled).toBe(true);
    fireEvent.change(sonNameInput, { target: { value: "K" } });
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    expect(nextAfterClear.disabled).toBe(false);
    fireEvent.input(sonNameInput, { target: { value: "Kenta" }, inputType: "insertFromPaste" });
    expect(dialog.getAttribute("data-tutorial-step")).toBe("3");
    fireEvent.click(nextAfterClear);
    expect(dialog.getAttribute("data-tutorial-step")).toBe("4");

    // チュートリアルを完了すると閉じ、再マウント時は出ない
    fireEvent.click(screen.getByRole("button", { name: "チュートリアルを完了" }));
    expect(screen.queryByTestId("demo-registration-tutorial-dialog")).toBeNull();
    expect(isDemoRegistrationTutorialDone()).toBe(true);
    expect(
      window.localStorage.getItem(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY),
    ).toBe("1");

    unmount();
    render(<DemoNewRoomClient />);
    expect(screen.queryByTestId("demo-registration-tutorial-dialog")).toBeNull();
  });

  it("「案内を終わる」および Esc キーでスキップ終了できる", async () => {
    const { unmount } = render(<DemoNewRoomClient />);
    await screen.findByTestId("demo-registration-tutorial-dialog");

    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    expect(screen.queryByTestId("demo-registration-tutorial-dialog")).toBeNull();
    expect(isDemoRegistrationTutorialDone()).toBe(true);

    unmount();
    clearDemoRegistrationTutorialDone();
    render(<DemoNewRoomClient />);
    await screen.findByTestId("demo-registration-tutorial-dialog");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("demo-registration-tutorial-dialog")).toBeNull();
    expect(isDemoRegistrationTutorialDone()).toBe(true);
  });

  it("ステップ切替とスクロール・リサイズ後にハイライト枠の位置が再計算される", async () => {
    let roomRectTop = 100;
    let familyRectTop = 260;

    const origGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const target = this.getAttribute("data-registration-tutorial-target");
      if (target === "room-name") {
        return new DOMRect(40, roomRectTop, 300, 40);
      }
      if (target === "family-list") {
        return new DOMRect(40, familyRectTop, 500, 200);
      }
      if (target === "son-trial-form") {
        return new DOMRect(40, 400, 500, 90);
      }
      if (target === "create-btn") {
        return new DOMRect(40, 520, 220, 44);
      }
      return origGetBoundingClientRect.call(this);
    });

    const rafQueue: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<DemoNewRoomClient />);
    const ring1 = await screen.findByTestId(
      "demo-registration-tutorial-ring-room-name",
    );
    expect(ring1.style.top).toBe("92px"); // 100 - 8px padding

    // スクロール後の再計算
    roomRectTop = 140;
    act(() => {
      fireEvent.scroll(window);
      while (rafQueue.length > 0) {
        rafQueue.shift()!(0);
      }
    });
    expect(
      screen.getByTestId("demo-registration-tutorial-ring-room-name").style.top,
    ).toBe("132px");

    // ステップ切替 + リサイズ後の再計算
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    const ring2 = await screen.findByTestId(
      "demo-registration-tutorial-ring-family-list",
    );
    expect(ring2.style.top).toBe("252px");

    familyRectTop = 210;
    act(() => {
      fireEvent(window, new Event("resize"));
      while (rafQueue.length > 0) {
        rafQueue.shift()!(0);
      }
    });
    expect(
      screen.getByTestId("demo-registration-tutorial-ring-family-list").style.top,
    ).toBe("202px");
  });

  it("通常ルーム作成画面（/rooms/new）には登録画面チュートリアルを表示しない", () => {
    render(<NewRoomClient />);
    expect(screen.queryByTestId("demo-registration-tutorial-dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "案内を終わる" })).toBeNull();
  });
});
