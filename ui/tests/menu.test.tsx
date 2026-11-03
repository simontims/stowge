import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { topNavItems } from "../src/config/nav";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TAGS = [makeTag("t1", "Cables", { icon: "cable" }), makeTag("t2", "Tools")];
const FILTERS = [
  makeFilter("f1", "Cables", { tag_id: "t1" }),
  makeFilter("f2", "Tools", { tag_id: "t2" }),
  makeFilter("f3", "Hidden", { pinned: false }),
  makeFilter("f4", "Drafts", { statuses: ["draft"] }),
];

function api(filters: unknown[] = FILTERS) {
  const user = makeUser({ shortcut_filters: filters as never });
  return {
    user,
    mock: mockApi({ "GET /api/tags": TAGS, "GET /api/me": user, "PATCH /api/me": user }),
  };
}

function pinnedNames() {
  return within(screen.getByRole("list", { name: "Pinned filters" }))
    .getAllByRole("link")
    .map((a) => a.textContent);
}

function dataTransfer() {
  const store: Record<string, string> = {};
  return {
    effectAllowed: "",
    dropEffect: "",
    setData: (k: string, v: string) => {
      store[k] = v;
    },
    getData: (k: string) => store[k] ?? "",
  };
}

/** jsdom drag events carry no clientY, so set it on the event the way a browser would. */
function dragWithY(type: "dragOver" | "drop", el: Element, dt: unknown, clientY: number) {
  const event = createEvent[type](el, { dataTransfer: dt });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(el, event);
}

describe("menu entries", () => {
  it("has a Tags entry and no Collections entry", () => {
    expect(topNavItems.map((i) => [i.label, i.route])).toEqual([["Tags", "/tags"]]);
  });
});

describe("Sidebar", () => {
  it("lists the Tags link, then the pinned filters as one ordered list, under a Filters heading", async () => {
    const { user } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/tags"]);
    await screen.findByRole("list", { name: "Pinned filters" });

    expect(pinnedNames()).toEqual(["Cables", "Tools", "Drafts"]);
    expect(screen.queryByText("Shortcuts")).toBeNull();
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.queryByText("Collections")).toBeNull();

    const tagsLink = screen.getByRole("link", { name: "Tags" });
    expect(tagsLink.getAttribute("data-tour")).toBe("nav-tags");
    const list = screen.getByRole("list", { name: "Pinned filters" });
    // The list sits directly under the Tags entry.
    expect(tagsLink.parentElement?.contains(list)).toBe(true);
  });

  it("links a tag filter to /items?tag=<name> and marks it active on that URL", async () => {
    const { user } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/items?tag=Tools"]);
    await screen.findByRole("list", { name: "Pinned filters" });
    expect(screen.getByRole("link", { name: "Tools" }).getAttribute("href")).toBe("/items?tag=Tools");
    expect(screen.getByRole("link", { name: "Tools" }).className).toContain("text-neutral-100");
    expect(screen.getByRole("link", { name: "Cables" }).className).not.toContain("text-neutral-100");
  });

  it("shows no list when nothing is pinned", async () => {
    const { user, mock } = api([makeFilter("f3", "Hidden", { pinned: false })]);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await waitFor(() => expect(mock.find("GET", "/api/me").length).toBeGreaterThan(0));
    expect(screen.queryByRole("list", { name: "Pinned filters" })).toBeNull();
  });

  it("drag reorder PATCHes /api/me with shortcut_filters in the new order, unpinned ones staying put", async () => {
    const { user, mock } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Pinned filters" });

    const dt = dataTransfer();
    const drafts = screen.getByTestId("pinned-f4");
    const cables = screen.getByTestId("pinned-f1");
    fireEvent.dragStart(drafts, { dataTransfer: dt });
    dragWithY("dragOver", cables, dt, -5);
    // The existing drop indicator shows where it will land.
    expect(screen.getAllByTestId("drop-indicator")).toHaveLength(1);
    dragWithY("drop", cables, dt, -5);

    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    const sent = (mock.find("PATCH", "/api/me")[0].body as { shortcut_filters: Array<{ id: string }> }).shortcut_filters;
    expect(sent.map((r) => r.id)).toEqual(["f4", "f1", "f3", "f2"]);
    expect(pinnedNames()).toEqual(["Drafts", "Cables", "Tools"]);
  });

  it("dropping on the lower half puts the filter after the target; the end zone appends", async () => {
    const { user, mock } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Pinned filters" });

    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    dragWithY("dragOver", screen.getByTestId("pinned-f2"), dt, 5);
    dragWithY("drop", screen.getByTestId("pinned-f2"), dt, 5);
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    expect(pinnedNames()).toEqual(["Tools", "Cables", "Drafts"]);

    // Now drag Tools to the end drop zone.
    fireEvent.dragStart(screen.getByTestId("pinned-f2"), { dataTransfer: dt });
    const zone = document.querySelector("li[aria-hidden='true']") as HTMLElement;
    fireEvent.dragOver(zone, { dataTransfer: dt });
    expect(screen.getAllByTestId("drop-indicator")).toHaveLength(1);
    fireEvent.drop(zone, { dataTransfer: dt });
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(2));
    expect(pinnedNames()).toEqual(["Cables", "Drafts", "Tools"]);
  });

  it("dropping a filter on itself saves nothing", async () => {
    const { user, mock } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Pinned filters" });
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    expect(mock.find("PATCH", "/api/me")).toHaveLength(0);
    expect(screen.queryAllByTestId("drop-indicator")).toHaveLength(0);
  });
});

describe("MobileNavDrawer", () => {
  it("shows Tags and the same single pinned list, not draggable, under a Filters heading", async () => {
    const { user } = api();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user);
    await screen.findByRole("list", { name: "Pinned filters" });
    expect(pinnedNames()).toEqual(["Cables", "Tools", "Drafts"]);
    expect(screen.getByRole("link", { name: "Tags" })).toBeTruthy();
    expect(screen.queryByText("Shortcuts")).toBeNull();
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.getByTestId("pinned-f1").getAttribute("draggable")).toBe("false");
  });
});
