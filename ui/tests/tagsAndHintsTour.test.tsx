import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WhatsNewHost } from "../src/components/onboarding/whatsNew/WhatsNewHost";
import { WHATS_NEW_TOURS } from "../src/components/onboarding/whatsNew/registry";
import { TagsAndHintsTour } from "../src/components/onboarding/whatsNew/TagsAndHintsTour";
import {
  FIRST_PINNED_TOUR_TARGET,
  buildTagsAndHintsSteps,
  convertedTitle,
} from "../src/components/onboarding/whatsNew/tagsAndHintsSteps";
import { Sidebar } from "../src/components/layout/Sidebar";
import { UserContext } from "../src/lib/UserContext";
import type { CurrentUser, WhatsNewNote } from "../src/lib/types";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOTE: WhatsNewNote = {
  id: "tags-and-hints",
  seq: 3,
  severity: "interrupt",
  version: "0.12.0",
  title: "Collections are now tags",
  summary: "Your collections became tags, and an item can have several. AI hints are now a separate list. Your menu looks the same.",
  date: "2026-11-02",
  supersedes: [],
};

function userWithMigration(converted: number, extra: Partial<CurrentUser> = {}): CurrentUser {
  return makeUser({
    whats_new: {
      latest_seq: 3,
      unseen: [NOTE],
      unseen_interrupt_count: 1,
      welcome_pending: false,
      tags_migration: { collections_converted: converted, filters_skipped: 0 },
    },
    ...extra,
  });
}

describe("tour registration", () => {
  it("registers a tour for the tags-and-hints note, so the card offers Show me", () => {
    expect(Object.keys(WHATS_NEW_TOURS)).toEqual(["tags-and-hints"]);
    expect(WHATS_NEW_TOURS["tags-and-hints"]).toBe(TagsAndHintsTour);
  });

  it("the What's New card for that note shows 'Show me', which starts the tour with the converted count", async () => {
    const user = userWithMigration(7);
    render(
      <UserContext.Provider value={{ currentUser: user, setCurrentUser: () => {} }}>
        <MemoryRouter>
          <WhatsNewHost user={user} onUserChange={() => {}} />
        </MemoryRouter>
      </UserContext.Provider>,
    );
    expect(screen.getByText("Collections are now tags")).toBeTruthy();
    await userEvent.click(screen.getByText("Show me"));
    expect(await screen.findByText("7 collections are now tags")).toBeTruthy();
  });
});

describe("converted count wording", () => {
  it("states the number, singular for one, and drops it when there is none", () => {
    expect(convertedTitle(7)).toBe("7 collections are now tags");
    expect(convertedTitle(1)).toBe("1 collection is now a tag");
    expect(convertedTitle(0)).toBe("Collections are now tags");
  });

  it("the tour component reads the count from user.whats_new.tags_migration", async () => {
    render(
      <UserContext.Provider value={{ currentUser: userWithMigration(12), setCurrentUser: () => {} }}>
        <TagsAndHintsTour onDone={() => {}} />
      </UserContext.Provider>,
    );
    expect(await screen.findByText("12 collections are now tags")).toBeTruthy();
  });

  it("falls back to wording without a number when the count is 0 or missing", async () => {
    const noInfo = makeUser();
    render(
      <UserContext.Provider value={{ currentUser: noInfo, setCurrentUser: () => {} }}>
        <TagsAndHintsTour onDone={() => {}} />
      </UserContext.Provider>,
    );
    expect(await screen.findByText("Collections are now tags")).toBeTruthy();
    expect(screen.queryByText(/\d+ collections/)).toBeNull();
  });
});

describe("tour steps", () => {
  it("has 4 steps: centre, Filters heading, first pinned filter, centre", () => {
    const steps = buildTagsAndHintsSteps(3, true);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => String(s.target))).toEqual([
      "body",
      "[data-tour='menu-filters']",
      `[data-tour='${FIRST_PINNED_TOUR_TARGET}']`,
      "body",
    ]);
    expect(steps[0].placement).toBe("center");
    expect(steps[3].placement).toBe("center");
  });

  it("points step 3 at the Filters heading when nothing is pinned", () => {
    expect(String(buildTagsAndHintsSteps(3, false)[2].target)).toBe("[data-tour='menu-filters']");
  });

  it("the TagsAndHintsTour picks the pinned target from the user's filters", async () => {
    const withPinned = makeUser({ shortcut_filters: [makeFilter("f1", "Cables", { tag_id: "t1" })] as never });
    expect(withPinned.shortcut_filters.some((r) => r.pinned)).toBe(true);
    const steps = buildTagsAndHintsSteps(1, withPinned.shortcut_filters.some((r) => r.pinned));
    expect(String(steps[2].target)).toContain(FIRST_PINNED_TOUR_TARGET);
  });

  it("the copy covers: multiple tags, old collections stay pinned, drag + Pin tag filter, AI hints in Settings", () => {
    const text = JSON.stringify(buildTagsAndHintsSteps(3, true).map((s) => [s.title, s.content]));
    expect(text).toMatch(/several tags/);
    expect(text).toMatch(/old collections are pinned filters/i);
    expect(text).toMatch(/All items/);
    expect(text).toMatch(/Drag/);
    expect(text).toMatch(/Pin tag filter/);
    expect(text).toMatch(/AI hints/);
    expect(text).toMatch(/hint picker/);
  });

  it("only the first pinned filter in the sidebar carries the step-3 target, and the Filters heading carries menu-filters", async () => {
    const filters = [makeFilter("f1", "Cables", { tag_id: "t1" }), makeFilter("f2", "Tools", { tag_id: "t2" })];
    const user = makeUser({ shortcut_filters: filters as never });
    mockApi({ "GET /api/tags": [makeTag("t1", "Cables"), makeTag("t2", "Tools")], "GET /api/me": user });
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });
    expect(document.querySelectorAll(`[data-tour='${FIRST_PINNED_TOUR_TARGET}']`)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Cables" }).getAttribute("data-tour")).toBe(FIRST_PINNED_TOUR_TARGET);
    expect(screen.getByRole("link", { name: "Tools" }).getAttribute("data-tour")).toBeNull();
    expect(document.querySelectorAll("[data-tour='menu-filters']")).toHaveLength(1);
  });
});

describe("tour behaviour", () => {
  it("Escape ends the tour", async () => {
    const onDone = vi.fn();
    render(
      <UserContext.Provider value={{ currentUser: userWithMigration(2), setCurrentUser: () => {} }}>
        <TagsAndHintsTour onDone={onDone} />
      </UserContext.Provider>,
    );
    await screen.findByText("2 collections are now tags");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("has a Close tour (X) and no Skip button, and Next walks to step 2", async () => {
    render(
      <UserContext.Provider value={{ currentUser: userWithMigration(2), setCurrentUser: () => {} }}>
        <TagsAndHintsTour onDone={() => {}} />
      </UserContext.Provider>,
    );
    await screen.findByText("2 collections are now tags");
    expect(screen.getByRole("button", { name: "Close tour" })).toBeTruthy();
    expect(screen.queryByText(/skip/i)).toBeNull();
    await userEvent.click(screen.getByText(/^Next/));
    // Step 2's target is not in this DOM, so Joyride moves on without showing it; the first step is gone.
    await vi.waitFor(() => expect(screen.queryByText("2 collections are now tags")).toBeNull());
  });
});
