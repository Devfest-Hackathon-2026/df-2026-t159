// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BoardMetricsCard from "./BoardMetricsCard";
import BoardStatusBand from "./BoardStatusBand";
import { demoFixture } from "../../../../lib/demo-fixture";
import type { RoomSnapshot } from "../../../../lib/types";

afterEach(() => {
  cleanup();
});

const troubledSnapshot: RoomSnapshot = {
  people: demoFixture.people,
  placements: demoFixture.troubledPlan.placements,
  constraints: demoFixture.constraints,
  careWindows: demoFixture.careWindows,
  copayRate: demoFixture.copayRate,
  hopes: demoFixture.hopes,
  unknowns: demoFixture.unknowns,
  revision: 1,
};

const troubledValidation = demoFixture.troubledPlan.expectedValidationResult;

describe("BoardMetricsCard（左列カード）と BoardStatusBand（上部バー）", () => {
  it("左列カードに単位数・自己負担・家族の負担を表示し、上部バーは注意点チップ・代替案・確定ボタンのみを表示する", () => {
    const onConfirm = vi.fn();
    render(
      <>
        <BoardStatusBand
          roomId="room-test"
          snapshot={troubledSnapshot}
          validation={troubledValidation}
          people={demoFixture.people}
          onOpenProposals={vi.fn()}
          onConfirm={onConfirm}
        />
        <BoardMetricsCard
          snapshot={troubledSnapshot}
          validation={troubledValidation}
          people={demoFixture.people}
        />
      </>,
    );

    const statusBand = screen.getByRole("region", { name: "プランの状態" });
    const metricsCard = screen.getByRole("region", { name: "単位数・自己負担・家族の負担" });

    // 上部バーには単位数・自己負担・家族の負担は含まれない
    expect(within(statusBand).queryByText("28,131単位")).toBeNull();
    expect(within(statusBand).queryByText("37,878円")).toBeNull();
    expect(within(statusBand).queryByText(/家族の負担/)).toBeNull();
    expect(within(statusBand).getByText("問題があるため確定できません")).toBeTruthy();
    expect(within(statusBand).getByRole("button", { name: /代替案を見る/ })).toBeTruthy();
    expect(within(statusBand).getByRole("button", { name: "このプランで確定する" })).toBeTruthy();
    expect(statusBand.querySelector('[data-board-tutorial-target="status-warnings"]')).toBeNull();
    expect(statusBand.querySelector('[data-board-tutorial-target="status-proposals"]')).toBeTruthy();
    expect(statusBand.querySelector('[data-board-tutorial-target="confirm-btn"]')).toBeTruthy();

    // 左列カードにチュートリアル対象（status-money / status-burden）と単位数・自己負担・家族の負担が並ぶ
    expect(metricsCard.querySelector('[data-board-tutorial-target="status-money"]')).toBeTruthy();
    expect(metricsCard.querySelector('[data-board-tutorial-target="status-burden"]')).toBeTruthy();
    expect(within(metricsCard).getByText("28,131単位")).toBeTruthy();
    expect(within(metricsCard).getByText("+1,083").className).toContain("text-[#C05B4D]");
    expect(within(metricsCard).getByText("上限 27,048単位（要介護3）")).toBeTruthy();
    expect(within(metricsCard).getByTestId("units-over-bar")).toBeTruthy();

    // 月の自己負担（目安）＋うち上限超過分
    expect(within(metricsCard).getByText("37,878円")).toBeTruthy();
    expect(within(metricsCard).getByText("うち上限超過分 10,830円（全額自己負担）")).toBeTruthy();
    expect(within(metricsCard).getByText(/1単位10円・30日の月として試算した目安/)).toBeTruthy();

    // 家族の負担：プログレスバーではなく積み重ねバー＋メンバー別表示（長女のみ赤字）
    expect(within(metricsCard).queryByRole("progressbar")).toBeNull();
    const burdenText = within(metricsCard).getByText("長女").closest("p")!;
    expect(burdenText.textContent).toContain("母 10時間");
    expect(burdenText.textContent).toContain("長女 27時間");
    expect(burdenText.textContent).toContain("長男 8時間");
    expect(within(metricsCard).getByText("長女").className).toContain("text-[#C05B4D]");

    expect(within(metricsCard).getByText("※ 週20時間超は負担を見直す目安です")).toBeTruthy();
    expect(burdenText.textContent).toContain("長女 27時間（目安超え）");
    expect(within(metricsCard).getAllByText("（目安超え）")).toHaveLength(1);
    expect(within(statusBand).queryByText("注意点 3件")).toBeNull();
    expect(within(statusBand).queryByRole("button", { name: /注意点/ })).toBeNull();
    expect(screen.queryByText(/注意点の詳細/)).toBeNull();
  });

  it("家族の負担バー区間と色ドットは MemberAvatar と同じ people 順の色を使う", () => {
    const fourMemberPeople = [
      { id: "person-mother", name: "母", canProvideCare: true },
      { id: "person-daughter", name: "長女", canProvideCare: true },
      { id: "person-son", name: "長男", canProvideCare: true },
      { id: "person-aunt", name: "叔母", canProvideCare: true },
    ];
    const fourMemberValidation = {
      ...troubledValidation,
      memberHours: [
        { personId: "person-mother", hours: 20 },
        { personId: "person-daughter", hours: 27 },
        { personId: "person-son", hours: 8 },
        { personId: "person-aunt", hours: 5 },
      ],
      overloads: [{ personId: "person-daughter", hours: 27 }],
    };

    render(
      <BoardMetricsCard
        snapshot={{ ...troubledSnapshot, people: fourMemberPeople }}
        validation={fourMemberValidation}
        people={fourMemberPeople}
      />,
    );

    expect(screen.getByTestId("burden-bar-segment-person-mother").className).toContain("bg-emerald-500");
    expect(screen.getByTestId("burden-dot-person-mother").className).toContain("bg-emerald-500");

    expect(screen.getByTestId("burden-dot-person-mother").parentElement?.textContent).toBe("母 20時間");

    // 過負荷（27時間）でもバーとドットは2人目=purpleを維持し、テキストのみ赤字
    expect(screen.getByTestId("burden-bar-segment-person-daughter").className).toContain("bg-purple-500");
    expect(screen.getByTestId("burden-dot-person-daughter").className).toContain("bg-purple-500");
    expect(screen.getByText("長女").className).toContain("text-[#C05B4D]");

    expect(screen.getByTestId("burden-bar-segment-person-son").className).toContain("bg-blue-500");
    expect(screen.getByTestId("burden-dot-person-son").className).toContain("bg-blue-500");

    expect(screen.getByTestId("burden-bar-segment-person-aunt").className).toContain("bg-orange-500");
    expect(screen.getByTestId("burden-dot-person-aunt").className).toContain("bg-orange-500");
  });

  it("通所リハビリが複数日あっても確認事項カードは1つに集約され、問題ヒントとは独立して表示される", () => {
    render(
      <BoardStatusBand
        roomId="room-test"
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
      />,
    );

    const rehabNotes = screen.getAllByText(/通所リハビリの確認事項/);
    expect(rehabNotes).toHaveLength(1);
    expect(screen.getByText(/通所リハビリの利用には医師の指示が必要です/)).toBeTruthy();
  });

  it("警告0件のときは「警告はありません」を表示し、確認事項は初期表示で読める", () => {
    const acceptedSnapshot: RoomSnapshot = {
      ...troubledSnapshot,
      placements: demoFixture.acceptedPlan.placements,
      revision: 2,
    };
    const acceptedValidation = demoFixture.acceptedPlan.expectedValidationResult;

    render(
      <BoardStatusBand
        roomId="room-test"
        snapshot={acceptedSnapshot}
        validation={acceptedValidation}
        people={demoFixture.people}
      />,
    );

    expect(screen.getByText("警告はありません")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /注意点/ })).toBeNull();

    expect(screen.getByRole("heading", { name: "面談での確認事項（1件）" })).toBeTruthy();
    expect(screen.getByText(/通所リハビリの利用には医師の指示が必要です/)).toBeTruthy();
  });

  it("警告0件かつ確認事項0件のときは「警告はありません」のみ表示する", () => {
    const cleanSnapshot: RoomSnapshot = {
      ...troubledSnapshot,
      placements: [
        {
          id: "p1",
          day: 0,
          startHour: 9,
          endHour: 10,
          kind: "visit",
          serviceId: "visit-body",
        },
      ],
      revision: 3,
    };
    const cleanValidation = {
      ...demoFixture.acceptedPlan.expectedValidationResult,
      gaps: [],
      hardViolations: [],
      validationErrors: [],
      overloads: [],
      overUnits: 0,
      ok: true,
    };

    render(
      <BoardStatusBand
        roomId="room-test"
        snapshot={cleanSnapshot}
        validation={cleanValidation}
        people={demoFixture.people}
      />,
    );

    expect(screen.getByText("警告はありません")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /注意点/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /確認事項/ })).toBeNull();
  });

  it("単位数が算出不可（null）のときは未判定と表示し0円を出さず、0単位確定時は0円を出す", () => {
    const nullUnitsValidation = {
      ...troubledValidation,
      ok: false,
      weeklyUnits: null,
      monthlyUnits: null,
      overUnits: null,
      selfPayYen: null,
      selfPayBreakdown: null,
      validationErrors: [
        { code: "unsupportedBand" as const, reason: "時間区分が未対応です" },
      ],
    };

    const view = render(
      <BoardMetricsCard
        snapshot={troubledSnapshot}
        validation={nullUnitsValidation}
        people={demoFixture.people}
      />,
    );

    expect(screen.queryByText("0円")).toBeNull();
    expect(screen.queryByText(/うち上限超過分 0円/)).toBeNull();
    expect(screen.getAllByText("未判定").length).toBeGreaterThanOrEqual(2);

    const zeroUnitsWithCareWindowError = {
      ...troubledValidation,
      ok: false,
      weeklyUnits: 0,
      monthlyUnits: 0,
      overUnits: 0,
      selfPayYen: 0,
      selfPayBreakdown: { withinYen: 0, overYen: 0 },
      gaps: [],
      hardViolations: [],
      overloads: [],
      validationErrors: [
        { code: "missingCareWindows" as const, reason: "支援が必要な時間帯が未設定です" },
      ],
    };

    view.rerender(
      <BoardMetricsCard
        snapshot={{ ...troubledSnapshot, placements: [] }}
        validation={zeroUnitsWithCareWindowError}
        people={demoFixture.people}
      />,
    );

    expect(screen.getByText("0単位")).toBeTruthy();
    expect(screen.getByText("0円")).toBeTruthy();
    expect(screen.getByText("うち上限超過分 0円")).toBeTruthy();
  });

  it("負担割合チップの切替は即時追随し、保存失敗時は元の値へ戻る", async () => {
    let resolveSave!: (ok: boolean) => void;
    const onChangeCopayRate = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          resolveSave = resolve;
        }),
    );

    render(
      <BoardMetricsCard
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
        onChangeCopayRate={onChangeCopayRate}
      />,
    );

    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(copaySelect.value).toBe("1");
    expect(screen.getByText("37,878円")).toBeTruthy();

    fireEvent.change(copaySelect, { target: { value: "2" } });
    expect(onChangeCopayRate).toHaveBeenCalledWith(2);
    expect(copaySelect.value).toBe("2");
    expect(screen.getByText("64,926円")).toBeTruthy();

    resolveSave(false);
    await waitFor(() => {
      expect(copaySelect.value).toBe("1");
    });
    expect(screen.getByText("37,878円")).toBeTruthy();
  });

  it("canEdit=false（ケアマネ等）では自己負担割合チップが無効化される", () => {
    const onChangeCopayRate = vi.fn();
    render(
      <BoardMetricsCard
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
        canEdit={false}
        onChangeCopayRate={onChangeCopayRate}
      />,
    );

    const copaySelect = screen.getByRole("combobox", { name: "自己負担割合" }) as HTMLSelectElement;
    expect(copaySelect.disabled).toBe(true);
  });

  it("仮置き時刻の未確認がある場合は、重なり警告より先に「時刻の確認」を出す", () => {
    const provisionalSnapshot: RoomSnapshot = {
      ...troubledSnapshot,
      constraints: [
        {
          personId: "person-daughter",
          type: "unavailable",
          detail: "水曜午後は用事",
          days: [2],
          startHour: 13,
          endHour: 17,
          provisional: true,
        },
      ],
    };
    const overlapValidation = {
      ...troubledValidation,
      ok: false,
      hardViolations: [
        {
          type: "unavailableOverlap" as const,
          detail: "長女の対応不可の時間帯に付き添いの予定があります",
          placementId: "p1",
        },
        {
          type: "overlap" as const,
          detail: "予定が重なっています",
          placementId: "p2",
        },
      ],
    };

    render(
      <BoardStatusBand
        roomId="room-test"
        snapshot={provisionalSnapshot}
        validation={overlapValidation}
        people={demoFixture.people}
      />,
    );

    const timeSection = screen.getByRole("region", { name: "時刻の確認" });
    const ruleSection = screen.getByRole("region", { name: "確認が必要な予定" });
    expect(
      timeSection.compareDocumentPosition(ruleSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const summaryParagraph = within(timeSection).getByText(
      /AIが仮置きした時刻です。入力画面で正しい時刻を設定してください/,
    );
    expect(summaryParagraph.className).toContain("text-sm");
  });
});
