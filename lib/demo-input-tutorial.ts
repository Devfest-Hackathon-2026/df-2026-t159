import type { DayIndex } from "./types";

export type DemoInputTutorialStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface DemoInputTutorialStep {
  step: DemoInputTutorialStepNumber;
  title: string;
  message: string;
  targetKeys: readonly string[];
  primaryTargetKey: string;
  allowManualNext: boolean;
  isFinal?: boolean;
}

export const DEMO_INPUT_TUTORIAL_STEPS: readonly DemoInputTutorialStep[] = [
  {
    step: 1,
    title: "ステップ 1 / 8：退院書類の写真を見る",
    message: "退院時に受け取った書類の写真をここに添えます。佐藤家の退院時サマリーを1枚用意しました。",
    targetKeys: ["documents-section"],
    primaryTargetKey: "documents-section",
    allowManualNext: true,
  },
  {
    step: 2,
    title: "ステップ 2 / 8：家族の事情メモを読む",
    message: "誰がいつ付き添えるか、家族が何を希望しているかをメモにします。佐藤家のメモを読んだら「次へ」を押してください。",
    targetKeys: ["memo-section"],
    primaryTargetKey: "memo-section",
    allowManualNext: true,
  },
  {
    step: 3,
    title: "ステップ 3 / 8：AIで条件を整理する",
    message:
      "『家族の事情メモから条件・希望の下書きを作る（AI）』を押してください。",
    targetKeys: ["ai-structure-btn"],
    primaryTargetKey: "ai-structure-btn",
    allowManualNext: false,
  },
  {
    step: 4,
    title: "ステップ 4 / 8：整理された条件カードを確認",
    message:
      "書類とメモが、条件と希望のカードに反映されました。家族が付き添えない時間や、本人・家族の希望を確認してください。案内が終われば、カードは修正・削除もできます。",
    targetKeys: ["condition-cards"],
    primaryTargetKey: "condition-cards",
    allowManualNext: true,
  },
  {
    step: 5,
    title: "ステップ 5 / 8：負担割合を確認する",
    message:
      "サービスを使ったとき、費用のうち家族が払う分の割合です。あとで自己負担額を計算するときに使います。佐藤家の見本では1割になっています。",
    targetKeys: ["copay-rate"],
    primaryTargetKey: "copay-rate",
    allowManualNext: true,
  },
  {
    step: 6,
    title: "ステップ 6 / 8：土・日の時間帯を追加する",
    message:
      "お父さんに見守りや介助が必要な時間帯です。平日と土日の8〜12時は入力済みです。足りない時間帯は、曜日と時間を選んでこのように追加できます。試しに土日の17〜21時を入れてあるので、**『＋ まとめて追加』を押してみてください**。",
    targetKeys: ["care-windows"],
    primaryTargetKey: "care-windows",
    allowManualNext: false,
  },
  {
    step: 7,
    title: "ステップ 7 / 8：入力内容を保存する",
    message:
      "**『条件・時間帯・負担割合をまとめて保存する』を押してください。**",
    targetKeys: ["save-btn"],
    primaryTargetKey: "save-btn",
    allowManualNext: false,
  },
  {
    step: 8,
    title: "ステップ 8 / 8：週間ボードへ進む",
    message:
      "保存できました。**『次へ（週間ボードへ進む）』を押して**、介護サービスと家族の付き添いを組み合わせてみましょう。",
    targetKeys: ["board-link"],
    primaryTargetKey: "board-link",
    allowManualNext: false,
    isFinal: true,
  },
] as const;

export function getDemoInputTutorialStep(
  step: DemoInputTutorialStepNumber,
): DemoInputTutorialStep {
  return DEMO_INPUT_TUTORIAL_STEPS[step - 1];
}

export function hasWeekendDaysSelected(days: readonly DayIndex[]): boolean {
  return days.length === 2 && days.includes(5) && days.includes(6);
}

export const DEMO_INPUT_TUTORIAL_STORAGE_PREFIX =
  "carepact:demo_input_tutorial_done:";

// 未訪問はキーなし。0 は開始済み・未完了、1 は従来と共通の完了値。
type TutorialStatus = "0" | "1";
const memoryStatus = new Map<string, TutorialStatus>();

function readStatus(roomId: string): TutorialStatus | undefined {
  if (memoryStatus.has(roomId)) return memoryStatus.get(roomId);
  try {
    const value = window.localStorage.getItem(`${DEMO_INPUT_TUTORIAL_STORAGE_PREFIX}${roomId}`);
    if (value === "0" || value === "1") return value;
  } catch {
    // 保存できない環境でも、このタブでの開始・終了は記録する。
  }
  return undefined;
}

function writeStatus(roomId: string, value: TutorialStatus): void {
  try {
    window.localStorage.setItem(`${DEMO_INPUT_TUTORIAL_STORAGE_PREFIX}${roomId}`, value);
    memoryStatus.delete(roomId);
  } catch {
    memoryStatus.set(roomId, value);
  }
}

export function hasSeenDemoInputTutorial(roomId: string): boolean {
  return readStatus(roomId) !== undefined;
}

export function markDemoInputTutorialStarted(roomId: string): void {
  writeStatus(roomId, "0");
}

export function isDemoInputTutorialDone(roomId: string): boolean {
  return readStatus(roomId) === "1";
}

export function markDemoInputTutorialDone(roomId: string): void {
  writeStatus(roomId, "1");
}

export function clearDemoInputTutorialDone(roomId?: string): void {
  if (roomId !== undefined) {
    memoryStatus.delete(roomId);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(
          `${DEMO_INPUT_TUTORIAL_STORAGE_PREFIX}${roomId}`,
        );
      } catch {
        // ignore
      }
    }
    return;
  }
  memoryStatus.clear();
  if (typeof window !== "undefined") {
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(DEMO_INPUT_TUTORIAL_STORAGE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        window.localStorage.removeItem(k);
      }
    } catch {
      // ignore
    }
  }
}
