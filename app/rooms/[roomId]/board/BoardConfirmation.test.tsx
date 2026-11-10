// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BoardClient, { type BoardConnection } from "./BoardClient";
import { demoFixture as fixture } from "@/lib/demo-fixture";
import type { MemberRole, RoomSnapshot } from "@/lib/types";

// このテストは親の確定・同期処理を検証する。盤面のドラッグ等は既存の専用テストが担う。
vi.mock("./WeeklyBoard", async importOriginal => ({
  ...await importOriginal<typeof import("./WeeklyBoard")>(),
  default: () => <div aria-label="週間予定" />,
}));
vi.mock("./BoardLeftNav", () => ({ default: () => null }));
vi.mock("./BoardAssistPanel", () => ({ default: () => null }));

vi.mock("next/dynamic", () => ({ default: () => function EmbeddedProposals({ embedded, onRoomChanged }: { embedded: boolean; onRoomChanged: () => Promise<void> }) {
  return <button onClick={() => void onRoomChanged()}>{embedded ? "代替案の採用後に同期" : "通常ページ"}</button>;
} }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

function port(overrides: Partial<RoomSnapshot> = {}, role: MemberRole = "family") {
  let stored: RoomSnapshot = {
    people: fixture.people, placements: fixture.acceptedPlan.placements,
    constraints: fixture.constraints, hopes: fixture.hopes, unknowns: [],
    careWindows: fixture.careWindows, copayRate: fixture.copayRate, revision: 7, ...overrides,
  };
  let confirmedRevision: number | null = null;
  const connection: BoardConnection = {
    load: vi.fn(async () => ({ snapshot: structuredClone(stored), role, isDemo: false, confirmedRevision })),
    save: vi.fn(async (_id, expected, placements) => {
      expect(expected).toBe(stored.revision);
      stored = { ...stored, placements, revision: expected + 1 };
      return stored.revision;
    }),
    confirm: vi.fn(async (_id: string, expected: number) => { confirmedRevision = expected; return { confirmedRevision: expected }; }),
  };
  return { connection, update: (next: Partial<RoomSnapshot>) => { stored = { ...stored, ...next }; } };
}

async function confirmButton() {
  const button = await screen.findByRole("button", { name: "このプランで確定する" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  return button;
}

describe("ボードからの確定と代替案パネル", () => {
  it("現在のrevisionで既存の確定処理を呼び、確定記録の再取得後にまとめへ案内する。入力が変われば未確定に戻る", async () => {
    const { connection, update } = port();
    render(<BoardClient roomId="test" connection={connection} />);
    fireEvent.click(await confirmButton());
    await screen.findByRole("link", { name: "まとめシートで確認・印刷する" });
    expect(connection.confirm).toHaveBeenCalledWith("test", 7);
    expect(connection.save).not.toHaveBeenCalled();
    expect(screen.getByText("確定済み")).toBeTruthy();
    update({ revision: 8 });
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await confirmButton();
    expect(screen.queryByText("確定済み")).toBeNull();
  });

  it("確定後はヘッダーの「まとめシート」ボタンがプライマリになり、「代替案を開く」が白ボタンになる", async () => {
    const { connection } = port();
    render(<BoardClient roomId="test" connection={connection} />);
    const summaryLink = await screen.findByRole("link", { name: "📄 まとめシート" });
    const proposalsButton = screen.getByRole("button", { name: "代替案を開く" });

    // 未確定時
    expect(summaryLink.className).toContain("bg-white");
    expect(proposalsButton.className).toContain("bg-indigo-600");

    // 確定する
    fireEvent.click(await confirmButton());
    await screen.findByRole("link", { name: "まとめシートで確認・印刷する" });

    // 確定後
    expect(summaryLink.className).toContain("bg-indigo-600");
    expect(proposalsButton.className).toContain("bg-white");
  });

  it.each(["unknowns", "validation", "role"])("%s が確定条件を満たさない場合は理由を表示し保存しない", async reason => {
    const { connection } = port(reason === "unknowns" ? { unknowns: ["家族に確認が必要"] } : reason === "validation" ? { placements: fixture.troubledPlan.placements } : {}, reason === "role" ? "careManager" : "family");
    render(<BoardClient roomId="test" connection={connection} />);
    const button = await screen.findByRole("button", { name: "このプランで確定する" });
    await waitFor(() => expect(screen.queryByText("検証中です。最新の検証結果を確認してから確定できます。")).toBeNull());
    expect((button as HTMLButtonElement).disabled).toBe(true);
    if (reason === "unknowns") expect(screen.getByText("家族に確認が必要")).toBeTruthy();
    if (reason === "validation") expect(screen.getByText(/問題があるため確定できません/)).toBeTruthy();
    if (reason === "role") expect(screen.getByText(/プランを確定できるのは家族だけです/)).toBeTruthy();
    fireEvent.click(button);
    expect(connection.confirm).not.toHaveBeenCalled();
  });

  it("確定の競合・通信エラーは表示し、確定済みと誤表示しない", async () => {
    const { connection } = port();
    vi.mocked(connection.confirm!).mockRejectedValue(new Error("入力が更新されました。再読み込みしてください。"));
    render(<BoardClient roomId="test" connection={connection} />);
    fireEvent.click(await confirmButton());
    expect((await screen.findByRole("alert")).textContent).toContain("入力が更新されました");
    expect(screen.queryByText("確定済み")).toBeNull();
  });

  it("右レールとヘッダーからパネルを開閉でき、採用後の更新通知でボードを再読み込みする", async () => {
    const { connection, update } = port();
    render(<BoardClient roomId="test" connection={connection} />);
    await confirmButton();
    fireEvent.click(screen.getByRole("button", { name: /✨ 代替案を見る/ }));
    const dialog = screen.getByRole("dialog", { name: "代替案の取得・比較・採用" });
    expect(dialog).toBeTruthy();
    update({ unknowns: ["採用後の確認事項"], revision: 8 });
    fireEvent.click(screen.getByRole("button", { name: "代替案の採用後に同期" }));
    await screen.findByText("採用後の確認事項");
    expect(connection.load).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "ボードへ戻る" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "代替案を開く" }));
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
