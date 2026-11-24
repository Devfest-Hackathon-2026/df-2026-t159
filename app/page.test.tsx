// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "./page";
import { demoFixture } from "@/lib/demo-fixture";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  getIdToken: () => Promise.resolve("test-token"),
  useAnonymousUser: () => ({ uid: "anon-123" }),
  useAnonymousAuth: () => ({
    user: { uid: "anon-123" },
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
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
  it("初回HTMLの本文より先にスプラッシュを開き、同じセッションでは再度開かない", () => {
    const html = document.createElement("template");
    html.innerHTML = renderToStaticMarkup(<HomePage />);
    const main = html.content.querySelector("main")!;
    const dialog = main.firstElementChild as HTMLDialogElement;
    const script = dialog.nextElementSibling!;
    expect(dialog.tagName).toBe("DIALOG");
    expect(script.tagName).toBe("SCRIPT");
    expect(script.nextElementSibling?.classList.contains("screenbar")).toBe(true);
    expect(dialog.querySelector("form")?.method).toBe("dialog");

    const showModal = vi.fn();
    dialog.showModal = showModal;
    dialog.close = vi.fn();
    // hydrationを行わず、HTMLパーサーがこのscriptに到達した時点を再現する。
    const run = new Function("document", script.textContent!);
    const parsingDocument = { currentScript: script };
    vi.useFakeTimers();
    try {
      sessionStorage.removeItem("carepact:splash-seen");
      run(parsingDocument);
      expect(showModal).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("pagehide"));
      expect(dialog.close).toHaveBeenCalledOnce();
      run(parsingDocument);
      expect(showModal).toHaveBeenCalledTimes(1);
    } finally {
      dialog.dispatchEvent(new Event("close"));
      vi.useRealTimers();
      sessionStorage.removeItem("carepact:splash-seen");
    }
  });

  it("ヒーロー要素（ロゴ、見出し、説明、アクションボタン、見本ボード）が表示される", () => {
    render(<HomePage />);

    // ロゴ・タイトル
    expect(screen.getByRole("link", {name: "CarePact"})).toBeTruthy();
    expect(screen.getByText(/家族で決める、/)).toBeTruthy();
    expect(screen.getByText(/介護のかたち。/)).toBeTruthy();

    expect(screen.queryByText("試作版のため、架空データでお試しください。")).toBeNull();
    expect(screen.getByText("在宅介護の予定と費用を、家族で整理する相談ボードです。")).toBeTruthy();

    // アクションボタン
    const demoLinks = screen.getAllByRole("link", { name: "デモルームを作成 チュートリアル付き" });
    expect(demoLinks).toHaveLength(2);
    for (const link of demoLinks) {
      expect(link.getAttribute("href")).toBe("/rooms/demo-new");
    }
    expect(screen.getAllByRole("link", { name: "新しくルームを作成" })).toBeTruthy();

    // 見本ボード
    expect(screen.getByText("できあがるプランのイメージ")).toBeTruthy();
    expect(screen.getByRole("region", { name: /週間ボードの見本/ })).toBeTruthy();
  });

  it("見本ボードは納得プラン（acceptedPlan）の数値と予定を本物ボードと同じ形式で表示する", () => {
    render(<HomePage />);

    const example = within(screen.getByRole("figure"));
    const expected = demoFixture.acceptedPlan.expectedValidationResult;
    const preview = screen.getByRole("region", { name: /週間ボードの見本/ });

    // 納得プランの数値（単位数・自己負担・家族の負担）が表示され、揉めるプランの数値は出ない
    expect(example.getByText(new RegExp(`${expected.monthlyUnits?.toLocaleString()}単位`))).toBeTruthy();
    expect(example.getByText(new RegExp(`${expected.selfPayYen?.toLocaleString()}円`))).toBeTruthy();
    expect(example.getByText(/母 12時間・長女 18時間・長男 12時間/)).toBeTruthy();
    expect(example.queryByText(/28,131/)).toBeNull();
    expect(example.queryByText(/37,878/)).toBeNull();
    expect(example.queryByText(/長女 27時間/)).toBeNull();

    // 平日の夕方は母 17:00〜19:00 → 長女 19:00〜21:00 で表示され、揉めるプランの 18:00〜21:00 は出ない
    const monday = within(preview).getByRole("group", { name: "月曜日の予定" });
    expect(within(monday).getByText("母の付き添い")).toBeTruthy();
    expect(within(monday).getByText("17:00〜19:00")).toBeTruthy();
    expect(within(monday).getByText("長女の付き添い")).toBeTruthy();
    expect(within(monday).getByText("19:00〜21:00")).toBeTruthy();
    expect(within(monday).queryByText("18:00〜21:00")).toBeNull();

    // ブロックの幅・左余白・行位置が本物ボードと同じレイアウト計算で出力される
    const daughterEveningBlock = within(monday).getByTitle("長女の付き添い (19:00〜21:00)");
    expect(daughterEveningBlock.className).toContain("bg-amber-100");
    expect(daughterEveningBlock.parentElement?.style.width).toBe("100%");
    expect(daughterEveningBlock.parentElement?.style.marginLeft).toBe("0%");
    expect(daughterEveningBlock.parentElement?.style.gridRow).toBe("14 / 16");

    // 納得プラン固有の配置（水曜 通所介護 9:00〜16:00、金曜朝 母 7:00〜9:00、土曜午前 長男 8:00〜12:00）
    const wednesday = within(preview).getByRole("group", { name: "水曜日の予定" });
    expect(within(wednesday).getByTitle("通所介護 (9:00〜16:00)")).toBeTruthy();

    const tuesday = within(preview).getByRole("group", { name: "火曜日の予定" });
    const dayrehabBlock = within(tuesday).getByTitle("通所リハビリ (10:00〜14:00)");
    expect(dayrehabBlock.className).toContain("bg-fuchsia-200");

    const friday = within(preview).getByRole("group", { name: "金曜日の予定" });
    expect(within(friday).getByTitle("母の付き添い (7:00〜9:00)")).toBeTruthy();
    expect(within(friday).queryByTitle(/訪問介護/)).toBeNull();

    const saturday = within(preview).getByRole("group", { name: "土曜日の予定" });
    expect(within(saturday).getByTitle("長男の付き添い (8:00〜12:00)")).toBeTruthy();
    expect(within(saturday).queryByTitle(/長女の付き添い/)).toBeNull();
  });
});
