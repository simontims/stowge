import type { LocationOption } from "./types";

function nonEmpty(value: string | null | undefined): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

export function buildLocationDisplayLabel(location: LocationOption, allLocations: LocationOption[]): string {
  const siteIds = new Set(allLocations.map((row) => nonEmpty(row.site_id)).filter(Boolean) as string[]);
  const areaIds = new Set(allLocations.map((row) => nonEmpty(row.area_id)).filter(Boolean) as string[]);

  const showSite = siteIds.size > 1;
  const showArea = showSite || areaIds.size > 1;

  const parts: string[] = [];
  if (showSite) {
    parts.push(nonEmpty(location.site_name) || "Site");
  }
  if (showArea) {
    parts.push(nonEmpty(location.area_name) || "Area");
  }
  parts.push(location.name);

  return parts.join(" / ");
}
