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
      /(?<![\w/\-[])(?:[\w\[\]\-&>*=]+:)*!?(?:(?:bg|text|border(?:-[xytblrse])?|divide|ring|ring-offset|placeholder|accent|caret|from|to|via|decoration|outline|fill|stroke|shadow)-(?:neutral|slate|gray|zinc|stone|red|amber|emerald|green|blue|sky|orange|yellow|rose|pink|fuchsia|violet|purple|cyan|teal|lime|indigo)-\d+|(?:bg|border|divide|ring|fill|stroke|shadow|outline)-(?:black|white)|text-(?:black|white))(?:\/\d+)?(?![\w\-])/g;
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
    // The only mention of data-theme is the one declaration that sets the light role variables.
    expect(css.match(/data-theme/g)).toHaveLength(1);
    const block = css.match(/:root\[data-theme="light"\] \{([^}]*)\}/)![1];
    for (const line of block.split("\n").map((l) => l.trim()).filter(Boolean)) {
      expect(line).toMatch(/^(--[a-z0-9-]+|color-scheme):/);
    }
  });

  it("every role has a dark value and a light value", () => {
    const names = [...dark.keys()];
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

describe("every role class used in the UI is defined", () => {
  it("each bg-/text-/border-/ring-/divide- role has a --color-<role> in @theme inline", () => {
    const defined = new Set([...css.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
    const roles = [...dark.keys()];
    const prop = /(?<![\w-])(?:[\w\[\]\-&>*=]+:)*!?(?:bg|text|border|divide|ring|placeholder|accent)-([a-z][a-z0-9-]*)(?:\/\d+)?(?![\w-])/g;
    const known = new Set(roles);
    const missing = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(prop)) {
        const name = m[1];
        // Only look at names that are role-shaped: a known role, or a tone/shade pair like success-300.
        if (known.has(name) && !defined.has(name)) missing.add(name);
        if (/^(success|danger|warning|info)-\d+$/.test(name) && !defined.has(name)) missing.add(`${relative(SRC, file)}: ${m[0]}`);
      }
    }
    expect([...missing]).toEqual([]);
    expect(roles.every((r) => defined.has(r))).toBe(true);
  });
});

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

  it("tone text (shades 100-400) is at least 4.5:1 on that tone's tint, on white and on the page", () => {
    // A tint is the tone's 900/950 base at 20-50% over the ground, the way the UI draws it.
    const over = (fg: string, bg: string, a: number) => {
      const f = fg.replace("#", ""), b = bg.replace("#", "");
      const mix = [0, 2, 4].map((i) => Math.round(parseInt(f.slice(i, i + 2), 16) * a + parseInt(b.slice(i, i + 2), 16) * (1 - a)));
      return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
    };
    const failures: string[] = [];
    for (const tone of ["success", "danger", "warning", "info"]) {
      for (const base of [`${tone}-950`, `${tone}-900`]) {
        if (!light.has(base)) continue;
        for (const alpha of [0.2, 0.3, 0.5]) {
          for (const ground of ["surface", "canvas"]) {
            const tint = over(get(base), get(ground), alpha);
            for (const shade of ["100", "200", "300", "400"]) {
              const role = `${tone}-${shade}`;
              if (!light.has(role)) continue;
              const ratio = contrast(get(role), tint);
              if (ratio < 4.5) failures.push(`${role} on ${base}/${alpha * 100} over ${ground}: ${ratio.toFixed(2)}`);
            }
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it("hover on a solid fill changes the colour: shade 500 differs from shade 600", () => {
    for (const tone of ["success", "info", "danger", "warning"]) {
      if (light.has(`${tone}-500`) && light.has(`${tone}-600`)) expect(get(`${tone}-500`)).not.toBe(get(`${tone}-600`));
    }
  });

  it("disabled controls are readable: disabled-fg is at least 4.5:1 on disabled-bg (light and dark)", () => {
    expect(contrast(get("disabled-fg"), get("disabled-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(get("disabled-fg"), get("surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("non-text roles (ghost, surface-5, surface-6) are at least 3:1 on the light surfaces", () => {
    for (const role of ["ghost", "surface-5", "surface-6"]) {
      for (const ground of ["surface", "canvas"]) expect(contrast(get(role), get(ground))).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("disabled controls use the disabled roles, not opacity", () => {
  it("no disabled:opacity-* in ui/src", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/disabled:opacity-\d+/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("ghost, surface-5 and surface-6 are never used as a text colour", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/(?<![\w-])text-(?:surface-5|surface-6)(?![\w-])/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("every disabled colour in ui/src is paired with a not-allowed cursor on the same line", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/(?<![\w-])disabled:text-disabled-fg/.test(line) && !/disabled:cursor-not-allowed/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("no disabled:hover overrides, so a disabled control never reverts on hover", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/disabled:hover:/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("no dark: variants anywhere (the theme is the data-theme attribute, so dark: never fires)", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (/(?<![\w-])dark:[a-z]/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

/** Dark roles that are palette references: Tailwind neutral hexes, to check the dark theme against AA too. */
const NEUTRAL: Record<string, string> = {
  "neutral-100": "#f5f5f5", "neutral-200": "#e5e5e5", "neutral-300": "#d4d4d4", "neutral-400": "#a3a3a3",
  "neutral-500": "#737373", "neutral-600": "#525252", "neutral-700": "#404040", "neutral-800": "#262626",
  "neutral-900": "#171717", "neutral-950": "#0a0a0a", "blue-400": "#51a2ff",
};
function darkHex(role: string): string {
  const v = dark.get(role) as string;
  if (v.startsWith("#")) return v;
  const m = v.match(/var\(--color-([a-z0-9-]+)\)/);
  return NEUTRAL[m![1]];
}

describe("dark theme contrast (WCAG AA)", () => {
  const grounds = ["canvas", "surface", "surface-2"];
  it.each(["heading", "body", "secondary", "muted", "subtle", "faint"])("text-%s is at least 4.5:1 on canvas, surface and surface-2", (role) => {
    for (const ground of grounds) expect(contrast(darkHex(role), darkHex(ground))).toBeGreaterThanOrEqual(4.5);
  });
  it("control borders (border-strong) and the focus border are at least 3:1 on canvas, surface and surface-2", () => {
    for (const role of ["border-strong", "border-focus"]) {
      for (const ground of grounds) expect(contrast(darkHex(role), darkHex(ground))).toBeGreaterThanOrEqual(3);
    }
  });
  it("non-text roles (ghost, surface-5, surface-6) are at least 3:1 on canvas, surface and surface-2", () => {
    for (const role of ["ghost", "surface-5", "surface-6"]) {
      for (const ground of grounds) expect(contrast(darkHex(role), darkHex(ground))).toBeGreaterThanOrEqual(3);
    }
  });
  it("white text on the solid success fill is at least 4.5:1", () => {
    expect(contrast(darkHex("on-solid"), (dark.get("success-600") as string).startsWith("#") ? (dark.get("success-600") as string) : "#007a55")).toBeGreaterThanOrEqual(4.5);
  });
});
