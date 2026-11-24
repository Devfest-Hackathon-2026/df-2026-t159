import { describe, expect, it } from "vitest";
import {
  DEMO_BOARD_TUTORIAL_STEPS,
  getDemoBoardTutorialStepNumber,
  getDemoBoardTutorialSteps,
  isDrawerTutorialStepId,
} from "./demo-board-tutorial";

describe("demo-board-tutorial", () => {
  it("proposal-fetch の直後・proposal-apply の直前に proposal-compare ステップを持つ", () => {
    const ids = DEMO_BOARD_TUTORIAL_STEPS.map((s) => s.id);
    expect(ids).toEqual(["family-assist", "place-trial", "money", "burden", "proposals", "proposal-fetch", "proposal-compare", "proposal-apply", "confirm"]);
    const fetchIdx = ids.indexOf("proposal-fetch");
    const compareIdx = ids.indexOf("proposal-compare");
    const applyIdx = ids.indexOf("proposal-apply");

    expect(fetchIdx).toBeGreaterThan(-1);
    expect(compareIdx).toBe(fetchIdx + 1);
    expect(applyIdx).toBe(compareIdx + 1);

    const compareStep = DEMO_BOARD_TUTORIAL_STEPS[compareIdx];
    expect(compareStep).toEqual({
      id: "proposal-compare",
      title: "代替案を比較する",
      message:
        "今のプランと代替案を、単位数・自己負担・家族の付き添い時間で比べます。「変更の内訳を見る（12件）」を開くと、どの予定がどう変わるかも1件ずつ確認できます。",
      targetKey: "proposal-card",
    });
    expect(compareStep.allowManualNext).toBeUndefined();
    expect(getDemoBoardTutorialStepNumber("proposal-compare")).toBe(compareIdx + 1);
    expect(isDrawerTutorialStepId("proposal-fetch")).toBe(true);
    expect(isDrawerTutorialStepId("proposal-compare")).toBe(true);
    expect(isDrawerTutorialStepId("proposal-apply")).toBe(true);
    expect(isDrawerTutorialStepId("proposals")).toBe(false);
    expect(isDrawerTutorialStepId("confirm")).toBe(false);
  });

  it("proposalState=card でも proposal-fetch は取得ステップのまま保ち、戻る操作後の手動進行のみ許可する", () => {
    const steps = getDemoBoardTutorialSteps(false, "card");
    const fetchStep = steps.find((s) => s.id === "proposal-fetch")!;
    const compareStep = steps.find((s) => s.id === "proposal-compare")!;

    expect(fetchStep.targetKey).toBe("proposal-fetch");
    expect(fetchStep.title).toBe("代替案を取得する");
    expect(fetchStep.allowManualNext).toBe(true);

    expect(compareStep.targetKey).toBe("proposal-card");
    expect(compareStep.title).toBe("代替案を比較する");
    expect(compareStep.allowManualNext).toBeUndefined();
  });

  it("通常モードの retry / unavailable 分岐は proposal-fetch 側に残る", () => {
    const retrySteps = getDemoBoardTutorialSteps(false, "retry", false);
    const retryFetch = retrySteps.find((s) => s.id === "proposal-fetch")!;
    expect(retryFetch.allowManualNext).toBe(false);
    expect(retryFetch.message).toContain("再試行できます");

    const unavailableSteps = getDemoBoardTutorialSteps(false, "unavailable", false);
    const unavailableFetch = unavailableSteps.find((s) => s.id === "proposal-fetch")!;
    expect(unavailableFetch.allowManualNext).toBe(false);
    expect(unavailableFetch.targetKey).toBe("proposal-recovery");
    expect(unavailableFetch.fallbackTargetKey).toBe("proposal-fetch");
  });

  it("replay モードで unavailable のときも proposal-fetch / proposal-compare / proposal-apply を手動で進められる", () => {
    const steps = getDemoBoardTutorialSteps(false, "unavailable", true);
    const fetchStep = steps.find((s) => s.id === "proposal-fetch")!;
    const compareStep = steps.find((s) => s.id === "proposal-compare")!;
    const applyStep = steps.find((s) => s.id === "proposal-apply")!;

    expect(fetchStep.allowManualNext).toBe(true);
    expect(fetchStep.message).toContain("このプランは編集済み");

    expect(compareStep.allowManualNext).toBe(true);
    expect(compareStep.fallbackTargetKey).toBe("proposal-fetch");

    expect(applyStep.allowManualNext).toBe(true);
    expect(applyStep.fallbackTargetKey).toBe("proposal-fetch");
  });
});
