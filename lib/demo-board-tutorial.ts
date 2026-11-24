import { createRoomTutorialProgress } from "./room-tutorial-progress";
import type { DayIndex, Placement } from "./types";

export const DEMO_TRIAL_PLACEMENT_ID = "demo-daughter-sat-morning";
export const DEMO_TRIAL_DAY: DayIndex = 5;
export const DEMO_TRIAL_START_HOUR = 8;
export const DEMO_TRIAL_END_HOUR = 12;
export const DEMO_TRIAL_NOTE = "土曜の午前は長女が担当";

export type DemoBoardTutorialStepId =
  | "family-assist"
  | "place-trial"
  | "money"
  | "burden"
  | "proposals"
  | "proposal-fetch"
  | "proposal-compare"
  | "proposal-apply"
  | "confirm";

export interface DemoBoardTutorialStep {
  id: DemoBoardTutorialStepId;
  title: string;
  message: string;
  targetKey: string;
  extraTargetKeys?: readonly string[];
  fallbackTargetKey?: string;
  allowManualNext?: boolean;
  waitHint?: string;
}

export const DEMO_BOARD_TUTORIAL_STEPS: readonly DemoBoardTutorialStep[] = [
  {
    id: "family-assist",
    title: "家族の事情を確認",
    message:
      "前の画面で整理した家族の予定・希望・介護が必要な時間がここにまとまっています。左の事情を見ながら右のボードを組みます。",
    targetKey: "family-assist",
  },
  {
    id: "place-trial",
    title: "予定を1件だけ入れてみる",
    message:
      "「＋ 家族の付き添い」を土曜 8:00〜12:00 の点線枠へ**ドラッグするか、枠をタップしてください**。開いた画面で長女と時間を確認し、**保存しましょう**。",
    targetKey: "trial-pair",
    fallbackTargetKey: "weekly-board",
    allowManualNext: false,
    waitHint: "土曜 8:00〜12:00 の枠に長女の付き添いを入れると次へ進みます",
  },
  {
    id: "money",
    title: "単位数と自己負担の目安",
    message:
      "予定が揃いました。介護保険の単位数と、月の自己負担の目安が左のカードに出ます。1単位は10円で、上限を超えた分は全額自己負担になります。",
    targetKey: "status-money",
  },
  {
    id: "burden",
    title: "家族の負担",
    message:
      "家族の付き添い時間です。土曜の午前が入ったことで長女が週27時間になり、目安（週20時間）を超えて赤く表示されています。",
    targetKey: "status-burden",
  },
  {
    id: "proposals",
    title: "代替案を見る",
    message:
      "『代替案を見る』では、負担が重い人を減らし、上限内に収めた組み替え案を確認できます。",
    targetKey: "status-proposals",
    allowManualNext: false,
    waitHint: "「代替案を見る」を押してドロワーを開きましょう",
  },
  {
    id: "proposal-fetch",
    title: "代替案を取得する",
    message: "「代替案を取得する」を押すと、現在のプランと比較できる代替案が表示されます。",
    targetKey: "proposal-fetch",
    allowManualNext: false,
    waitHint: "代替案を取得すると、カードの見方を確認できます",
  },
  {
    id: "proposal-compare",
    title: "代替案を比較する",
    message:
      "今のプランと代替案を、単位数・自己負担・家族の付き添い時間で比べます。「変更の内訳を見る（12件）」を開くと、どの予定がどう変わるかも1件ずつ確認できます。",
    targetKey: "proposal-card",
  },
  {
    id: "proposal-apply",
    title: "採用する",
    message: "この案を使うには「採用する」を押してください。変更が週間ボードに反映されます。",
    targetKey: "proposal-apply",
    allowManualNext: false,
    waitHint: "採用すると週間ボードに戻ります",
  },
  {
    id: "confirm",
    title: "プランの確定",
    message:
      "注意点がすべて解消して内容が決まったら、このボタンでプランを確定します。",
    targetKey: "confirm-btn",
  },
] as const;

export interface DemoTrialExtraction {
  canonicalPlacement: Placement;
  maskedPlacements: Placement[];
  originalIndex: number;
}

/**
 * デモの「揉めるプラン」から体験対象（土曜 8:00〜12:00 長女の付き添い）を1件だけ抜いた表示用配列と、
 * 正規化・復元に使う基準データ（ルーム固有 personId 付き）を返す。
 */
export function extractDemoTrialPlacement(
  placements: readonly Placement[],
): DemoTrialExtraction | null {
  const index = placements.findIndex(
    (p) =>
      p.id === DEMO_TRIAL_PLACEMENT_ID &&
      p.day === DEMO_TRIAL_DAY &&
      p.startHour === DEMO_TRIAL_START_HOUR &&
      p.endHour === DEMO_TRIAL_END_HOUR &&
      p.kind === "family" &&
      Boolean(p.personId),
  );
  if (index === -1) return null;

  const target = placements[index];
  const canonicalPlacement: Placement = {
    id: DEMO_TRIAL_PLACEMENT_ID,
    day: DEMO_TRIAL_DAY,
    startHour: DEMO_TRIAL_START_HOUR,
    endHour: DEMO_TRIAL_END_HOUR,
    kind: "family",
    personId: target.personId,
    note: target.note ?? DEMO_TRIAL_NOTE,
  };
  const maskedPlacements = [
    ...placements.slice(0, index),
    ...placements.slice(index + 1),
  ];
  return {
    canonicalPlacement,
    maskedPlacements,
    originalIndex: index,
  };
}

/** ドラッグ／タップ先が体験ステップの対象マス（土曜 8:00〜12:00）かを判定する */
export function isValidDemoTrialTargetSlot(day: number, hour: number): boolean {
  return (
    day === DEMO_TRIAL_DAY &&
    hour >= DEMO_TRIAL_START_HOUR &&
    hour < DEMO_TRIAL_END_HOUR
  );
}

/** ポップアップ入力値が体験ステップの対象枠・種別・担当者（長女）に合致するかを判定する */
export function isValidDemoTrialPlacementInput(
  placement: Pick<Placement, "day" | "startHour" | "endHour" | "kind" | "personId">,
  expectedPersonId?: string,
): boolean {
  if (
    placement.kind !== "family" ||
    placement.day !== DEMO_TRIAL_DAY ||
    placement.startHour !== DEMO_TRIAL_START_HOUR ||
    placement.endHour !== DEMO_TRIAL_END_HOUR
  ) {
    return false;
  }
  if (expectedPersonId !== undefined && placement.personId !== expectedPersonId) {
    return false;
  }
  return true;
}

/**
 * 体験ステップ完了時に、抜いておいた基準配置を fixture の値で元の位置へ正規化して戻し、
 * troubledPlan と完全一致する配置配列を作る。
 */
export function buildNormalizedDemoTrialPlacements(
  maskedPlacements: readonly Placement[],
  canonicalPlacement: Placement,
  originalIndex = maskedPlacements.length,
): Placement[] {
  const withoutDuplicate = maskedPlacements.filter(
    (p) => p.id !== canonicalPlacement.id,
  );
  const clampedIndex = Math.max(
    0,
    Math.min(originalIndex, withoutDuplicate.length),
  );
  const normalized: Placement = {
    id: DEMO_TRIAL_PLACEMENT_ID,
    day: DEMO_TRIAL_DAY,
    startHour: DEMO_TRIAL_START_HOUR,
    endHour: DEMO_TRIAL_END_HOUR,
    kind: "family",
    personId: canonicalPlacement.personId,
    note: canonicalPlacement.note ?? DEMO_TRIAL_NOTE,
  };
  return [
    ...withoutDuplicate.slice(0, clampedIndex),
    normalized,
    ...withoutDuplicate.slice(clampedIndex),
  ];
}

export type TutorialProposalState = "fetch" | "card" | "unavailable" | "retry";

export function getDemoBoardTutorialStepNumber(
  id: DemoBoardTutorialStepId,
): number {
  return DEMO_BOARD_TUTORIAL_STEPS.findIndex(step => step.id === id) + 1;
}

export function isDrawerTutorialStepId(
  id: DemoBoardTutorialStepId | undefined,
): boolean {
  return id === "proposal-fetch" || id === "proposal-compare" || id === "proposal-apply";
}

export function getDemoBoardTutorialSteps(
  trialCompleted: boolean,
  proposalState: TutorialProposalState,
  replay = false,
  hasTrialTarget = true,
): readonly DemoBoardTutorialStep[] {
  return DEMO_BOARD_TUTORIAL_STEPS.map(step => {
    if (replay && !hasTrialTarget && step.id === "place-trial") {
      return { ...step, targetKey: "weekly-board", extraTargetKeys: [], allowManualNext: true,
        message: "週間ボードで予定を確認しましょう。空いている枠をタップすると予定を追加できます。" };
    }
    if (replay && step.id === "burden") {
      return { ...step, message: "家族ごとの付き添い時間を確認できます。週20時間を超える人は赤く表示されます。" };
    }
    if (step.id === "place-trial" && trialCompleted) return { ...step, allowManualNext: true };
    if (step.id === "proposal-fetch" && proposalState === "card") {
      return { ...step, allowManualNext: true };
    }
    if (!replay && proposalState === "retry" && step.id === "proposal-fetch") {
      return { ...step, message: "代替案を取得できませんでした。「代替案を取得する」で再試行できます。見本からやり直す場合は、ルームトップへ戻ってください。",
        waitHint: "代替案を取得すると、カードの見方を確認できます。" };
    }
    if (!replay && proposalState === "unavailable" && step.id === "proposal-fetch") {
      return { ...step, targetKey: "proposal-recovery", fallbackTargetKey: "proposal-fetch",
        message: "見本と内容が異なるため、固定の代替案を取得できません。ルームトップで「デモをリセット」すると、見本の状態からやり直せます。",
        waitHint: "ルームトップへ戻るリンクを押してください。" };
    }
    if (replay && proposalState === "unavailable" && step.id === "proposal-fetch") {
      return { ...step, allowManualNext: true,
        message: "このプランは編集済みのため、見本の代替案は表示されません。代替案がある場合はカードで単位数・自己負担・付き添い時間の変化を比較できます。" };
    }
    if (replay && proposalState === "unavailable" && step.id === "proposal-compare") {
      return { ...step, allowManualNext: true, fallbackTargetKey: "proposal-fetch" };
    }
    if (replay && proposalState === "unavailable" && step.id === "proposal-apply") {
      return { ...step, allowManualNext: true, fallbackTargetKey: "proposal-fetch",
        message: "使いたい案のカードで「採用する」を押すと、変更が週間ボードに保存されます。見直しだけなら、そのまま案内を進められます。" };
    }
    return step;
  });
}

export const DEMO_BOARD_TUTORIAL_STORAGE_PREFIX =
  "carepact:demo_board_tutorial_done:";

export const boardTutorialProgress = createRoomTutorialProgress(DEMO_BOARD_TUTORIAL_STORAGE_PREFIX);
export const drawerTutorialProgress = createRoomTutorialProgress("carepact:demo_proposals_tutorial_done:");

export const isDemoBoardTutorialDone = boardTutorialProgress.isDone;
export const markDemoBoardTutorialDone = boardTutorialProgress.finish;
export const clearDemoBoardTutorialDone = boardTutorialProgress.clear;
