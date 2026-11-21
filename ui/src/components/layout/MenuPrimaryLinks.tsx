import { Link, useLocation } from "react-router-dom";
import { List, Plus } from "lucide-react";
import clsx from "clsx";
import { outlinedActionButtonClasses } from "../ui/buttonStyles";
import { ItemsSectionLabel, MenuRow } from "./MenuRow";
import { buildShortcutFilterSearch, isShortcutFilterActive, type ShortcutFilter, type TagRef } from "../../lib/shortcutFilters";

interface MenuPrimaryLinksProps {
  filters: ShortcutFilter[];
  tags: TagRef[];
  /** Icon-only layout for the collapsed sidebar. */
  collapsed?: boolean;
  /** Taller rows (44px) for touch, used in the mobile drawer. */
  touch?: boolean;
  /** Called when a link is chosen, so the mobile drawer closes even when the URL does not change. */
  onNavigate?: () => void;
  /** data-tour value for the ITEMS label, so a tour can point at it (desktop sidebar only). */
  itemsTourId?: string;
}

/** The links that sit above the Filters list and never scroll away: Add Item (an action, so it is
 *  drawn as an outlined button), the ITEMS section label, and All items (a destination, so it is drawn
 *  as a normal menu row).
 *  Without them a user with no pinned filters had no way from the menu to the item list or to Add. */
export function MenuPrimaryLinks({ filters, tags, collapsed = false, touch = false, onNavigate, itemsTourId }: MenuPrimaryLinksProps) {
  const location = useLocation();

  // All items is the Items page itself. It is highlighted unless one of the pinned filters is the
  // current view, so exactly one of them is ever highlighted.
  const onItems = location.pathname === "/items" || location.pathname === "/parts"; // /parts is the old name for the same page
  // A filter with no criteria matches every URL, so it must not take the highlight from All items.
  const filterActive = filters.some(
    (f) => buildShortcutFilterSearch(f, tags) !== "" && isShortcutFilterActive(f, location.search, tags),
  );
  const allItemsActive = onItems && !filterActive;
  const addActive = ["/add", "/items/new", "/parts/new"].includes(location.pathname);

  return (
    <div className="shrink-0 pt-3 pb-1" data-testid="menu-primary-links">
      <div className={clsx(collapsed ? "flex justify-center" : "px-2")}>
        <Link
          to="/add"
          title={collapsed ? "Add Item" : undefined}
          aria-label={collapsed ? "Add Item" : undefined}
          aria-current={addActive ? "page" : undefined}
          onClick={onNavigate}
          className={clsx(
            outlinedActionButtonClasses("positive"),
            "text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-success-400",
            collapsed ? "h-10 w-10 justify-center" : clsx("w-full gap-3 px-3 py-2", touch ? "min-h-11" : "h-10"),
            addActive && "!bg-success-900/50",
          )}
        >
          <Plus size={16} className="shrink-0" aria-hidden="true" />
          {!collapsed && <span>Add Item</span>}
        </Link>
      </div>

      <ItemsSectionLabel collapsed={collapsed} tourId={itemsTourId} />
      <MenuRow to="/items" icon={List} label="All items" active={allItemsActive} collapsed={collapsed} touch={touch} onNavigate={onNavigate} />
    </div>
  );
}
