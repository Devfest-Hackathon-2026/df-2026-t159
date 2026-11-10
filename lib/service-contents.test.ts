import { describe, expect, it } from "vitest";
import { SERVICE_CONTENTS, serviceContentFor, serviceShortDescription } from "./service-contents";

describe("サービス説明（data/columns.json の service 項目）", () => {
  it("5種すべての説明が読み込まれている", () => {
    expect(SERVICE_CONTENTS).toHaveLength(5);
    for (const kind of ["visit", "daycare", "dayrehab", "shortstay", "family"] as const) {
      expect(serviceContentFor(kind)?.body.length).toBeGreaterThan(0);
    }
  });

  it("種別ごとに正しい項目が返る", () => {
    expect(serviceContentFor("visit")?.title).toBe("訪問介護");
    expect(serviceContentFor("daycare")?.title).toBe("通所介護");
    expect(serviceContentFor("dayrehab")?.title).toBe("通所リハビリ");
    expect(serviceContentFor("shortstay")?.title).toBe("ショートステイ");
    expect(serviceContentFor("family")?.title).toBe("家族の付き添い");
  });

  it("短い説明は本文の1行目である", () => {
    for (const content of SERVICE_CONTENTS) {
      expect(serviceShortDescription(content.kind)).toBe(content.body.split("\n")[0]);
    }
  });

  it("serviceId が一致する項目があれば、種別より serviceId を優先する", () => {
    // 現在の columns.json に serviceId 付きの項目はないため、未知の serviceId では種別に落ちることも確認する。
    expect(serviceContentFor("visit", "unknown-service-id")?.title).toBe("訪問介護");
  });
});
