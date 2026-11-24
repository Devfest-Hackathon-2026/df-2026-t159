"use client";

import SpotlightTutorial, {
  type SpotlightTutorialStep,
} from "@/components/SpotlightTutorial";
import {
  DEMO_REGISTRATION_TUTORIAL_STEPS,
  type DemoRegistrationTutorialStepNumber,
} from "@/lib/demo-registration-tutorial";

const SPOTLIGHT_STEPS: readonly SpotlightTutorialStep[] =
  DEMO_REGISTRATION_TUTORIAL_STEPS.map((item) => ({
    id: item.primaryTargetKey,
    title: item.title,
    message: item.message,
    targetKey: item.primaryTargetKey,
    allowManualNext: item.allowManualNext,
    rawTitle: true,
  }));

const PREFILLED_NAME_STEPS = SPOTLIGHT_STEPS.map((step) =>
  step.targetKey === "son-trial-form"
    ? { ...step, message: "入力済みの名前と付き添いの可否を確認したら、「次へ」を押してください。" }
    : step,
);

export default function DemoRegistrationTutorial({
  step,
  nameReady,
  reviewPrefilledName = false,
  measureKey = 0,
  onStepChange,
  onClose,
}: {
  step: DemoRegistrationTutorialStepNumber;
  nameReady: boolean;
  reviewPrefilledName?: boolean;
  measureKey?: number;
  onStepChange: (nextStep: DemoRegistrationTutorialStepNumber) => void;
  onClose: () => void;
}) {
  return (
    <SpotlightTutorial
      steps={reviewPrefilledName ? PREFILLED_NAME_STEPS : SPOTLIGHT_STEPS}
      step={step}
      nextDisabled={step === 3 && !nameReady}
      targetAttr="data-registration-tutorial-target"
      testIdPrefix="demo-registration-tutorial"
      measureKey={measureKey}
      showBackButton={false}
      onStepChange={(nextStep) => {
        if (
          nextStep >= 1 &&
          nextStep <= DEMO_REGISTRATION_TUTORIAL_STEPS.length
        ) {
          onStepChange(nextStep as DemoRegistrationTutorialStepNumber);
        }
      }}
      onClose={onClose}
    />
  );
}
