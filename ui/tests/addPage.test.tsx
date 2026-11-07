import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddPage } from "../src/pages/AddPage";
import { DEFAULT_HINT, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

vi.mock("../src/lib/resizeImage", () => ({ resizeImage: async (file: File) => file }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const TAGS = [makeTag("t1", "Cables"), makeTag("t2", "Tools")];
const HINTS = [DEFAULT_HINT, { id: "h2", name: "Parts", text: "Electronic parts", is_default: false }];
const LLM = { id: "llm1", name: "GPT", provider: "openai", model: "x", is_default: true, ai_max_edge: 1600, ai_quality: 85 };

function bootstrap(overrides: Record<string, unknown> = {}) {
  return {
    tags: TAGS,
    hints: HINTS,
    locations: [],
    ai_settings: { default_llm_id: "llm1", configs: [LLM] },
    ...overrides,
  };
}

function api(extra: Record<string, unknown> = {}, boot: Record<string, unknown> = {}) {
  return mockApi({
    "GET /api/items/bootstrap": bootstrap(boot),
    "PATCH /api/me": makeUser(),
    "POST /api/items": { id: "new1" },
    "POST /api/identify": { ai: { candidates: [{ name: "Cable" }] }, stored_images: [] },
    ...extra,
  });
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function hintSelect() {
  return (await screen.findByLabelText("AI hint")) as HTMLSelectElement;
}

describe("Add page hint select", () => {
  it("is always shown, even with only the Default hint and no AI model", async () => {
    api({}, { hints: [DEFAULT_HINT], ai_settings: { default_llm_id: null, configs: [] } });
    renderWithUser(<AddPage />);
    const select = await hintSelect();
    expect(select.value).toBe("h-default");
    expect(Array.from(select.options).map((o) => o.text)).toEqual(["Default"]);
  });

  it("starts on the saved hint, or on Default when the saved one no longer exists", async () => {
    api();
    const { unmount } = renderWithUser(<AddPage />, makeUser({ preferred_add_hint_id: "h2" }));
    await waitFor(async () => expect((await hintSelect()).value).toBe("h2"));
    unmount();

    renderWithUser(<AddPage />, makeUser({ preferred_add_hint_id: "deleted" }));
    await waitFor(async () => expect((await hintSelect()).value).toBe("h-default"));
  });
});

describe("Add page tags", () => {
  it("starts with the saved sticky tags as chips", async () => {
    api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_tag_ids: ["t2"] }));
    await waitFor(() => expect(screen.getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Tools×"]));
  });

  it("a tag in the URL (Add Item from a tagged list) replaces the saved ones", async () => {
    api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_tag_ids: ["t2"] }), ["/add?tag=cables"]);
    await waitFor(() => expect(screen.getAllByTestId("tag-chip").map((c) => c.textContent)).toEqual(["Cables×"]));
  });

  it("has no way to create a tag", async () => {
    api();
    renderWithUser(<AddPage />);
    await hintSelect();
    await userEvent.type(screen.getByRole("combobox", { name: "Tags" }), "Brand new");
    expect(screen.getByText("No matching tags.")).toBeTruthy();
  });
});

describe("Add page sticky saves", () => {
  it("changing the hint PATCHes /api/me once, debounced, null meaning Default", async () => {
    const mock = api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_hint_id: "h2" }));
    const select = await hintSelect();
    await waitFor(() => expect(select.value).toBe("h2"));

    await userEvent.selectOptions(select, "h-default");
    await userEvent.selectOptions(select, "h2");
    await userEvent.selectOptions(select, "h-default");
    expect(mock.find("PATCH", "/api/me")).toHaveLength(0);

    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/me")[0].body).toEqual({ preferred_add_hint_id: null });
  });

  it("picking a non-default hint saves its id", async () => {
    const mock = api();
    renderWithUser(<AddPage />);
    await userEvent.selectOptions(await hintSelect(), "h2");
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/me")[0].body).toEqual({ preferred_add_hint_id: "h2" });
  });

  it("changing the tags PATCHes preferred_add_tag_ids with the whole list", async () => {
    const mock = api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_tag_ids: ["t1"] }));
    await waitFor(() => expect(screen.getAllByTestId("tag-chip")).toHaveLength(1));
    await userEvent.click(screen.getByRole("combobox", { name: "Tags" }));
    await userEvent.click(screen.getByRole("option", { name: "Tools" }));
    await waitFor(() => expect(mock.find("PATCH", "/api/me")).toHaveLength(1));
    expect(mock.find("PATCH", "/api/me")[0].body).toEqual({ preferred_add_tag_ids: ["t1", "t2"] });
  });
});

describe("Add page identify and save", () => {
  it("Identify sends hint_id", async () => {
    const mock = api();
    const { container } = renderWithUser(<AddPage />, makeUser({ preferred_add_hint_id: "h2" }));
    const select = await hintSelect();
    await waitFor(() => expect(select.value).toBe("h2"));

    const input = container.querySelector("input[type=file]:not([capture])") as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "a.jpg", { type: "image/jpeg" }));
    await userEvent.click(screen.getByRole("button", { name: /Identify/ }));

    await waitFor(() => expect(mock.find("POST", "/api/identify")).toHaveLength(1));
    const url = new URL(mock.find("POST", "/api/identify")[0].path, "http://x");
    expect(url.searchParams.get("hint_id")).toBe("h2");
    expect(url.searchParams.get("llm_id")).toBe("llm1");
    expect(url.searchParams.has("collection_id")).toBe(false);
  });

  it("Save sends tag_ids and no collection", async () => {
    const mock = api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_tag_ids: ["t1", "t2"] }));
    await waitFor(() => expect(screen.getAllByTestId("tag-chip")).toHaveLength(2));

    await userEvent.click(screen.getByText("Continue manually"));
    await userEvent.type(screen.getByPlaceholderText("Item name"), "USB cable");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mock.find("POST", "/api/items")).toHaveLength(1));
    const body = mock.find("POST", "/api/items")[0].body as Record<string, unknown>;
    expect(body.tag_ids).toEqual(["t1", "t2"]);
    expect("collection" in body).toBe(false);
    expect(body.name).toBe("USB cable");
  });

  it("keeps the tags after saving, ready for the next item", async () => {
    api();
    renderWithUser(<AddPage />, makeUser({ preferred_add_tag_ids: ["t1"] }));
    await waitFor(() => expect(screen.getAllByTestId("tag-chip")).toHaveLength(1));
    await userEvent.click(screen.getByText("Continue manually"));
    await userEvent.type(screen.getByPlaceholderText("Item name"), "USB cable");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Continue manually")).toBeTruthy());
    expect(screen.getAllByTestId("tag-chip")).toHaveLength(1);
  });
});
