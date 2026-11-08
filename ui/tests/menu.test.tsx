import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { navItems } from "../src/config/nav";
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
  return within(screen.getByRole("list", { name: "Filters" }))
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

describe("Add Item and All items", () => {
  const EMPTY = [makeFilter("f3", "Hidden", { pinned: false })];

  it("shows both above the Filters heading on a blank install, in the sidebar and the drawer", async () => {
    for (const ui of [
      <Sidebar collapsed={false} onToggleCollapse={() => {}} />,
      <MobileNavDrawer open onClose={() => {}} />,
    ]) {
      const { user } = api(EMPTY);
      renderWithUser(ui, user, ["/settings"]);
      const add = screen.getByRole("link", { name: "Add Item" });
      const all = screen.getByRole("link", { name: "All items" });
      expect(add.getAttribute("href")).toBe("/add");
      expect(all.getAttribute("href")).toBe("/items");
      const heading = screen.getByText("Filters");
      expect(add.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(all.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      cleanup();
    }
  });

  it("shows them to a non-admin too", () => {
    const { user } = api(EMPTY);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, { ...user, role: "user" } as never, ["/settings"]);
    expect(screen.getByRole("link", { name: "Add Item" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "All items" })).toBeTruthy();
  });

  it("is outlined, not a solid button, and sits outside the scrolling area", () => {
    const { user } = api(EMPTY);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/settings"]);
    const add = screen.getByRole("link", { name: "Add Item" });
    expect(add.className).toContain("border-success-500/70");
    expect(add.className).not.toContain("bg-success-600");
    expect(add.className).toContain("w-full"); // spans the menu like the rows, not just its label
    expect((add.parentElement as HTMLElement).className).toContain("px-2");
    const block = screen.getByTestId("menu-primary-links");
    expect(block.className).toContain("shrink-0");
    expect(block.closest(".overflow-y-auto")).toBeNull();
    expect(screen.getByText("Filters").closest(".overflow-y-auto")).toBeTruthy();
  });

  it("All items is active on /items and on an unmatched search, but not when a pinned filter is the view", async () => {
    for (const [url, expected] of [
      ["/items", true],
      ["/items?q=drill", true],
      ["/items?tag=Tools", false],
      ["/settings", false],
    ] as const) {
      const { user } = api();
      renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, [url]);
      await screen.findByRole("link", { name: "Cables" }); // filters and tags have loaded
      const all = screen.getByRole("link", { name: "All items" });
      expect(all.getAttribute("aria-current") === "page").toBe(expected);
      expect(all.className.includes("bg-surface-2 text-heading")).toBe(expected);
      cleanup();
    }
  });

  it("collapsed rail: icon-only with names and titles; the label text is gone", () => {
    const { user } = api(EMPTY);
    renderWithUser(<Sidebar collapsed onToggleCollapse={() => {}} />, user, ["/items"]);
    const add = screen.getByRole("link", { name: "Add Item" });
    expect(add.getAttribute("title")).toBe("Add Item");
    expect(add.textContent).toBe("");
    expect((add.parentElement as HTMLElement).className).toContain("justify-center"); // centred in the 64px rail
    const all = screen.getByRole("link", { name: "All items" });
    expect(all.getAttribute("title")).toBe("All items");
    expect(all.textContent).toBe("");
  });

  it("drawer rows are at least 44px (min-h-11), including the filters and the empty hint", async () => {
    const { user } = api();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user, ["/settings"]);
    await screen.findByRole("link", { name: "Cables" });
    for (const name of ["Add Item", "All items", "Cables", "Settings"]) {
      expect(screen.getByRole("link", { name }).className).toContain("min-h-11");
    }
    expect((screen.getByText("Filters").closest("h2") as HTMLElement).className).toContain("min-h-11");
    cleanup();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, api(EMPTY).user, ["/settings"]);
    expect(screen.getByRole("link", { name: "No filters yet. Add one in Settings." }).className).toContain("min-h-11");
  });

  it("the drawer closes when All items, Add Item or the logo is chosen, even if the URL does not change", () => {
    const onClose = vi.fn();
    const { user } = api(EMPTY);
    renderWithUser(<MobileNavDrawer open onClose={onClose} />, user, ["/items"]);
    onClose.mockClear(); // the route-change effect fires once on mount
    for (const name of ["All items", "Add Item", "Stowge, all items"]) {
      fireEvent.click(screen.getByRole("link", { name }));
    }
    expect(onClose.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("a closed drawer is inert, so its links are not in the tab order", () => {
    const { user } = api(EMPTY);
    const { container } = renderWithUser(<MobileNavDrawer open={false} onClose={() => {}} />, user, ["/items"]);
    expect((container.querySelector("[role='dialog']") as HTMLElement).hasAttribute("inert")).toBe(true);
  });

  it("Add Item is current on /add, /items/new and /parts/new, with a visible tint; All items is current on /parts", () => {
    for (const [url, add, all] of [
      ["/add", true, false],
      ["/items/new", true, false],
      ["/parts/new", true, false],
      ["/parts", false, true],
      ["/items?sort=name&page=2", false, true],
      ["/items?tag=__none", false, true],
    ] as const) {
      const { user } = api(EMPTY);
      renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, [url]);
      const a = screen.getByRole("link", { name: "Add Item" });
      expect(a.getAttribute("aria-current") === "page").toBe(add);
      expect(a.className.includes("!bg-success-900/50")).toBe(add);
      expect(screen.getByRole("link", { name: "All items" }).getAttribute("aria-current") === "page").toBe(all);
      cleanup();
    }
  });

  it("a pinned filter with no criteria does not take the highlight from All items", () => {
    const { user } = api([makeFilter("f9", "Everything", {})]);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/items"]);
    expect(screen.getByRole("link", { name: "All items" }).getAttribute("aria-current")).toBe("page");
  });

  it("the drawer's logo is a link to the item list with a focus ring", () => {
    const { user } = api(EMPTY);
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user, ["/settings"]);
    const logo = screen.getByRole("link", { name: "Stowge, all items" });
    expect(logo.getAttribute("href")).toBe("/items");
    expect(logo.className).toContain("focus-visible:ring-2");
  });

  it("the logo links to the item list", () => {
    const { user } = api(EMPTY);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/settings"]);
    expect(screen.getByRole("link", { name: "Stowge, all items" }).getAttribute("href")).toBe("/items");
  });

  it("the empty-state hint is a full sentence ending in a full stop", async () => {
    const { user } = api(EMPTY);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/settings"]);
    expect(screen.getByRole("link", { name: "No filters yet. Add one in Settings." })).toBeTruthy();
  });
});

describe("menu entries", () => {
  it("has no Tags or Collections entry: tags are managed in Settings", () => {
    expect(navItems.map((i) => i.label)).toEqual(["Settings", "System"]);
  });
});

describe("Sidebar", () => {
  it("lists the pinned filters as one ordered list under a Filters heading that is not a link", async () => {
    const { user } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/tags"]);
    await screen.findByRole("list", { name: "Filters" });

    expect(pinnedNames()).toEqual(["Cables", "Tools", "Drafts"]);
    expect(screen.queryByText("Shortcuts")).toBeNull();
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.queryByText("Collections")).toBeNull();

    expect(screen.queryByRole("link", { name: "Tags" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Filters" })).toBeNull();
    const heading = screen.getByText("Filters").closest("[data-tour='menu-filters']") as HTMLElement;
    expect(heading).toBeTruthy();
    expect(heading.querySelector("svg")).toBeTruthy(); // an icon, like Settings and System
    const list = screen.getByRole("list", { name: "Filters" });
    // The heading comes straight before the list.
    expect(heading.nextElementSibling).toBe(list);
  });

  it("links a tag filter to /items?tag=<name> and marks it active on that URL", async () => {
    const { user } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/items?tag=Tools"]);
    await screen.findByRole("list", { name: "Filters" });
    expect(screen.getByRole("link", { name: "Tools" }).getAttribute("href")).toBe("/items?tag=Tools");
    expect(screen.getByRole("link", { name: "Tools" }).className).toContain("text-heading");
    expect(screen.getByRole("link", { name: "Cables" }).className).not.toContain("text-heading");
  });

  it("shows the Filters heading with a pointer to Settings, and no items, when nothing is pinned", async () => {
    const { user, mock } = api([makeFilter("f3", "Hidden", { pinned: false })]);
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await waitFor(() => expect(mock.find("GET", "/api/me").length).toBeGreaterThan(0));
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.getByRole("link", { name: /No filters yet/ }).getAttribute("href")).toBe("/settings");
    expect(within(screen.getByRole("list", { name: "Filters" })).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("drag reorder PATCHes /api/me with shortcut_filters in the new order, unpinned ones staying put", async () => {
    const { user, mock } = api();
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });

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
    await screen.findByRole("list", { name: "Filters" });

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
    await screen.findByRole("list", { name: "Filters" });
    const dt = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    fireEvent.dragOver(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("pinned-f1"), { dataTransfer: dt });
    expect(mock.find("PATCH", "/api/me")).toHaveLength(0);
    expect(screen.queryAllByTestId("drop-indicator")).toHaveLength(0);
  });
});

describe("MobileNavDrawer", () => {
  it("shows the same single pinned list under a Filters heading, not draggable, and no Tags link", async () => {
    const { user } = api();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });
    expect(pinnedNames()).toEqual(["Cables", "Tools", "Drafts"]);
    expect(screen.queryByRole("link", { name: "Tags" })).toBeNull();
    expect(screen.queryByText("Shortcuts")).toBeNull();
    expect(screen.getByText("Filters")).toBeTruthy();
    expect(screen.getByTestId("pinned-f1").getAttribute("draggable")).toBe("false");
  });
});
