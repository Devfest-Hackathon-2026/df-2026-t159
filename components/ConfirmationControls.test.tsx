// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmPlanButton, ConfirmationBlockers } from "./ConfirmationControls";
import { mockSnapshot } from "@/lib/mock";
import { demoFixture } from "@/lib/demo-fixture";

afterEach(cleanup);

it("ok=trueでも判定不能項目が残ると確定を無効にして理由を示す", () => {
  const snapshot = { ...mockSnapshot, unknowns: [] };
  const validation = { ...demoFixture.acceptedPlan.expectedValidationResult, validationErrors: [{ code: "missingCareWindows" as const, reason: "支援が必要な時間が未入力" }] };
  const onConfirm = vi.fn();
  render(<><ConfirmPlanButton snapshot={snapshot} validation={validation} canEdit busy={false} onConfirm={onConfirm} describedBy="reasons" />
    <ConfirmationBlockers snapshot={snapshot} validation={validation} canEdit roomId="test" id="reasons" /></>);
  const button = screen.getByRole("button", { name: "このプランで確定する" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-describedby")).toBe("reasons");
  expect(screen.getByText(/計算・判定できない項目が残っています/)).toBeTruthy();
  fireEvent.click(button);
  expect(onConfirm).not.toHaveBeenCalled();
});
