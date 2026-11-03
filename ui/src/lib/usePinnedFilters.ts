import { useCallback, useEffect, useState } from "react";
import { TAGS_NAV_UPDATED_EVENT, USER_NAV_PREFERENCES_UPDATED_EVENT } from "../config/nav";
import { apiRequest } from "./api";
import { UNTAGGED, reorderPinnedFilters, normalizeShortcutFilter, type ShortcutFilter } from "./shortcutFilters";
import type { CurrentUser, Tag } from "./types";

/** The menu's data: the user's filters (pinned ones are shown, in list order) and the tag
 *  list used to resolve a filter's tag id to the name in the Items URL. Reloads when tags or
 *  filters change elsewhere in the app. */
export function usePinnedFilters() {
  const [filters, setFilters] = useState<ShortcutFilter[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const [tagList, me] = await Promise.all([apiRequest<Tag[]>("/api/tags"), apiRequest<CurrentUser>("/api/me")]);
        if (!active) return;
        setTags(tagList || []);
        setFilters(Array.isArray(me.shortcut_filters) ? me.shortcut_filters.map((row) => normalizeShortcutFilter(row)) : []);
      } catch {
        if (!active) return;
        setTags([]);
        setFilters([]);
      }
    }

    void load();
    const reload = () => void load();
    window.addEventListener(TAGS_NAV_UPDATED_EVENT, reload);
    window.addEventListener(USER_NAV_PREFERENCES_UPDATED_EVENT, reload);
    return () => {
      active = false;
      window.removeEventListener(TAGS_NAV_UPDATED_EVENT, reload);
      window.removeEventListener(USER_NAV_PREFERENCES_UPDATED_EVENT, reload);
    };
  }, []);

  /** Move a pinned filter and save the new order of `shortcut_filters`. */
  const reorder = useCallback(
    async (sourceId: string, targetId: string, position: "before" | "after") => {
      const next = reorderPinnedFilters(filters, sourceId, targetId, position);
      if (!next) return;
      setFilters(next);
      try {
        await apiRequest("/api/me", { method: "PATCH", body: JSON.stringify({ shortcut_filters: next }) });
      } catch {
        // Keep the local order; the next drag retries the save.
      }
    },
    [filters],
  );

  // A filter whose tag no longer exists would open the unfiltered list, so it stays out of the menu.
  const pinned = filters.filter(
    (row) => row.pinned && (!row.tag_id || row.tag_id === UNTAGGED || tags.some((tag) => tag.id === row.tag_id)),
  );

  return { filters, pinned, tags, reorder };
}
