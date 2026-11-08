import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation } from "react-router-dom";
import { ItemsPage } from "../src/pages/ItemsPage";
import { makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const CABLES = { id: "t1", name: "Cables", icon: null, color: null };
const TOOLS = { id: "t2", name: "Tools", icon: null, color: null };

function item(id: string, name: string, tags: unknown[]) {
  return { id, name, description: null, tags, location: null, status: "draft", quantity: 1, created_at: "2026-01-01", thumb: null };
}

const ITEMS = [item("i1", "USB lead", [CABLES, TOOLS]), item("i2", "Hammer", []), item("i3", "Drill", [TOOLS])];

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname + loc.search}</p>;
}

function setup(entry = "/items") {
  const mock = mockApi({
    "GET /api/items": ITEMS,
    "GET /api/locations": [],
    "GET /api/tags": [makeTag("t1", "Cables"), makeTag("t2", "Tools")],
    "PATCH /api/me": makeUser(),
    "GET /api/items/i1": {
      ...item("i1", "USB lead", [CABLES, TOOLS]),
      location_id: null,
      updated_at: "2026-01-01",
      images: [],
    },
  });
  renderWithUser(
    <>
      <ItemsPage />
      <Where />
    </>,
    makeUser(),
    [entry],
  );
  return mock;
}

function lastItemsUrl(mock: ReturnType<typeof setup>) {
  const calls = mock.find("GET", "/api/items");
  return new URL(calls[calls.length - 1].path, "http://x");
}

describe("Items page Tags column", () => {
  it("shows a Tags column with a chip per tag, and an empty marker for untagged items", async () => {
    setup();
    await screen.findByText("USB lead");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toContain("Tags");
    expect(headers).not.toContain("Collection");

    const leadRow = screen.getByText("USB lead").closest("tr") as HTMLElement;
    expect(within(leadRow).getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Cables", "Tools"]);
    const hammerRow = screen.getByText("Hammer").closest("tr") as HTMLElement;
    expect(within(hammerRow).queryAllByTestId("tag-chip")).toHaveLength(0);
  });

  it("sorting by the Tags header asks the server for sort_by=tags", async () => {
    const mock = setup();
    await screen.findByText("USB lead");
    await userEvent.click(screen.getByRole("columnheader", { name: /Tags/ }));
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.get("sort_by")).toBe("tags"));
    expect(lastItemsUrl(mock).searchParams.get("sort_dir")).toBe("asc");
    await userEvent.click(screen.getByRole("columnheader", { name: /Tags/ }));
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.get("sort_dir")).toBe("desc"));
  });
});

describe("Items page Tag filter", () => {
  it("?tag=<name> in the URL filters the request and titles the page", async () => {
    const mock = setup("/items?tag=Cables");
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.get("tag")).toBe("Cables"));
    expect(lastItemsUrl(mock).searchParams.has("collection")).toBe(false);
    expect(screen.getByRole("heading", { name: "Cables" })).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Filter by tag") as HTMLSelectElement).value).toBe("Cables"));
  });

  it("?tag=__none shows untagged items and is titled No tag", async () => {
    const mock = setup("/items?tag=__none");
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.get("tag")).toBe("__none"));
    expect(screen.getByRole("heading", { name: "No tag" })).toBeTruthy();
  });

  it("the select offers Any tag, Untagged and each tag; choosing one sets the URL and reloads", async () => {
    const mock = setup();
    await screen.findByText("USB lead");
    const select = screen.getByLabelText("Filter by tag") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Any tag", "Untagged", "Cables", "Tools"]);

    await userEvent.selectOptions(select, "Tools");
    expect(screen.getByTestId("where").textContent).toBe("/items?tag=Tools");
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.get("tag")).toBe("Tools"));

    await userEvent.selectOptions(select, "__none");
    expect(screen.getByTestId("where").textContent).toBe("/items?tag=__none");

    await userEvent.selectOptions(select, "");
    expect(screen.getByTestId("where").textContent).toBe("/items");
    await waitFor(() => expect(lastItemsUrl(mock).searchParams.has("tag")).toBe(false));
  });

  it("records last_open_tag when the filter changes (the name, or null for untagged)", async () => {
    const mock = setup();
    await screen.findByText("USB lead");
    const select = screen.getByLabelText("Filter by tag") as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(4));

    await userEvent.selectOptions(select, "Tools");
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/me")[0].body).toEqual({ last_open_tag: "Tools" });

    await userEvent.selectOptions(select, "__none");
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(2));
    expect(mock.find("PATCH", "/api/me")[1].body).toEqual({ last_open_tag: null });
  });

  it("Add Item from a tagged list carries the tag name to the Add page", async () => {
    setup("/items?tag=Cables");
    await screen.findByText("USB lead");
    await userEvent.click(screen.getByRole("button", { name: /Add Item/ }));
    expect(screen.getByTestId("where").textContent).toBe("/add?tag=Cables");
  });
});

describe("Item detail panel", () => {
  it("shows the item's tags as read-only chips, with no collection or tag select", async () => {
    setup();
    await userEvent.click(await screen.findByText("USB lead"));
    await screen.findByText("Item Details");
    const label = await screen.findByText("Tags", { selector: "span.uppercase" });
    const block = label.parentElement as HTMLElement;
    await waitFor(() => expect(within(block).getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Cables", "Tools"]));
    expect(within(block).queryByRole("button")).toBeNull();
    expect(screen.queryByText("Collection")).toBeNull();
  });
});

describe("Items page layout is the same however the list is filtered", () => {
  async function layout(entry: string) {
    setup(entry);
    await screen.findByText("Hammer");
    const search = screen.getByPlaceholderText(/Search/);
    const pane = search.closest("div.space-y-4") as HTMLElement;
    return { placeholder: search.getAttribute("placeholder"), paneClass: pane.className };
  }

  it("has the same search placeholder and no extra padding with a tag filter, a search/location filter, or none", async () => {
    const tagged = await layout("/items?tag=Cables");
    cleanup();
    const searched = await layout("/items?q=usb&area_id=a1&location_id=l1");
    cleanup();
    const plain = await layout("/items");
    expect(searched).toEqual(tagged);
    expect(plain).toEqual(tagged);
    expect(tagged.paneClass).not.toMatch(/\bp-4\b/);
  });
});

describe("Items table columns keep their widths whatever the list holds", () => {
  const LONG = [
    { ...item("i1", "A very long item name that goes on and on and on for a while", [CABLES, TOOLS, { id: "t3", name: "Seasonal decorations", icon: null, color: null }]), location: "Garage shelf number twelve, left side" },
    item("i2", "Hammer", []),
  ];
  const SHORT = [item("i3", "Drill", [])];

  function widths(rows: unknown[]) {
    mockApi({
      "GET /api/items": rows,
      "GET /api/locations": [],
      "GET /api/tags": [makeTag("t1", "Cables"), makeTag("t2", "Tools")],
      "PATCH /api/me": makeUser(),
    });
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    return screen.findAllByRole("columnheader").then((hs) => ({
      widths: hs.map((h) => (h as HTMLElement).style.width),
      table: (hs[0].closest("table") as HTMLElement).className,
    }));
  }

  it("column widths do not depend on the longest name, tags or location on the page", async () => {
    const many = await widths(LONG);
    cleanup();
    const one = await widths(SHORT);
    expect(one.widths).toEqual(many.widths);
  });

  it("uses a fixed table layout, with Name taking the remaining width", async () => {
    const { widths: w, table } = await widths(SHORT);
    expect(table).toContain("table-fixed");
    expect(w[1]).toBe(""); // Name: no width of its own
    for (const i of [0, 2, 3, 4, 5]) expect(w[i]).not.toBe("");
  });

  it("a long location is cut with an ellipsis and keeps its full text as a title", async () => {
    mockApi({
      "GET /api/items": LONG,
      "GET /api/locations": [],
      "GET /api/tags": [makeTag("t1", "Cables"), makeTag("t2", "Tools")],
      "PATCH /api/me": makeUser(),
    });
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    const pill = await screen.findByTitle("Garage shelf number twelve, left side");
    expect(pill.className).toContain("truncate");
  });
});
