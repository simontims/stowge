import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildShortcutFilterSearch, normalizeShortcutFilter } from "../src/lib/shortcutFilters";
import { ShortcutIcon } from "../src/components/ui/ShortcutIcon";

afterEach(cleanup);

describe("normalizeShortcutFilter icon and colour", () => {
  it("keeps a chosen icon and colour", () => {
    const row = normalizeShortcutFilter({ id: "1", name: "Cables", icon: " cable ", color: "#38bdf8" });
    expect(row.icon).toBe("cable");
    expect(row.color).toBe("#38bdf8");
  });

  it("defaults old filters (no icon or colour) to null", () => {
    const row = normalizeShortcutFilter({ id: "1", name: "Old", query: "m6", pinned: true });
    expect(row.icon).toBeNull();
    expect(row.color).toBeNull();
    expect(row.query).toBe("m6");
    expect(row.pinned).toBe(true);
  });

  it("treats blanks as unset", () => {
    const row = normalizeShortcutFilter({ id: "1", name: "x", icon: "  ", color: "" });
    expect(row.icon).toBeNull();
    expect(row.color).toBeNull();
  });

  it("does not put icon or colour in the item search", () => {
    const row = normalizeShortcutFilter({ id: "1", name: "x", query: "m6", icon: "box", color: "#fff" });
    expect(buildShortcutFilterSearch(row)).toBe("q=m6");
  });
});

describe("ShortcutIcon", () => {
  it("falls back to the default filter icon, coloured when a colour is set", () => {
    const { container } = render(<ShortcutIcon filter={{ icon: null, color: "#ff0000" }} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("style") ?? "").toContain("color");
  });

  it("uses no inline colour when none is set", () => {
    const { container } = render(<ShortcutIcon filter={{ icon: null, color: null }} />);
    expect(container.querySelector("svg")?.getAttribute("style")).toBeNull();
  });
});
