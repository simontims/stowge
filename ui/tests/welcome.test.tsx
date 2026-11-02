import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WelcomeModal } from "../src/components/onboarding/welcome/WelcomeModal";
import { WELCOME_TOUR_TARGETS, buildWelcomeSteps } from "../src/components/onboarding/welcome/welcomeSteps";

afterEach(cleanup);

describe("WelcomeModal", () => {
  it("is a dialog titled Welcome to Stowge with a short explanation (tags, not collections)", () => {
    render(<WelcomeModal onTakeTour={() => {}} onClose={() => {}} />);
    expect(screen.queryByText(/collections/i)).toBeNull();
    expect(screen.getByText(/tag them/)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Welcome to Stowge" })).toBeTruthy();
    expect(screen.getByText(/keeps track of what you own/)).toBeTruthy();
  });

  it("'Take the tour' and 'Close' call their own handlers", async () => {
    const onTakeTour = vi.fn();
    const onClose = vi.fn();
    render(<WelcomeModal onTakeTour={onTakeTour} onClose={onClose} />);

    await userEvent.click(screen.getByText("Take the tour"));
    expect(onTakeTour).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("welcome tour steps", () => {
  it("admins get the System step, other users do not", () => {
    const targets = (isAdmin: boolean) => buildWelcomeSteps(isAdmin).map((s) => String(s.target));
    expect(targets(true)).toContain("[data-tour='nav-system']");
    expect(targets(false)).not.toContain("[data-tour='nav-system']");
  });

  it("starts and ends with steps that can always be shown", () => {
    const steps = buildWelcomeSteps(false);
    expect(steps[0].target).toBe("body");
    expect(String(steps[steps.length - 1].target)).toBe("[data-tour='user-menu']");
  });

  it("the Tags step is built on the renamed nav-tags target (nav-collections is gone)", () => {
    expect(WELCOME_TOUR_TARGETS).toContain("nav-tags");
    expect([...WELCOME_TOUR_TARGETS]).not.toContain("nav-collections");
    const steps = buildWelcomeSteps(false);
    expect(steps.map((s) => String(s.target))).toContain("[data-tour='nav-tags']");
    expect(steps.map((s) => String(s.title))).toContain("Tags");
    expect(steps.map((s) => String(s.title))).not.toContain("Collections");
  });

  it("the welcome copy mentions tags and the AI hint picker on the Add screen", () => {
    const text = JSON.stringify(buildWelcomeSteps(true).map((s) => s.content));
    expect(text).toMatch(/an item can have several/);
    expect(text).toMatch(/AI hint/);
    expect(text).not.toMatch(/ollection/);
  });

  it("every element the tour points at still exists in the layout source (stops the tour going stale)", () => {
    const layout = ["Sidebar.tsx", "Topbar.tsx"]
      .map((file) => readFileSync(resolve(__dirname, "../src/components/layout", file), "utf8"))
      .join("\n");
    const nav = readFileSync(resolve(__dirname, "../src/config/nav.ts"), "utf8");
    for (const name of WELCOME_TOUR_TARGETS) {
      if (name.startsWith("nav-")) {
        // Sidebar builds data-tour from the route: nav-<route without the slash>.
        expect(layout).toContain("data-tour={`nav-${item.route.replace(\"/\", \"\")}`}");
        expect(nav).toContain(`route: "/${name.slice(4)}"`);
      } else {
        expect(layout).toContain(`data-tour="${name}"`);
      }
    }
    const used = buildWelcomeSteps(true).map((s) => String(s.target));
    for (const name of WELCOME_TOUR_TARGETS) expect(used).toContain(`[data-tour='${name}']`);
  });
});
