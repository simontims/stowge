import { describe, expect, it } from "vitest";

import { buildCenteredExcerpt } from "../src/lib/itemSearch";

describe("buildCenteredExcerpt", () => {
  it("centers the excerpt around the first description match and adds ellipses when clipped", () => {
    const excerpt = buildCenteredExcerpt(
      "Left context before the keyword match and trailing context after the keyword for visibility.",
      "keyword",
      32
    );

    expect(excerpt).not.toBeNull();
    expect(excerpt).toContain("keyword");
    expect(excerpt?.startsWith("...")).toBe(true);
    expect(excerpt?.endsWith("...")).toBe(true);
    expect(excerpt && excerpt.length).toBeGreaterThan(32);
  });

  it("returns the compacted full description when it already fits", () => {
    const excerpt = buildCenteredExcerpt("  Compact   keyword  text  ", "keyword", 40);

    expect(excerpt).toBe("Compact keyword text");
  });

  it("returns null when there is no match", () => {
    expect(buildCenteredExcerpt("A different description", "keyword", 24)).toBeNull();
  });
});