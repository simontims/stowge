// This module is ONLY ever dynamically imported — never statically.
// Vite detects the dynamic import and splits it into its own lazy chunk,
// keeping the main bundle untouched.

import * as TablerIcons from "@tabler/icons-react";
import type { ComponentType } from "react";

export type TablerIconComponent = ComponentType<{
  size?: number | string;
  stroke?: number | string;
  color?: string;
  className?: string;
}>;

export interface TablerEntry {
  name: string; // kebab-case, no "Icon" prefix — e.g. "arrow-left"
  component: TablerIconComponent;
}

/** Convert a PascalCase Tabler component name to a kebab-case display name.
 *  IconBarChart3 → "bar-chart-3",  IconArrowLeft → "arrow-left" */
function toKebabName(componentName: string): string {
  return componentName
    .replace(/^Icon/, "")
    .replace(/([A-Z])/g, (m, _p, offset: number) =>
      offset > 0 ? "-" + m.toLowerCase() : m.toLowerCase()
    )
    .replace(/([a-z])([0-9])/g, "$1-$2")
    .replace(/-+/g, "-")
    .replace(/^-/, "");
}

export const TABLER_CATALOGUE: TablerEntry[] = (
  Object.entries(TablerIcons) as Array<[string, unknown]>
)
  .filter(
    ([key, val]) =>
      /^Icon[A-Z0-9]/.test(key) &&
      typeof val === "function" &&
      key !== "IconContext"
  )
  .map(([key, val]) => ({
    name: toKebabName(key),
    component: val as TablerIconComponent,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));
