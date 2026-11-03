import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage, parseSettingsTab } from "../src/pages/SettingsPage";
import { DEFAULT_HINT, makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const HINTS = [DEFAULT_HINT, { id: "h2", name: "Parts", text: "Electronic parts", is_default: false }];
const TAGS = [makeTag("t1", "Cables"), makeTag("t2", "Tools")];

function setup(entry: string, filters: unknown[] = []) {
  const user = makeUser({ shortcut_filters: filters as never });
  const mock = mockApi({
    "GET /api/me": user,
    "PATCH /api/me": user,
    "GET /api/items/bootstrap": { tags: TAGS, sites: [], areas: [], locations: [], statuses: ["draft", "confirmed"], hints: HINTS },
    "GET /api/hints": HINTS,
    "GET /api/tags": TAGS,
    "GET /api/items/deleted": [],
    "POST /api/hints": { id: "h3", name: "New", text: "", is_default: false },
    "PATCH /api/hints/h-default": DEFAULT_HINT,
    "PATCH /api/hints/h2": HINTS[1],
    "DELETE /api/hints/h2": { ok: true },
  });
  renderWithUser(<SettingsPage />, user, [entry]);
  return mock;
}

describe("Settings tabs", () => {
  it("parses ?tab= and falls back to Filters", () => {
    expect(parseSettingsTab("hints")).toBe("hints");
    expect(parseSettingsTab("tags")).toBe("tags");
    expect(parseSettingsTab(null)).toBe("shortcuts");
    expect(parseSettingsTab("bogus")).toBe("shortcuts");
  });

  it("/settings opens Filters by default, with AI hints as the next tab", async () => {
    setup("/settings");
    expect(screen.getByRole("tab", { name: "Filters" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "AI hints" }).getAttribute("aria-selected")).toBe("false");
    await screen.findByRole("button", { name: /Add Filter/ });
    expect(screen.queryByText("Sent to the AI with each photo. Pick one on the Add screen.")).toBeNull();
  });

  it("the tabs are Filters, Tags, AI hints; ?tab=tags shows the tags list with no second page title", async () => {
    setup("/settings?tab=tags");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Filters", "Tags", "AI hints"]);
    expect(screen.getByRole("tab", { name: "Tags" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Cables")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Tag/ })).toBeTruthy();
    expect(screen.queryByText("Group items with tags. An item can have several.")).toBeNull();
  });

  it("?tab=hints opens the AI hints tab, and clicking tabs switches between them", async () => {
    setup("/settings?tab=hints");
    expect(screen.getByRole("tab", { name: "AI hints" }).getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("Sent to the AI with each photo. Pick one on the Add screen.")).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Filters" }));
    expect(await screen.findByRole("button", { name: /Add Filter/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Filters" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("AI hints tab", () => {
  it("lists the Default first and gives it no Delete button", async () => {
    setup("/settings?tab=hints");
    const defaultRow = (await screen.findByText("General stuff")).closest("tr") as HTMLElement;
    expect(within(defaultRow).getAllByText("Default")).toHaveLength(2); // name and badge
    expect(within(defaultRow).queryByRole("button", { name: /Delete/ })).toBeNull();
    const partsRow = screen.getByText("Electronic parts").closest("tr") as HTMLElement;
    expect(within(partsRow).getByRole("button", { name: /Delete/ })).toBeTruthy();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Default");
  });

  it("the Default's name is locked, only its text is saved", async () => {
    const mock = setup("/settings?tab=hints");
    const row = (await screen.findByText("General stuff")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Edit/ }));
    const dialog = screen.getByRole("dialog", { name: "Edit hint" });
    expect((within(dialog).getByPlaceholderText("Electronic parts") as HTMLInputElement).disabled).toBe(true);
    const text = within(dialog).getByPlaceholderText(/What the AI should know/);
    await userEvent.clear(text);
    await userEvent.type(text, "Mixed household stuff");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.find("PATCH", "/api/hints/h-default")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/hints/h-default")[0].body).toEqual({ text: "Mixed household stuff" });
  });

  it("adds a hint with a name and text area", async () => {
    const mock = setup("/settings?tab=hints");
    await screen.findByText("General stuff");
    await userEvent.click(screen.getByRole("button", { name: /Add Hint/ }));
    const dialog = screen.getByRole("dialog", { name: "Add hint" });
    await userEvent.type(within(dialog).getByPlaceholderText("Electronic parts"), "Garden");
    await userEvent.type(within(dialog).getByPlaceholderText(/What the AI should know/), "Plants and tools");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.find("POST", "/api/hints")).toHaveLength(1));
    expect(mock.find("POST", "/api/hints")[0].body).toEqual({ name: "Garden", text: "Plants and tools" });
  });

  it("deletes a non-default hint after confirming", async () => {
    const mock = setup("/settings?tab=hints");
    const row = (await screen.findByText("Electronic parts")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Delete/ }));
    expect(mock.find("DELETE", "/api/hints/h2")).toHaveLength(0);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mock.find("DELETE", "/api/hints/h2")).toHaveLength(1));
  });
});

describe("Filters settings Tag select", () => {
  it("offers Any, Untagged and each tag, and stores tag_id", async () => {
    const mock = setup("/settings");
    await userEvent.click(await screen.findByRole("button", { name: /Add Filter/ }));
    const dialog = screen.getByRole("dialog");
    const select = within(dialog).getByText("Tag").closest("label")!.querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => [o.value, o.text])).toEqual([
      ["", "Any"],
      ["__none", "Untagged"],
      ["t1", "Cables"],
      ["t2", "Tools"],
    ]);
    expect(within(dialog).queryByText("Collection")).toBeNull();

    await userEvent.type(within(dialog).getByPlaceholderText("Low stock drills"), "Cable stock");
    await userEvent.selectOptions(select, "t1");
    await userEvent.click(within(dialog).getByRole("button", { name: /Save/ }));

    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    const sent = (mock.find("PATCH", "/api/me")[0].body as { shortcut_filters: Array<Record<string, unknown>> }).shortcut_filters;
    expect(sent[0]).toMatchObject({ name: "Cable stock", tag_id: "t1" });
    expect("collection" in sent[0]).toBe(false);
  });

  it("an existing filter shows its tag name in the Scope column and loads it into the select", async () => {
    setup("/settings", [makeFilter("f1", "Cable stock", { tag_id: "t1" }), makeFilter("f2", "Loose", { tag_id: "__none" })]);
    expect(await screen.findByText(/Cables · Any status/)).toBeTruthy();
    expect(screen.getByText(/Untagged · Any status/)).toBeTruthy();

    const row = screen.getByText("Cable stock").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: /Edit/ }));
    const select = within(screen.getByRole("dialog")).getByText("Tag").closest("label")!.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("t1");
  });
});
