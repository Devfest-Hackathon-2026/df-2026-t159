"use client";

import SpotlightTutorial from "@/components/SpotlightTutorial";
import {
  getDemoBoardTutorialSteps,
  isDrawerTutorialStepId,
  type TutorialProposalState,
} from "@/lib/demo-board-tutorial";

export default function DemoBoardTutorial({
  step,
  isDesktop,
  trialCompleted = false,
  proposalState = "fetch",
  replay = false,
  hasTrialTarget = true,
  feedbackMessage = null,
  measureKey = 0,
  onStepChange,
  onClose,
}: {
  step: number;
  isDesktop: boolean;
  trialCompleted?: boolean;
  proposalState?: TutorialProposalState;
  replay?: boolean;
  hasTrialTarget?: boolean;
  feedbackMessage?: string | null;
  measureKey?: number;
  onStepChange: (nextStep: number) => void;
  onClose: () => void;
}) {
  const steps = getDemoBoardTutorialSteps(trialCompleted, proposalState, replay, hasTrialTarget);
  const currentStep = steps[Math.max(1, Math.min(step, steps.length)) - 1];

  return (
    <SpotlightTutorial
      steps={steps}
      step={step}
      targetAttr={
        isDrawerTutorialStepId(currentStep?.id)
          ? "data-proposals-tutorial-target"
          : "data-board-tutorial-target"
      }
      testIdPrefix="demo-board-tutorial"
      measureKey={(isDesktop ? 1 : 0) + measureKey * 2}
      feedbackMessage={feedbackMessage}
      showBackButton={step < steps.length}
      onStepChange={onStepChange}
      onClose={onClose}
    />
  );
}
