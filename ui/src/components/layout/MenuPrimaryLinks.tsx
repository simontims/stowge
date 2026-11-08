import { Link, useLocation } from "react-router-dom";
import { List, Plus } from "lucide-react";
import clsx from "clsx";
import { outlinedActionButtonClasses } from "../ui/buttonStyles";
import { isShortcutFilterActive, type ShortcutFilter, type TagRef } from "../../lib/shortcutFilters";

interface MenuPrimaryLinksProps {
  filters: ShortcutFilter[];
  tags: TagRef[];
  /** Icon-only layout for the collapsed sidebar. */
  collapsed?: boolean;
  /** Taller rows (44px) for touch, used in the mobile drawer. */
  touch?: boolean;
}

/** The two links that sit above the Filters list and never scroll away: Add Item (an action, so it is
 *  drawn as an outlined button) and All items (a destination, so it is drawn as a normal menu row).
 *  Without them a user with no pinned filters had no way from the menu to the item list or to Add. */
export function MenuPrimaryLinks({ filters, tags, collapsed = false, touch = false }: MenuPrimaryLinksProps) {
  const location = useLocation();

  // All items is the Items page itself. It is highlighted unless one of the pinned filters is the
  // current view, so exactly one of them is ever highlighted.
  const onItems = location.pathname === "/items";
  const filterActive = filters.some((f) => isShortcutFilterActive(f, location.search, tags));
  const allItemsActive = onItems && !filterActive;
  const addActive = location.pathname === "/add";

  const rowHeight = touch ? "min-h-11" : "";

  return (
    <div className="shrink-0 pt-3 pb-1" data-testid="menu-primary-links">
      <Link
        to="/add"
        title={collapsed ? "Add Item" : undefined}
        aria-label={collapsed ? "Add Item" : undefined}
        aria-current={addActive ? "page" : undefined}
        className={clsx(
          outlinedActionButtonClasses("positive"),
          "text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400",
          collapsed ? "mx-auto h-10 w-10 justify-center" : clsx("mx-2 gap-3 px-3 py-2", touch ? "min-h-11" : "h-10"),
          addActive && "bg-emerald-900/50",
        )}
      >
        <Plus size={16} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span>Add Item</span>}
      </Link>

      <Link
        to="/items"
        title={collapsed ? "All items" : undefined}
        aria-label={collapsed ? "All items" : undefined}
        aria-current={allItemsActive ? "page" : undefined}
        className={clsx(
          "mt-1 flex items-center gap-3 text-sm py-2 rounded-md mx-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500",
          rowHeight,
          collapsed ? "justify-center px-0" : "px-3",
          allItemsActive
            ? "bg-neutral-800 text-neutral-100"
            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50",
        )}
      >
        <List size={16} className="shrink-0" aria-hidden="true" />
        {!collapsed && <span>All items</span>}
      </Link>
    </div>
  );
}
