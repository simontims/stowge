import { describe, expect, it } from "vitest";
import {
  END_OF_LIST,
  UNTAGGED,
  buildShortcutFilterSearch,
  isShortcutFilterActive,
  normalizeShortcutFilter,
  reorderPinnedFilters,
} from "../src/lib/shortcutFilters";
import { appendPinnedTagFilter, resolveHintId, toItemTags, validTagIds } from "../src/lib/tags";
import { DEFAULT_HINT, makeFilter, makeTag } from "./testUtils";

const tags = [makeTag("t1", "Cables"), makeTag("t2", "Tools & Bits")];

function filter(id: string, extra: Record<string, unknown> = {}) {
  return normalizeShortcutFilter(makeFilter(id, id, extra) as never);
}

describe("shortcut filters by tag", () => {
  it("builds ?tag=<name> from the tag id", () => {
    expect(buildShortcutFilterSearch(filter("a", { tag_id: "t2" }), tags)).toBe("tag=Tools+%26+Bits");
  });

  it("untagged filters use tag=__none and need no tag list", () => {
    expect(buildShortcutFilterSearch(filter("a", { tag_id: UNTAGGED }))).toBe("tag=__none");
  });

  it("leaves the tag out when the tag id is unknown (never filters on an id)", () => {
    expect(buildShortcutFilterSearch(filter("a", { tag_id: "gone" }), tags)).toBe("");
  });

  it("keeps tag_id through normalise and drops a stored collection key", () => {
    const row = normalizeShortcutFilter({ ...makeFilter("a", "A", { tag_id: " t1 " }), collection: "Old" } as never);
    expect(row.tag_id).toBe("t1");
    expect("collection" in row).toBe(false);
  });

  it("is active only for the matching tag name", () => {
    const row = filter("a", { tag_id: "t1" });
    expect(isShortcutFilterActive(row, "?tag=Cables", tags)).toBe(true);
    expect(isShortcutFilterActive(row, "?tag=Other", tags)).toBe(false);
    expect(isShortcutFilterActive(row, "", tags)).toBe(false);
  });
});

describe("reorderPinnedFilters", () => {
  const rows = [filter("a"), filter("hidden", { pinned: false }), filter("b"), filter("c")];

  it("moves a filter before another and keeps unpinned filters in their slots", () => {
    const next = reorderPinnedFilters(rows, "c", "a", "before");
    expect(next?.map((r) => r.id)).toEqual(["c", "hidden", "a", "b"]);
  });

  it("moves after a target and to the end of the list", () => {
    expect(reorderPinnedFilters(rows, "a", "b", "after")?.map((r) => r.id)).toEqual(["b", "hidden", "a", "c"]);
    expect(reorderPinnedFilters(rows, "a", END_OF_LIST, "after")?.map((r) => r.id)).toEqual(["b", "hidden", "c", "a"]);
  });

  it("returns null when nothing moves or an id is unknown", () => {
    expect(reorderPinnedFilters(rows, "a", "b", "before")).toBeNull();
    expect(reorderPinnedFilters(rows, "nope", "b", "before")).toBeNull();
    expect(reorderPinnedFilters(rows, "a", "nope", "before")).toBeNull();
    expect(reorderPinnedFilters(rows, "hidden", "a", "before")).toBeNull();
  });
});

describe("appendPinnedTagFilter", () => {
  it("appends a pinned filter with the tag's name, id, icon and colour", () => {
    const tag = makeTag("t1", "Cables", { icon: "cable", color: "#38bdf8" });
    const next = appendPinnedTagFilter([filter("a")], tag);
    expect(next).toHaveLength(2);
    const added = next![1];
    expect(added).toMatchObject({ name: "Cables", tag_id: "t1", pinned: true, icon: "cable", color: "#38bdf8", query: "" });
    expect(added.id).toBeTruthy();
  });

  it("does nothing when a filter for that tag exists", () => {
    expect(appendPinnedTagFilter([filter("a", { tag_id: "t1" })], makeTag("t1", "Cables"))).toBeNull();
  });
});

describe("hint and tag helpers", () => {
  const hints = [DEFAULT_HINT, { id: "h2", name: "Parts", text: "x", is_default: false }];

  it("uses the saved hint if it exists, else the Default", () => {
    expect(resolveHintId(hints, "h2")).toBe("h2");
    expect(resolveHintId(hints, null)).toBe("h-default");
    expect(resolveHintId(hints, "deleted")).toBe("h-default");
  });

  it("keeps only tag ids that exist and maps ids to item tags", () => {
    expect(validTagIds(tags, ["t2", "zzz", "t1"])).toEqual(["t2", "t1"]);
    expect(validTagIds(tags, undefined)).toEqual([]);
    expect(toItemTags(tags, ["t2"])).toEqual([{ id: "t2", name: "Tools & Bits", icon: null, color: null }]);
  });
});
