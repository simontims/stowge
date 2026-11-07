import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { TAGS_NAV_UPDATED_EVENT, USER_NAV_PREFERENCES_UPDATED_EVENT } from "../config/nav";
import { apiRequest } from "./api";
import { UNTAGGED, reorderPinnedFilters, normalizeShortcutFilter, type ShortcutFilter } from "./shortcutFilters";
import { useCurrentUser, useSetCurrentUser } from "./UserContext";
import type { CurrentUser, Tag } from "./types";

/** The menu's data: the user's filters (pinned ones are shown, in list order) and the tag
 *  list used to resolve a filter's tag id to the name in the Items URL. Reloads when tags or
 *  filters change elsewhere in the app. */
export function usePinnedFilters() {
  const [filters, setFilters] = useState<ShortcutFilter[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const currentUser = useCurrentUser();
  const setCurrentUser = useSetCurrentUser();
  // Always the latest list, so a save never sends a list captured earlier.
  const filtersRef = useRef<ShortcutFilter[]>(filters);
  filtersRef.current = filters;
  const userRef = useRef(currentUser);
  userRef.current = currentUser;

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

  /** Move a pinned filter and save the new order of `shortcut_filters`. If the save fails the
   *  menu goes back to the previous order and says so. */
  const reorder = useCallback(
    async (sourceId: string, targetId: string, position: "before" | "after") => {
      const previous = filtersRef.current;
      const next = reorderPinnedFilters(previous, sourceId, targetId, position);
      if (!next) return;
      filtersRef.current = next;
      setFilters(next);
      try {
        const saved = await apiRequest<CurrentUser>("/api/me", { method: "PATCH", body: JSON.stringify({ shortcut_filters: next }) });
        const savedFilters = Array.isArray(saved?.shortcut_filters) ? saved.shortcut_filters : next;
        setCurrentUser({ ...userRef.current, ...(saved && saved.id === userRef.current.id ? saved : {}), shortcut_filters: savedFilters });
      } catch {
        // A newer drag may already have replaced this list: only undo our own change.
        if (filtersRef.current === next) {
          filtersRef.current = previous;
          setFilters(previous);
        }
        toast.error("Could not save the new order");
      }
    },
    [setCurrentUser],
  );

  // A filter whose tag no longer exists would open the unfiltered list, so it stays out of the menu.
  const pinned = filters.filter(
    (row) => row.pinned && (!row.tag_id || row.tag_id === UNTAGGED || tags.some((tag) => tag.id === row.tag_id)),
  );

  return { filters, pinned, tags, reorder };
}
