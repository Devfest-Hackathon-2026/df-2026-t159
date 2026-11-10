// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BoardRightRail from "./BoardRightRail";
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

describe("BoardRightRail UX要約と詳細表示", () => {
  it("初期表示では問題件数と重い問題の見出し1〜2件のみを表示し、解消のヒント全文は詳しく見るで表示する", () => {
    render(
      <BoardRightRail
        roomId="room-test"
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
      />,
    );

    // 初期表示：問題件数の表示がある
    expect(screen.getByText(/問題 \d+件/)).toBeTruthy();

    // 初期表示：重い問題の見出しが表示されている
    expect(screen.getByText(/保険の上限超過/)).toBeTruthy();

    // 初期表示：解消のヒント全文はまだ表示されていない
    expect(screen.queryByText(/💡 解消のヒント:/)).toBeNull();

    // 「詳しく見る」をクリック
    fireEvent.click(screen.getByRole("button", { name: /詳しく見る・解消のヒント/ }));

    // 展開後：「解消のヒント」が表示される
    expect(screen.getAllByText(/💡 解消のヒント:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/訪問介護・デイサービスの回数を減らす/)).toBeTruthy();

    // 閉じるボタンで再度折りたためる
    fireEvent.click(screen.getByRole("button", { name: /閉じる/ }));
    expect(screen.queryByText(/💡 解消のヒント:/)).toBeNull();
  });

  it("通所リハビリが複数日あっても確認事項カードは1つに集約され、問題ヒントとは独立して表示される", () => {
    render(
      <BoardRightRail
        roomId="room-test"
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
      />,
    );

    // 問題の「詳しく見る」を展開しても確認事項は混ざらない
    fireEvent.click(screen.getByRole("button", { name: /詳しく見る・解消のヒント/ }));
    expect(screen.queryByText(/通所リハビリの利用には医師の指示が必要です/)).toBeNull();

    // 独立した「面談での確認事項を見る」をクリックして展開
    fireEvent.click(screen.getByRole("button", { name: /面談での確認事項を見る/ }));

    // 通所リハビリの確認事項は火・木の2件ではなく1つに集約されている
    const rehabNotes = screen.getAllByText(/通所リハビリの確認事項/);
    expect(rehabNotes).toHaveLength(1);
    expect(screen.getByText(/通所リハビリの利用には医師の指示が必要です/)).toBeTruthy();
  });

  it("検証OK（問題0件）のとき、ヒント側の開閉トグルは出ず「問題なし」のみ表示され、確認事項は独立して表示・開閉できる", () => {
    const acceptedSnapshot: RoomSnapshot = {
      ...troubledSnapshot,
      placements: demoFixture.acceptedPlan.placements,
      revision: 2,
    };
    const acceptedValidation = demoFixture.acceptedPlan.expectedValidationResult;

    render(
      <BoardRightRail
        roomId="room-test"
        snapshot={acceptedSnapshot}
        validation={acceptedValidation}
        people={demoFixture.people}
      />,
    );

    // 問題なしバッジとメッセージの表示
    expect(screen.getByText("問題なし")).toBeTruthy();
    expect(screen.getByText(/対応ルール内で検証済み/)).toBeTruthy();

    // 問題が0件なので「詳しく見る・解消のヒント」トグル自体が出ない
    expect(screen.queryByRole("button", { name: /詳しく見る・解消のヒント/ })).toBeNull();
    expect(screen.queryByText(/全0件/)).toBeNull();

    // 通所リハビリの確認事項があるため、「面談での確認事項を見る」は独立して表示される
    const checkNotesBtn = screen.getByRole("button", { name: /面談での確認事項を見る（1件）/ });
    expect(checkNotesBtn).toBeTruthy();

    // 初期状態では確認事項本文は非表示
    expect(screen.queryByText(/通所リハビリの利用には医師の指示が必要です/)).toBeNull();

    // クリックで展開
    fireEvent.click(checkNotesBtn);
    expect(screen.getByText(/通所リハビリの確認事項/)).toBeTruthy();
    expect(screen.getByText(/通所リハビリの利用には医師の指示が必要です/)).toBeTruthy();

    // 閉じるで折りたためる
    fireEvent.click(screen.getByRole("button", { name: /閉じる/ }));
    expect(screen.queryByText(/通所リハビリの利用には医師の指示が必要です/)).toBeNull();
  });

  it("問題0件かつ確認事項0件のときは「問題なし」表示のみで、どちらの開閉ボタンも表示されない", () => {
    const cleanSnapshot: RoomSnapshot = {
      ...troubledSnapshot,
      // 確認事項（dayrehab や 2h daycare）を含まない配置
      placements: [
        {
          id: "p1",
          day: 0,
          startHour: 9,
          endHour: 10,
          kind: "visit",
          serviceId: "visit-physical-20-60",
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
      <BoardRightRail
        roomId="room-test"
        snapshot={cleanSnapshot}
        validation={cleanValidation}
        people={demoFixture.people}
      />,
    );

    expect(screen.getByText("問題なし")).toBeTruthy();
    expect(screen.getByText(/対応ルール内で検証済み/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /詳しく見る・解消のヒント/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /面談での確認事項を見る/ })).toBeNull();
  });

  it("家族の負担はプログレスバーを排し、1行要約と過労警告色、負担ビューへのリンクを表示する", () => {
    render(
      <BoardRightRail
        roomId="room-test"
        snapshot={troubledSnapshot}
        validation={troubledValidation}
        people={demoFixture.people}
      />,
    );

    // 詳細なプログレスバーは存在しない
    expect(screen.queryByRole("progressbar")).toBeNull();

    // 1行要約の表示（長女 27時間／週、母 10時間／週、長男 8時間／週）
    expect(screen.getByText(/27時間／週/)).toBeTruthy();
    expect(screen.getByText(/10時間／週/)).toBeTruthy();
    expect(screen.getByText(/8時間／週/)).toBeTruthy();

    // 長女（27h）には過労警告が表示される
    expect(screen.getByText("過労警告")).toBeTruthy();

    // 負担ビューへのリンクが存在する
    const link = screen.getByRole("link", { name: /負担ビューで詳しく見る/ });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/rooms/room-test/burden");
  });
});
