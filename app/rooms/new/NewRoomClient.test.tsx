// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import NewRoomClient from "./NewRoomClient";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/auth", () => ({
  useAnonymousUser: () => ({ uid: "anon-1" }),
  getIdToken: vi.fn(async () => "test-token"),
}));

describe("NewRoomClient（Issue #72, #74）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it("トップページへ戻るボタンが存在する（Issue #74）", () => {
    render(<NewRoomClient />);
    const backLink = screen.getByRole("link", { name: /トップページへ戻る/ });
    expect(backLink.getAttribute("href")).toBe("/");
  });

  it("家族の区分が3択（介護を受ける人／付き添いができる家族／付き添いはできない家族）になっている（Issue #72）", () => {
    render(<NewRoomClient />);
    const selects = screen.getAllByLabelText("家族の区分");
    expect(selects.length).toBeGreaterThanOrEqual(2);

    const options = Array.from(selects[0].querySelectorAll("option")).map(
      (opt) => opt.textContent,
    );
    expect(options).toEqual([
      "介護を受ける人",
      "付き添いができる家族",
      "付き添いはできない家族",
    ]);
  });

  it("被介護者が指定されていない（または2人以上）の場合はエラーが表示される", async () => {
    render(<NewRoomClient />);

    const selects = screen.getAllByLabelText("家族の区分");
    // 1人目も付き添いができる家族に変更（被介護者0人）
    fireEvent.change(selects[0], { target: { value: "caregiver" } });

    const submitBtn = screen.getByRole("button", { name: "ルームを作成" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/介護を受ける人を1人指定してください/)).toBeTruthy();
  });

  it("家族ごとに絵文字アイコンを選択でき、未選択の場合は icon なしで送信される", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ roomId: "new-room-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<NewRoomClient />);

    const nameInputs = screen.getAllByPlaceholderText("名前（例：父、長女）");
    fireEvent.change(nameInputs[0], { target: { value: "父" } });
    fireEvent.change(nameInputs[1], { target: { value: "長女" } });

    const iconPickers = screen.getAllByRole("group", { name: "家族のアイコン" });
    expect(iconPickers).toHaveLength(2);
    // 1人目（父）だけアイコン 👴🏻 を選択し、2人目（長女）は未選択のまま
    const fatherGrandpaBtn = within(iconPickers[0]).getByRole("button", { name: "アイコン 👴🏻" });
    fireEvent.click(fatherGrandpaBtn);

    fireEvent.click(screen.getByRole("button", { name: "ルームを作成" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    const callArgs = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body.people[0]).toEqual(
      expect.objectContaining({ name: "父", careRole: "recipient", icon: "👴🏻" }),
    );
    expect(body.people[1]).toEqual(
      expect.objectContaining({ name: "長女", careRole: "caregiver" }),
    );
    expect(body.people[1].icon).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
