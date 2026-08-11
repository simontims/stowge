export interface ShortcutFilter {
  id: string;
  name: string;
  query: string;
  collection: string | null;
  statuses: string[];
  status: string | null;
  site_id: string | null;
  area_id: string | null;
  location_id: string | null;
  quantity_min: number | null;
  quantity_max: number | null;
  pinned: boolean;
}

function trimText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseOptionalNonNegativeInt(value: unknown): number | null {
  const text = trimText(value);
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeStatus(value: unknown): string | null {
  const normalized = trimText(value);
  return normalized || null;
}

function normalizeStatuses(value: unknown, fallbackStatus: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = trimText(entry);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }

  if (out.length === 0) {
    const fallback = normalizeStatus(fallbackStatus);
    if (fallback) {
      out.push(fallback);
    }
  }

  return out;
}

export function normalizeShortcutFilter(input: Partial<ShortcutFilter>): ShortcutFilter {
  const quantityMin = parseOptionalNonNegativeInt(input.quantity_min);
  const quantityMax = parseOptionalNonNegativeInt(input.quantity_max);
  const normalizedMin = quantityMin;
  const normalizedMax = quantityMax;
  const statuses = normalizeStatuses(input.statuses, input.status);

  return {
    id: trimText(input.id),
    name: trimText(input.name),
    query: trimText(input.query),
    collection: trimText(input.collection) || null,
    statuses,
    status: statuses.length === 1 ? statuses[0] : null,
    site_id: trimText(input.site_id) || null,
    area_id: trimText(input.area_id) || null,
    location_id: trimText(input.location_id) || null,
    quantity_min:
      normalizedMin !== null && normalizedMax !== null && normalizedMin > normalizedMax
        ? normalizedMax
        : normalizedMin,
    quantity_max:
      normalizedMin !== null && normalizedMax !== null && normalizedMax < normalizedMin
        ? normalizedMin
        : normalizedMax,
    pinned: Boolean(input.pinned),
  };
}

export function buildShortcutFilterParams(filter: ShortcutFilter): URLSearchParams {
  const params = new URLSearchParams();
  const query = trimText(filter.query);
  const collection = trimText(filter.collection);
  const statusList = normalizeStatuses(filter.statuses, filter.status);
  const siteId = trimText(filter.site_id);
  const areaId = trimText(filter.area_id);
  const locationId = trimText(filter.location_id);
  const quantityMin = parseOptionalNonNegativeInt(filter.quantity_min);
  const quantityMax = parseOptionalNonNegativeInt(filter.quantity_max);

  if (query) {
    params.set("q", query);
  }
  if (collection) {
    params.set("collection", collection);
  }
  if (statusList.length === 1) {
    params.set("status", statusList[0]);
  } else if (statusList.length > 1) {
    params.set("status", statusList.join(","));
  }
  if (siteId) {
    params.set("site_id", siteId);
  }
  if (areaId) {
    params.set("area_id", areaId);
  }
  if (locationId) {
    params.set("location_id", locationId);
  }
  if (quantityMin !== null) {
    params.set("quantity_min", String(quantityMin));
  }
  if (quantityMax !== null) {
    params.set("quantity_max", String(quantityMax));
  }

  return params;
}

export function buildShortcutFilterSearch(filter: ShortcutFilter): string {
  return buildShortcutFilterParams(filter).toString();
}

export function isShortcutFilterActive(filter: ShortcutFilter, currentSearch: string): boolean {
  const current = new URLSearchParams(currentSearch);
  const target = buildShortcutFilterParams(filter);

  const keys = [
    "q",
    "collection",
    "status",
    "site_id",
    "area_id",
    "location_id",
    "quantity_min",
    "quantity_max",
  ];

  return keys.every((key) => ((current.get(key) || "").trim() === (target.get(key) || "").trim()));
}
