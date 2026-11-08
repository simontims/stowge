import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../src/index.css"), "utf8");
const addPage = readFileSync(resolve(__dirname, "../src/pages/AddPage.tsx"), "utf8");

/** The Add page's sticky action bar (Continue manually / Identify, and Save in review) is a near-opaque
 *  dark surface. Without a light override it showed as a black strip in light mode. */
describe("light theme: Add page action bar", () => {
  it("has a light override for the bar's near-opaque dark background", () => {
    expect(css).toMatch(/:root\[data-theme="light"\] \.bg-neutral-900\\\/95\s*\{[^}]*background-color:\s*rgba\(255, 255, 255, 0\.95\)/);
  });

  it("both sticky action bars on the Add page use that background", () => {
    const bars = addPage.match(/sticky bottom-0[^"]*bg-neutral-900\/95/g) ?? [];
    expect(bars).toHaveLength(2);
  });

  it("the menu's Add Item current-page tint has a light override too, not a muddy dark green", () => {
    expect(css).toMatch(/:root\[data-theme="light"\] \.\\!bg-emerald-900\\\/50\s*\{[^}]*rgb\(167 243 208\)/);
  });
});
