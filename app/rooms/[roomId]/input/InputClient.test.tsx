// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InputClient from "./InputClient";
import RoomShell from "@/components/RoomShell";

vi.mock("@/components/RoomName", () => ({ default: () => "ルーム" }));
import {
  clearInputScreenDraft,
  getInputScreenDraft,
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

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  getDocFromServer: vi.fn(async () => ({
    exists: () => true,
    data: () => ({ isDemo: false }),
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
  usePathname: () => "/rooms/room-input-test/input",
  useRouter: () => ({ push: mockPush }),
}));

const baseSnapshot: RoomSnapshot = {
  people: [
    { id: "p-father", name: "父", canProvideCare: false },
    { id: "p-mother", name: "母", canProvideCare: true },
    { id: "p-daughter", name: "長女", canProvideCare: true },
    { id: "p-son", name: "長男", canProvideCare: true },
  ],
  placements: [],
  constraints: [
    {
      personId: "p-daughter",
      type: "unavailable",
      detail: "平日はフルタイム勤務",
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 18,
    },
  ],
  hopes: ["週末は家族で交代したい"],
  unknowns: ["退院後の服薬管理の担当"],
  careWindows: [
    { day: 2, startHour: 12, endHour: 16 },
    { day: 0, startHour: 7, endHour: 10 },
  ],
  copayRate: 1,
  revision: 2,
};

function addHopeViaRowUi(text: string) {
  const input = screen.getByLabelText("家族の希望を追加") as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } });
  const form = input.closest("form")!;
  fireEvent.submit(form);
}

function InputRoomLayout({ children }: { children: React.ReactNode }) {
  return <RoomShell roomId="room-input-test">{children}</RoomShell>;
}

describe("InputClient（入力画面：統一UI・時間帯まとめ表示・色案F改）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInputScreenDraft();
    mockUseAnonymousAuth.mockReturnValue({
      user: { uid: "test-user" },
      loading: false,
      error: null,
      retry: mockRetryAuth,
    });
    mockReadOwnMembership.mockResolvedValue({ role: "family" });
    mockReadRoomSnapshot.mockResolvedValue(baseSnapshot);
  });

  afterEach(() => {
    cleanup();
    clearInputScreenDraft();
  });

  it("1. 下書き保持：事情メモや未保存の編集内容が画面遷移（アンマウント→再マウント）しても失われない（「入力の版：N」は非表示）", async () => {
    const { unmount } = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });

    await screen.findByText("登録されている家族");
    expect(screen.queryByText(/入力の版：/)).toBeNull();

    // 事情メモを入力
    const memoTextarea = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    fireEvent.change(memoTextarea, {
      target: { value: "長女は平日仕事。母は腰痛あり。" },
    });
    expect(memoTextarea.value).toBe("長女は平日仕事。母は腰痛あり。");

    // 家族の希望も行UIで追加
    addHopeViaRowUi("入浴はプロにお願いしたい");
    expect(screen.getByText("入浴はプロにお願いしたい")).toBeTruthy();

    // 週間ボードなど別画面へ移動したことを模擬（アンマウント）
    unmount();

    // 再び「事情を入れる」画面に戻ってきたことを模擬（再マウント）
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    expect(screen.queryByText(/入力の版：/)).toBeNull();

    const restoredMemo = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    expect(restoredMemo.value).toBe("長女は平日仕事。母は腰痛あり。");

    expect(screen.getByText("週末は家族で交代したい")).toBeTruthy();
    expect(screen.getByText("入浴はプロにお願いしたい")).toBeTruthy();
  });

  it("2 & 3 & 6. AI整理・対象の自動セット・曜日時刻なし希望の分離・統合保存してもGeminiの整理が消えない", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/structure") {
          return new Response(
            JSON.stringify({
              constraints: [
                {
                  memberName: "長女",
                  type: "unavailable",
                  detail: "平日9時〜18時は仕事",
                  days: [0, 1, 2, 3, 4],
                  startHour: 9,
                  endHour: 18,
                },
                {
                  memberName: "親戚", // 家族一覧にいない不明な対象
                  type: "unavailable",
                  detail: "水曜午後は用事",
                  days: [2],
                  startHour: 13,
                  endHour: 17,
                },
                {
                  memberName: "母",
                  type: "hope",
                  detail: "入浴介助は外部サービスを使いたい",
                  days: [], // 曜日・時刻がない希望
                },
              ],
              hopes: ["住み慣れた自宅で過ごしたい"],
              unknowns: ["夜間の見守り体制"],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url === "/api/structure/save") {
          return new Response(JSON.stringify({ revision: 3 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // ボタンの意味が「家族の事情メモから条件・希望の下書きを作る（AI）」になっていること
    const structureBtn = screen.getByRole("button", {
      name: /家族の事情メモから条件・希望の下書きを作る（AI）/,
    });
    fireEvent.click(structureBtn);

    // 名前が一意に一致する「長女」は対象が自動セットされ、一致しない「親戚」は未選択のまま
    await waitFor(() => {
      expect(screen.getByText("平日9時〜18時は仕事")).toBeTruthy();
    });
    expect(screen.getByText("水曜午後は用事")).toBeTruthy();

    // 曜日・時刻がない希望（「入浴介助は外部サービスを使いたい」）は条件カードに入れず「家族の希望」に入っている
    const cards = screen.getAllByTestId("constraint-card");
    expect(cards).toHaveLength(2);
    expect(
      within(cards[0]).queryByText("入浴介助は外部サービスを使いたい"),
    ).toBeNull();
    expect(
      within(cards[1]).queryByText("入浴介助は外部サービスを使いたい"),
    ).toBeNull();
    const hopeRows = screen.getAllByTestId("hope-row");
    expect(hopeRows.map((r) => r.textContent).join(" ")).toContain(
      "住み慣れた自宅で過ごしたい",
    );
    expect(hopeRows.map((r) => r.textContent).join(" ")).toContain(
      "入浴介助は外部サービスを使いたい",
    );

    // AI読み取りメモに対象の名前（AI読み取りメモ: 長女 など）は出さない
    expect(screen.queryByText(/AI読み取りメモ/)).toBeNull();

    // 1件目（長女）は対象が自動セット済み、2件目（親戚）は「対象未選択」
    expect(within(cards[0]).getByText("長女")).toBeTruthy();
    expect(within(cards[1]).getByText("対象未選択")).toBeTruthy();

    // 2件目の「編集」を開いて「母」を選択して完了する
    fireEvent.click(within(cards[1]).getByRole("button", { name: "編集" }));
    const targetSelect = within(cards[1]).getByLabelText(
      "対象の家族",
    ) as HTMLSelectElement;
    expect(targetSelect.value).toBe("");
    fireEvent.change(targetSelect, { target: { value: "p-mother" } });
    fireEvent.click(within(cards[1]).getByRole("button", { name: "完了" }));

    // 自己負担割合を2割に変更してまとめて保存する
    fireEvent.click(screen.getByLabelText("2割"));

    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/条件・時間帯・負担割合をまとめて保存しました。/),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/新しい版/)).toBeNull();

    // 保存APIへ constraints / hopes / unknowns / careWindows / copayRate / baseRevision が1回でまとめて送られていること
    const saveCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/structure/save",
    );
    expect(saveCall).toBeTruthy();
    const savedBody = JSON.parse(
      (saveCall![1] as RequestInit).body as string,
    );
    expect(savedBody.baseRevision).toBe(2);
    expect(savedBody.copayRate).toBe(2);
    expect(savedBody.careWindows).toEqual([
      { day: 0, startHour: 7, endHour: 10 },
      { day: 2, startHour: 12, endHour: 16 },
    ]);
    expect(savedBody.constraints).toHaveLength(2);
    expect(savedBody.constraints[0].personId).toBe("p-daughter");
    expect(savedBody.constraints[1].personId).toBe("p-mother");
    expect(savedBody.hopes).toEqual([
      "住み慣れた自宅で過ごしたい",
      "入浴介助は外部サービスを使いたい",
    ]);

    // 保存後も Gemini の整理の内容が消えずに残っていること
    expect(screen.getByText("平日9時〜18時は仕事")).toBeTruthy();
    expect(screen.getByText("水曜午後は用事")).toBeTruthy();
  });

  it("3. 通常入力（手動追加）でも内容から対象が明らかなものは自動で対象と分類が入る", async () => {
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    fireEvent.click(screen.getByRole("button", { name: "＋ 条件カードを追加" }));

    const cards = screen.getAllByTestId("constraint-card");
    const newCard = cards[cards.length - 1];
    expect(within(newCard).getByTestId("constraint-card-editor")).toBeTruthy();
    const detailInput = within(newCard).getByLabelText("条件の内容");
    const targetSelect = within(newCard).getByLabelText(
      "対象の家族",
    ) as HTMLSelectElement;
    const typeSelect = within(newCard).getByLabelText(
      "条件の種別",
    ) as HTMLSelectElement;

    // 初期状態は未選択・希望（新規作成で other は作らない）
    expect(targetSelect.value).toBe("");
    expect(typeSelect.value).toBe("hope");
    const optionValues = Array.from(typeSelect.options).map((o) => o.value);
    expect(optionValues).toEqual(["unavailable", "available", "hope"]);

    // 「長男は金曜に仕事」と入力すると、対象が「長男（p-son）」、種別が「対応不可（unavailable）」に自動セットされる
    fireEvent.change(detailInput, { target: { value: "長男は金曜に仕事" } });
    expect(targetSelect.value).toBe("p-son");
    expect(typeSelect.value).toBe("unavailable");
  });

  it("統一UI：簡易／詳細切り替えを廃止し、条件カード・家族の希望・分からないことをその場で編集・追加・削除できる", async () => {
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // 簡易／詳細の切り替えボタンは存在しない
    expect(screen.queryByRole("button", { name: "簡易" })).toBeNull();
    expect(screen.queryByRole("button", { name: "詳細" })).toBeNull();
    expect(screen.queryByTestId("gemini-simple-view")).toBeNull();
    expect(screen.queryByTestId("gemini-detailed-view")).toBeNull();

    // 件数サマリーと一覧が表示される
    expect(screen.getByText("条件カード：1件")).toBeTruthy();
    expect(screen.getByText("家族の希望：1件")).toBeTruthy();
    expect(screen.getByText("分からないこと：1件")).toBeTruthy();

    // 所得による目安は折りたたみトグルで開閉できる
    expect(screen.queryByText(/一般的な所得の方は1割/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /所得による目安（詳細表示）/ }),
    );
    expect(screen.getByText(/一般的な所得の方は1割/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /詳細を隠す/ }));
    expect(screen.queryByText(/一般的な所得の方は1割/)).toBeNull();

    // 条件カード1件目のその場編集：種類・曜日・時刻・内容を変更し、キャンセルと完了を試す
    const card = screen.getByTestId("constraint-card");
    expect(within(card).getAllByText("対応不可")).toHaveLength(1);
    expect(within(card).getByText("月・火・水・木・金 9:00〜18:00")).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "編集" }));
    expect(within(card).getByTestId("constraint-card-editor")).toBeTruthy();
    fireEvent.change(within(card).getByLabelText("条件の内容"), {
      target: { value: "一度書き換えた内容" },
    });
    // キャンセルすると元に戻る
    fireEvent.click(within(card).getByRole("button", { name: "キャンセル" }));
    expect(within(card).queryByTestId("constraint-card-editor")).toBeNull();
    expect(within(card).getByText("平日はフルタイム勤務")).toBeTruthy();

    // 再度編集して種類プルダウン・曜日クリック・時刻・内容を確定する
    fireEvent.click(within(card).getByRole("button", { name: "編集" }));
    fireEvent.change(within(card).getByLabelText("条件の種別"), {
      target: { value: "available" },
    });
    // 月曜(pressed=true)を外し、土曜(pressed=false)をオンにする
    fireEvent.click(within(card).getByRole("button", { name: "月" }));
    fireEvent.click(within(card).getByRole("button", { name: "土" }));
    fireEvent.change(within(card).getByLabelText("条件の開始時刻"), {
      target: { value: "10" },
    });
    fireEvent.change(within(card).getByLabelText("条件の終了時刻"), {
      target: { value: "16" },
    });
    fireEvent.change(within(card).getByLabelText("条件の内容"), {
      target: { value: "土曜なら日中も対応可" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "完了" }));

    expect(within(card).getByText("対応可")).toBeTruthy();
    expect(within(card).getByText("土曜なら日中も対応可")).toBeTruthy();
    expect(within(card).getByText("火・水・木・金・土 10:00〜16:00")).toBeTruthy();

    // 家族の希望の行UI：追加・その場編集・削除
    addHopeViaRowUi("費用は介護保険の枠内に収めたい");
    expect(screen.getByText("家族の希望：2件")).toBeTruthy();
    let hopeRows = screen.getAllByTestId("hope-row");
    fireEvent.click(within(hopeRows[1]).getByRole("button", { name: "編集" }));
    const hopeEditInput = within(hopeRows[1]).getByLabelText("希望の内容");
    fireEvent.change(hopeEditInput, {
      target: { value: "費用はできれば月2万円台に抑えたい" },
    });
    fireEvent.click(within(hopeRows[1]).getByRole("button", { name: "完了" }));
    expect(screen.getByText("費用はできれば月2万円台に抑えたい")).toBeTruthy();

    hopeRows = screen.getAllByTestId("hope-row");
    fireEvent.click(within(hopeRows[0]).getByRole("button", { name: "削除" }));
    expect(screen.getByText("家族の希望：1件")).toBeTruthy();
    expect(screen.queryByText("週末は家族で交代したい")).toBeNull();

    // 分からないことの行UI：追加・その場編集・削除
    const unkInput = screen.getByLabelText("分からないことを追加");
    fireEvent.change(unkInput, { target: { value: "かかりつけ医の連絡先" } });
    fireEvent.submit(unkInput.closest("form")!);
    expect(screen.getByText("分からないこと：2件")).toBeTruthy();

    let unkRows = screen.getAllByTestId("unknown-row");
    fireEvent.click(within(unkRows[1]).getByRole("button", { name: "編集" }));
    fireEvent.change(within(unkRows[1]).getByLabelText("分からないことの内容"), {
      target: { value: "夜間連絡できるかかりつけ医" },
    });
    fireEvent.click(within(unkRows[1]).getByRole("button", { name: "完了" }));
    expect(screen.getByText("夜間連絡できるかかりつけ医")).toBeTruthy();

    unkRows = screen.getAllByTestId("unknown-row");
    fireEvent.click(within(unkRows[0]).getByRole("button", { name: "削除" }));
    expect(screen.getByText("分からないこと：1件")).toBeTruthy();
    expect(screen.queryByText("退院後の服薬管理の担当")).toBeNull();
  });

  it("介護が必要な時間帯：同じ時間帯の曜日まとめ表示・プリセット＆個別チェック一括追加・行単位編集削除が動作し曜日ごとに保存される", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/structure/save") {
          return new Response(JSON.stringify({ revision: 3 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      careWindows: [
        // 月〜金は同じ 7:00〜9:00
        ...[0, 1, 2, 3, 4].map((day) => ({
          day: day as 0 | 1 | 2 | 3 | 4,
          startHour: 7,
          endHour: 9,
        })),
        // 土日は同じ 8:00〜12:00
        { day: 5, startHour: 8, endHour: 12 },
        { day: 6, startHour: 8, endHour: 12 },
      ],
    });

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // 初期表示：「支援が必要な時間帯」は出ず、「平日（月〜金）」「土・日」の2行にまとまる
    expect(
      screen.getByRole("heading", {
        name: /介護が必要な時間帯と自己負担割合/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("支援が必要な時間帯")).toBeNull();

    let groups = screen.getAllByTestId("care-window-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText("平日（月〜金）")).toBeTruthy();
    expect(within(groups[0]).getByText("7:00〜9:00")).toBeTruthy();
    expect(within(groups[1]).getByText("土・日")).toBeTruthy();
    expect(within(groups[1]).getByText("8:00〜12:00")).toBeTruthy();

    // 平日プリセットのまま 17:00〜21:00 をまとめて追加
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), {
      target: { value: "17" },
    });
    fireEvent.change(screen.getByLabelText("追加する終了時刻"), {
      target: { value: "21" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));

    groups = screen.getAllByTestId("care-window-group");
    expect(within(groups[0]).getByText("7:00〜9:00")).toBeTruthy();
    expect(within(groups[0]).getByText("17:00〜21:00")).toBeTruthy();

    // 任意の曜日（水曜だけ追加）を個別チェックで選び、12:00〜14:00 を追加 → 水曜だけ別行になる
    const weekdayPresetBtn = screen.getByRole("button", { name: "平日" });
    expect(weekdayPresetBtn.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByRole("group", { name: "追加する曜日を個別に選択" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "各曜日" }));
    const dayFieldset = screen.getByRole("group", {
      name: "追加する曜日を個別に選択",
    });
    expect(within(dayFieldset).getAllByRole("checkbox")).toHaveLength(7);
    fireEvent.click(within(dayFieldset).getByLabelText("水"));
    fireEvent.click(screen.getByRole("button", { name: "全曜日" }));
    expect(screen.queryByRole("group", { name: "追加する曜日を個別に選択" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "各曜日" }));
    expect((screen.getByLabelText("水", { selector: "input[type=checkbox]" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("追加する終了時刻"), {
      target: { value: "14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));

    groups = screen.getAllByTestId("care-window-group");
    expect(groups).toHaveLength(3);
    expect(within(groups[0]).getByText("月・火・木・金")).toBeTruthy();
    expect(within(groups[1]).getByText("水曜")).toBeTruthy();
    expect(within(groups[1]).getByText("12:00〜14:00")).toBeTruthy();
    expect(within(groups[2]).getByText("土・日")).toBeTruthy();

    // 行単位削除：水曜の行を削除して「月・火・木・金」と「土・日」にする
    fireEvent.click(within(groups[1]).getByRole("button", { name: "削除" }));
    groups = screen.getAllByTestId("care-window-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getByText("月・火・木・金")).toBeTruthy();

    // 行単位編集：土・日を編集し、8:00〜12:00 を 7:00〜9:00 に変更して 17:00〜21:00 を追加すると
    // 「月・火・木・金」と同じスロットになり「月・火・木・金・土・日」の1行にまとまる
    fireEvent.click(within(groups[1]).getByRole("button", { name: "編集" }));
    const editor = within(groups[1]).getByTestId("care-window-group-editor");
    fireEvent.change(within(editor).getByLabelText("介護が必要な開始時刻"), {
      target: { value: "7" },
    });
    fireEvent.change(within(editor).getByLabelText("介護が必要な終了時刻"), {
      target: { value: "9" },
    });
    fireEvent.click(within(editor).getByRole("button", { name: "＋ 時間帯を追加" }));
    const endSelects = within(editor).getAllByLabelText("介護が必要な終了時刻");
    const startSelects = within(editor).getAllByLabelText("介護が必要な開始時刻");
    fireEvent.change(startSelects[1], { target: { value: "17" } });
    fireEvent.change(endSelects[1], { target: { value: "21" } });
    fireEvent.click(within(editor).getByRole("button", { name: "完了" }));

    groups = screen.getAllByTestId("care-window-group");
    expect(groups).toHaveLength(1);
    expect(within(groups[0]).getByText("月・火・木・金・土・日")).toBeTruthy();

    // 全曜日プリセットで 10:00〜11:00 を追加（水曜にも入る）し、保存時のデータ構造が曜日ごとのまま送られることを確認
    fireEvent.click(screen.getByRole("button", { name: "全曜日" }));
    fireEvent.change(screen.getByLabelText("追加する開始時刻"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("追加する終了時刻"), {
      target: { value: "11" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ まとめて追加" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "条件・時間帯・負担割合をまとめて保存する",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/条件・時間帯・負担割合をまとめて保存しました。/),
      ).toBeTruthy();
    });
    const saveCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/structure/save",
    );
    const savedBody = JSON.parse(
      (saveCall![1] as RequestInit).body as string,
    );
    // 月・火・木・金・土・日 各3件(6*3=18) + 水曜 1件(10〜11) = 19件の曜日ごとレコード
    expect(savedBody.careWindows).toHaveLength(19);
    expect(savedBody.careWindows).toContainEqual({
      day: 2,
      startHour: 10,
      endHour: 11,
    });
  });

  it("色案F改：背景 #F8F4EC・文字 #403346・基調 #65519A・希望バッジ #EFEAF6/#574468・意味色維持が適用されている", async () => {
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const root = screen.getByTestId("input-page-root");
    expect(root.className).toContain("bg-[#F8F4EC]");
    expect(root.className).toContain("text-[#403346]");

    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    });
    expect([...saveBtn.classList]).toEqual(expect.arrayContaining(["bg-white", "text-[#65519A]", "border-[#65519A]"]));
    const nextLink = within(root).getByRole("link", { name: /次へ（週間ボードへ進む）/ });
    expect([...nextLink.classList]).toEqual(expect.arrayContaining(["bg-[#65519A]", "text-white"]));

    // 希望バッジは薄紫 #EFEAF6 背景・文字 #574468
    const hopeRow = screen.getByTestId("hope-row");
    const hopeBadge = within(hopeRow).getByText("希望");
    expect(hopeBadge.className).toContain("bg-[#EFEAF6]");
    expect(hopeBadge.className).toContain("text-[#574468]");

    // 対応不可バッジの赤系意味色はそのまま維持
    const card = screen.getByTestId("constraint-card");
    const unavailableBadge = within(card).getByText("対応不可");
    expect(unavailableBadge.className).toContain("text-[#991b1b]");
    expect(unavailableBadge.className).toContain("bg-[#fef2f2]");
  });

  it("写真アップロードで選んだ画像のサムネイルプレビューが表示され、削除で取り消せる", async () => {
    const createObjectURLMock = vi.fn(
      (file: Blob) => `blob:mock-${(file as File).name}`,
    );
    const revokeObjectURLMock = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;

    try {
      render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
      await screen.findByText("登録されている家族");

      const uploadSection = screen.getByRole("region", {
        name: "書類の写真アップロード",
      });
      const fileInput = uploadSection.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      const file1 = new File(["dummy-1"], "summary1.jpg", {
        type: "image/jpeg",
      });
      const file2 = new File(["dummy-2"], "summary2.png", {
        type: "image/png",
      });

      fireEvent.change(fileInput, { target: { files: [file1, file2] } });

      const previews = await within(uploadSection).findAllByTestId(
        "image-preview-thumbnail",
      );
      expect(previews).toHaveLength(2);
      expect((previews[0] as HTMLImageElement).getAttribute("src")).toBe(
        "blob:mock-summary1.jpg",
      );
      expect((previews[1] as HTMLImageElement).getAttribute("src")).toBe(
        "blob:mock-summary2.png",
      );

      // 1枚目を削除すると2枚目だけが残る
      const deleteButtons = within(uploadSection).getAllByRole("button", {
        name: "削除",
      });
      fireEvent.click(deleteButtons[0]);

      const remainingPreviews = within(uploadSection).getAllByTestId(
        "image-preview-thumbnail",
      );
      expect(remainingPreviews).toHaveLength(1);
      expect(
        (remainingPreviews[0] as HTMLImageElement).getAttribute("src"),
      ).toBe("blob:mock-summary2.png");
      expect(revokeObjectURLMock).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("各人のピルに名前と役割ドットを表示し、3役割の凡例にも同じ色を使う", async () => {
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      people: [...baseSnapshot.people, { id: "p-grandma", name: "佐藤花子", canProvideCare: false, careRole: "family" }],
    });
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    const list = await screen.findByRole("region", { name: "登録されている家族" });
    const pills = within(list).getByRole("list", { name: "家族一覧" });
    const legend = within(list).getByRole("list", { name: "役割の凡例" });
    expect(within(legend).getAllByRole("listitem")).toHaveLength(3);
    for (const [name, label, color] of [
      ["父", "介護を受ける人", "bg-[#65519A]"],
      ["長女", "付き添いができる家族", "bg-emerald-700"],
      ["佐藤花子", "付き添いはできない家族", "bg-gray-500"],
    ]) {
      const pill = within(pills).getByText(name, { selector: "span:not([aria-hidden])" }).closest("li")!;
      expect(within(pill).getByText(label).classList.contains("sr-only")).toBe(true);
      expect(pill.querySelector(".size-2")?.classList.contains(color)).toBe(true);
      const key = within(legend).getByText(label);
      expect(key.querySelector(".size-2")?.classList.contains(color)).toBe(true);
    }
  });

  it("家族のピルは折り返し可能な横並びで、アバターは24pxで表示する", async () => {
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const familySection = screen.getByRole("region", { name: "登録されている家族" });
    const list = within(familySection).getByRole("list", { name: "家族一覧" });
    expect(list.classList.contains("flex-wrap")).toBe(true);
    expect(within(familySection).getByRole("list", { name: "役割の凡例" }).children).toHaveLength(3);
    const icons = list.querySelectorAll("li > span:first-child");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.className).toContain("h-6");
      expect(icon.className).toContain("w-6");
    }
  });

  it("条件が0件・未確認事項あり・未選択ありの状態では「全条件結びつけ完了」を表示せず、全件結びついて確認事項もないときだけ表示する", async () => {
    // 1) 条件0件・確認事項0件
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      constraints: [],
      unknowns: [],
    });
    const { unmount } = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    expect(screen.queryByText("全条件結びつけ完了")).toBeNull();
    expect(screen.getByText("条件なし")).toBeTruthy();
    unmount();

    // 2) 条件1件結びつき済みだが unknowns が残っている
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      unknowns: ["退院後の服薬管理の担当"],
    });
    const second = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    expect(screen.queryByText("全条件結びつけ完了")).toBeNull();
    expect(screen.getByText("未確認事項あり: 1件")).toBeTruthy();
    second.unmount();

    // 3) 条件1件結びつき済み・入力不備なし・unknowns も空のときだけ「全条件結びつけ完了」
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      unknowns: [],
    });
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    expect(screen.getByText("全条件結びつけ完了")).toBeTruthy();
  });

  it("古い版（baseRevision 不一致）の端末内下書きは後から保存しようとしても黙って上書きせず拒否する", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ revision: 99 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // 1. 版2の時点で下書きを作成して画面を離れる
    mockReadRoomSnapshot.mockResolvedValueOnce(baseSnapshot);
    const { unmount } = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    addHopeViaRowUi("版2で作った未保存の希望");
    expect(getInputScreenDraft("room-input-test")?.baseRevision).toBe(2);
    unmount();

    // 2. 他の人が先に更新し、サーバーの版が 3 に進んだ状態で入力画面に戻る
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      revision: 3,
    });
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // 戻った後に再編集しても、下書きの作成時点の版（2）が上書きされないこと
    expect(screen.getByText("版2で作った未保存の希望")).toBeTruthy();
    addHopeViaRowUi("版2の下書きに足した希望");
    expect(getInputScreenDraft("room-input-test")?.baseRevision).toBe(2);

    // 3. 保存ボタンを押しても /api/structure/save を呼ばず、競合エラーを表示する
    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          /他の人が先に内容を更新しました。再読み込みして、最新の内容で確認し直してください。/,
        ),
      ).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("baseRevision が無い旧形式の下書きが残っていた場合も安全側で上書き保存を拒否する", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ revision: 99 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    // 旧形式（baseRevision なし）の下書きを localStorage に直接配置
    window.localStorage.setItem(
      "carepact:input_draft:room-input-test",
      JSON.stringify({
        memo: "旧形式メモ",
        drafts: [
          {
            memberName: "長女",
            type: "unavailable",
            detail: "平日は仕事",
            days: [0, 1, 2, 3, 4],
            startHour: 9,
            endHour: 18,
            personId: "p-daughter",
          },
        ],
        hopesText: "旧形式の希望",
        unknownsText: "",
        careWindowDrafts: [],
        copayRate: 1,
        dirty: true,
      }),
    );

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(
          /作成時点の版番号が不明なため、他の人の変更を上書きしないよう保存を中止しました/,
        ),
      ).toBeTruthy();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("統合保存後に追加した希望を破棄しても、保存済みの条件2件と希望が画面と次の保存内容に残る", async ({ onTestFinished }) => {
    const save = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const { baseRevision } = JSON.parse(init!.body as string);
      return Response.json({ revision: baseRevision + 1 });
    });
    onTestFinished(() => save.mockRestore());
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("平日はフルタイム勤務");

    fireEvent.click(screen.getByRole("button", { name: "＋ 条件カードを追加" }));
    const card = within(screen.getByTestId("constraint-card-editor"));
    fireEvent.change(card.getByLabelText("条件の内容"), { target: { value: "母は付き添える" } });
    fireEvent.change(card.getByLabelText("対象の家族"), { target: { value: "p-mother" } });
    fireEvent.change(card.getByLabelText("条件の種別"), { target: { value: "available" } });
    fireEvent.click(card.getByRole("button", { name: "完了" }));
    addHopeViaRowUi("家で昼食を取りたい");
    const saveButton = screen.getByRole("button", { name: "条件・時間帯・負担割合をまとめて保存する" });
    fireEvent.click(saveButton);
    await screen.findByText(/条件・時間帯・負担割合をまとめて保存しました/);
    const firstSave = JSON.parse(save.mock.calls[0][1]!.body as string);
    expect(firstSave.constraints).toHaveLength(2);
    expect(firstSave.hopes).toEqual(["週末は家族で交代したい", "家で昼食を取りたい"]);

    addHopeViaRowUi("破棄する希望");
    fireEvent.click(screen.getByRole("button", { name: "下書きを破棄する" }));
    expect(screen.queryByText("破棄する希望")).toBeNull();
    expect(screen.getByText("平日はフルタイム勤務")).toBeTruthy();
    expect(screen.getByText("母は付き添える")).toBeTruthy();
    expect(screen.getByText("週末は家族で交代したい")).toBeTruthy();
    expect(screen.getByText("家で昼食を取りたい")).toBeTruthy();

    fireEvent.click(saveButton);
    await screen.findByText(/条件・時間帯・負担割合をまとめて保存しました/);
    expect(save).toHaveBeenCalledTimes(2);
    const secondSave = JSON.parse(save.mock.calls[1][1]!.body as string);
    expect(secondSave).toEqual({ ...firstSave, baseRevision: firstSave.baseRevision + 1 });
  });

  it("平林20：入力画面で下書きを破棄でき、保存済みスナップショットの内容に戻る", async () => {
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const memoTextarea = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    fireEvent.change(memoTextarea, { target: { value: "破棄する予定のメモ" } });

    addHopeViaRowUi("一時的な希望");
    expect(screen.getByText("一時的な希望")).toBeTruthy();

    const discardBtn = await screen.findByRole("button", {
      name: "下書きを破棄する",
    });
    fireEvent.click(discardBtn);

    expect(getInputScreenDraft("room-input-test")).toBeNull();
    expect(memoTextarea.value).toBe("");
    expect(screen.queryByText("一時的な希望")).toBeNull();
    expect(screen.getByText("週末は家族で交代したい")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "下書きを破棄する" }),
    ).toBeNull();
  });

  it("平林11・12：匿名ログイン失敗と参加情報取得失敗を未参加扱いせず、再試行導線を表示する", async () => {
    mockUseAnonymousAuth.mockReturnValue({
      user: null,
      loading: false,
      error:
        "匿名ログインに失敗しました。通信環境や接続設定を確認して、もう一度お試しください。",
      retry: mockRetryAuth,
    });
    const { unmount } = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    const authAlert = await screen.findByRole("alert");
    expect(authAlert.textContent).toContain("匿名ログインに失敗しました");
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(mockRetryAuth).toHaveBeenCalledTimes(1);
    unmount();

    mockUseAnonymousAuth.mockReturnValue({
      user: { uid: "test-user" },
      loading: false,
      error: null,
      retry: mockRetryAuth,
    });
    mockReadOwnMembership.mockRejectedValueOnce(new Error("network-error"));
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    const memberAlert = await screen.findByRole("alert");
    expect(memberAlert.textContent).toContain("参加情報を取得できませんでした");
    expect(screen.queryByText(/このルームにはまだ参加していません/)).toBeNull();
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
  });

  it("平林16：AI整理結果が保存上限（希望20件）を超える場合は保存前に何が超えたか表示し、APIを呼ばない", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/structure") {
        return new Response(
          JSON.stringify({
            constraints: Array.from({ length: 21 }, (_, i) => ({
              memberName: "母",
              type: "hope",
              detail: `AIの希望${i + 1}`,
              days: [],
            })),
            hopes: [],
            unknowns: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    fireEvent.click(
      screen.getByRole("button", {
        name: /家族の事情メモから条件・希望の下書きを作る（AI）/,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/家族の希望は 20 件までです（現在 21 件）/),
      ).toBeTruthy();
    });

    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/structure/save",
      expect.anything(),
    );
  });

  it("平林19：5MB超過や非対応形式のファイルは選択時点で拒否し、プレビュー生成（URL.createObjectURL）しない", async () => {
    const createObjectURLMock = vi.fn(
      (file: Blob) => `blob:mock-${(file as File).name}`,
    );
    const revokeObjectURLMock = vi.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = revokeObjectURLMock;

    try {
      render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
      await screen.findByText("登録されている家族");

      const uploadSection = screen.getByRole("region", {
        name: "書類の写真アップロード",
      });
      const fileInput = uploadSection.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      const badPdf = new File(["pdf"], "bad.pdf", { type: "application/pdf" });
      const hugeImg = {
        name: "huge.jpg",
        type: "image/jpeg",
        size: 5 * 1024 * 1024 + 1,
      } as unknown as File;
      Object.setPrototypeOf(hugeImg, File.prototype);

      fireEvent.change(fileInput, { target: { files: [badPdf, hugeImg] } });

      expect(await within(uploadSection).findByRole("alert")).toBeTruthy();
      expect(createObjectURLMock).not.toHaveBeenCalled();
      expect(
        within(uploadSection).queryAllByTestId("image-preview-thumbnail"),
      ).toHaveLength(0);
    } finally {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it("平林10：未保存の変更がないとき（初期状態・破棄後・保存後・ケアマネ閲覧時）はヘッダーの遷移リンクで警告を出さずそのまま進む", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/structure/save") {
        return new Response(JSON.stringify({ revision: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const { unmount } = render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const headerNextLink = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    })[0];
    const stepBoardLink = screen.getByRole("link", { name: "2. ボードで組む" });
    const stepSummaryLink = screen.getByRole("link", { name: "3. 確定・印刷" });

    // 未編集時はクリックしても defaultPrevented にならず警告も出ない
    for (const link of [headerNextLink, stepBoardLink, stepSummaryLink]) {
      const ev = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      link.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();

    // 編集して「まとめて保存」した後は再び警告が出ない
    addHopeViaRowUi("保存済みの希望");
    fireEvent.click(
      screen.getByRole("button", {
        name: "条件・時間帯・負担割合をまとめて保存する",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/条件・時間帯・負担割合をまとめて保存しました。/),
      ).toBeTruthy();
    });
    expect(screen.queryByText(/新しい版/)).toBeNull();

    const afterSaveEv = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    stepSummaryLink.dispatchEvent(afterSaveEv);
    expect(afterSaveEv.defaultPrevented).toBe(false);
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
    unmount();

    // careManager（閲覧のみ）のときも警告を出さない
    mockReadOwnMembership.mockResolvedValueOnce({ role: "careManager" });
    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    const cmNextLink = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    })[0];
    const cmEv = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    cmNextLink.dispatchEvent(cmEv);
    expect(cmEv.defaultPrevented).toBe(false);
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
  });

  it("平林10：未保存の変更があるとき、ヘッダーの遷移リンクで警告が出て「保存してから進む」「このまま進む」「とどまる」を選べる", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/structure/save") {
        return new Response(JSON.stringify({ revision: 3 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    addHopeViaRowUi("未保存の希望内容");

    // (c) とどまる：遷移が止まり、警告を閉じて編集内容が残る
    const stepBoardLink = screen.getByRole("link", { name: "2. ボードで組む" });
    fireEvent.click(stepBoardLink);
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "とどまる" }));
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("未保存の希望内容")).toBeTruthy();

    // (b) このまま進む：保存 API を呼ばずに元の遷移先へ進み、端末内下書きは保持される
    const headerNextLink = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    })[0];
    fireEvent.click(headerNextLink);
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "このまま進む" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/rooms/room-input-test/board");
    expect(getInputScreenDraft("room-input-test")?.dirty).toBe(true);
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();

    // (a) 保存してから進む：保存処理を実行し、成功したら元の遷移先（3. 確定・印刷）へ進む
    mockPush.mockClear();
    const stepSummaryLink = screen.getByRole("link", { name: "3. 確定・印刷" });
    fireEvent.click(stepSummaryLink);
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存してから進む" }));
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith("/rooms/room-input-test/summary");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/structure/save",
      expect.objectContaining({ method: "POST" }),
    );
    expect(getInputScreenDraft("room-input-test")?.dirty).toBe(false);
  });

  it("平林10：「保存してから進む」で保存が失敗したときは遷移せず既存のエラー表示に従う", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/structure/save") {
        return new Response(
          JSON.stringify({ message: "保存エラーのテスト" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 404 });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    addHopeViaRowUi("失敗する保存");

    const headerNextLink = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    })[0];
    fireEvent.click(headerNextLink);
    fireEvent.click(screen.getByRole("button", { name: "保存してから進む" }));

    await waitFor(() => {
      expect(screen.getByText("保存エラーのテスト")).toBeTruthy();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(getInputScreenDraft("room-input-test")?.dirty).toBe(true);
  });

  it("平林10：未選択の条件など検証不備がある状態で「保存してから進む」を押しても API を呼ばず遷移しない", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // 対象未選択の条件を追加して未保存・保存不可状態にする
    fireEvent.click(screen.getByRole("button", { name: "＋ 条件カードを追加" }));

    const headerNextLink = screen.getAllByRole("link", {
      name: /次へ（週間ボードへ進む）/,
    })[0];
    fireEvent.click(headerNextLink);
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存してから進む" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        /対象の家族が未選択の条件が 1 件あります。すべて選択するまで保存できません。/,
      ),
    ).toBeTruthy();
  });

  it("平林10：未保存の端末内下書きを復元した直後でも、ヘッダーの遷移リンクで警告が出る", async () => {
    window.localStorage.setItem(
      "carepact:input_draft:room-input-test",
      JSON.stringify({
        memo: "復元されたメモ",
        drafts: [],
        hopesText: "復元された希望",
        unknownsText: "",
        careWindowDrafts: [],
        copayRate: 1,
        dirty: true,
        baseRevision: 2,
      }),
    );

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");
    expect(screen.getByRole("button", { name: "下書きを破棄する" })).toBeTruthy();

    const stepBoardLink = screen.getByRole("link", { name: "2. ボードで組む" });
    fireEvent.click(stepBoardLink);
    expect(screen.getByText("保存されていない変更があります")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();

    // 下書きを破棄したら警告も閉じる
    fireEvent.click(screen.getByRole("button", { name: "下書きを破棄する" }));
    expect(screen.queryByText("保存されていない変更があります")).toBeNull();
  });

  it("バッチ1：「対応可」緑系バッジが表示され、既存 other データは壊さず表示・保存できる", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "/api/structure/save") {
          return new Response(JSON.stringify({ revision: 3 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("{}", { status: 404 });
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      constraints: [
        {
          personId: "p-son",
          type: "available",
          detail: "土日なら付き添い可能",
          days: [5, 6],
        },
        {
          personId: "p-mother",
          type: "other",
          detail: "旧データのその他メモ",
          days: [],
        },
      ],
    });

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    const cards = screen.getAllByTestId("constraint-card");
    expect(cards).toHaveLength(2);

    // 1枚目（available）：緑系スタイル・編集時選択肢は3種のみ（その他なし）
    const availableBadge = within(cards[0]).getByText("対応可");
    expect(availableBadge.className).toContain("bg-emerald-100");
    fireEvent.click(within(cards[0]).getByRole("button", { name: "編集" }));
    const availableSelect = within(cards[0]).getByLabelText(
      "条件の種別",
    ) as HTMLSelectElement;
    expect(availableSelect.value).toBe("available");
    expect(availableSelect.className).toContain("bg-emerald-100");
    expect(
      Array.from(availableSelect.options).map((o) => o.value),
    ).toEqual(["unavailable", "available", "hope"]);
    fireEvent.click(within(cards[0]).getByRole("button", { name: "完了" }));

    // 2枚目（既存 other）：読み取り互換で表示され、保存しても壊れない
    expect(within(cards[1]).getByText("旧データのその他メモ")).toBeTruthy();
    fireEvent.click(within(cards[1]).getByRole("button", { name: "編集" }));
    const otherSelect = within(cards[1]).getByLabelText(
      "条件の種別",
    ) as HTMLSelectElement;
    expect(otherSelect.value).toBe("other");
    fireEvent.click(within(cards[1]).getByRole("button", { name: "完了" }));

    fireEvent.click(
      screen.getByRole("button", {
        name: "条件・時間帯・負担割合をまとめて保存する",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/条件・時間帯・負担割合をまとめて保存しました。/),
      ).toBeTruthy();
    });
    const saveCall = fetchMock.mock.calls.find(
      (c) => c[0] === "/api/structure/save",
    );
    const savedBody = JSON.parse(
      (saveCall![1] as RequestInit).body as string,
    );
    expect(savedBody.constraints[0].type).toBe("available");
    expect(savedBody.constraints[1].type).toBe("other");
  });

  it("バッチ1：provisional: true のカードに仮置き時刻の印と警告文を出し、時刻変更または確定ボタンで解除できる", async () => {
    mockReadRoomSnapshot.mockResolvedValueOnce({
      ...baseSnapshot,
      unknowns: [],
      constraints: [
        {
          personId: "p-daughter",
          type: "unavailable",
          detail: "水曜午後は用事",
          days: [2],
          startHour: 13,
          endHour: 17,
          provisional: true,
        },
        {
          personId: "p-son",
          type: "available",
          detail: "土曜午前中は付き添い可能",
          days: [5],
          startHour: 9,
          endHour: 12,
          provisional: true,
        },
      ],
    });

    render(<InputClient roomId="room-input-test" />, { wrapper: InputRoomLayout });
    await screen.findByText("登録されている家族");

    // ヘッダーに仮置き時刻ありバッジが出る（「全条件結びつけ完了」にはならない）
    expect(screen.getByText("仮置き時刻あり: 2件")).toBeTruthy();
    expect(screen.queryByText("全条件結びつけ完了")).toBeNull();

    const warnings = screen.getAllByTestId("provisional-time-warning");
    expect(warnings).toHaveLength(2);
    expect(warnings[0].textContent).toContain(
      "AIが仮置きした時刻です。実際の時刻と違う場合があります。正しい時刻を設定してください。直すまでは、この時間で仮の判定をします。",
    );

    const cards = screen.getAllByTestId("constraint-card");
    expect(within(cards[0]).getByText("⏱ 仮置き時刻")).toBeTruthy();

    // 1枚目は編集を開いて時刻を変更し仮置き解除
    fireEvent.click(within(cards[0]).getByRole("button", { name: "編集" }));
    const startSelect = within(cards[0]).getByLabelText("条件の開始時刻");
    fireEvent.change(startSelect, { target: { value: "14" } });
    fireEvent.click(within(cards[0]).getByRole("button", { name: "完了" }));
    expect(screen.getAllByTestId("provisional-time-warning")).toHaveLength(1);
    expect(screen.getByText("仮置き時刻あり: 1件")).toBeTruthy();

    // 2枚目は「この時刻で確定する」ボタンで仮置き解除
    fireEvent.click(
      within(cards[1]).getByRole("button", { name: "この時刻で確定する" }),
    );
    expect(screen.queryAllByTestId("provisional-time-warning")).toHaveLength(0);
    expect(screen.getByText("全条件結びつけ完了")).toBeTruthy();
  });
});
