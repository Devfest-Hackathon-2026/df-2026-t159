// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoomHomeClient from "./RoomHomeClient";
import type { RoomSnapshot } from "@/lib/types";

vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
  usePathname: () => "/rooms/test-room",
}));

vi.mock("@/lib/auth", () => ({
  useAnonymousUser: () => ({ uid: "user-1" }),
  getIdToken: vi.fn(async () => "mock-token"),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(async () => ({ exists: () => false })),
}));

vi.mock("@/lib/plan/client", () => ({
  listComments: vi.fn(async () => []),
  postComment: vi.fn(async () => ({})),
}));

const mockCommitRoomChange = vi.fn(async (..._args: unknown[]) => 2);

const testSnapshot: RoomSnapshot = {
  people: [
    { id: "p-father", name: "父", canProvideCare: false, careRole: "recipient" },
    { id: "p-daughter", name: "長女", canProvideCare: true, careRole: "caregiver" },
  ],
  placements: [
    {
      id: "pl-1",
      day: 0,
      startHour: 9,
      endHour: 10,
      kind: "family",
      personId: "p-daughter",
    },
  ],
  constraints: [],
  hopes: [],
  unknowns: [],
  careWindows: [],
  copayRate: 1,
  revision: 1,
};

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: vi.fn(async () => ({
    role: "family",
    joinedAt: {} as any,
  })),
  readRoomSnapshot: vi.fn(async () => testSnapshot),
  commitRoomChange: (...args: unknown[]) => mockCommitRoomChange(...args),
}));

describe("RoomHomeClient - 家族の追加・編集・削除と3区分表示（Issue #71, #72）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("家族の3区分ラベル（介護を受ける人／付き添いができる家族）が正しく表示される", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    expect(await screen.findByText("長女")).toBeTruthy();
    expect(screen.getByText("介護を受ける人")).toBeTruthy();
    expect(screen.getByText("付き添いができる家族")).toBeTruthy();
  });

  it("「家族を追加・編集」をクリックすると編集フォームが開き、家族の追加・編集ができる", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    const editBtn = await screen.findByRole("button", { name: "家族を追加・編集" });
    fireEvent.click(editBtn);

    // 編集モードに切り替わる
    expect(screen.getByText("＋ 家族を追加")).toBeTruthy();
    expect(screen.getByRole("button", { name: "変更を保存" })).toBeTruthy();

    // 家族を追加
    fireEvent.click(screen.getByText("＋ 家族を追加"));

    // 新しい家族の名前を入力
    const inputs = screen.getAllByPlaceholderText("名前（例：父、長女）");
    expect(inputs).toHaveLength(3);
    fireEvent.change(inputs[2], { target: { value: "次女" } });

    // 変更を保存
    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    await waitFor(() => {
      expect(mockCommitRoomChange).toHaveBeenCalledWith(
        "test-room",
        1,
        expect.objectContaining({
          people: expect.arrayContaining([
            expect.objectContaining({ name: "父", careRole: "recipient" }),
            expect.objectContaining({ name: "長女", careRole: "caregiver" }),
            expect.objectContaining({ name: "次女", careRole: "caregiver" }),
          ]),
        }),
      );
    });
  });

  it("配置がある家族を削除しようとするとガードが働き、理由が表示されて削除されない", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    const editBtn = await screen.findByRole("button", { name: "家族を追加・編集" });
    fireEvent.click(editBtn);

    // 長女には配置がある（pl-1）ため削除できないはず
    const deleteButtons = screen.getAllByRole("button", { name: "削除" });
    // index 1 が長女の削除ボタン
    fireEvent.click(deleteButtons[1]);

    // 理由が表示され、長女は削除されない
    expect(await screen.findByText(/週間ボードに1件の配置があるため削除できません/)).toBeTruthy();
    expect(mockCommitRoomChange).not.toHaveBeenCalled();
  });

  it("被介護者が0人または2人以上の場合は保存できずエラーが表示される", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    const editBtn = await screen.findByRole("button", { name: "家族を追加・編集" });
    fireEvent.click(editBtn);

    // 父の区分を caregiver に変更（これで被介護者が0人になる）
    const selects = screen.getAllByLabelText("家族の区分");
    fireEvent.change(selects[0], { target: { value: "caregiver" } });

    fireEvent.click(screen.getByRole("button", { name: "変更を保存" }));

    expect(await screen.findByText(/介護を受ける人を1人指定してください/)).toBeTruthy();
    expect(mockCommitRoomChange).not.toHaveBeenCalled();
  });
});
