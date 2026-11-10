// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyBoard from "./WeeklyBoard";
import BoardLeftNav from "./BoardLeftNav";
import BoardAssistPanel from "./BoardAssistPanel";
import { mockSnapshot, mockValidation } from "../../../../lib/mock";
import type { BoardService } from "../../../../lib/board";
import type { Placement, RoomSnapshot } from "../../../../lib/types";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const services: BoardService[] = [
  { serviceId: "visit-body", title: "訪問介護（身体介護）", kind: "visit" },
  { serviceId: "daycare-basic", title: "通所介護", kind: "daycare" },
  { serviceId: "dayrehab-basic", title: "通所リハビリ", kind: "dayrehab" },
  { serviceId: "shortstay-basic", title: "ショートステイ", kind: "shortstay" },
];

function renderAssistView() {
  function Harness() {
    const [draft, setDraft] = useState<Placement | null>(null);
    return (
      <div>
        <BoardLeftNav
          snapshot={mockSnapshot}
          canEdit
          services={services}
          onAddPlacement={kind => {
            const service = services.find(s => s.kind === kind);
            setDraft({
              id: "draft-test",
              day: 0,
              startHour: 6,
              endHour: kind === "shortstay" ? 24 : 7,
              kind,
              serviceId: service?.serviceId ?? "",
            });
          }}
        />
        <WeeklyBoard
          snapshot={mockSnapshot}
          canEdit
          saving={false}
          services={services}
          validation={mockValidation}
          onSave={vi.fn(async () => true)}
          activeDraftPlacement={draft}
        />
      </div>
    );
  }
  return render(<Harness />);
}

describe("配置補助（サービス説明・空白ガイド・整理パネル）", () => {
  it("パレットの共通注記は上部に1回だけ表示し、項目内に曜日や反復注記を出さない", () => {
    renderAssistView();
    const palette = within(screen.getByRole("complementary", { name: "サービスパレット" }));
    expect(palette.getAllByText(/基本単位の目安/)).toHaveLength(1);
    expect(palette.getAllByText(/時間区分によって異なります/)).toHaveLength(1);
    for (const button of palette.getAllByRole("button")) {
      expect(button.textContent).not.toMatch(/ドラッグ可|基本単位の目安|時間区分によって異なります|[月火水木金土日]曜/);
    }
  });
  it("時間の目盛りは6時から24時まで欠けずに表示する", () => {
    renderAssistView();
    const axis = within(screen.getByLabelText("時刻の目盛り"));
    for (let hour = 6; hour <= 24; hour++) expect(axis.getByText(`${hour}:00`)).toBeTruthy();
  });
  it("パレットに各サービスの短い説明が出る", () => {
    renderAssistView();
    expect(screen.getByText(/ヘルパーが自宅に来て/)).toBeTruthy();
    expect(screen.getByText(/施設に日帰りで通い/)).toBeTruthy();
    expect(screen.getByText(/施設に短期間泊まり/)).toBeTruthy();
  });

  it("追加フォームを開くと、選んだ種別の説明（全文）が出る", () => {
    renderAssistView();
    fireEvent.click(screen.getByRole("button", { name: "＋ 通所介護" }));
    expect(screen.getByText("通所介護とは")).toBeTruthy();
    // パレットの短い説明（1行目）だけでなく、本文の2行目まで出ていること
    expect(screen.getByText(/人と会う機会をつくり/)).toBeTruthy();
  });

  it("空白ガイドに未配置の時間帯が出て、選ぶと曜日と時刻がフォームに入る", () => {
    renderAssistView();
    const gapButton = screen.getByRole("button", { name: /水曜 17:00〜19:00 がまだ空いています/ });
    fireEvent.click(gapButton);
    expect(gapButton.getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByLabelText("曜日") as HTMLSelectElement).value).toBe("2");
    expect((screen.getByLabelText("開始") as HTMLSelectElement).value).toBe("17");
    expect((screen.getByLabelText("終了") as HTMLSelectElement).value).toBe("19");
    // 既定の種別は訪問介護で開き、サービスも先頭のものが選ばれる
    expect(screen.getByText("訪問介護の配置")).toBeTruthy();
    expect((screen.getByLabelText("サービス") as HTMLSelectElement).value).toBe("visit-body");
  });

  it("整理パネルに人ごとの制約・希望・支援が要る時間帯が出る", () => {
    render(<BoardAssistPanel snapshot={mockSnapshot} />);
    // 初期状態は閉じて件数のみ見える
    expect(screen.getByText(/家族の事情 1件/)).toBeTruthy();
    // 開くと詳細が見える
    fireEvent.click(screen.getByRole("button", { name: /開く/ }));
    expect(screen.getAllByText(/平日は仕事（モック）/).length).toBeGreaterThan(0);
    expect(screen.getByText("長女")).toBeTruthy();
    expect(screen.getByText(/週末は家族で交代したい（モック）/)).toBeTruthy();
    // 全て埋まっている曜日はまとめて1行で畳まれる（mockSnapshot は月・水ともに充足済み）
    expect(screen.getByText("月・水：すべて埋まっています")).toBeTruthy();
  });

  it("ブロックは1時間ではサービス名のみ、2時間以上ではサービス名と時刻を表示する", () => {
    const testSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      placements: [
        { id: "p1", day: 0, startHour: 9, endHour: 10, kind: "visit", serviceId: "visit-body" },
        { id: "p2", day: 0, startHour: 11, endHour: 13, kind: "daycare", serviceId: "daycare-basic" },
      ],
    };
    render(
      <WeeklyBoard
        snapshot={testSnapshot}
        canEdit
        saving={false}
        services={services}
        validation={null}
        onSave={vi.fn(async () => true)}
      />
    );
    // 1時間ブロック（9:00-10:00）：サービス名は出るが、時刻文字列はブロック内に出ない
    expect(screen.getByRole("button", { name: "訪問介護（身体介護） 月曜 9:00の詳細" })).toBeTruthy();
    expect(screen.queryByText("9:00–10:00")).toBeNull();

    // 2時間ブロック（11:00-13:00）：サービス名も時刻文字列も出る
    expect(screen.getByRole("button", { name: "通所介護 月曜 11:00の詳細" })).toBeTruthy();
    expect(screen.getByText("11:00–13:00")).toBeTruthy();
  });

  it("パレットは詳細表示の切り替えで説明・単位目安を隠す・表示でき、パレット自体も開閉できる", () => {
    renderAssistView();
    // 初期状態（defaultShowDetails=true）では短い説明が出ている
    expect(screen.getByText(/ヘルパーが自宅に来て/)).toBeTruthy();

    // 「詳細表示を隠す」で説明を隠し、5つの追加ボタンは残る
    fireEvent.click(screen.getByRole("button", { name: "詳細表示を隠す" }));
    expect(screen.queryByText(/ヘルパーが自宅に来て/)).toBeNull();
    expect(screen.getByRole("button", { name: "＋ 訪問介護" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "＋ 家族の付き添い" })).toBeTruthy();

    // 「詳細を表示」で再び説明が出る
    fireEvent.click(screen.getByRole("button", { name: "詳細を表示" }));
    expect(screen.getByText(/ヘルパーが自宅に来て/)).toBeTruthy();

    // 「パレットを隠す ▲」でパレット帯のボタン群を隠せる
    fireEvent.click(screen.getByRole("button", { name: /パレットを隠す/ }));
    expect(screen.queryByRole("button", { name: "＋ 訪問介護" })).toBeNull();

    // 「パレットを表示 ▼」で再び表示できる
    fireEvent.click(screen.getByRole("button", { name: /パレットを表示/ }));
    expect(screen.getByRole("button", { name: "＋ 訪問介護" })).toBeTruthy();
  });

  it("介護が必要な時間帯リストは埋まった曜日を畳み、空きのある曜日はチップ（充足✓・未充足赤）と末尾サマリを表示する", () => {
    // 月曜 9:00-12:00 は配置あり（すべて充足済み）
    // 水曜 10:00-11:00 は配置なし（未充足）、水曜 14:00-16:00 は配置あり（充足済み）
    const testSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      careWindows: [
        { day: 0, startHour: 9, endHour: 12 },
        { day: 2, startHour: 10, endHour: 11 },
        { day: 2, startHour: 14, endHour: 16 },
      ],
      placements: [
        { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "daycare-basic" },
        { id: "p2", day: 2, startHour: 14, endHour: 16, kind: "visit", serviceId: "visit-body" },
      ],
    };
    render(<BoardAssistPanel snapshot={testSnapshot} defaultOpen />);
    // 月曜はすべて埋まっているため1行で畳まれる
    expect(screen.getByText(/月：すべて埋まっています/)).toBeTruthy();
    // 水曜は一部空きがあるため、全チップが表示される（充足済みは✓、未充足は赤）
    expect(screen.getByTitle("水曜 14:00–16:00（充足済み）")).toBeTruthy();
    expect(screen.getByTitle("水曜 10:00–11:00（未充足）")).toBeTruthy();
    expect(screen.getAllByText("✓").length).toBeGreaterThan(0);
    // 末尾サマリ
    expect(screen.getByText("まだ空いているのは 水曜 10:00–11:00 だけ")).toBeTruthy();
  });

  it("全部の時間帯が埋まっている場合はその旨のみ表示される", () => {
    const testSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      careWindows: [
        { day: 0, startHour: 9, endHour: 12 },
        { day: 1, startHour: 9, endHour: 12 },
      ],
      placements: [
        { id: "p1", day: 0, startHour: 9, endHour: 12, kind: "daycare", serviceId: "daycare-basic" },
        { id: "p2", day: 1, startHour: 9, endHour: 12, kind: "daycare", serviceId: "daycare-basic" },
      ],
    };
    render(<BoardAssistPanel snapshot={testSnapshot} defaultOpen />);
    expect(screen.getByText(/月・火：すべて埋まっています/)).toBeTruthy();
    // 空きチップや赤い末尾サマリは出ない
    expect(screen.queryByTitle(/未充足/)).toBeNull();
    expect(screen.queryByText(/まだ空いているのは/)).toBeNull();
  });

  it("家族の事情カード内の人物アイコンが 32px（h-8 w-8 text-2xl）で表示される", () => {
    const testSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      people: [
        { id: "person-mother", name: "母", canProvideCare: true, icon: "👩" },
      ],
      constraints: [
        {
          personId: "person-mother",
          type: "hope",
          detail: "朝の付き添い可能",
          days: [4],
          startHour: 7,
          endHour: 9,
        },
      ],
    };
    render(<BoardAssistPanel snapshot={testSnapshot} defaultOpen />);
    const iconEl = screen.getByText("👩");
    expect(iconEl.className).toContain("h-8");
    expect(iconEl.className).toContain("w-8");
  });

  it("パレットの各アイテムは絵文字アイコンがなく、家族アバターも表示されない", () => {
    renderAssistView();
    const palette = within(screen.getByRole("complementary", { name: "サービスパレット" }));
    const familyButton = palette.getByRole("button", { name: "＋ 家族の付き添い" });
    // 絵文字アイコン（👥、🏠、🚌など）がボタン内に含まれないこと
    expect(familyButton.textContent).not.toMatch(/[👥🏠🚌🏃🏨]/);
    // 家族アバター（長女、母などの丸バッジ）がパレットに含まれないこと
    expect(familyButton.textContent).not.toMatch(/長女|母|長男/);
  });

  it("時刻指定なしの希望はカードにならず「家族の希望」に合流し、総件数は保持される", () => {
    const testSnapshot: RoomSnapshot = {
      ...mockSnapshot,
      constraints: [
        {
          personId: "person-mother",
          type: "hope",
          detail: "腰痛があるため長時間の身体介助は避けたい",
          days: [0, 1, 2, 3, 4],
          // startHour, endHour なし
        },
        {
          personId: "person-daughter",
          type: "hope",
          detail: "土曜午前は付き添い可能",
          days: [5],
          startHour: 9,
          endHour: 12,
        },
        {
          personId: "person-daughter",
          type: "unavailable",
          detail: "平日は仕事",
          days: [0, 1, 2, 3, 4],
          startHour: 9,
          endHour: 18,
        },
      ],
      hopes: ["週末は家族で交代したい"],
    };

    render(<BoardAssistPanel snapshot={testSnapshot} defaultOpen />);

    // 総件数バッジはカードから外した希望も含めて「家族の事情 3件」
    expect(screen.getByText("家族の事情 3件")).toBeTruthy();

    // 時刻指定なしの希望はカードとして表示されない（「（時刻指定なし）」バッジやカードなし）
    expect(screen.queryByText(/（時刻指定なし）/)).toBeNull();

    // 時刻指定ありの希望と対応不可はカードとして表示される
    expect(screen.getByText("土 9:00–12:00")).toBeTruthy();
    expect(screen.getByText("土曜午前は付き添い可能")).toBeTruthy();
    expect(screen.getByText("月・火・水・木・金 9:00–18:00")).toBeTruthy();
    expect(screen.getByText("平日は仕事")).toBeTruthy();

    // 時刻指定なしの希望は「💭 家族の希望」リストに「名前：内容」の形で合流する
    expect(screen.getByText("💭 家族の希望")).toBeTruthy();
    expect(screen.getByText(/母：腰痛があるため長時間の身体介助は避けたい/)).toBeTruthy();
    expect(screen.getByText(/週末は家族で交代したい/)).toBeTruthy();
  });
});
