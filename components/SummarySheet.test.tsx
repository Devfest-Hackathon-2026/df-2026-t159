import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";
import SummarySheet from "./SummarySheet";
import { demoFixture as fx } from "../lib/demo-fixture";
import type { SummaryDoc } from "../lib/types";

const summary: SummaryDoc = {
  snapshot: { people: fx.people, placements: fx.acceptedPlan.placements, constraints: fx.constraints,
    hopes: ["確定時だけの希望"], unknowns: [], careWindows: fx.careWindows, copayRate: fx.copayRate, revision: 3 },
  validation: fx.acceptedPlan.expectedValidationResult, confirmedRevision: 3, confirmedAt: Timestamp.fromMillis(0),
};
describe("まとめシートは確定スナップショットだけを表示する", () => {
  it("確定内容がなければ空の表や現在入力を表示しない", () => {
    const html = renderToStaticMarkup(createElement(SummarySheet, { roomId: "test", summary: null, currentRevision: 3 }));
    expect(html).toContain("確定した内容がありません");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("印刷する");
  });
  it("現在版と一致するときは保存済みの希望・プラン・分担・概算注記を表示する", () => {
    const html = renderToStaticMarkup(createElement(SummarySheet, { roomId: "test", summary, currentRevision: 3 }));
    expect(html).toContain("確定済みプラン");
    expect(html).toContain("確定時だけの希望");
    expect(html).toContain("長女");
    expect(html).toContain("30日の月を仮定した概算");
    expect(html).toContain("食費・居住費・各種加算は含みません");
  });
  it("確定後の編集や版不明の時に現在版を確定済みと呼ばない", () => {
    for (const currentRevision of [4, null]) {
      const html = renderToStaticMarkup(createElement(SummarySheet, { roomId: "test", summary, currentRevision }));
      expect(html).toContain("未確定");
      expect(html).toContain("確定時だけの希望");
      expect(html).toContain("以前");
      expect(html).not.toContain("確定済みプラン");
      expect(html).not.toContain("現在の入力内容を下書き");
    }
  });
  it("週間ボードで確認する誘導ボタンを画面に表示し、印刷時は非表示（print:hidden）にする", () => {
    const html = renderToStaticMarkup(createElement(SummarySheet, { roomId: "test-room", summary, currentRevision: 3 }));
    expect(html).toContain("週間ボードで確認する");
    expect(html).toContain("/rooms/test-room/board");
    expect(html).toMatch(/class="[^"]*print:hidden[^"]*"[^>]*>[^<]*<a[^>]*href="\/rooms\/test-room\/board"/);
  });
});
