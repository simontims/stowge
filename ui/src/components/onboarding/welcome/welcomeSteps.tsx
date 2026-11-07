import type { Step } from "react-joyride";

/** data-tour attribute values the welcome tour points at. A test checks each one still exists in
 *  the layout source, so renaming a menu item can't silently break the tour. */
export const WELCOME_TOUR_TARGETS = ["menu-filters", "nav-settings", "nav-system", "user-menu"] as const;

function target(name: (typeof WELCOME_TOUR_TARGETS)[number]): string {
  return `[data-tour='${name}']`;
}

/** Steps of the "Welcome to Stowge" tour. It always describes the product as it is today: when a
 *  release changes what's described here, update it and send existing users a What's New note. */
export function buildWelcomeSteps(isAdmin: boolean): Step[] {
  const steps: Step[] = [
    {
      target: "body",
      placement: "center",
      skipBeacon: true,
      title: "Add items fast",
      content: (
        <p className="text-sm leading-6">
          On the Items page choose <strong>Add Item</strong> and start with a photo. If an AI provider is set up,
          Stowge suggests a name and description; otherwise fill the details in yourself. The Add screen also has
          an <strong>AI hint</strong> picker, so you can tell the AI what kind of thing you are adding.
        </p>
      ),
    },
    {
      target: target("menu-filters"),
      placement: "right",
      skipBeacon: true,
      title: "Filters",
      content: (
        <p className="text-sm leading-6">
          Filters you pin sit here, one click from any page. Drag them to put the ones you use most at the top.
        </p>
      ),
    },
    {
      target: target("nav-settings"),
      placement: "right",
      skipBeacon: true,
      title: "Settings",
      content: (
        <p className="text-sm leading-6">
          Build filters here and pin them to the menu, manage <strong>Tags</strong> (they group your items, and an
          item can have several), and keep the <strong>AI hints</strong> that guide the AI.
        </p>
      ),
    },
  ];

  if (isAdmin) {
    steps.push({
      target: target("nav-system"),
      placement: "right",
      skipBeacon: true,
      title: "System",
      content: (
        <p className="text-sm leading-6">
          Admins manage <strong>Locations</strong> (Site, Area, then Location, which collapses when you only have
          one site or area), AI settings, users and backups here.
        </p>
      ),
    });
  }

  steps.push({
    target: target("user-menu"),
    placement: "bottom",
    skipBeacon: true,
    title: "Your menu",
    content: (
      <p className="text-sm leading-6">
        <strong>Release notes</strong> lists what changed in each version, and <strong>Welcome tour</strong> replays this tour.
      </p>
    ),
  });

  return steps;
}
