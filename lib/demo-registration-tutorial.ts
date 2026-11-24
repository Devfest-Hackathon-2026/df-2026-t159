export type DemoRegistrationTutorialStepNumber = 1 | 2 | 3 | 4;

export interface DemoRegistrationTutorialStep {
  step: DemoRegistrationTutorialStepNumber;
  title: string;
  message: string;
  targetKeys: readonly string[];
  primaryTargetKey: string;
  allowManualNext: boolean;
  isFinal?: boolean;
}

export const DEMO_REGISTRATION_TUTORIAL_STEPS: readonly DemoRegistrationTutorialStep[] =
  [
    {
      step: 1,
      title: "ステップ 1 / 4：ルーム名",
      message:
        "ルーム名は任意で設定できます。最初から『デモルーム（佐藤家）』が入っています。変えたい場合は書き換えてください。",
      targetKeys: ["room-name"],
      primaryTargetKey: "room-name",
      allowManualNext: true,
    },
    {
      step: 2,
      title: "ステップ 2 / 4：家族の一覧",
      message:
        "このルームでは、介護を受ける父と、付き添いができる家族が登場します。まず3人が登録済みです。",
      targetKeys: ["family-list"],
      primaryTargetKey: "family-list",
      allowManualNext: true,
    },
    {
      step: 3,
      title: "ステップ 3 / 4：長男の試し登録",
      message:
        "最後の1人、長男を登録してみましょう。名前を入力して、『付き添いができる』を選んでください。",
      targetKeys: ["son-trial-form"],
      primaryTargetKey: "son-trial-form",
      allowManualNext: true,
    },
    {
      step: 4,
      title: "ステップ 4 / 4：作成",
      message: "『この内容でデモルームを作る』を押すと、デモが始まります。",
      targetKeys: ["create-btn"],
      primaryTargetKey: "create-btn",
      allowManualNext: false,
      isFinal: true,
    },
  ] as const;

export function getDemoRegistrationTutorialStep(
  step: DemoRegistrationTutorialStepNumber,
): DemoRegistrationTutorialStep {
  return DEMO_REGISTRATION_TUTORIAL_STEPS[step - 1];
}

export const DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY =
  "carepact:demo_registration_tutorial_done";

let memoryDone = false;

export function isDemoRegistrationTutorialDone(): boolean {
  if (memoryDone) {
    return true;
  }
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const done =
      window.localStorage.getItem(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY) === "1";
    if (done) {
      memoryDone = true;
    }
    return done;
  } catch {
    return false;
  }
}

export function markDemoRegistrationTutorialDone(): void {
  memoryDone = true;
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY, "1");
  } catch {
    // localStorage が使えない環境ではメモリ保持のみ
  }
}

export function clearDemoRegistrationTutorialDone(): void {
  memoryDone = false;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DEMO_REGISTRATION_TUTORIAL_STORAGE_KEY);
  } catch {
    // localStorage が使えない環境ではメモリのフラグのみリセットする。
  }
}
