// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import RecentRoomsList from "./RecentRoomsList";
import { saveRecentRoom } from "@/lib/recent-rooms";

describe("RecentRoomsList", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("ルーム記録が無いときは何も表示しない", () => {
    const { container } = render(<RecentRoomsList />);
    expect(container.firstChild).toBeNull();
  });

  it("ルーム記録があるときは一覧を表示し、削除ボタンで消せる", () => {
    saveRecentRoom({ roomId: "room-abc", roomName: "テスト家のルーム" });

    render(<RecentRoomsList />);

    expect(screen.getByText("あなたのルーム")).toBeTruthy();
    expect(screen.getByText("テスト家のルーム")).toBeTruthy();

    const deleteBtn = screen.getByRole("button", { name: "削除" });
    fireEvent.click(deleteBtn);

    expect(screen.queryByText("テスト家のルーム")).toBeNull();
  });
});
