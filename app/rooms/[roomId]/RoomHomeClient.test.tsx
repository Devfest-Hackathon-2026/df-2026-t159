// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RoomHomeClient from "./RoomHomeClient";
import { getRecentRooms } from "@/lib/recent-rooms";
import {
  clearInputScreenDraft,
  getInputScreenDraft,
  saveInputScreenDraft,
} from "@/lib/structure-review";
import type { RoomSnapshot } from "@/lib/types";

vi.mock("@/lib/firebase", () => ({
  db: {},
  auth: {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => "/rooms/test-room",
}));

const mockRetryAuth = vi.fn();
const mockUseAnonymousAuth = vi.fn(() => ({
  user: { uid: "user-1" } as { uid: string } | null,
  loading: false,
  error: null as string | null,
  retry: mockRetryAuth,
}));

vi.mock("@/lib/auth", () => ({
  useAnonymousUser: () => ({ uid: "user-1" }),
  useAnonymousAuth: () => mockUseAnonymousAuth(),
  getIdToken: vi.fn(async () => "mock-token"),
}));

const mockGetDocFromServer = vi.fn(async (): Promise<{ exists: () => boolean; data: () => { isDemo?: boolean; name?: string } }> => ({
  exists: () => false,
  data: () => ({}),
}));

vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, path: string) => path,
  onSnapshot: vi.fn((path: string, update: (doc: { exists: () => boolean; data: () => object }) => void) => {
    update({ exists: () => !path.endsWith("/summary/main"), data: () => ({ revision: 1 }) });
    return () => {};
  }),
  getDocFromServer: () => mockGetDocFromServer(),
}));

vi.mock("@/lib/demo/client", () => ({
  resetDemoRoomClient: vi.fn(async () => ({ reset: true, revision: 2 })),
  seedDemoTroubledPlanClient: vi.fn(async () => ({ seeded: true, revision: 2 })),
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

const mockReadOwnMembership = vi.fn(async (): Promise<{ role: "family" | "careManager"; joinedAt: any } | null> => ({
  role: "family",
  joinedAt: {} as any,
}));

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: () => mockReadOwnMembership(),
  readRoomSnapshot: vi.fn(() => {
    return new Promise<RoomSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
  }),
}));

beforeEach(() => {
  mockRetryAuth.mockReset();
  mockUseAnonymousAuth.mockReset();
  mockUseAnonymousAuth.mockReturnValue({
    user: { uid: "user-1" },
    loading: false,
    error: null,
    retry: mockRetryAuth,
  });
  mockReadOwnMembership.mockReset();
  mockReadOwnMembership.mockResolvedValue({
    role: "family",
    joinedAt: {} as any,
  });
  mockGetDocFromServer.mockReset();
  mockGetDocFromServer.mockResolvedValue({ exists: () => false, data: () => ({}) });
  clearInputScreenDraft();
  window.localStorage.clear();
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
  it("家族用・ケアマネ用の発行済みリンクを個別にコピーできる", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { clipboard: { writeText } }));
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => ({
      ok: true, json: async () => ({ joinPath: "/rooms/test-room?invite=" + JSON.parse(options.body).role }),
    })));
    render(<RoomHomeClient roomId="test-room" />);
    for (const [label, role] of [["家族用", "family"], ["ケアマネ用", "careManager"]]) {
      fireEvent.click(await screen.findByRole("button", { name: label + "リンクを発行" }));
      fireEvent.click(await screen.findByRole("button", { name: label + "リンクをコピー" }));
      expect(writeText).toHaveBeenLastCalledWith(window.location.origin + "/rooms/test-room?invite=" + role);
    }
    await screen.findByText("コピーしました");
  });

  it("ケアマネ用招待の参加後に役割を表示し、コメントを送れる", async () => {
    window.history.replaceState(null, "", "/rooms/test-room?invite=test-invite");
    try {
      mockReadOwnMembership.mockResolvedValueOnce(null).mockResolvedValue({ role: "careManager", joinedAt: {} });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role: "careManager" }) }));
      render(<RoomHomeClient roomId="test-room" />);
      fireEvent.click(await screen.findByRole("button", { name: "招待リンクで参加する" }));
      await screen.findByText("ケアマネージャー（閲覧・コメントできます）");
      fireEvent.change(screen.getByLabelText("コメント本文"), { target: { value: "面談で確認します" } });
      fireEvent.click(screen.getByRole("button", { name: "コメントする" }));
      const { postComment } = await import("@/lib/plan/client");
      expect(postComment).toHaveBeenCalledWith("test-room", "面談で確認します");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("スナップショット読み込み完了前は「次にやること」カードを出さず控えめなプレースホルダを表示し、読み込み完了後に表示する", async () => {
    render(<RoomHomeClient roomId="test-room" />);

    // membership 読み込み後、snapshot 読み込み完了前の状態
    // 「次にやること」セクションは出ず、プレースホルダが表示される
    expect(await screen.findByLabelText("読み込み中")).toBeTruthy();
    expect(screen.queryByLabelText("次にやること")).toBeNull();

    // スナップショット読み込み完了
    resolveSnapshot!(mockSnapshot);

    const card = within(await screen.findByRole("region", { name: "次にやること" }));
    expect(screen.queryByLabelText("読み込み中")).toBeNull();
    expect(card.getByRole("heading", { name: "週間ボードでプランの続きを編集する" })).toBeTruthy();
    expect(card.getByRole("link", { name: /週間ボードを再開する/ }).getAttribute("href")).toBe(
      "/rooms/test-room/board",
    );
  });

  it.each([
    { revision: 0, destination: "input", label: "まず、家族の事情を入れる" },
    { revision: 1, destination: "board", label: "週間ボードで予定を組む" },
  ])("配置がなく介護時間帯だけのルームで revision=$revision は $destination を案内する", async ({ revision, destination, label }) => {
    render(<RoomHomeClient roomId="test-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!({
      ...mockSnapshot, revision, placements: [], careWindows: [{ day: 0, startHour: 9, endHour: 12 }],
    });
    const card = within(await screen.findByRole("region", { name: "次にやること" }));
    expect(card.getByRole("link", { name: new RegExp(label) }).getAttribute("href")).toBe(`/rooms/test-room/${destination}`);
  });

  it("確定通知だけで次の操作が切り替わり、入力更新で未確定に戻る", async () => {
    const { onSnapshot } = await import("firebase/firestore");
    render(<RoomHomeClient roomId="test-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);
    await screen.findByText("配置あり・未確定");
    const calls = vi.mocked(onSnapshot).mock.calls as unknown as [string, (doc: object) => void][];
    const notify = (path: string, data: object) => {
      const listener = calls.filter(([ref]) => ref === path).at(-1)![1];
      act(() => listener({ exists: () => true, data: () => data }));
    };
    notify("rooms/test-room/summary/main", { confirmedRevision: 1 });
    expect(await screen.findByText("確定済み")).toBeTruthy();
    notify("rooms/test-room", { revision: 2 });
    expect(await screen.findByText("配置あり・未確定")).toBeTruthy();
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

  it("平林9：デモをリセットすると、そのルームの端末内下書き（carepact:input_draft:<roomId>）も消える", async () => {
    mockGetDocFromServer.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ isDemo: true }),
    });
    vi.stubGlobal("confirm", () => true);

    saveInputScreenDraft("test-room", {
      memo: "リセットで消えるメモ",
      drafts: [],
      hopesText: "消える希望",
      unknownsText: "",
      careWindowDrafts: [],
      copayRate: 1,
      dirty: true,
      baseRevision: 1,
    });

    render(<RoomHomeClient roomId="test-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);

    const resetBtn = await screen.findByRole("button", { name: "デモをリセット" });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByText("デモルームを初期状態に戻しました。")).toBeTruthy();
    });
    expect(window.localStorage.getItem("carepact:input_draft:test-room")).toBeNull();
    expect(getInputScreenDraft("test-room")).toBeNull();
  });

  it("平林11・12：匿名ログイン失敗や参加情報取得失敗時に未参加扱いせずエラーと再試行導線を表示する", async () => {
    mockUseAnonymousAuth.mockReturnValue({
      user: null,
      loading: false,
      error: "匿名ログインに失敗しました。通信環境や接続設定を確認して、もう一度お試しください。",
      retry: mockRetryAuth,
    });
    const { unmount } = render(<RoomHomeClient roomId="test-room" />);
    const authAlert = await screen.findByRole("alert");
    expect(authAlert.textContent).toContain("匿名ログインに失敗しました");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(mockRetryAuth).toHaveBeenCalledTimes(1);
    unmount();

    mockUseAnonymousAuth.mockReturnValue({
      user: { uid: "user-1" },
      loading: false,
      error: null,
      retry: mockRetryAuth,
    });
    mockReadOwnMembership.mockRejectedValueOnce(new Error("offline"));
    render(<RoomHomeClient roomId="test-room" />);
    const memberAlert = await screen.findByRole("alert");
    expect(memberAlert.textContent).toContain("参加情報を取得できませんでした");
    expect(screen.queryByText(/このルームにはまだ参加していません/)).toBeNull();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });

  it("ルームに name が設定されている場合は最近のルームにその名前を保存し、未設定時は既存ルールで保存する", async () => {
    mockGetDocFromServer.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ isDemo: false, name: "実家のルーム" }),
    });

    const { unmount } = render(<RoomHomeClient roomId="named-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);

    await waitFor(() => {
      expect(getRecentRooms()[0]).toEqual(
        expect.objectContaining({
          roomId: "named-room",
          roomName: "実家のルーム",
        }),
      );
    });
    unmount();

    mockGetDocFromServer.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ isDemo: false }),
    });

    render(<RoomHomeClient roomId="unnamed-room" />);
    await screen.findByLabelText("読み込み中");
    resolveSnapshot!(mockSnapshot);

    await waitFor(() => {
      expect(getRecentRooms()[0]).toEqual(
        expect.objectContaining({
          roomId: "unnamed-room",
          roomName: "父のルーム",
        }),
      );
    });
  });
});
