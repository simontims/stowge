import type { Step } from "react-joyride";

/** data-tour value on the first pinned filter in the sidebar. */
export const FIRST_PINNED_TOUR_TARGET = "pinned-filter-first";

/** Title of the first step: states how many collections were converted, or skips the number when
 *  there is none to report (a database that never had collections). */
export function convertedTitle(converted: number): string {
  if (converted <= 0) return "Collections are now tags";
  if (converted === 1) return "1 collection is now a tag";
  return `${converted} collections are now tags`;
}

/** Steps of the "Collections are now tags" tour. */
export function buildTagsAndHintsSteps(converted: number, hasPinnedFilter: boolean): Step[] {
  return [
    {
      target: "body",
      placement: "center",
      skipBeacon: true,
      title: convertedTitle(converted),
      content: (
        <p className="text-sm leading-6">
          Everything that was in a collection now has that tag. An item can have several tags, so you can group
          things more than one way.
        </p>
      ),
    },
    {
      target: "[data-tour='menu-filters']",
      placement: "right",
      skipBeacon: true,
      title: "Your pinned filters",
      content: (
        <p className="text-sm leading-6">
          Your old collections are pinned filters under <strong>Filters</strong>, in the order you had them. <strong>Add Item</strong> and <strong>All items</strong> now sit above them.
        </p>
      ),
    },
    {
      target: hasPinnedFilter ? `[data-tour='${FIRST_PINNED_TOUR_TARGET}']` : "[data-tour='menu-filters']",
      placement: "right",
      skipBeacon: true,
      title: "Reorder and add",
      content: (
        <p className="text-sm leading-6">
          Drag a pinned filter to reorder the list. To add more, open <strong>Settings &gt; Tags</strong> and choose <strong>Pin tag filter</strong>.
        </p>
      ),
    },
    {
      target: "body",
      placement: "center",
      skipBeacon: true,
      title: "AI hints are a separate list",
      content: (
        <p className="text-sm leading-6">
          Hints for the AI now live in <strong>Settings &gt; AI hints</strong>. The Add screen has a hint picker and
          remembers your last choice.
        </p>
      ),
    },
  ];
}
