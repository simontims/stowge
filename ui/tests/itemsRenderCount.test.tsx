import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ItemsPage } from "../src/pages/ItemsPage";
import { makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

// One TagChips per row per row render: counts how often rows are rendered.
const counter = vi.hoisted(() => ({ rows: 0 }));
vi.mock("../src/components/ui/TagChips", () => ({
  TagChips: () => {
    counter.rows += 1;
    return null;
  },
}));

beforeEach(() => {
  vi.stubGlobal("EventSource", class { addEventListener() {} removeEventListener() {} close() {} });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ROWS = 2000;
const items = Array.from({ length: ROWS }, (_, i) => ({
  id: `i${i}`, name: `Item ${i}`, description: null, tags: [], location: null, status: "draft", quantity: 1, created_at: "2026-01-01", thumb: null,
}));

describe("Items page with a large list", () => {
  it("typing in the search box does not re-render the 2,000 rows", async () => {
    mockApi({
      "GET /api/items": items,
      "GET /api/locations": [],
      "GET /api/tags": [makeTag("t1", "Cables")],
      "GET /api/me": makeUser(),
    });
    renderWithUser(<ItemsPage />, makeUser(), ["/items"]);
    await waitFor(() => expect(screen.getByText(`${ROWS} items`)).toBeTruthy(), { timeout: 5000 });
    const afterLoad = counter.rows;
    expect(afterLoad).toBeGreaterThanOrEqual(ROWS);

    // Keystrokes update the page state immediately (the request itself is debounced).
    await userEvent.type(screen.getByPlaceholderText(/Search items/), "abc");
    expect(counter.rows - afterLoad).toBeLessThan(ROWS); // was 3 x 2,000 before rows were memoised
  }, 30000);
});
