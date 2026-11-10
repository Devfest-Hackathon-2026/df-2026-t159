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
import { clearInputScreenDraft } from "@/lib/structure-review";
import type { RoomSnapshot } from "@/lib/types";

vi.mock("@/lib/auth", () => {
  const user = { uid: "test-user" };
  return {
    useAnonymousUser: () => user,
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

vi.mock("@/lib/rooms", () => ({
  readOwnMembership: vi.fn(async () => ({ role: "family" })),
  readRoomSnapshot: () => mockReadRoomSnapshot(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/rooms/room-input-test/input",
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

describe("InputClient（事情を入れる画面の最終チェック9項目）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInputScreenDraft();
    mockReadRoomSnapshot.mockResolvedValue(baseSnapshot);
  });

  afterEach(() => {
    cleanup();
    clearInputScreenDraft();
  });

  it("1. 下書き保持：事情メモや未保存の編集内容が画面遷移（アンマウント→再マウント）しても失われない（「入力の版：N」は非表示）", async () => {
    const { unmount } = render(<InputClient roomId="room-input-test" />);

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

    // 家族の希望も編集
    const hopesTextarea = screen.getByLabelText(
      /家族の希望（自由記述・1行に1件）/,
    ) as HTMLTextAreaElement;
    fireEvent.change(hopesTextarea, {
      target: { value: "週末は家族で交代したい\n入浴はプロにお願いしたい" },
    });

    // 週間ボードなど別画面へ移動したことを模擬（アンマウント）
    unmount();

    // 再び「事情を入れる」画面に戻ってきたことを模擬（再マウント）
    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");
    expect(screen.queryByText(/入力の版：/)).toBeNull();

    const restoredMemo = screen.getByPlaceholderText(
      /父は来週退院予定で要介護3/,
    ) as HTMLTextAreaElement;
    expect(restoredMemo.value).toBe("長女は平日仕事。母は腰痛あり。");

    const restoredHopes = screen.getByLabelText(
      /家族の希望（自由記述・1行に1件）/,
    ) as HTMLTextAreaElement;
    expect(restoredHopes.value).toBe(
      "週末は家族で交代したい\n入浴はプロにお願いしたい",
    );
  });

  it("2 & 3 & 6. AI整理・対象の自動セット・曜日時刻なし希望の分離・統合保存してもGeminiの整理が消えない", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
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
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");

    // 5. ボタンの意味が「家族の事情メモから条件・希望の下書きを作る（AI）」になっていること
    const structureBtn = screen.getByRole("button", {
      name: /家族の事情メモから条件・希望の下書きを作る（AI）/,
    });
    fireEvent.click(structureBtn);

    // 3. 名前が一意に一致する「長女」は対象が自動セットされ、一致しない「親戚」は未選択のまま
    await waitFor(() => {
      expect(screen.getByDisplayValue("平日9時〜18時は仕事")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("水曜午後は用事")).toBeTruthy();

    // 6. 曜日・時刻がない希望（「入浴介助は外部サービスを使いたい」）は条件カードに入れず「家族の希望」に入っている
    expect(
      screen.queryByDisplayValue("入浴介助は外部サービスを使いたい"),
    ).toBeNull();
    const hopesTextarea = screen.getByLabelText(
      /家族の希望（自由記述・1行に1件）/,
    ) as HTMLTextAreaElement;
    expect(hopesTextarea.value).toContain("住み慣れた自宅で過ごしたい");
    expect(hopesTextarea.value).toContain("入浴介助は外部サービスを使いたい");

    // 6. AI読み取りメモに対象の名前（AI読み取りメモ: 長女 など）は出さない
    expect(screen.queryByText(/AI読み取りメモ/)).toBeNull();

    // 条件カードの1件目（長女）は p-daughter が自動選択され、2件目（親戚）は未選択("")
    const targetSelects = screen.getAllByLabelText(
      "対象の家族",
    ) as HTMLSelectElement[];
    expect(targetSelects).toHaveLength(2);
    expect(targetSelects[0].value).toBe("p-daughter");
    expect(targetSelects[1].value).toBe("");

    // 未選択の2件目に「母」を選択し、自己負担割合を2割に変更してまとめて保存する
    fireEvent.change(targetSelects[1], { target: { value: "p-mother" } });
    fireEvent.click(screen.getByLabelText("2割"));

    const saveBtn = screen.getByRole("button", {
      name: "条件・時間帯・負担割合をまとめて保存する",
    });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/条件・時間帯・負担割合をまとめて保存しました（新しい版：3）/),
      ).toBeTruthy();
    });

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
    expect(savedBody.hopes).toEqual([
      "住み慣れた自宅で過ごしたい",
      "入浴介助は外部サービスを使いたい",
    ]);

    // 保存後も Gemini の整理の内容が消えずに残っていること
    expect(screen.getByDisplayValue("平日9時〜18時は仕事")).toBeTruthy();
    expect(screen.getByDisplayValue("水曜午後は用事")).toBeTruthy();
  });

  it("3. 通常入力（手動追加）でも内容から対象が明らかなものは自動で対象と分類が入る", async () => {
    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");

    fireEvent.click(screen.getByRole("button", { name: "＋ 条件を追加する" }));

    const cards = screen.getAllByTestId("constraint-card");
    const newCard = cards[cards.length - 1];
    const detailInput = within(newCard).getByPlaceholderText(
      "事情・条件の詳しい内容",
    );
    const targetSelect = within(newCard).getByLabelText(
      "対象の家族",
    ) as HTMLSelectElement;
    const typeSelect = within(newCard).getByLabelText(
      "条件の種別",
    ) as HTMLSelectElement;

    // 初期状態は未選択・その他
    expect(targetSelect.value).toBe("");
    expect(typeSelect.value).toBe("other");

    // 「長男は金曜に仕事」と入力すると、対象が「長男（p-son）」、種別が「対応不可（unavailable）」に自動セットされる
    fireEvent.change(detailInput, { target: { value: "長男は金曜に仕事" } });
    expect(targetSelect.value).toBe("p-son");
    expect(typeSelect.value).toBe("unavailable");
  });

  it("4 & 9. 介護が必要な時間帯が曜日ごとの開閉式になっており、初期開閉・追加・曜日内ソートが動作する", async () => {
    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");

    // 9. 「介護が必要な時間帯」の表示になっており、「支援が必要な時間帯」は表示されない
    expect(
      screen.getByRole("heading", {
        name: /介護が必要な時間帯と自己負担割合/,
      }),
    ).toBeTruthy();
    expect(screen.queryByText("支援が必要な時間帯")).toBeNull();

    // 曜日ごとの見出しと件数が表示され、入力がある月曜(0)・水曜(2)は開いた状態、それ以外は畳んだ状態
    const monSection = screen.getByTestId("care-window-day-0");
    const tueSection = screen.getByTestId("care-window-day-1");
    const wedSection = screen.getByTestId("care-window-day-2");

    expect(
      within(monSection)
        .getByRole("button", { name: "月曜日（1件）" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(tueSection)
        .getByRole("button", { name: "火曜日（0件）" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(
      within(wedSection)
        .getByRole("button", { name: "水曜日（1件）" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    // 初期表示で開いている行は月曜と水曜の2件のみ
    expect(screen.getAllByTestId("care-window-row")).toHaveLength(2);
    expect(within(tueSection).queryAllByTestId("care-window-row")).toHaveLength(
      0,
    );

    // 入力のない火曜日セクションの「時間帯を追加」ボタンを押すと、火曜日が開いて未入力行が追加される
    fireEvent.click(
      within(tueSection).getByRole("button", { name: "時間帯を追加" }),
    );
    expect(
      within(tueSection)
        .getByRole("button", { name: "火曜日（1件）" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    const tueRows = within(tueSection).getAllByTestId("care-window-row");
    expect(tueRows).toHaveLength(1);
    expect(within(tueRows[0]).getByText("未入力")).toBeTruthy();
    // 各行から曜日プルダウンは外れ、その曜日セクションの時間帯として扱われる
    expect(
      within(tueRows[0]).queryByLabelText("介護が必要な曜日"),
    ).toBeNull();

    // 月曜日（既に7:00〜10:00がある）にさらに2件追加して、曜日内で開始時刻の早い順に並ぶことを確認
    fireEvent.click(
      within(monSection).getByRole("button", { name: "時間帯を追加" }),
    );
    let monRows = within(monSection).getAllByTestId("care-window-row");
    expect(monRows).toHaveLength(2);
    // 未入力行に 14:00〜17:00 を設定
    fireEvent.change(
      within(monRows[0]).getByLabelText("介護が必要な開始時刻"),
      { target: { value: "14" } },
    );
    fireEvent.change(
      within(monRows[0]).getByLabelText("介護が必要な終了時刻"),
      { target: { value: "17" } },
    );

    // もう1件追加して 6:00〜7:00 を設定すると、6:00 → 7:00 → 14:00 の順に並ぶ
    fireEvent.click(
      within(monSection).getByRole("button", { name: "時間帯を追加" }),
    );
    monRows = within(monSection).getAllByTestId("care-window-row");
    expect(within(monSection).getByText("月曜日（3件）")).toBeTruthy();
    fireEvent.change(
      within(monRows[0]).getByLabelText("介護が必要な開始時刻"),
      { target: { value: "6" } },
    );
    fireEvent.change(
      within(monRows[0]).getByLabelText("介護が必要な終了時刻"),
      { target: { value: "7" } },
    );

    monRows = within(monSection).getAllByTestId("care-window-row");
    expect(
      monRows.map(
        (r) =>
          (
            within(r).getByLabelText(
              "介護が必要な開始時刻",
            ) as HTMLSelectElement
          ).value,
      ),
    ).toEqual(["6", "7", "14"]);

    // セクション見出しクリックで開閉できる
    fireEvent.click(
      within(monSection).getByRole("button", { name: "月曜日（3件）" }),
    );
    expect(
      within(monSection)
        .getByRole("button", { name: "月曜日（3件）" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(within(monSection).queryAllByTestId("care-window-row")).toHaveLength(
      0,
    );
  });

  it("6 & 7 & 8. 簡易／詳細の切り替え、ゴミ箱アイコン削除、バッジ重複解消、希望欄の広さが反映されている", async () => {
    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");

    // 7. 条件カード左上の種別表示は select 1つだけで、同じラベルのバッジが2つ重複していない
    const card = screen.getByTestId("constraint-card");
    expect(within(card).getAllByText("対応不可")).toHaveLength(1);

    // 必須ステップ案内が目立つ形で表示されており、所得による目安はトグルで開閉できる
    expect(
      screen.getByText("対象の家族を選び、内容を確認して保存してください。"),
    ).toBeTruthy();
    expect(screen.queryByText(/一般的な所得の方は1割/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /所得による目安（詳細表示）/ }),
    );
    expect(screen.getByText(/一般的な所得の方は1割/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /詳細を隠す/ }));
    expect(screen.queryByText(/一般的な所得の方は1割/)).toBeNull();

    // 6. 条件削除はゴミ箱アイコンボタン（aria-label="この条件を削除"）になっている
    const deleteBtn = within(card).getByRole("button", {
      name: "この条件を削除",
    });
    expect(deleteBtn.querySelector("svg")).toBeTruthy();

    // 8. 家族の希望の入力欄が縦に広がっている（rows=6）
    const hopesTextarea = screen.getByLabelText(
      /家族の希望（自由記述・1行に1件）/,
    ) as HTMLTextAreaElement;
    expect(hopesTextarea.getAttribute("rows")).toBe("6");

    // 6. 簡易／詳細の切り替えで整理全体を隠す・表示できる
    expect(screen.getByTestId("gemini-detailed-view")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "簡易" }));
    expect(screen.queryByTestId("gemini-detailed-view")).toBeNull();
    expect(screen.getByTestId("gemini-simple-view")).toBeTruthy();
    expect(screen.getByText("条件カード：1件")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "詳細" }));
    expect(screen.getByTestId("gemini-detailed-view")).toBeTruthy();
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
      render(<InputClient roomId="room-input-test" />);
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

  it("登録されている家族リストのアイコンが40px（h-10 w-10）で表示される", async () => {
    render(<InputClient roomId="room-input-test" />);
    await screen.findByText("登録されている家族");

    const familySection = screen.getByRole("region", { name: "登録されている家族" });
    const icons = familySection.querySelectorAll("ul span.rounded-full");
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(icon.className).toContain("h-10");
      expect(icon.className).toContain("w-10");
    }
  });
});
