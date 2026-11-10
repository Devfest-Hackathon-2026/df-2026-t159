// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DemoCreateButton from "./DemoCreateButton";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const mockGetIdToken = vi.fn(async () => "test-token");
const mockUseAnonymousUser = vi.fn((): { uid: string } | null => ({ uid: "anon-123" }));
vi.mock("@/lib/auth", () => ({
  getIdToken: () => mockGetIdToken(),
  useAnonymousUser: () => mockUseAnonymousUser(),
}));

const mockCreateDemoRoomClient = vi.fn();
vi.mock("@/lib/demo/client", () => ({
  createDemoRoomClient: (...args: unknown[]) => mockCreateDemoRoomClient(...args),
}));

describe("DemoCreateButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAnonymousUser.mockReturnValue({ uid: "anon-123" });
    mockGetIdToken.mockResolvedValue("test-token");
  });

  afterEach(cleanup);

  it("デモ作成後はルームの入力画面（/rooms/:roomId/input）へ遷移する", async () => {
    mockCreateDemoRoomClient.mockResolvedValueOnce({
      roomId: "demo-room-456",
      personMapping: {},
    });

    render(<DemoCreateButton />);

    const button = screen.getByRole("button", { name: "デモルームを作成" });
    expect(button).toBeTruthy();

    fireEvent.click(button);

    await waitFor(() => {
      expect(mockCreateDemoRoomClient).toHaveBeenCalledWith("test-token", {
        initialState: "troubled",
      });
      expect(mockPush).toHaveBeenCalledWith("/rooms/demo-room-456/input");
    });
  });

  it("未認証時はボタンが無効化される", () => {
    mockUseAnonymousUser.mockReturnValueOnce(null);

    render(<DemoCreateButton />);

    const button = screen.getByRole("button", { name: "デモルームを作成" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("作成失敗時はエラーメッセージを表示する", async () => {
    mockCreateDemoRoomClient.mockRejectedValueOnce(
      new Error("サーバーエラーが発生しました"),
    );

    render(<DemoCreateButton />);

    const button = screen.getByRole("button", { name: "デモルームを作成" });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("サーバーエラーが発生しました")).toBeTruthy();
    });
  });
});
