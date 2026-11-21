import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { navItems } from "../../config/nav";
import { useCurrentUser } from "../../lib/UserContext";
import { usePinnedFilters } from "../../lib/usePinnedFilters";
import { FIRST_PINNED_TOUR_TARGET } from "../onboarding/whatsNew/tagsAndHintsSteps";
import { AppSectionRule, MenuRow } from "./MenuRow";
import { MenuPrimaryLinks } from "./MenuPrimaryLinks";
import { PinnedFilterList } from "./PinnedFilterList";

interface MenuNavProps {
  /** The desktop sidebar drags to reorder and carries the tour targets; the phone drawer does neither. */
  variant: "sidebar" | "drawer";
  /** Icon-only layout for the collapsed sidebar. */
  collapsed?: boolean;
  /** Called when a link is chosen, so the drawer closes even when the URL does not change. */
  onNavigate?: () => void;
}

/** The whole menu, used by the sidebar and the drawer so they cannot differ:
 *
 *  Add Item
 *  ITEMS        All items, Filters (its list scrolls), Recycle Bin: every one is a view of the items
 *  ---------    pinned to the bottom, so a long filter list can never push them off screen
 *  Settings, System
 */
export function MenuNav({ variant, collapsed = false, onNavigate }: MenuNavProps) {
  const location = useLocation();
  const currentUser = useCurrentUser();
  const { pinned, tags, loaded, reorder } = usePinnedFilters();
  const isSidebar = variant === "sidebar";
  const touch = !isSidebar;

  const visible = useMemo(
    () => navItems.filter((item) => !item.requiresAdmin || currentUser.role === "admin"),
    [currentUser.role],
  );
  const itemsGroup = visible.filter((item) => item.group === "items");
  const appGroup = visible.filter((item) => item.group === "app");

  function row(item: (typeof navItems)[number]) {
    return (
      <MenuRow
        key={item.route}
        to={item.route}
        icon={item.icon}
        label={item.label}
        active={location.pathname === item.route}
        collapsed={collapsed}
        touch={touch}
        onNavigate={onNavigate}
        tourId={isSidebar ? `nav-${item.route.replace("/", "")}` : undefined}
      />
    );
  }

  return (
    <nav className="flex-1 min-h-0 flex flex-col" aria-label="Main navigation">
      <MenuPrimaryLinks filters={pinned} tags={tags} collapsed={collapsed} touch={touch} onNavigate={onNavigate} itemsTourId={isSidebar ? "menu-items" : undefined} />

      {/* Only the filter list scrolls. In the collapsed rail it stays, as icons with the name as tooltip. */}
      <div className="min-h-0 overflow-y-auto overscroll-contain mt-1">
          <PinnedFilterList
            filters={pinned}
            tags={tags}
            loading={!loaded}
            touch={touch}
            collapsed={collapsed}
            headingTourId={isSidebar ? "menu-filters" : undefined}
            firstItemTourId={isSidebar ? FIRST_PINNED_TOUR_TARGET : undefined}
            draggable={isSidebar}
            onReorder={isSidebar ? (src, target, pos) => void reorder(src, target, pos) : undefined}
          />
      </div>

      <div className="shrink-0 mt-1">{itemsGroup.map(row)}</div>

      {/* Settings and System sit at the bottom. */}
      <div className="mt-auto shrink-0 pb-2 pt-3">
        <AppSectionRule />
        {appGroup.map(row)}
      </div>
    </nav>
  );
}
