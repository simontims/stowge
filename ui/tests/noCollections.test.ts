import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

/** Lines allowed to keep the old word: the /collections redirect, the CSV import legacy note, and the
 *  one-off "collections are now tags" tour, which has to name what changed (plus the API field that
 *  carries the converted count). */
const ALLOWED: Array<{ file: string; line: RegExp; why: string }> = [
  { file: "App.tsx", line: /<Route path="\/collections" element=\{<Navigate to="\/settings\?tab=tags" replace \/>\} \/>/, why: "redirect" },
  { file: "pages/SettingsToolsPage.tsx", line: /Older files with a <span[^>]*>collection<\/span> column still import/, why: "CSV legacy note" },
  { file: "components/onboarding/whatsNew/tagsAndHintsSteps.tsx", line: /./, why: "migration tour copy" },
  { file: "components/onboarding/whatsNew/TagsAndHintsTour.tsx", line: /./, why: "migration tour" },
  { file: "lib/legacyLinks.ts", line: /./, why: "old ?collection= links keep working" },
  { file: "App.tsx", line: /LegacyCollectionLink|Old `\?collection=` links/, why: "legacy link upgrade" },
  { file: "lib/types.ts", line: /collections_converted|collections-to-tags migration/, why: "migration info from the API" },
];

function leftovers(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file).split("\\").join("/");
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, idx) => {
        if (!/collection/i.test(line)) return;
        if (ALLOWED.some((a) => a.file === rel && a.line.test(line))) return;
        found.push(`${rel}:${idx + 1}: ${line.trim()}`);
      });
  }
  return found;
}

describe("no collection references left in ui/src", () => {
  it("only the redirect and the CSV legacy note mention collections", () => {
    expect(leftovers()).toEqual([]);
  });

  it("the allowed lines really exist (so the allowlist cannot silently go stale)", () => {
    for (const entry of ALLOWED) {
      const text = readFileSync(join(SRC, entry.file), "utf8");
      expect(text.split("\n").some((line) => entry.line.test(line)), entry.why).toBe(true);
    }
  });

  it("the old API strings are gone", () => {
    const all = sourceFiles(SRC).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const old of ["/api/collections", "collection_id", "ai_hint", "preferred_add_collection_id", "last_open_collection", "collection_nav_order", "move_to_collection_id", "create_collections"]) {
      expect(all.includes(old), old).toBe(false);
    }
  });

  it("the old collections page and its nav event are removed", () => {
    expect(() => readFileSync(join(SRC, "pages/SettingsCollectionsPage.tsx"))).toThrow();
    expect(readFileSync(join(SRC, "config/nav.ts"), "utf8")).not.toContain("COLLECTIONS_NAV_UPDATED_EVENT");
  });
});
