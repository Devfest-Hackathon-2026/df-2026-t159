// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DemoCreateButton from "./DemoCreateButton";

describe("DemoCreateButton", () => {
  afterEach(cleanup);

  it("チュートリアル付きと分かるラベルで、デモ登録画面へ進める", () => {
    render(<DemoCreateButton />);

    const link = screen.getByRole("link", { name: "デモルームを作成 チュートリアル付き" });
    expect(link).toBeTruthy();
    expect(link.getAttribute("href")).toBe("/rooms/demo-new");
  });

  it("className が渡された場合はそのクラスを適用する", () => {
    render(<DemoCreateButton className="button primary" />);

    const link = screen.getByRole("link", { name: "デモルームを作成 チュートリアル付き" });
    expect(link.className).toContain("button primary");
  });
});
