import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { TagsPage, tagDeleteSummary } from "../src/pages/TagsPage";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => {
  const toastFn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast: toastFn };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.mocked(toast).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

const CABLES = makeTag("t1", "Cables", { item_count: 3, description: "Leads", icon: "cable", color: "#38bdf8" });
const TOOLS = makeTag("t2", "Tools", { item_count: 1 });

function setup(extra: Record<string, unknown> = {}, user = makeUser()) {
  const mock = mockApi({
    "GET /api/tags": [CABLES, TOOLS],
    "GET /api/items/deleted": [],
    "GET /api/me": user,
    "PATCH /api/me": user,
    "POST /api/tags": makeTag("t3", "New"),
    "PATCH /api/tags/t1": CABLES,
    "DELETE /api/tags/t1": { ok: true, items_untagged: 3 },
    ...extra,
  });
  renderWithUser(<TagsPage />, user, ["/tags"]);
  return mock;
}

describe("Tags page list", () => {
  it("shows name, description and item count per tag and no AI hint anywhere", async () => {
    setup();
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Leads")).toBeTruthy();
    expect(within(row).getByText("3")).toBeTruthy();
    expect(screen.queryByText(/ai hint/i)).toBeNull();
  });

  it("has no separate Icon column: the icon sits beside the name, as in the Filters table", async () => {
    setup();
    const nameCell = (await screen.findByText("Cables")).parentElement as HTMLElement;
    expect(nameCell.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Icon" })).toBeNull();
  });

  it("describes the delete impact in the right words", () => {
    expect(tagDeleteSummary(0)).toBe("No items use this tag.");
    expect(tagDeleteSummary(1)).toBe("1 item will lose this tag.");
    expect(tagDeleteSummary(5)).toBe("5 items will lose this tag.");
  });
});

describe("Tags page add and edit", () => {
  it("adds a tag with name and description (no AI hint field)", async () => {
    const mock = setup();
    await screen.findByText("Cables");
    await userEvent.click(screen.getByRole("button", { name: /Add Tag/ }));
    const dialog = screen.getByRole("dialog", { name: "Add tag" });
    expect(within(dialog).queryByText(/hint/i)).toBeNull();

    await userEvent.type(within(dialog).getByPlaceholderText("Cables"), "Camping");
    await userEvent.type(within(dialog).getByPlaceholderText("Optional description"), "Outdoor gear");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.find("POST", "/api/tags")).toHaveLength(1));
    expect(mock.find("POST", "/api/tags")[0].body).toEqual({ name: "Camping", icon: null, color: null, description: "Outdoor gear" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("rejects a too-short name without calling the API", async () => {
    const mock = setup();
    await screen.findByText("Cables");
    await userEvent.click(screen.getByRole("button", { name: /Add Tag/ }));
    await userEvent.type(screen.getByPlaceholderText("Cables"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Tag name must be at least 2 characters.")).toBeTruthy();
    expect(mock.find("POST", "/api/tags")).toHaveLength(0);
  });

  it("shows the server's duplicate-name error inside the modal", async () => {
    const mock = setup();
    await screen.findByText("Cables");
    mock.spy.mockImplementation(async (input, init) => {
      if (String(input) === "/api/tags" && init?.method === "POST") {
        return new Response(JSON.stringify({ detail: "Tag already exists" }), { status: 400 });
      }
      return new Response("[]", { status: 200 });
    });
    await userEvent.click(screen.getByRole("button", { name: /Add Tag/ }));
    await userEvent.type(screen.getByPlaceholderText("Cables"), "cables");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Tag already exists")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Add tag" })).toBeTruthy();
  });

  it("edits a tag with its values filled in and PATCHes the changes", async () => {
    const mock = setup();
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit tag" });
    const name = within(dialog).getByPlaceholderText("Cables") as HTMLInputElement;
    expect(name.value).toBe("Cables");
    expect((within(dialog).getByPlaceholderText("Optional description") as HTMLInputElement).value).toBe("Leads");

    await userEvent.clear(name);
    await userEvent.type(name, "Leads and cables");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.find("PATCH", "/api/tags/t1")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/tags/t1")[0].body).toMatchObject({ name: "Leads and cables", icon: "cable", color: "#38bdf8", description: "Leads" });
  });
});

describe("Tags page delete", () => {
  it("confirms with the number of items that lose the tag, then deletes", async () => {
    const mock = setup();
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Delete/ }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/3 items will lose this tag/)).toBeTruthy();
    expect(mock.find("DELETE", "/api/tags/t1")).toHaveLength(0);

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mock.find("DELETE", "/api/tags/t1")).toHaveLength(1));
    expect(mock.find("DELETE", "/api/tags/t1")[0].path).toBe("/api/tags/t1");
  });

  it("Cancel deletes nothing", async () => {
    const mock = setup();
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Delete/ }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mock.find("DELETE", "/api/tags/t1")).toHaveLength(0);
  });
});

describe("Tags page Pin tag filter", () => {
  it("appends a pinned filter for the tag and keeps the existing filters", async () => {
    const existing = makeFilter("f0", "Drafts", { statuses: ["draft"] });
    const user = makeUser({ shortcut_filters: [existing] as never });
    const mock = setup({}, user);
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Pin tag filter/ }));

    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    const sent = (mock.find("PATCH", "/api/me")[0].body as { shortcut_filters: Array<Record<string, unknown>> }).shortcut_filters;
    expect(sent).toHaveLength(2);
    expect(sent[0].id).toBe("f0");
    expect(sent[1]).toMatchObject({ name: "Cables", tag_id: "t1", pinned: true, icon: "cable", color: "#38bdf8" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Filter for Cables pinned to your menu"));
  });

  it("does nothing, with a toast, when a filter for that tag already exists", async () => {
    const user = makeUser({ shortcut_filters: [makeFilter("f1", "Cables", { tag_id: "t1" })] as never });
    const mock = setup({}, user);
    const row = (await screen.findByText("Cables")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Pin tag filter/ }));

    await waitFor(() => expect(toast).toHaveBeenCalledWith("A filter for Cables is already in your menu"));
    expect(mock.find("PATCH", "/api/me")).toHaveLength(0);
  });
});
