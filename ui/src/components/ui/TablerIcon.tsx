import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import type { TablerIconComponent } from "../../lib/tablerIconCatalogue";

// Module-level cache: each icon is lazy-loaded once (as its own small chunk) and reused for the
// whole session. `null` records a confirmed unknown name so it is not looked up again; a failed
// load (network error, deleted chunk) is not cached, so a later render can try again.
const icons = new Map<string, TablerIconComponent | null>();
const pending = new Map<string, Promise<TablerIconComponent | null>>();

/** Load the shard (icons sharing the first two characters of their name) that holds `name`. */
export async function loadTablerIcon(name: string): Promise<TablerIconComponent | null> {
  const { default: shards } = await import("virtual:tabler-shards");
  const shard = shards[name.slice(0, 2)];
  if (!shard) return null;
  return (await shard()).default[name] ?? null;
}

function loadIcon(name: string): Promise<TablerIconComponent | null> {
  let promise = pending.get(name);
  if (!promise) {
    promise = loadTablerIcon(name)
      .then((component) => {
        icons.set(name, component);
        return component;
      })
      .catch(() => null)
      .finally(() => {
        pending.delete(name);
      });
    pending.set(name, promise);
  }
  return promise;
}

interface TablerIconProps {
  name?: string | null;
  size?: number;
  color?: string | null;
}

export function TablerIcon({ name, size = 15, color }: TablerIconProps) {
  const [, setLoaded] = useState(0);
  const component = name ? icons.get(name) : undefined;

  useEffect(() => {
    if (!name || icons.has(name)) return;
    let cancelled = false;
    void loadIcon(name).then(() => {
      if (!cancelled) setLoaded((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!name || !component) return <Tag size={size} />;
  const C = component;
  return <C size={size} stroke={1.5} color={color || undefined} />;
}
