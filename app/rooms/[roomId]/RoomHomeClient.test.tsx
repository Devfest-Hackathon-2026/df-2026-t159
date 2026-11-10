// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

const mockSnapshot: RoomSnapshot = {
  people: [{ id: "p1", name: "父", canProvideCare: false }],
  placements: [
    {
      id: "pl-1",
      day: 0,
      startHour: 9,
      endHour: 17,
      kind: "daycare",
      serviceId: "day-service",
    },
  ],
  constraints: [],
  hopes: [],
  unknowns: [],
  careWindows: [],
  copayRate: 1,
  revision: 1,
};

let resolveSnapshot: ((snap: RoomSnapshot) => void) | null = null;

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: vi.fn(async () => ({
    role: "family",
    joinedAt: {} as any,
  })),
  readRoomSnapshot: vi.fn(() => {
    return new Promise<RoomSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
  }),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resolveSnapshot = null;
});

describe("RoomHomeClient", () => {
  it("スナップショット読み込み完了前は「次にやること」カードを出さず控えめなプレースホルダを表示し、読み込み完了後に表示する", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    // membership 読み込み後、snapshot 読み込み完了前の状態
    // 「次にやること」セクションは出ず、プレースホルダが表示される
    expect(await screen.findByLabelText("読み込み中")).toBeTruthy();
    expect(screen.queryByLabelText("次にやること")).toBeNull();

    // スナップショット読み込み完了
    resolveSnapshot!(mockSnapshot);

    // 「次にやること」が表示される（配置があるのでステップ2「代替案を見て、プランを決める」）
    await waitFor(() => {
      expect(screen.getByLabelText("次にやること")).toBeTruthy();
    });
    expect(screen.queryByLabelText("読み込み中")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "代替案を見て、プランを決める" }),
    ).toBeTruthy();
  });

  it("コラムへの導線リンクが存在する", async () => {
    render(<RoomHomeClient roomId="test-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);

    await waitFor(() => {
      const columnLink = screen.getByRole("link", { name: /コラムを読む/ });
      expect(columnLink.getAttribute("href")).toBe("/rooms/test-room/columns");
    });
  });

  it("登録されている家族一覧のアイコンが40px（h-10 w-10）で表示される", async () => {
    render(<RoomHomeClient roomId="test-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "登録されている家族" })).toBeTruthy();
    });

    const familySection = screen.getByRole("region", { name: "登録されている家族" });
    const icons = familySection.querySelectorAll("ul span.rounded-full");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.className).toContain("h-10");
      expect(icon.className).toContain("w-10");
    }
  });
});
