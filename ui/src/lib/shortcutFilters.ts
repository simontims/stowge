export interface ShortcutFilter {
  id: string;
  name: string;
  query: string;
  /** A tag id, UNTAGGED for items without a tag, or null for any. */
  tag_id: string | null;
  statuses: string[];
  status: string | null;
  site_id: string | null;
  area_id: string | null;
  location_id: string | null;
  quantity_min: number | null;
  quantity_max: number | null;
  pinned: boolean;
  /** Tabler icon name; null = default filter icon. */
  icon: string | null;
  /** Hex colour such as #38bdf8; null = default text colour. */
  color: string | null;
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
    tag_id: trimText(input.tag_id) || null,
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
    icon: trimText(input.icon) || null,
    color: trimText(input.color) || null,
  };
}

/** Tag id used by a filter (and `tag=` in the Items URL) for items that have no tag. */
export const UNTAGGED = "__none";

/** Just what is needed to turn a filter's tag id into the tag name the Items URL uses. */
export type TagRef = { id: string; name: string };

function tagParamFor(filter: ShortcutFilter, tags: readonly TagRef[]): string {
  const tagId = trimText(filter.tag_id);
  if (!tagId) return "";
  if (tagId === UNTAGGED) return UNTAGGED;
  return tags.find((tag) => tag.id === tagId)?.name ?? "";
}

export function buildShortcutFilterParams(filter: ShortcutFilter, tags: readonly TagRef[] = []): URLSearchParams {
  const params = new URLSearchParams();
  const query = trimText(filter.query);
  const tag = tagParamFor(filter, tags);
  const statusList = normalizeStatuses(filter.statuses, filter.status);
  const siteId = trimText(filter.site_id);
  const areaId = trimText(filter.area_id);
  const locationId = trimText(filter.location_id);
  const quantityMin = parseOptionalNonNegativeInt(filter.quantity_min);
  const quantityMax = parseOptionalNonNegativeInt(filter.quantity_max);

  if (query) {
    params.set("q", query);
  }
  if (tag) {
    params.set("tag", tag);
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

export function buildShortcutFilterSearch(filter: ShortcutFilter, tags: readonly TagRef[] = []): string {
  return buildShortcutFilterParams(filter, tags).toString();
}

export function isShortcutFilterActive(
  filter: ShortcutFilter,
  currentSearch: string,
  tags: readonly TagRef[] = [],
): boolean {
  const current = new URLSearchParams(currentSearch);
  const target = buildShortcutFilterParams(filter, tags);

  const keys = [
    "q",
    "tag",
    "status",
    "site_id",
    "area_id",
    "location_id",
    "quantity_min",
    "quantity_max",
  ];

  return keys.every((key) => ((current.get(key) || "").trim() === (target.get(key) || "").trim()));
}

/** Where a pinned filter can be dropped: before/after another filter, or at the end of the list. */
export const END_OF_LIST = "__end__";

/** Move one pinned filter and return the whole filter list in its new order. Unpinned filters keep
 *  their slots, so only the pinned ones change places. Returns null when nothing would move. */
export function reorderPinnedFilters(
  all: readonly ShortcutFilter[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): ShortcutFilter[] | null {
  const pinned = all.filter((row) => row.pinned);
  const sourceIdx = pinned.findIndex((row) => row.id === sourceId);
  if (sourceIdx < 0) return null;

  const [moved] = pinned.splice(sourceIdx, 1);
  let insertIdx: number;
  if (targetId === END_OF_LIST) {
    insertIdx = pinned.length;
  } else {
    const targetIdx = pinned.findIndex((row) => row.id === targetId);
    if (targetIdx < 0) return null;
    insertIdx = position === "after" ? targetIdx + 1 : targetIdx;
  }
  pinned.splice(insertIdx, 0, moved);

  let next = 0;
  const result = all.map((row) => (row.pinned ? pinned[next++] : row));
  const unchanged = result.every((row, idx) => row === all[idx]);
  return unchanged ? null : result;
}
