import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every list says Loading, then the error, then "none" the same way, through lib/listState.ts.
 *  A page that writes its own Loading text, or starts a list as `loading = false`, brings the flash back. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

function code(file: string): string {
  return readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const files = sources(join(__dirname, "..", "src")).filter((f) => !f.endsWith("lib/listState.ts"));

describe("loading text and loading state live in one place", () => {
  it("no file writes its own 'Loading…' or 'Loading <noun>...' text", () => {
    const offenders = files.filter((f) => /["'`>]Loading(\.\.\.|…| [a-z])/i.test(code(f)));
    // Dashboard's "Loading backup storage" is a sentence about one number, not a list state.
    expect(offenders.map((f) => f.split("/src/")[1]).filter((f) => f !== "pages/DashboardPage.tsx")).toEqual([]);
  });

  it("no list page starts with `loading` false", () => {
    const offenders = files.filter((f) => /\[loading, setLoading\] = useState\(false\)/.test(code(f)));
    // The login button's busy flag is not a list.
    expect(offenders.map((f) => f.split("/src/")[1]).filter((f) => f !== "pages/LoginPage.tsx")).toEqual([]);
  });

  it("no page builds its own 'error || (loading ? ...' chain", () => {
    const offenders = files.filter((f) => /error \|\| \(loading|loading\s*\?\s*"Loading/.test(code(f)));
    expect(offenders).toEqual([]);
  });
});
