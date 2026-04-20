import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
import type { TablerEntry } from "../../lib/tablerIconCatalogue";

// Module-level cache: lazy-load once, reuse for the full session.
let catalogue: TablerEntry[] | null = null;
let cataloguePromise: Promise<TablerEntry[]> | null = null;

function loadCatalogue(): Promise<TablerEntry[]> {
  if (catalogue) return Promise.resolve(catalogue);
  if (!cataloguePromise) {
    cataloguePromise = import("../../lib/tablerIconCatalogue").then((m) => {
      catalogue = m.TABLER_CATALOGUE;
      return catalogue;
    });
  }
  return cataloguePromise;
}

interface TablerIconProps {
  name?: string | null;
  size?: number;
  color?: string | null;
}

export function TablerIcon({ name, size = 15, color }: TablerIconProps) {
  const [entry, setEntry] = useState<TablerEntry | null>(() =>
    name && catalogue ? (catalogue.find((e) => e.name === name) ?? null) : null
  );

  useEffect(() => {
    if (!name) return;
    if (catalogue) {
      setEntry(catalogue.find((e) => e.name === name) ?? null);
      return;
    }

    let cancelled = false;
    loadCatalogue().then((cat) => {
      if (!cancelled) setEntry(cat.find((e) => e.name === name) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);

  if (!name || !entry) return <Tag size={size} />;
  const C = entry.component;
  return <C size={size} stroke={1.5} color={color || undefined} />;
}
