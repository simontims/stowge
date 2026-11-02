import { useMemo } from "react";
import { useCurrentUser } from "../../../lib/UserContext";
import { GuidedTour } from "../GuidedTour";
import { buildTagsAndHintsSteps } from "./tagsAndHintsSteps";

/** "Show me" tour for the What's New note about collections becoming tags. */
export function TagsAndHintsTour({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser();
  const converted = user.whats_new?.tags_migration?.collections_converted ?? 0;
  const hasPinnedFilter = (user.shortcut_filters ?? []).some((row) => row.pinned);
  const steps = useMemo(() => buildTagsAndHintsSteps(converted, hasPinnedFilter), [converted, hasPinnedFilter]);
  return <GuidedTour run steps={steps} onFinish={onDone} />;
}
