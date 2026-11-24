// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InputClient from "./InputClient";
import { buildBackdropPath } from "./DemoInputTutorial";
import { addCareWindowsBulk } from "@/lib/care-windows-group";
import { demoFixture } from "@/lib/demo-fixture";
import {
  DEMO_INPUT_TUTORIAL_STEPS,
  DEMO_INPUT_TUTORIAL_STORAGE_PREFIX,
  clearDemoInputTutorialDone,
  isDemoInputTutorialDone,
  markDemoInputTutorialDone,
} from "@/lib/demo-input-tutorial";
import {
  careWindowDraftsFromWindows,
  clearInputScreenDraft,
  getInputScreenDraft,
  toCareWindows,
} from "@/lib/structure-review";
import type { RoomSnapshot } from "@/lib/types";

const mockRetryAuth = vi.fn();
const mockUseAnonymousAuth = vi.fn(() => ({
  user: { uid: "test-user" } as { uid: string } | null,
  loading: false,
  error: null as string | null,
  retry: mockRetryAuth,
}));

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return {
    useAnonymousUser: () => user,
    useAnonymousAuth: () => mockUseAnonymousAuth(),
    getIdToken: vi.fn(async () => "test-token"),
    ensureAnonymousUser: vi.fn(async () => user),
  };
});

vi.mock("@/lib/firebase", () => ({ db: {} }));

let mockRoomIsDemo = false;

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ isDemo: mockRoomIsDemo }),
  })),
}));

const mockReadRoomSnapshot = vi.fn<() => Promise<RoomSnapshot | null>>();
const mockReadOwnMembership = vi.fn(
  async (): Promise<{ role: "family" | "careManager" } | null> => ({
    role: "family",
  }),
);

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: () => mockReadOwnMembership(),
  readRoomSnapshot: () => mockReadRoomSnapshot(),
}));

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/rooms/demo-room-1/input",
  useRouter: () => ({ push: mockPush }),
}));

const demoSnapshot: RoomSnapshot = {
  people: demoFixture.people,
  placements: demoFixture.troubledPlan.placements,
  constraints: demoFixture.constraints,
  hopes: demoFixture.hopes,
  unknowns: demoFixture.unknowns,
  careWindows: demoFixture.careWindows,
  copayRate: demoFixture.copayRate,
  revision: 0,
};

function expectTutorialInstruction(message: string, emphasizedText: string) {
  const dialog = screen.getByTestId("demo-tutorial-dialog");
  const description = document.getElementById(dialog.getAttribute("aria-describedby")!);
  expect(description?.textContent).toBe(message);
  expect(Array.from(description!.querySelectorAll("strong"), (el) => el.textContent)).toEqual([emphasizedText]);
  const guide = within(dialog);
  expect(guide.getByRole("status").textContent).toBe(`${guide.getByRole("heading").textContent}。${message}`);
}

describe("デモルーム専用チュートリアル（入力画面）", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom には Canvas の描画機能がないため、描画先のみ差し替える。
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: (line: string) => ({ width: line.length * 24 }),
      fillText: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,iVBORw0KGgo=");
    clearInputScreenDraft();
    clearDemoInputTutorialDone();
    mockRoomIsDemo = false;
    mockUseAnonymousAuth.mockReturnValue({
      user: { uid: "test-user" },
      loading: false,
      error: null,
      retry: mockRetryAuth,
    });
    mockReadOwnMembership.mockResolvedValue({ role: "family" });
    mockReadRoomSnapshot.mockResolvedValue(demoSnapshot);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    clearInputScreenDraft();
    clearDemoInputTutorialDone();
    global.fetch = originalFetch;
  });

  it("通常ルーム（isDemo=false）にはチュートリアルを表示せず、familyMemo も見本書類も表示しない", async () => {
    mockRoomIsDemo = false;

    render(<InputClient roomId="normal-room-1" />);
    await screen.findByText("登録されている家族");

    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(screen.queryByTestId("demo-tutorial-exit-bar")).toBeNull();
    expect(screen.queryByRole("button", { name: "チュートリアルをもう一度見る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "案内を終わる" })).toBeNull();
    expect(screen.queryByTestId("image-preview-thumbnail")).toBeNull();

    const memoTextarea = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    expect(memoTextarea.value).toBe("");
    expect(screen.getByText("土・日")).toBeTruthy();
  });

  it.each([
    { roomType: "通常ルーム", isDemo: false },
    { roomType: "デモルーム", isDemo: true },
  ])("$roomType の写真欄・メモ欄で注意書きを出し分ける", async ({ isDemo }) => {
    mockRoomIsDemo = isDemo;
    render(<InputClient roomId="room-input-notices" />);
    await screen.findByText("登録されている家族");

    const photo = screen.getByRole("region", { name: "書類の写真アップロード" });
    const memo = screen.getByRole("region", { name: "家族の事情メモ" });
    const demoNotice = "実在する方の情報や、実際の退院書類・写真は入力しないでください。";
    expect(photo.textContent).toContain("写真は保存されません。");
    expect(photo.textContent?.includes(demoNotice)).toBe(isDemo);
    expect(memo.textContent?.includes(demoNotice)).toBe(isDemo);
  });

  it("ケアマネ（閲覧のみ）ではデモルームでもチュートリアルを表示しない", async () => {
    mockRoomIsDemo = true;
    mockReadOwnMembership.mockResolvedValue({ role: "careManager" });

    render(<InputClient roomId="demo-room-cm" />);
    await screen.findByText("登録されている家族");

    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "チュートリアルをもう一度見る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "案内を終わる" })).toBeNull();
    expect(await screen.findByText("退院時サマリー（見本）.png")).toBeTruthy();

    const memoTextarea = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    expect(memoTextarea.value).toBe(demoFixture.documents.familyMemo);
  });

  it("デモルーム初回表示で全8ステップが操作連動で進み、AI・保存APIを呼ばず、終了後は現行デモ表示と一致し再表示されない", async () => {
    mockRoomIsDemo = true;
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = render(<InputClient roomId="demo-room-1" />);
    await screen.findByText("登録されている家族");

    await screen.findByTestId("demo-tutorial-dialog");
    // 書類欄に見本の退院時サマリーが初期表示され、familyMemo も表示され、未保存下書き扱いにはならない
    expect(screen.getByText("選択中のファイル（1 / 2枚）")).toBeTruthy();
    expect(screen.getByAltText("退院時サマリー（見本）.pngのプレビュー")).toBeTruthy();
    const memoTextarea = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    expect(memoTextarea.value).toBe(demoFixture.documents.familyMemo);
    expect(getInputScreenDraft("demo-room-1")).toBeNull();
    expect(screen.queryByRole("button", { name: "下書きを破棄する" })).toBeNull();

    expect(DEMO_INPUT_TUTORIAL_STEPS.slice(0, 3).map(step => step.targetKeys)).toEqual([
      ["documents-section"], ["memo-section"], ["ai-structure-btn"],
    ]);
    expect(screen.getByTestId("demo-tutorial-dialog").textContent).toContain("デモ案内 1 / 8");
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    const memoGuide = screen.getByTestId("demo-tutorial-dialog");
    expect(memoGuide.getAttribute("data-tutorial-step")).toBe("2");
    expect(memoTextarea.readOnly).toBe(true);
    expect(memoTextarea.nextElementSibling?.contains(memoGuide)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step")).toBe("3");
    expect(screen.getByRole("button", { name: "案内を終わる" })).toBeTruthy();
    expect(screen.getByText("条件カード：0件")).toBeTruthy();
    expect(screen.getByText("家族の希望：0件")).toBeTruthy();
    expect(screen.queryAllByTestId("constraint-card")).toHaveLength(0);
    expect(screen.queryByText("土・日")).toBeNull();

    // AIボタンを押してもAPIは呼ばずステップ4へ進む
    fireEvent.click(
      screen.getByRole("button", {
        name: /家族の事情メモから条件・希望の下書きを作る（AI）/,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("選択中のファイル（1 / 2枚）")).toBeTruthy();

    // ステップ 4：右パネルのマスクが外れて条件カードと希望が表示される（土日はまだ非表示）
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("4");
    expect(screen.getByTestId("demo-tutorial-dialog").textContent).toContain(
      "書類とメモが、条件と希望のカードに反映されました。家族が付き添えない時間や、本人・家族の希望を確認してください。",
    );
    expect(screen.getByText("条件カード：3件")).toBeTruthy();
    expect(screen.getByText("家族の希望：6件")).toBeTruthy();
    expect(screen.getAllByTestId("constraint-card")).toHaveLength(3);
    expect(screen.getAllByTestId("hope-row")).toHaveLength(6);
    expect(screen.queryByText("土・日")).toBeNull();

    // 「次へ」でステップ 5（負担割合の確認）へ
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("5");
    expect(screen.getByTestId("demo-tutorial-dialog").textContent).toContain(
      "サービスを使ったとき、費用のうち家族が払う分の割合です。あとで自己負担額を計算するときに使います。佐藤家の見本では1割になっています。",
    );
    const rate1 = screen.getByLabelText("1割") as HTMLInputElement;
    const rate2 = screen.getByLabelText("2割") as HTMLInputElement;
    expect(rate1.checked).toBe(true);
    fireEvent.click(rate2);
    expect(rate1.checked).toBe(true);
    expect(rate2.checked).toBe(false);
    expect(screen.queryByText("土・日")).toBeNull();

    // 「次へ」でステップ 6（時間の追加）へ
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("6");
    expectTutorialInstruction(
      "お父さんに見守りや介助が必要な時間帯です。平日と土日の8〜12時は入力済みです。足りない時間帯は、曜日と時間を選んでこのように追加できます。試しに土日の17〜21時を入れてあるので、『＋ まとめて追加』を押してみてください。",
      "『＋ まとめて追加』を押してみてください",
    );

    // ステップ 6 では土日 8:00〜12:00 のみ表示済みで、17:00〜21:00 はまだ非表示
    const step6Groups = screen.getAllByTestId("care-window-group");
    expect(step6Groups).toHaveLength(2);
    expect(within(step6Groups[0]).getByText("平日（月〜金）")).toBeTruthy();
    expect(within(step6Groups[1]).getByText("土・日")).toBeTruthy();
    expect(within(step6Groups[1]).getByText("8:00〜12:00")).toBeTruthy();
    expect(within(step6Groups[1]).queryByText("17:00〜21:00")).toBeNull();

    // 追加フォームの初期値が 曜日=土日（5,6）・17:00〜21:00 になっている
    expect(
      screen.getByRole("button", { name: "土日" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      (screen.getByLabelText("追加する開始時刻") as HTMLSelectElement).value,
    ).toBe("17");
    expect(
      (screen.getByLabelText("追加する終了時刻") as HTMLSelectElement).value,
    ).toBe("21");

    // 初期値のまま『＋ まとめて追加』を押すとステップ 7 へ進み、17:00〜21:00 も表示される
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("7");
    expectTutorialInstruction(
      "『条件・時間帯・負担割合をまとめて保存する』を押してください。",
      "『条件・時間帯・負担割合をまとめて保存する』を押してください。",
    );
    const step7Groups = screen.getAllByTestId("care-window-group");
    expect(within(step7Groups[1]).getByText("8:00〜12:00")).toBeTruthy();
    expect(within(step7Groups[1]).getByText("17:00〜21:00")).toBeTruthy();

    // ステップ 7：保存ボタンを押しても /api/structure/save は呼ばずステップ 8 へ進む
    fireEvent.click(
      screen.getByRole("button", {
        name: "条件・時間帯・負担割合をまとめて保存する",
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("8");
    expectTutorialInstruction(
      "保存できました。『次へ（週間ボードへ進む）』を押して、介護サービスと家族の付き添いを組み合わせてみましょう。",
      "『次へ（週間ボードへ進む）』を押して",
    );
    expect(
      screen.getByText(/条件・時間帯・負担割合をまとめて保存しました。/),
    ).toBeTruthy();

    // ステップ 8：週間ボードへの導線クリックで完了（未保存警告も出ない）
    const boardLinks = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    });
    const footerBoardLink = boardLinks[boardLinks.length - 1];
    fireEvent.click(footerBoardLink);

    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(
      screen.queryByText(/条件・時間帯・負担割合をまとめて保存しました。/),
    ).toBeNull();
    expect(isDemoInputTutorialDone("demo-room-1")).toBe(true);
    expect(getInputScreenDraft("demo-room-1")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // 再表示してもチュートリアルは出ず、現行デモルームと同じ表示になる
    unmount();
    render(<InputClient roomId="demo-room-1" />);
    await screen.findByText("登録されている家族");

    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(screen.getByText("条件カード：3件")).toBeTruthy();
    expect(screen.getByText("家族の希望：6件")).toBeTruthy();
    expect(screen.getByText("平日（月〜金）")).toBeTruthy();
    expect(screen.getByText("土・日")).toBeTruthy();
    expect((screen.getByLabelText("1割") as HTMLInputElement).checked).toBe(true);
    expect(
      (
        screen.getByPlaceholderText(
          /父は来週退院予定で要介護3/,
        ) as HTMLTextAreaElement
      ).value,
    ).toBe(demoFixture.documents.familyMemo);
    expect(screen.getAllByRole("button", { name: "編集" }).length).toBeGreaterThan(0);
  });

  it("「案内を終わる」ボタンで途中終了でき、マスク解除・データ不変・再表示されないこと", async () => {
    mockRoomIsDemo = true;

    const { unmount } = render(<InputClient roomId="demo-room-exit" />);
    await screen.findByText("登録されている家族");

    expect(await screen.findByTestId("demo-tutorial-dialog")).toBeTruthy();
    expect(screen.getByText("条件カード：0件")).toBeTruthy();
    expect(screen.queryByText("土・日")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));

    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(screen.getByText("条件カード：3件")).toBeTruthy();
    expect(screen.getByText("家族の希望：6件")).toBeTruthy();
    expect(screen.getByText("土・日")).toBeTruthy();
    expect(isDemoInputTutorialDone("demo-room-exit")).toBe(true);
    expect(getInputScreenDraft("demo-room-exit")).toBeNull();

    unmount();
    render(<InputClient roomId="demo-room-exit" />);
    await screen.findByText("登録されている家族");
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();

    // 別IDのデモルームでは未完了として初回表示される
    cleanup();
    render(<InputClient roomId="demo-room-other" />);
    await screen.findByTestId("demo-tutorial-dialog");
    expect(screen.getByTestId("demo-tutorial-dialog")).toBeTruthy();
  });

  it("再訪時に手動でそのルームの案内だけをステップ1から再生でき、メモは保持される", async () => {
    mockRoomIsDemo = true;
    const roomId = "demo-room-replay";
    const otherRoomId = "demo-room-already-seen";
    const storageKey = DEMO_INPUT_TUTORIAL_STORAGE_PREFIX + roomId;
    markDemoInputTutorialDone(roomId);
    markDemoInputTutorialDone(otherRoomId);
    const replay = { name: "チュートリアルをもう一度見る" };
    const page = render(<InputClient roomId={roomId} />);
    const button = await screen.findByRole("button", replay);
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    const memo = "日曜の付き添いは家族で相談中";
    fireEvent.change(screen.getByPlaceholderText(/父は来週退院予定で要介護3/), { target: { value: memo } });
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "＋ 条件カードを追加" }));
    const save = { name: "条件・時間帯・負担割合をまとめて保存する" };
    expect((screen.getByRole("button", save) as HTMLButtonElement).disabled).toBe(true);
    const draft = getInputScreenDraft(roomId);

    fireEvent.click(button);
    const dialog = await screen.findByTestId("demo-tutorial-dialog");
    expect(dialog.getAttribute("data-tutorial-step")).toBe("1");
    expect(isDemoInputTutorialDone(roomId)).toBe(false);
    expect(localStorage.getItem(storageKey)).toBe("0");
    expect(isDemoInputTutorialDone(otherRoomId)).toBe(true);
    expect(localStorage.getItem(DEMO_INPUT_TUTORIAL_STORAGE_PREFIX + otherRoomId)).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step")).toBe("2");
    expect(screen.getByDisplayValue(memo)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: /家族の事情メモから条件・希望の下書きを作る（AI）/ }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));
    fireEvent.click(screen.getByRole("button", save));
    expect(screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step")).toBe("8");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "案内を終わる" }));
    expect((screen.getByLabelText("追加する開始時刻") as HTMLSelectElement).value).toBe("10");
    expect(localStorage.getItem(storageKey)).toBe("1");
    expect(getInputScreenDraft(roomId)).toEqual(draft);

    // 再生中にページを閉じ、メモリが失われてlocalStorageだけが残る場合も自動再開しない。
    fireEvent.click(screen.getByRole("button", replay));
    expect((await screen.findByTestId("demo-tutorial-dialog")).getAttribute("data-tutorial-step")).toBe("1");
    const interruptedFlag = localStorage.getItem(storageKey);
    expect(interruptedFlag).toBe("0");
    page.unmount();
    clearDemoInputTutorialDone(roomId);
    localStorage.setItem(storageKey, interruptedFlag!);
    render(<InputClient roomId={roomId} />);
    await screen.findByRole("button", replay);
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(screen.getByDisplayValue(memo)).toBeTruthy();
  });

  it("ステップ6で曜日が土日以外や時刻が17〜21時以外の場合はエラーを返して進まず、正しい条件で進み、Escキーで途中終了できること", async () => {
    mockRoomIsDemo = true;

    render(<InputClient roomId="demo-room-esc" />);
    await screen.findByTestId("demo-tutorial-dialog");
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));
    fireEvent.click(screen.getByRole("button", { name: "次へ" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: /家族の事情メモから条件・希望の下書きを作る（AI）/,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // 4 -> 5
    fireEvent.click(screen.getByRole("button", { name: "次へ" })); // 5 -> 6

    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("6");

    // 平日を選んだ場合はエラーでステップ6に留まる
    fireEvent.click(screen.getByRole("button", { name: "平日" }));
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("6");
    expect(screen.getByRole("alert").textContent).toContain("土日");

    // 土日を選んでも時刻が 10:00〜15:00 の場合はエラーでステップ6に留まる
    fireEvent.click(screen.getByRole("button", { name: "土日" }));
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("追加する終了時刻"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));
    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("6");
    expect(screen.getByRole("alert").textContent).toContain("17:00〜21:00");

    // 正しい 17:00〜21:00 に戻して押すとステップ7へ進み、実データは fixture のまま
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), {
      target: { value: "17" },
    });
    fireEvent.change(screen.getByLabelText("追加する終了時刻"), {
      target: { value: "21" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));

    expect(
      screen.getByTestId("demo-tutorial-dialog").getAttribute("data-tutorial-step"),
    ).toBe("7");
    const groups = screen.getAllByTestId("care-window-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[1]).getByText("土・日")).toBeTruthy();
    expect(within(groups[1]).getByText("8:00〜12:00")).toBeTruthy();
    expect(within(groups[1]).getByText("17:00〜21:00")).toBeTruthy();
    expect(within(groups[1]).queryByText("10:00〜15:00")).toBeNull();

    // Esc キーで終了
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    expect(isDemoInputTutorialDone("demo-room-esc")).toBe(true);
    expect(getInputScreenDraft("demo-room-esc")).toBeNull();
  });

  it("見本画像は通常の添付1枚として扱い、追加・削除できる。途中離脱後も案内は再開しない", async () => {
    mockRoomIsDemo = true;
    const { unmount } = render(<InputClient roomId="demo-room-doc" />);
    await screen.findByText("退院時サマリー（見本）.png");
    unmount();
    render(<InputClient roomId="demo-room-doc" />);
    const section = within(await screen.findByRole("region", { name: "書類の写真アップロード" }));
    expect(screen.queryByTestId("demo-tutorial-dialog")).toBeNull();
    const input = section.getByLabelText(/写真を選択またはドロップ/);
    const file = new File(["dummy"], "追加.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(section.getByText("選択中のファイル（2 / 2枚）")).toBeTruthy();
    fireEvent.click(section.getAllByRole("button", { name: "削除" })[0]);
    expect(section.queryByText("退院時サマリー（見本）.png")).toBeNull();
    expect(section.getByText("追加.jpg")).toBeTruthy();
    fireEvent.click(section.getByRole("button", { name: "削除" }));
    expect(section.queryByTestId("image-preview-thumbnail")).toBeNull();
  });

  it("buildBackdropPath は内包されたターゲット矩形を SVG evenodd の穴から除外してクリック透過を壊さない", () => {
    const path = buildBackdropPath(1200, 900, [
      {
        key: "documents-section",
        isPrimary: false,
        left: 20,
        top: 20,
        width: 400,
        height: 200,
      },
      {
        key: "memo-section",
        isPrimary: false,
        left: 20,
        top: 250,
        width: 400,
        height: 240,
      },
      {
        key: "ai-structure-btn",
        isPrimary: true,
        left: 40,
        top: 410,
        width: 280,
        height: 44,
      },
    ]);

    // 外枠 1 + documents-section 1 + memo-section 1 = 3つのサブパス（M で始まる数）のみ、内包された ai-structure-btn は穴に重複しない
    const subpaths = path.match(/\bM\b/g);
    expect(subpaths).toHaveLength(3);
  });

  it("fixture の careWindows に対して土日（8:00〜12:00 / 17:00〜21:00）を addCareWindowsBulk しても重複抑止で実データが変わらない", () => {
    const initialDrafts = careWindowDraftsFromWindows(demoFixture.careWindows);
    const afterMorning = addCareWindowsBulk(initialDrafts, [5, 6], 8, 12);
    const afterEvening = addCareWindowsBulk(afterMorning, [5, 6], 17, 21);

    expect(toCareWindows(afterEvening)).toEqual(toCareWindows(initialDrafts));
    expect(toCareWindows(afterEvening)).toHaveLength(
      demoFixture.careWindows.length,
    );
  });
});
