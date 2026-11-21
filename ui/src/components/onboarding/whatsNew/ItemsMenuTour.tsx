import { ErrorBoundary } from "../../ErrorBoundary";
import { Suspense, lazy, useMemo } from "react";
import { buildItemsMenuSteps } from "./itemsMenuSteps";

// react-joyride is only downloaded when the tour is opened.
const GuidedTour = lazy(() => import("../GuidedTour").then((m) => ({ default: m.GuidedTour })));

/** "Show me" tour for the What's New note about the new items menu layout. */
export function ItemsMenuTour({ onDone }: { onDone: () => void }) {
  const steps = useMemo(() => buildItemsMenuSteps(), []);
  return (
    <ErrorBoundary fallback={null} onError={onDone}>
      <Suspense fallback={null}>
        <GuidedTour run steps={steps} onFinish={onDone} />
      </Suspense>
    </ErrorBoundary>
  );
}
