import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecycleBinPage } from "../src/pages/RecycleBinPage";
import { TagsPage } from "../src/pages/TagsPage";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { navItems } from "../src/config/nav";
import { makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DELETED = [
  { id: "a", name: "Old drill", tags: [{ id: "t1", name: "Tools" }], location: "Shed" },
  { id: "b", name: "USB lead", tags: [{ id: "t2", name: "Cables" }], location: null },
  { id: "c", name: "Untagged thing", tags: [], location: "Loft" },
];

function setup(deleted: unknown[] = DELETED) {
  const user = makeUser();
  const mock = mockApi({
    "GET /api/items/deleted": deleted,
    "POST /api/items/deleted/purge": { deleted: deleted.length },
    "GET /api/tags": [makeTag("t1", "Tools")],
    "GET /api/me": user,
  });
  renderWithUser(<RecycleBinPage />, user, ["/recycle-bin"]);
  return mock;
}

describe("Recycle Bin page", () => {
  it("lists deleted items from every tag and location in one place", async () => {
    setup();
    for (const name of ["Old drill", "USB lead", "Untagged thing"]) expect(await screen.findByText(name)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Recycle Bin" })).toBeTruthy();
  });

  it("searches by name, tag and location", async () => {
    setup();
    await screen.findByText("Old drill");
    const box = screen.getByPlaceholderText("Search recycle bin…");
    await userEvent.type(box, "cables");
    expect(screen.queryByText("Old drill")).toBeNull();
    expect(screen.getByText("USB lead")).toBeTruthy();
  });

  it("shows an empty message and disables Empty when nothing is deleted", async () => {
    setup([]);
    expect(await screen.findByText("Recycle bin is empty.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Empty" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("empties the bin only after confirming", async () => {
    const mock = setup();
    await screen.findByText("Old drill");
    await userEvent.click(screen.getByRole("button", { name: "Empty" }));
    expect(mock.find("POST", "/api/items/deleted/purge")).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Permanently Delete" }));
    await waitFor(() => expect(mock.find("POST", "/api/items/deleted/purge")).toHaveLength(1));
  });

  it("has a Restore button per row", async () => {
    setup();
    const row = (await screen.findByText("Old drill")).closest("tr") as HTMLElement;
    expect(within(row).getByRole("button", { name: "Restore" })).toBeTruthy();
  });
});

describe("Recycle Bin entry points", () => {
  it("is a menu entry between Filters and Settings, in the sidebar, the drawer and the palette list", async () => {
    const labels = navItems.map((i) => i.label);
    expect(labels.indexOf("Recycle Bin")).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf("Recycle Bin")).toBeLessThan(labels.indexOf("Settings"));
    expect(navItems.find((i) => i.label === "Recycle Bin")?.route).toBe("/recycle-bin");

    const user = makeUser();
    mockApi({ "GET /api/tags": [], "GET /api/me": user });
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, user, ["/items"]);
    const link = (await screen.findAllByRole("link", { name: /Recycle Bin/ }))[0];
    expect(link.getAttribute("href")).toBe("/recycle-bin");
    cleanup();
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, user, ["/items"]);
    expect((await screen.findAllByRole("link", { name: /Recycle Bin/ }))[0].getAttribute("href")).toBe("/recycle-bin");
  });

  it("is no longer a button on the Tags tab", async () => {
    const user = makeUser();
    mockApi({ "GET /api/tags": [makeTag("t1", "Cables")], "GET /api/me": user });
    renderWithUser(<TagsPage />, user, ["/tags"]);
    await screen.findByText("Cables");
    expect(screen.queryByText(/Recycle Bin/)).toBeNull();
  });
});
