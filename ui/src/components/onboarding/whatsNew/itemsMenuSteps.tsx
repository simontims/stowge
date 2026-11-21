import type { Step } from "react-joyride";

/** data-tour values the "items menu" tour points at. All three sit on the desktop sidebar only. */
export const ITEMS_MENU_TOUR_TARGETS = ["menu-items", "nav-settings", "menu-collapse"] as const;

function target(name: (typeof ITEMS_MENU_TOUR_TARGETS)[number]): string {
  return `[data-tour='${name}']`;
}

/** Steps of the "Your items menu has a new layout" tour. */
export function buildItemsMenuSteps(): Step[] {
  return [
    {
      target: "body",
      placement: "center",
      skipBeacon: true,
      title: "Your items menu has a new layout",
      content: (
        <p className="text-sm leading-6">
          Everything that is about your items now sits together under <strong>ITEMS</strong>, so it is clear what
          belongs where.
        </p>
      ),
    },
    {
      target: target("menu-items"),
      placement: "right",
      skipBeacon: true,
      title: "ITEMS",
      content: (
        <p className="text-sm leading-6">
          <strong>All items</strong>, your pinned <strong>Filters</strong> and the <strong>Recycle Bin</strong> are
          all views of your items. The Recycle Bin is now a page of its own with every deleted item, instead of a
          button in Settings &gt; Tags.
        </p>
      ),
    },
    {
      target: target("nav-settings"),
      placement: "right",
      skipBeacon: true,
      title: "Settings stay in reach",
      content: (
        <p className="text-sm leading-6">
          <strong>Settings</strong> (and <strong>System</strong>, for admins) now stay at the bottom of the menu. A
          long list of filters scrolls on its own and never pushes them off the screen.
        </p>
      ),
    },
    {
      target: target("menu-collapse"),
      placement: "right",
      skipBeacon: true,
      title: "Collapse the menu",
      content: (
        <p className="text-sm leading-6">
          Use this arrow to shrink the menu to icons. Your filters stay in it; point at one to see its name.
        </p>
      ),
    },
  ];
}
