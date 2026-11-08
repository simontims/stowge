import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const SRC = resolve(__dirname, "../src");
const css = readFileSync(join(SRC, "index.css"), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Variables declared inside the `:root { ... }` block that matches `selector`. */
function declared(selector: RegExp): Map<string, string> {
  const m = css.match(selector);
  if (!m) throw new Error(`block not found: ${selector}`);
  const vars = new Map<string, string>();
  for (const d of m[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars.set(d[1], d[2].trim());
  return vars;
}
const dark = declared(/\n:root \{([^}]*)\}/);
const light = declared(/:root\[data-theme="light"\] \{([^}]*)\}/);

describe("colours come from semantic roles, not palette colours", () => {
  it("no palette colour classes (bg-neutral-900, text-red-300, bg-white, ...) are used in ui/src", () => {
    const raw =
      /(?<![\w/\-[])(?:[\w\[\]\-&>*=]+:)*!?(?:(?:bg|text|border|divide|ring|placeholder|accent|from|to|via|decoration)-(?:neutral|slate|gray|zinc|red|amber|emerald|green|blue|sky|orange|yellow|rose|violet|purple|cyan|teal|lime|indigo)-\d+|bg-black|bg-white|text-white|text-black|border-white|border-black)(?:\/\d+)?(?![\w\-])/g;
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith("index.css")) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(raw)) hits.push(`${relative(SRC, file)}:${i + 1} ${m[0]}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("index.css has no hand-written light-theme overrides: the light block only sets role variables", () => {
    expect(css).not.toMatch(/:root\[data-theme="light"\]\s+[.#\[a-z]/);
    const block = css.match(/:root\[data-theme="light"\] \{([^}]*)\}/)![1];
    for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      expect(line).toMatch(/^(--[a-z0-9-]+|color-scheme):/);
    }
  });

  it("every role has a dark value and a light value", () => {
    const names = [...dark.keys()].filter((k) => k !== "lightningcss-light");
    expect(names.length).toBeGreaterThan(40);
    expect([...light.keys()].sort()).toEqual(names.sort());
  });
});

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe("light theme contrast (WCAG AA)", () => {
  const get = (n: string) => light.get(n) as string;
  const grounds = ["surface", "canvas", "surface-2", "selected"];

  it.each(["heading", "body", "secondary", "muted", "subtle", "faint"])("text-%s is at least 4.5:1 on every light surface", (role) => {
    for (const ground of grounds) expect(contrast(get(role), get(ground))).toBeGreaterThanOrEqual(4.5);
  });

  it("control borders (border-strong) are at least 3:1 on the surface", () => {
    expect(contrast(get("border-strong"), get("surface"))).toBeGreaterThanOrEqual(3);
  });

  it("white text on the solid success and info fills is at least 4.5:1", () => {
    for (const fill of ["success-600", "info-600", "danger-600"]) {
      expect(contrast(get("on-solid"), get(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
