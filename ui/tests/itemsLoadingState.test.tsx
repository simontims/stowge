import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "../src/lib/UserContext";
import { ItemsPage } from "../src/pages/ItemsPage";
import { makeTag, makeUser, renderWithUser } from "./testUtils";

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

interface Pending {
  url: string;
  resolve: (items: unknown[]) => void;
  fail: (status: number, detail: string) => void;
}

/** /api/items answers only when the test says so; everything else answers at once. */
function holdItems() {
  const pending: Pending[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const path = url.split("?")[0];
    if (path === "/api/items") {
      return new Promise<Response>((resolve) => {
        pending.push({
          url,
          resolve: (items) => resolve(new Response(JSON.stringify(items), { status: 200 })),
          fail: (status, detail) => resolve(new Response(JSON.stringify({ detail }), { status })),
        });
      });
    }
    if (path === "/api/tags") return new Response(JSON.stringify([makeTag("t1", "Attic")]), { status: 200 });
    if (path === "/api/locations") return new Response("[]", { status: 200 });
    return new Response("{}", { status: 200 });
  });
  return pending;
}

const ITEM = { id: "i1", name: "Hammer", description: null, tags: [], location: null, status: "draft", quantity: 1, created_at: "2026-01-01", thumb: null };

function noItemsNote() {
  return screen.queryByText(/^No items/);
}

describe("Items page first paint", () => {
  // useEffect runs after the browser has painted, so the very first render is on screen for a frame
  // before any request starts. Server rendering shows exactly that render (no effects run).
  it.each(["/items", "/items?tag=Attic", "/items?tag=Attic&q=usb", "/items?q=usb"])(
    "%s does not say 'No items' on the first paint",
    (entry) => {
      const html = renderToString(
        <UserContext.Provider value={{ currentUser: makeUser(), setCurrentUser: () => {} }}>
          <MemoryRouter initialEntries={[entry]}>
            <ItemsPage />
          </MemoryRouter>
        </UserContext.Provider>,
      );
      expect(html).not.toMatch(/No items/);
      expect(html).not.toMatch(/No untagged/);
      expect(html).toContain("Loading items...");
    },
  );
});

describe("Items page never claims 'no items' before the server has said so", () => {
  it("shows Loading, not 'No items tagged ...', until the first list answers", async () => {
    const pending = holdItems();
    renderWithUser(<ItemsPage />, makeUser(), ["/items?tag=Attic"]);
    // first paint, before and while the request is in flight
    expect(noItemsNote()).toBeNull();
    expect(screen.getAllByText("Loading items...").length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(noItemsNote()).toBeNull();

    await act(async () => pending[0].resolve([]));
    expect(await screen.findByText("No items tagged Attic.")).toBeTruthy();
    expect(screen.queryByText("Loading items...")).toBeNull();
  });

  it("shows the plain empty message on an unfiltered page only after a successful empty answer", async () => {
    const pending = holdItems();
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    expect(noItemsNote()).toBeNull();
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    expect(noItemsNote()).toBeNull();
    await act(async () => pending[0].resolve([]));
    expect(await screen.findByText("No items yet. Add your first one above.")).toBeTruthy();
  });

  it("shows the error, not 'No items', when the list fails to load", async () => {
    const pending = holdItems();
    renderWithUser(<ItemsPage />, makeUser(), ["/items?tag=Attic"]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].fail(500, "Database is busy"));
    expect(await screen.findByText("Database is busy")).toBeTruthy();
    expect(noItemsNote()).toBeNull();
  });

  it("keeps saying Loading while a new search waits for the debounce and the server", async () => {
    const pending = holdItems();
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => pending[0].resolve([]));
    expect(await screen.findByText("No items yet. Add your first one above.")).toBeTruthy();

    await userEvent.type(screen.getByPlaceholderText("Search items, locations, tags…"), "zzz");
    // typed, debounce not yet fired: the old empty answer is not the answer to this search
    expect(noItemsNote()).toBeNull();
    await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 2000 });
    expect(pending[1].url).toContain("q=zzz");
    expect(noItemsNote()).toBeNull();

    await act(async () => pending[1].resolve([]));
    expect(await screen.findByText("No items match your search.")).toBeTruthy();
  });

  it("ignores a slow answer to an older query that arrives after the newer one", async () => {
    const pending = holdItems();
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await userEvent.type(screen.getByPlaceholderText("Search items, locations, tags…"), "x");
    await vi.waitFor(() => expect(pending).toHaveLength(2), { timeout: 2000 });

    await act(async () => pending[1].resolve([ITEM]));
    expect(await screen.findByText("Hammer")).toBeTruthy();
    await act(async () => pending[0].resolve([]));
    expect(screen.getByText("Hammer")).toBeTruthy();
    expect(noItemsNote()).toBeNull();
  });
});
