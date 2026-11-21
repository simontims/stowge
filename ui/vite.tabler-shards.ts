import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

/**
 * Virtual modules that split the Tabler icon set into small shards keyed by the first two
 * characters of the kebab-case icon name ("arrow-left" -> shard "ar").
 *
 *  - `virtual:tabler-shards` exports { [shardKey]: () => import(shard) }
 *  - each shard's default export is { [kebabName]: IconComponent }
 *
 * Showing one tag's icon then downloads one shard (a few KB..tens of KB) instead of the whole
 * 2.6 MB icon catalogue. The icon-picker still uses the full catalogue (tablerIconCatalogue.ts).
 */
const INDEX_ID = "virtual:tabler-shards";
const SHARD_PREFIX = "virtual:tabler-shard/";

/** Mirrors toKebabName() in src/lib/tablerIconCatalogue.ts. */
export function tablerKebabName(componentName: string): string {
  return componentName
    .replace(/^Icon/, "")
    .replace(/([A-Z])/g, (m, _p, offset: number) => (offset > 0 ? "-" + m.toLowerCase() : m.toLowerCase()))
    .replace(/([a-z])([0-9])/g, "$1-$2")
    .replace(/-+/g, "-")
    .replace(/^-/, "");
}

export function tablerShards(): Plugin {
  let shards: Map<string, Array<[string, string]>> | null = null;

  function load(): Map<string, Array<[string, string]>> {
    if (shards) return shards;
    const require = createRequire(import.meta.url);
    const pkgDir = dirname(require.resolve("@tabler/icons-react/package.json"));
    const iconsDir = join(pkgDir, "dist", "esm", "icons");
    shards = new Map();
    // The package's barrel file lists every public export, including aliases such as
    // `export { default as Icon123, default as IconNumber123 } from './icons/IconNumber123.mjs'`.
    // Reading it (rather than the Icon*.mjs filenames) keeps the shards identical to the
    // catalogue the icon picker offers.
    const barrel = readFileSync(join(pkgDir, "dist", "esm", "tabler-icons-react.mjs"), "utf8");
    const entries = new Map<string, string>();
    for (const line of barrel.split("\n")) {
      const from = /\bfrom\s+'\.\/icons\/([A-Za-z0-9]+\.mjs)'/.exec(line);
      if (!from) continue;
      for (const m of line.matchAll(/default as (Icon[A-Z0-9][A-Za-z0-9]*)/g)) {
        entries.set(tablerKebabName(m[1]), join(iconsDir, from[1]).replace(/\\/g, "/"));
      }
    }
    // Fallback for any icon file the barrel does not mention.
    for (const file of readdirSync(iconsDir).sort()) {
      const match = /^(Icon[A-Z0-9][A-Za-z0-9]*)\.mjs$/.exec(file);
      if (!match) continue;
      const name = tablerKebabName(match[1]);
      if (!entries.has(name)) entries.set(name, join(iconsDir, file).replace(/\\/g, "/"));
    }
    // Sorted so the generated shard source (and so the chunk hashes) never depends on file order.
    for (const [name, path] of [...entries].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
      const key = name.slice(0, 2);
      const list = shards.get(key) ?? [];
      list.push([name, path]);
      shards.set(key, list);
    }
    return shards;
  }

  return {
    name: "stowge-tabler-shards",
    resolveId(id) {
      if (id === INDEX_ID || id.startsWith(SHARD_PREFIX)) return "\0" + id;
      return null;
    },
    load(id) {
      if (id === "\0" + INDEX_ID) {
        const lines = [...load().keys()]
          .sort()
          .map((key) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(SHARD_PREFIX + key)}),`);
        return `export default {\n${lines.join("\n")}\n};\n`;
      }
      if (id.startsWith("\0" + SHARD_PREFIX)) {
        const key = id.slice(1 + SHARD_PREFIX.length);
        const icons = load().get(key) ?? [];
        const imports = icons.map(([, path], i) => `import I${i} from ${JSON.stringify(path)};`);
        const entries = icons.map(([name], i) => `  ${JSON.stringify(name)}: I${i},`);
        return `${imports.join("\n")}\nexport default {\n${entries.join("\n")}\n};\n`;
      }
      return null;
    },
  };
}
