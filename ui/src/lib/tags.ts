import { apiRequest } from "./api";
import { UNTAGGED, normalizeShortcutFilter, type ShortcutFilter } from "./shortcutFilters";
import type { AiHint, CurrentUser, ItemTag, Tag } from "./types";

export { UNTAGGED };

export interface TagInput {
  name: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
}

export function listTags(): Promise<Tag[]> {
  return apiRequest<Tag[]>("/api/tags");
}

export function createTag(input: TagInput): Promise<Tag> {
  return apiRequest<Tag>("/api/tags", { method: "POST", body: JSON.stringify(input) });
}

export function updateTag(id: string, input: TagInput): Promise<Tag> {
  return apiRequest<Tag>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTag(id: string): Promise<{ ok: boolean; items_untagged: number }> {
  return apiRequest(`/api/tags/${id}`, { method: "DELETE" });
}

export function listHints(): Promise<AiHint[]> {
  return apiRequest<AiHint[]>("/api/hints");
}

export function createHint(input: { name: string; text: string }): Promise<AiHint> {
  return apiRequest<AiHint>("/api/hints", { method: "POST", body: JSON.stringify(input) });
}

/** The Default hint only accepts `text`; the API rejects anything else. */
export function updateHint(id: string, input: { name?: string; text: string }): Promise<AiHint> {
  return apiRequest<AiHint>(`/api/hints/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteHint(id: string): Promise<{ ok: boolean }> {
  return apiRequest(`/api/hints/${id}`, { method: "DELETE" });
}

export function compareTagNames(a: { name: string }, b: { name: string }): number {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

/** The hint the Add screen starts on: the user's saved one if it still exists, else the Default. */
export function resolveHintId(hints: readonly AiHint[], preferredId: string | null | undefined): string {
  if (preferredId && hints.some((hint) => hint.id === preferredId)) return preferredId;
  return hints.find((hint) => hint.is_default)?.id ?? "";
}

/** The sticky tag ids that still exist (a deleted tag is dropped by the server, but be safe). */
export function validTagIds(tags: readonly Pick<Tag, "id">[], ids: readonly string[] | undefined): string[] {
  const known = new Set(tags.map((tag) => tag.id));
  return (ids ?? []).filter((id) => known.has(id));
}

export function toItemTags(tags: readonly Tag[], ids: readonly string[]): ItemTag[] {
  return ids
    .map((id) => tags.find((tag) => tag.id === id))
    .filter((tag): tag is Tag => Boolean(tag))
    .map(({ id, name, icon, color }) => ({ id, name, icon, color }));
}

function newFilterId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `sc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Append a pinned filter for a tag. Returns null when the user already has a filter for that tag. */
export function appendPinnedTagFilter(filters: readonly ShortcutFilter[], tag: Tag): ShortcutFilter[] | null {
  if (filters.some((row) => row.tag_id === tag.id)) return null;
  const row = normalizeShortcutFilter({
    id: newFilterId(),
    name: tag.name,
    tag_id: tag.id,
    icon: tag.icon,
    color: tag.color,
    pinned: true,
  });
  return [...filters, row];
}

/** "Pin tag filter": add a pinned filter for the tag to the user's shortcut filters. */
export async function pinTagToMenu(tag: Tag): Promise<"pinned" | "exists"> {
  const me = await apiRequest<CurrentUser>("/api/me");
  const current = (me.shortcut_filters || []).map((row) => normalizeShortcutFilter(row));
  const next = appendPinnedTagFilter(current, tag);
  if (!next) return "exists";
  await apiRequest<CurrentUser>("/api/me", { method: "PATCH", body: JSON.stringify({ shortcut_filters: next }) });
  return "pinned";
}
