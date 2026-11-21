import { ErrorBoundary } from "../../ErrorBoundary";
import { Suspense, lazy, useMemo } from "react";
import { buildWelcomeSteps } from "./welcomeSteps";

// react-joyride is only downloaded the first time the tour is started.
const GuidedTour = lazy(() => import("../GuidedTour").then((m) => ({ default: m.GuidedTour })));

interface WelcomeTourProps {
  run: boolean;
  isAdmin: boolean;
  onFinish: () => void;
}

/** The guided "Welcome to Stowge" tour (react-joyride). Runs on request only. */
export function WelcomeTour({ run, isAdmin, onFinish }: WelcomeTourProps) {
  const steps = useMemo(() => buildWelcomeSteps(isAdmin), [isAdmin]);
  if (!run) return null;
  return (
    <ErrorBoundary fallback={null} onError={onFinish}>
      <Suspense fallback={null}>
        <GuidedTour run={run} steps={steps} onFinish={onFinish} />
      </Suspense>
    </ErrorBoundary>
  );
}
