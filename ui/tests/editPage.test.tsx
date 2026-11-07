import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { EditPage } from "../src/pages/EditPage";
import { makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  window.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PART = {
  id: "i1",
  is_deleted: false,
  name: "USB lead",
  description: null,
  tags: [{ id: "t1", name: "Cables", icon: null, color: null }],
  location_id: null,
  location: null,
  status: "draft",
  quantity: 1,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  images: [],
  contents: [],
};

function setup() {
  const mock = mockApi({
    "GET /api/items/i1": PART,
    "GET /api/locations": [],
    "GET /api/tags": [makeTag("t1", "Cables"), makeTag("t2", "Tools")],
    "PATCH /api/items/i1": PART,
  });
  renderWithUser(
    <Routes>
      <Route path="/items/:itemId/edit" element={<EditPage />} />
    </Routes>,
    makeUser(),
    ["/items/i1/edit"],
  );
  return mock;
}

describe("Edit page tags", () => {
  it("shows the item's tags in a multi-select picker instead of a collection select", async () => {
    setup();
    await waitFor(() => expect(screen.getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Cables×"]));
    expect(screen.queryByText("Collection")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Tags" })).toBeTruthy();
  });

  it("saving after adding a tag PATCHes the whole tag_ids list", async () => {
    const mock = setup();
    await waitFor(() => expect(screen.getAllByTestId("tag-chip")).toHaveLength(1));
    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    await userEvent.click(screen.getByRole("option", { name: "Tools" }));
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(2);

    await userEvent.click(screen.getAllByRole("button", { name: /^Save/ })[0]);
    await waitFor(() => expect(mock.find("PATCH", "/api/items/i1")).toHaveLength(1));
    const body = mock.find("PATCH", "/api/items/i1")[0].body as Record<string, unknown>;
    expect(body.tag_ids).toEqual(["t1", "t2"]);
    expect("collection" in body).toBe(false);
  });

  it("removing the last tag saves an empty list (untagged)", async () => {
    const mock = setup();
    await waitFor(() => expect(screen.getAllByTestId("tag-chip")).toHaveLength(1));
    await userEvent.click(screen.getByRole("button", { name: "Remove tag Cables" }));
    await userEvent.click(screen.getAllByRole("button", { name: /^Save/ })[0]);
    await waitFor(() => expect(mock.find("PATCH", "/api/items/i1")).toHaveLength(1));
    expect((mock.find("PATCH", "/api/items/i1")[0].body as { tag_ids: string[] }).tag_ids).toEqual([]);
  });
});
