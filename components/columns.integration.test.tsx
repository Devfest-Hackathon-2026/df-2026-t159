// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { columnsData, getDecisionContents, getSceneColumns, getServiceContents } from "../lib/columns";
import { demoFixture as fx } from "../lib/demo-fixture";
import type { RoomSnapshot, ValidationResult } from "../lib/types";
import DecisionList from "./DecisionList";
import SceneColumnList, { SceneColumnNotice } from "./SceneColumn";
import ServiceDescription from "./ServiceDescription";
import WarningAlerts from "./WarningAlerts";
import WeeklyBoard from "../app/rooms/[roomId]/board/WeeklyBoard";
import BoardLeftNav from "../app/rooms/[roomId]/board/BoardLeftNav";
import ColumnsClient from "../app/rooms/[roomId]/columns/ColumnsClient";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const expected = fx.troubledPlan.expectedValidationResult;
describe("正本文面の表示とボードへの接続", () => {
  it("決めること8項目を選択して各詳細を読め、完了状態は作らない", () => {
    const decisions = getDecisionContents(columnsData);
    render(<DecisionList decisions={decisions} />);
    const buttons = within(screen.getByRole("list", { name: "決めること項目一覧" })).getAllByRole("button");
    expect(buttons).toHaveLength(8);
    for (const [i, decision] of decisions.entries()) {
      fireEvent.click(buttons[i]);
      expect(screen.getByRole("heading", { name: decision.title })).toBeTruthy();
      expect(screen.getByRole("article", { name: decision.title }).textContent).toContain(decision.body);
    }
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("5場面のコラムが対応する警告横に出て、各本文が正本と一致する", () => {
    const result: ValidationResult = { ...expected,
      hardViolations: [{ type: "unavailableOverlap", detail: "テスト用の対応不可" }],
      validationErrors: [{ code: "incompleteConstraint", reason: "テスト用の未判定" }],
    };
    render(<WarningAlerts validation={result} people={fx.people} />);
    for (const column of getSceneColumns(columnsData)) {
      expect(screen.getByRole("note", { name: `コラム：${column.title}` }).textContent).toContain(column.body);
    }
    expect(screen.getAllByRole("note")).toHaveLength(5);
  });
  it("結果なしで合格や場面を捏造せず、nullの超過数から超過コラムを出さない", () => {
    const view = render(<SceneColumnList validation={null} />);
    expect(screen.getByRole("heading", { name: "現在は未判定です" })).toBeTruthy();
    expect(screen.queryByRole("article")).toBeNull();
    view.rerender(<SceneColumnList validation={{ ...expected, overUnits: null }} />);
    const over = getSceneColumns(columnsData).find(c => c.sceneId === "overLimit")!;
    expect(screen.queryByRole("heading", { name: over.title })).toBeNull();
  });
  it("検証結果のないNoticeを自動表示しない", () => {
    render(<SceneColumnNotice sceneId="overLimit" />);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("全5種類の説明を表示でき、一覧と単体を切り替えてもHook順序が変わらない", () => {
    const services = getServiceContents(columnsData);
    const view = render(<ServiceDescription />);
    expect(screen.getAllByRole("article")).toHaveLength(5);
    for (const service of services) {
      view.rerender(<ServiceDescription kind={service.kind} variant="compact" />);
      expect(screen.getByRole("note").textContent).toContain(service.body);
    }
    view.rerender(<ServiceDescription />);
    expect(screen.getAllByRole("article")).toHaveLength(5);
  });
  it("明示されたサービス説明を優先し、不明IDだけから別サービスを推測しない", () => {
    const service = { ...getServiceContents(columnsData)[0], title: "表示テスト用", body: "渡された説明本文" };
    const view = render(<ServiceDescription services={[service]} kind={service.kind} variant="compact" />);
    expect(screen.getByText("渡された説明本文")).toBeTruthy();
    view.rerender(<ServiceDescription serviceId="unknown-test-id" />);
    expect(screen.getByText("サービス説明が見つかりません。")).toBeTruthy();
  });
  it("パレットと配置詳細の両方からサービス説明を読める", () => {
    const snapshot: RoomSnapshot = { people: fx.people, placements: fx.troubledPlan.placements,
      constraints: fx.constraints, careWindows: fx.careWindows, copayRate: fx.copayRate, hopes: fx.hopes, unknowns: fx.unknowns, revision: 1 };
    render(
      <div>
        <BoardLeftNav snapshot={snapshot} canEdit services={[]} onAddPlacement={() => {}} />
        <WeeklyBoard snapshot={snapshot} canEdit saving={false} services={[]} validation={expected} onSave={async () => true} />
      </div>
    );
    // パレット側：全種別の短い説明が読める（統合後のボードでは左パレットに常時表示）
    for (const service of getServiceContents(columnsData)) {
      expect(document.body.textContent).toContain(service.body.split("\n")[0]);
    }
    fireEvent.click(screen.getByRole("button", { name: "母の付き添い 月曜 17:00の詳細" }));
    const form = within(screen.getByRole("form", { name: "配置の編集" }));
    const family = getServiceContents(columnsData).find(s => s.kind === "family")!;
    expect(form.getByText(`${family.title}とは`)).toBeTruthy();
    expect(screen.getByRole("form", { name: "配置の編集" }).textContent).toContain(family.body);
  });
  it("ルーム取得失敗をデモで埋めず、明示操作のときだけデモの3場面を表示する", async () => {
    render(<ColumnsClient roomId="test" loadSnapshot={async () => { throw new Error("test"); }} />);
    await screen.findByText(/ルームの結果を取得できませんでした/);
    fireEvent.click(screen.getByRole("button", { name: /場面連動コラム/ }));
    const columns = within(screen.getByRole("region", { name: "場面連動コラム" }));
    expect(columns.queryByRole("article")).toBeNull();
    fireEvent.change(screen.getByLabelText("表示するプラン："), { target: { value: "troubled" } });
    await waitFor(() => expect(columns.getAllByRole("article")).toHaveLength(3));
    expect(screen.getByText(/架空デモの期待値/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("表示するプラン："), { target: { value: "room" } });
    expect(columns.queryByRole("article")).toBeNull();
  });
});
