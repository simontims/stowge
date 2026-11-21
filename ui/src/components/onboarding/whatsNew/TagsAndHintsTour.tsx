import { ErrorBoundary } from "../../ErrorBoundary";
import { Suspense, lazy, useMemo } from "react";
import { useCurrentUser } from "../../../lib/UserContext";
import { buildTagsAndHintsSteps } from "./tagsAndHintsSteps";

// react-joyride is only downloaded when the tour is opened.
const GuidedTour = lazy(() => import("../GuidedTour").then((m) => ({ default: m.GuidedTour })));

/** "Show me" tour for the What's New note about collections becoming tags. */
export function TagsAndHintsTour({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser();
  const converted = user.whats_new?.tags_migration?.collections_converted ?? 0;
  const hasPinnedFilter = (user.shortcut_filters ?? []).some((row) => row.pinned);
  const steps = useMemo(() => buildTagsAndHintsSteps(converted, hasPinnedFilter), [converted, hasPinnedFilter]);
  return (
    <ErrorBoundary fallback={null} onError={onDone}>
      <Suspense fallback={null}>
        <GuidedTour run steps={steps} onFinish={onDone} />
      </Suspense>
    </ErrorBoundary>
  );
}
