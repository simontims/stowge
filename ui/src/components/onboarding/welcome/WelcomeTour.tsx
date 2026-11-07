import { useMemo } from "react";
import { GuidedTour } from "../GuidedTour";
import { buildWelcomeSteps } from "./welcomeSteps";

interface WelcomeTourProps {
  run: boolean;
  isAdmin: boolean;
  onFinish: () => void;
}

/** The guided "Welcome to Stowge" tour (react-joyride). Runs on request only. */
export function WelcomeTour({ run, isAdmin, onFinish }: WelcomeTourProps) {
  const steps = useMemo(() => buildWelcomeSteps(isAdmin), [isAdmin]);
  return <GuidedTour run={run} steps={steps} onFinish={onFinish} />;
}
