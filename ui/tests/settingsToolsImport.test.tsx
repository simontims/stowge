import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsToolsPage } from "../src/pages/SettingsToolsPage";
import { makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PREVIEW = { item_count: 2, parse_errors: [], missing_tags: [], missing_sites: [], missing_areas: [], missing_locations: [] };

async function previewWith(extra: Record<string, unknown>) {
  mockApi({
    "GET /api/items/bootstrap": { tags: [], locations: [] },
    "POST /api/import/csv/preview": { ...PREVIEW, ...extra },
  });
  const { container } = renderWithUser(<SettingsToolsPage />, makeUser());
  const input = container.querySelector("input[type=file]") as HTMLInputElement;
  await userEvent.upload(input, new File(["name\nx"], "items.csv", { type: "text/csv" }));
  await userEvent.click(await screen.findByRole("button", { name: /Preview Import/ }));
  return (await screen.findByRole("button", { name: /Import 2 Items/ })) as HTMLButtonElement;
}

describe("CSV import preview: invalid tag names", () => {
  it("shows them in a warning and disables the import button", async () => {
    const confirm = await previewWith({ invalid_tags: ["a", "x;y"] });
    expect(screen.getByText(/These tag names cannot be used \(too short or containing ;\): a, x;y/)).toBeTruthy();
    expect(screen.getByText(/Edit the tag names in your CSV file/)).toBeTruthy();
    await waitFor(() => expect(confirm.disabled).toBe(true));
  });

  it("without the field (older API) there is no warning and the import is enabled", async () => {
    const confirm = await previewWith({});
    expect(screen.queryByText(/cannot be used/)).toBeNull();
    expect(confirm.disabled).toBe(false);
  });
});
