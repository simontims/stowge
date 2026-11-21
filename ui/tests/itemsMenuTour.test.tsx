import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Step } from "react-joyride";
import { WhatsNewHost } from "../src/components/onboarding/whatsNew/WhatsNewHost";
import { WHATS_NEW_TOURS } from "../src/components/onboarding/whatsNew/registry";
import { ItemsMenuTour } from "../src/components/onboarding/whatsNew/ItemsMenuTour";
import { ITEMS_MENU_TOUR_TARGETS, buildItemsMenuSteps } from "../src/components/onboarding/whatsNew/itemsMenuSteps";
import { buildWelcomeSteps } from "../src/components/onboarding/welcome/welcomeSteps";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { UserContext } from "../src/lib/UserContext";
import type { WhatsNewNote } from "../src/lib/types";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTE: WhatsNewNote = {
  id: "items-menu",
  seq: 5,
  severity: "interrupt",
  version: "0.12.1",
  title: "Your items menu has a new layout",
  summary: "All items, your Filters and the Recycle Bin now sit together under ITEMS.",
  date: "2026-11-21",
  supersedes: [],
};

function text(step: Step): string {
  return JSON.stringify(step.content, (_k, v) => (typeof v === "symbol" ? undefined : v));
}

describe("items menu tour", () => {
  it("is registered for the items-menu note, so the card offers Show me", () => {
    expect(WHATS_NEW_TOURS["items-menu"]).toBe(ItemsMenuTour);
  });

  it("the What's New card shows Show me for the note and starts the tour", async () => {
    const user = makeUser({
      whats_new: { latest_seq: 5, unseen: [NOTE], unseen_interrupt_count: 1, welcome_pending: false },
    });
    mockApi({ "GET /api/tags": [], "GET /api/me": user });
    render(
      <UserContext.Provider value={{ currentUser: user, setCurrentUser: () => {} }}>
        <MemoryRouter>
          <WhatsNewHost user={user} onUserChange={() => {}} />
        </MemoryRouter>
      </UserContext.Provider>,
    );
    expect(screen.getByText("Your items menu has a new layout")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(await screen.findByText(/sits together under|sit together under/i, undefined, { timeout: 4000 })).toBeTruthy();
  });

  it("has a centred intro, then one step per menu target, in menu order", () => {
    const steps = buildItemsMenuSteps();
    expect(steps.map((s) => s.target)).toEqual([
      "body",
      "[data-tour='menu-items']",
      "[data-tour='nav-settings']",
      "[data-tour='menu-collapse']",
    ]);
    expect(steps[0].placement).toBe("center");
    expect(steps.every((s) => s.skipBeacon)).toBe(true);
    expect(text(steps[1])).toContain("Recycle Bin");
    expect(text(steps[2])).toContain("bottom of the menu");
    expect(text(steps[3])).toContain("icons");
  });

  it("every target exists exactly once in the desktop sidebar, and none in the drawer", async () => {
    const user = makeUser({ role: "admin", shortcut_filters: [makeFilter("f1", "Attic", { tag_id: "t1" })] as never });
    mockApi({ "GET /api/tags": [makeTag("t1", "Attic")], "GET /api/me": user });
    const { container, unmount } = renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    for (const name of ITEMS_MENU_TOUR_TARGETS) {
      expect(container.querySelectorAll(`[data-tour='${name}']`), name).toHaveLength(1);
    }
    unmount();
    const drawer = renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user, ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    for (const name of ITEMS_MENU_TOUR_TARGETS) {
      expect(drawer.container.querySelectorAll(`[data-tour='${name}']`), name).toHaveLength(0);
    }
  });

  it("the ITEMS target also exists in the collapsed rail (as the rule), so the tour never loses it", async () => {
    const user = makeUser({ role: "admin" });
    mockApi({ "GET /api/tags": [], "GET /api/me": user });
    const { container } = renderWithUser(<Sidebar collapsed onToggleCollapse={() => {}} />, user, ["/items"]);
    await screen.findByRole("link", { name: "Add Item" });
    expect(container.querySelectorAll("[data-tour='menu-items']")).toHaveLength(1);
  });

  it("the welcome tour describes the grouped menu", () => {
    const filters = buildWelcomeSteps(true).find((s) => s.title === "Filters") as Step;
    expect(text(filters)).toContain("ITEMS");
    expect(text(filters)).toContain("Recycle Bin");
  });
});
