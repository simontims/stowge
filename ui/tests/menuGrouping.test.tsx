import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { Sidebar } from "../src/components/layout/Sidebar";
import { MobileNavDrawer } from "../src/components/layout/MobileNavDrawer";
import { makeFilter, makeTag, makeUser, mockApi, renderWithUser } from "./testUtils";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FILTERS = [makeFilter("f1", "Attic", { tag_id: "t1" }), makeFilter("f2", "Tools", { tag_id: "t2" })];

function setup(role: "admin" | "user" = "admin") {
  const user = makeUser({ role, shortcut_filters: FILTERS as never });
  mockApi({ "GET /api/tags": [makeTag("t1", "Attic"), makeTag("t2", "Tools")], "GET /api/me": user, "PATCH /api/me": user });
  return user;
}

function linkNames(nav: HTMLElement) {
  return within(nav).getAllByRole("link").map((a) => a.getAttribute("aria-label") ?? a.textContent);
}

describe("menu: the ITEMS group", () => {
  it("lists Add Item, All items, the filters and Recycle Bin together, then Settings and System", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup(), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    expect(linkNames(nav)).toEqual(["Add Item", "All items", "Attic", "Tools", "Recycle Bin", "Settings", "System"]);
  });

  it("has an ITEMS label above All items (written Items, drawn in capitals)", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup(), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    const label = screen.getByText("Items", { selector: "p" });
    expect(label.className).toContain("uppercase");
    const order = label.compareDocumentPosition(screen.getByRole("link", { name: "All items" }));
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("only the filter list scrolls: Recycle Bin, Settings and System stay outside the scrolling area", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup(), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    const scroller = screen.getByRole("link", { name: "Attic" }).closest(".overflow-y-auto") as HTMLElement;
    expect(scroller).toBeTruthy();
    for (const name of ["Recycle Bin", "Settings", "System", "All items", "Add Item"]) {
      expect(scroller.contains(screen.getByRole("link", { name })), name).toBe(false);
    }
  });

  it("a rule, not a label, marks Settings and System as the app's own section", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup(), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    const settings = screen.getByRole("link", { name: "Settings" });
    const rule = (settings.parentElement as HTMLElement).querySelector("[aria-hidden='true'].border-t");
    expect(rule).toBeTruthy();
    expect(rule?.className).toContain("border-border-strong");
  });

  it("System is for admins only", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup("user"), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    expect(screen.queryByRole("link", { name: "System" })).toBeNull();
    expect(screen.getByRole("link", { name: "Recycle Bin" })).toBeTruthy();
  });

  it("marks only the current page with aria-current", async () => {
    renderWithUser(<Sidebar collapsed={false} onToggleCollapse={() => {}} />, setup(), ["/recycle-bin"]);
    await screen.findByRole("link", { name: "Attic" });
    expect(screen.getByRole("link", { name: "Recycle Bin" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "All items" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("link", { name: "Settings" }).getAttribute("aria-current")).toBeNull();
  });
});

describe("menu: collapsed rail and drawer", () => {
  it("the collapsed rail keeps the filters as icons with names, and has a rule instead of the label", async () => {
    renderWithUser(<Sidebar collapsed onToggleCollapse={() => {}} />, setup(), ["/items"]);
    const nav = (await screen.findAllByRole("navigation", { name: "Main navigation" }))[0];
    expect(linkNames(nav)).toEqual(["Add Item", "All items", "Attic", "Tools", "Recycle Bin", "Settings", "System"]);
    expect(screen.queryByText("Items", { selector: "p" })).toBeNull();
    const attic = screen.getByRole("link", { name: "Attic" });
    expect(attic.getAttribute("title")).toBe("Attic");
    expect(attic.textContent).toBe(""); // icon only: the name is the tooltip and the accessible name
    expect(screen.getByRole("heading", { name: "Filters" })).toBeTruthy();
    expect(nav.querySelectorAll("[aria-hidden='true'].border-t").length).toBe(2);
    expect(screen.getByRole("link", { name: "Recycle Bin" }).getAttribute("title")).toBe("Recycle Bin");
  });

  it("the drawer has the same order and every row is at least 44px", async () => {
    renderWithUser(<MobileNavDrawer open onClose={() => {}} />, setup(), ["/items"]);
    await screen.findByRole("link", { name: "Attic" });
    const nav = screen.getAllByRole("navigation", { name: "Main navigation" })[0];
    expect(linkNames(nav)).toEqual(["Add Item", "All items", "Attic", "Tools", "Recycle Bin", "Settings", "System"]);
    for (const name of ["All items", "Attic", "Recycle Bin", "Settings", "System"]) {
      expect(screen.getByRole("link", { name }).className, name).toContain("min-h-11");
    }
    expect(nav.querySelector("[data-tour]")).toBeNull(); // tour targets live in the desktop sidebar only
  });
});
