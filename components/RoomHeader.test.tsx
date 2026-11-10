// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RoomHeader from "./RoomHeader";

describe("RoomHeader", () => {
  afterEach(cleanup);
  it("残す5つのリンク（ロゴ・事情を入れる・週間ボード・代替案・まとめシート）のみが表示され、コラムと負担は表示されない", () => {
    render(<RoomHeader roomId="test-room" activeKey="board" />);

    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(5);

    // 1. ロゴ（トップへ）
    const logoLink = screen.getByRole("link", { name: /CarePact/i });
    expect(logoLink.getAttribute("href")).toBe("/");

    // 2. 事情を入れる
    const inputLink = screen.getByRole("link", { name: "事情を入れる" });
    expect(inputLink.getAttribute("href")).toBe("/rooms/test-room/input");

    // 3. 週間ボード
    const boardLink = screen.getByRole("link", { name: "週間ボード" });
    expect(boardLink.getAttribute("href")).toBe("/rooms/test-room/board");

    // 4. 代替案
    const proposalsLink = screen.getByRole("link", { name: "代替案" });
    expect(proposalsLink.getAttribute("href")).toBe("/rooms/test-room/proposals");

    // 5. まとめシート
    const summaryLink = screen.getByRole("link", { name: "まとめシート" });
    expect(summaryLink.getAttribute("href")).toBe("/rooms/test-room/summary");

    // コラムと負担ビューが存在しないこと
    expect(screen.queryByRole("link", { name: /コラム/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /負担/ })).toBeNull();

    // ルームトップへ戻るボタンが表示されること（Issue #74）
    expect(screen.getByRole("button", { name: "ルームトップへ戻る" })).toBeTruthy();
  });

  it("ルームトップ画面（activeKey='top'）では戻るボタンは表示されない", () => {
    render(<RoomHeader roomId="test-room" activeKey="top" />);
    expect(screen.queryByRole("button", { name: "ルームトップへ戻る" })).toBeNull();
  });
});
