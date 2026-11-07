import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { toast } from "sonner";
import { LegacyLinkUpgrade } from "../src/App";
import { AddPage } from "../src/pages/AddPage";
import { SettingsPage } from "../src/pages/SettingsPage";
import { Sidebar } from "../src/components/layout/Sidebar";
import { UserContext } from "../src/lib/UserContext";
import type { CurrentUser } from "../src/lib/types";
import { DEFAULT_HINT, makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("../src/lib/resizeImage", () => ({ resizeImage: async (file: File) => file }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(toast.error).mockClear();
});

const TAGS = [makeTag("t1", "Cables"), makeTag("t2", "Tools")];
const HINTS = [DEFAULT_HINT, { id: "h2", name: "Parts", text: "Electronic parts", is_default: false }];

describe("U2: Filters heading", () => {
  it("is a level-2 heading and the list is named by it", async () => {
    const user = makeUser({ shortcut_filters: [makeFilter("f1", "Cables", { tag_id: "t1" })] as never });
    mockApi({ "GET /api/tags": TAGS, "GET /api/me": user });
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    const list = await screen.findByRole("list", { name: "Filters" });
    const heading = screen.getByRole("heading", { name: "Filters", level: 2 });
    expect(heading.id).toBeTruthy();
    expect(list.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(list.getAttribute("aria-label")).toBeNull();
  });
});

describe("U3: Settings tabs ARIA", () => {
  function setup(entry = "/settings") {
    const user = makeUser();
    mockApi({
      "GET /api/me": user,
      "GET /api/items/bootstrap": { tags: TAGS, sites: [], areas: [], locations: [], statuses: [], hints: HINTS },
      "GET /api/hints": HINTS,
      "GET /api/tags": TAGS,
      "GET /api/items/deleted": [],
    });
    let location = { pathname: "", search: "", type: "" as string };
    function Probe() {
      const { pathname, search } = useLocation();
      location = { pathname, search, type: useNavigationType() };
      return null;
    }
    renderWithUser(
      <>
        <SettingsPage />
        <Probe />
      </>,
      user,
      [entry],
    );
    return () => location;
  }

  it("tabs have id/aria-controls, roving tabindex, and the panel is labelled by the active tab", () => {
    setup("/settings?tab=tags");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    for (const tab of tabs) {
      expect(tab.id).toBeTruthy();
      const panelId = tab.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
    }
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[1].id);
    expect(panel.id).toBe(tabs[1].getAttribute("aria-controls"));
  });

  it("ArrowRight/ArrowLeft/Home/End move focus and select, wrapping around", async () => {
    setup();
    const tab = (name: string) => screen.getByRole("tab", { name });
    tab("Filters").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("Tags"));
    expect(tab("Tags").getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(tab("AI hints"));
    expect(tab("AI hints").getAttribute("aria-selected")).toBe("true");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(tab("Filters"));
    await userEvent.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(tab("AI hints"));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(tab("Filters"));
    expect(tab("Filters").getAttribute("aria-selected")).toBe("true");
  });

  it("selecting tabs replaces the history entry instead of adding one", async () => {
    const location = setup();
    await userEvent.click(screen.getByRole("tab", { name: "Tags" }));
    expect(location().type).toBe("REPLACE");
    await userEvent.click(screen.getByRole("tab", { name: "AI hints" }));
    expect(location().search).toBe("?tab=hints");
    expect(location().type).toBe("REPLACE");
  });
});

describe("U4: sticky Add choices survive leaving the page", () => {
  it("tags and hint chosen on Add are still there after unmounting and remounting AddPage", async () => {
    let server = makeUser();
    const mock = mockApi({
      "GET /api/items/bootstrap": { tags: TAGS, hints: HINTS, locations: [], ai_settings: { default_llm_id: null, configs: [] } },
      // The server answers with the whole profile it saved.
      "PATCH /api/me": (call: { body: unknown }) => (server = { ...server, ...(call.body as object) }),
    });

    function Harness() {
      const [currentUser, setCurrentUser] = useState<CurrentUser>(makeUser());
      const [onAdd, setOnAdd] = useState(true);
      return (
        <UserContext.Provider value={{ currentUser, setCurrentUser }}>
          <MemoryRouter>
            <button onClick={() => setOnAdd((v) => !v)}>toggle</button>
            {onAdd && <AddPage />}
          </MemoryRouter>
        </UserContext.Provider>
      );
    }
    render(<Harness />);

    const hint = (await screen.findByLabelText("AI hint")) as HTMLSelectElement;
    await userEvent.selectOptions(hint, "h2");
    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    await userEvent.click(screen.getByRole("option", { name: "Tools" }));
    await waitFor(() => expect(mock.find("PATCH", "/api/me").length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 0));

    await userEvent.click(screen.getByText("toggle")); // leave Add
    expect(screen.queryByLabelText("AI hint")).toBeNull();
    await userEvent.click(screen.getByText("toggle")); // come back

    await waitFor(async () => expect(((await screen.findByLabelText("AI hint")) as HTMLSelectElement).value).toBe("h2"));
    await waitFor(() => expect(screen.getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Tools×"]));
  });
});

describe("U5: reordering pinned filters", () => {
  const FILTERS = [makeFilter("f1", "Cables", { tag_id: "t1" }), makeFilter("f2", "Tools", { tag_id: "t2" })];

  function dt() {
    const store: Record<string, string> = {};
    return { effectAllowed: "", dropEffect: "", setData: (k: string, v: string) => void (store[k] = v), getData: (k: string) => store[k] ?? "" };
  }
  function dropWithY(type: "dragOver" | "drop", el: Element, data: unknown, y: number) {
    const event = createEvent[type](el, { dataTransfer: data });
    Object.defineProperty(event, "clientY", { value: y });
    fireEvent(el, event);
  }
  function names() {
    return within(screen.getByRole("list", { name: "Filters" })).getAllByRole("link").map((a) => a.textContent);
  }

  it("a failed save rolls the order back and shows a toast", async () => {
    const user = makeUser({ shortcut_filters: FILTERS as never });
    const mock = mockApi({ "GET /api/tags": TAGS, "GET /api/me": user });
    const base = mock.spy.getMockImplementation()!;
    mock.spy.mockImplementation(async (input, init) =>
      (init?.method || "GET") === "PATCH" ? new Response(JSON.stringify({ detail: "boom" }), { status: 500 }) : base(input, init),
    );
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    await screen.findByRole("list", { name: "Filters" });
    expect(names()).toEqual(["Cables", "Tools"]);

    const data = dt();
    fireEvent.dragStart(screen.getByTestId("pinned-f2"), { dataTransfer: data });
    dropWithY("dragOver", screen.getByTestId("pinned-f1"), data, -5);
    dropWithY("drop", screen.getByTestId("pinned-f1"), data, -5);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the new order"));
    await waitFor(() => expect(names()).toEqual(["Cables", "Tools"]));
  });

  it("a successful save updates UserContext with the saved filters", async () => {
    const user = makeUser({ shortcut_filters: FILTERS as never });
    const saved: unknown[] = [];
    mockApi({
      "GET /api/tags": TAGS,
      "GET /api/me": user,
      "PATCH /api/me": (call: { body: unknown }) => ({ ...user, shortcut_filters: (call.body as { shortcut_filters: unknown[] }).shortcut_filters }),
    });
    render(
      <UserContext.Provider value={{ currentUser: user, setCurrentUser: (u) => saved.push(u.shortcut_filters.map((f) => f.id)) }}>
        <MemoryRouter>
          <Sidebar collapsed={false} onToggleCollapse={() => {}} />
        </MemoryRouter>
      </UserContext.Provider>,
    );
    await screen.findByRole("list", { name: "Filters" });
    const data = dt();
    fireEvent.dragStart(screen.getByTestId("pinned-f2"), { dataTransfer: data });
    dropWithY("dragOver", screen.getByTestId("pinned-f1"), data, -5);
    dropWithY("drop", screen.getByTestId("pinned-f1"), data, -5);
    await waitFor(() => expect(saved).toEqual([["f2", "f1"]]));
  });
});

describe("U6: legacy ?collection= upgrade keeps hash and state", () => {
  it("carries hash and location state to the upgraded URL", () => {
    let seen: ReturnType<typeof useLocation> | null = null;
    function Probe() {
      seen = useLocation();
      return null;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: "/items", search: "?collection=Cables", hash: "#row-5", state: { from: "x" } }]}>
        <LegacyLinkUpgrade>
          <Probe />
        </LegacyLinkUpgrade>
      </MemoryRouter>,
    );
    expect(seen!.search).toBe("?tag=Cables");
    expect(seen!.hash).toBe("#row-5");
    expect(seen!.state).toEqual({ from: "x" });
  });
});

describe("R3: two quick drags", () => {
  const three = [makeFilter("f1", "Cables", { tag_id: "t1" }), makeFilter("f2", "Tools", { tag_id: "t2" }), makeFilter("f3", "Misc", { tag_id: "t1" })];

  it("a failed first save does not discard the newer drag's order, and still toasts", async () => {
    const user = makeUser({ shortcut_filters: three as never });
    const mock = mockApi({ "GET /api/tags": TAGS, "GET /api/me": user });
    const base = mock.spy.getMockImplementation()!;
    const pending: Array<(r: Response) => void> = [];
    mock.spy.mockImplementation((input, init) =>
      (init?.method || "GET") === "PATCH" ? new Promise<Response>((resolve) => pending.push(resolve)) : base(input, init),
    );
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user);
    const list = await screen.findByRole("list", { name: "Filters" });
    const names = () => within(list).getAllByRole("link").map((a) => a.textContent);
    function drag(source: string, target: string) {
      const store: Record<string, string> = {};
      const data = { effectAllowed: "", dropEffect: "", setData: (k: string, v: string) => void (store[k] = v), getData: (k: string) => store[k] ?? "" };
      fireEvent.dragStart(screen.getByTestId(`pinned-${source}`), { dataTransfer: data });
      for (const type of ["dragOver", "drop"] as const) {
        const event = createEvent[type](screen.getByTestId(`pinned-${target}`), { dataTransfer: data });
        Object.defineProperty(event, "clientY", { value: -5 });
        fireEvent(screen.getByTestId(`pinned-${target}`), event);
      }
    }
    drag("f3", "f1");
    await waitFor(() => expect(names()).toEqual(["Misc", "Cables", "Tools"]));
    drag("f2", "f3");
    await waitFor(() => expect(names()).toEqual(["Tools", "Misc", "Cables"]));
    expect(pending).toHaveLength(2);

    pending[0](new Response(JSON.stringify({ detail: "boom" }), { status: 500 }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not save the new order"));
    expect(names()).toEqual(["Tools", "Misc", "Cables"]);
  });
});

describe("R4: out-of-order preference saves", () => {
  it("a late tags answer carrying an older location does not undo the newer location", async () => {
    const locations = [{ id: "l1", name: "Shed" }];
    const mock = mockApi({
      "GET /api/items/bootstrap": { tags: TAGS, hints: HINTS, locations, ai_settings: { default_llm_id: null, configs: [] } },
    });
    const base = mock.spy.getMockImplementation()!;
    const pending: Array<(r: Response) => void> = [];
    mock.spy.mockImplementation((input, init) =>
      (init?.method || "GET") === "PATCH" ? new Promise<Response>((resolve) => pending.push(resolve)) : base(input, init),
    );
    let latest = makeUser();
    function Harness() {
      const [currentUser, setCurrentUser] = useState<CurrentUser>(makeUser());
      latest = currentUser;
      return (
        <UserContext.Provider value={{ currentUser, setCurrentUser }}>
          <MemoryRouter>
            <AddPage />
          </MemoryRouter>
        </UserContext.Provider>
      );
    }
    render(<Harness />);
    await userEvent.click(await screen.findByRole("combobox", { name: "Tags" }));
    await userEvent.click(screen.getByRole("option", { name: "Tools" }));
    await waitFor(() => expect(pending).toHaveLength(1)); // tags PATCH
    await userEvent.selectOptions(await screen.findByLabelText(/Location/), "l1");
    await waitFor(() => expect(pending).toHaveLength(2)); // location PATCH

    const ok = (body: object) => new Response(JSON.stringify({ ...makeUser(), ...body }), { status: 200 });
    pending[1](ok({ preferred_add_location_id: "l1", preferred_add_tag_ids: [] }));
    await waitFor(() => expect(latest.preferred_add_location_id).toBe("l1"));
    pending[0](ok({ preferred_add_tag_ids: ["t2"], preferred_add_location_id: null }));
    await waitFor(() => expect(latest.preferred_add_tag_ids).toEqual(["t2"]));
    expect(latest.preferred_add_location_id).toBe("l1");
  });
});

describe("R7: one tabpanel that every tab controls", () => {
  it("aria-controls always points at the existing panel, labelled by the active tab, focusable", async () => {
    mockApi({ "GET /api/me": makeUser(), "GET /api/tags": TAGS, "GET /api/hints": HINTS, "GET /api/items/bootstrap": { tags: TAGS, hints: HINTS, locations: [], ai_settings: { default_llm_id: null, configs: [] } } });
    renderWithUser(<SettingsPage />, makeUser(), ["/settings?tab=tags"]);
    const panel = screen.getByRole("tabpanel");
    for (const tab of screen.getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls") as string)).toBe(panel);
    }
    expect(panel.getAttribute("aria-labelledby")).toBe("settings-tab-tags");
    expect(panel.getAttribute("tabindex")).toBe("0");
    await userEvent.click(screen.getByRole("tab", { name: "AI hints" }));
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe("settings-tab-hints");
    expect(screen.getAllByRole("tab").every((t) => document.getElementById(t.getAttribute("aria-controls") as string))).toBe(true);
  });
});
