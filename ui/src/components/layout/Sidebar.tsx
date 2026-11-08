import { useMemo } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { navItems } from "../../config/nav";
import { useCurrentUser } from "../../lib/UserContext";
import { usePinnedFilters } from "../../lib/usePinnedFilters";
import { PinnedFilterList } from "./PinnedFilterList";
import { MenuPrimaryLinks } from "./MenuPrimaryLinks";
import { FIRST_PINNED_TOUR_TARGET } from "../onboarding/whatsNew/tagsAndHintsSteps";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const currentUser = useCurrentUser();
  const { pinned, tags, reorder } = usePinnedFilters();

  // Filter nav items based on user role
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => !item.requiresAdmin || currentUser.role === "admin"),
    [currentUser.role]
  );

  function isNavItemActive(route: string): boolean {
    const [path] = route.split("?");
    return location.pathname === path;
  }

  return (
    <aside
      className={clsx(
        "hidden md:flex flex-col border-r border-neutral-800 bg-neutral-900 transition-[width] duration-200 shrink-0 overflow-hidden",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo row */}
      <div
        className={clsx(
          "flex items-center h-14 border-b border-neutral-800 shrink-0",
          collapsed ? "justify-center px-0" : "px-4 gap-2"
        )}
      >
        <Link
          to="/items"
          aria-label="Stowge, all items"
          className={clsx("flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-500", collapsed && "justify-center")}
        >
          <img
            src="/stowgeLogoOptimized.webp"
            alt=""
            className="w-[46px] h-[46px] rounded-md object-cover shrink-0"
          />
          {!collapsed && (
            <span className="font-semibold text-sm text-neutral-100 tracking-wide -translate-y-[2px]">
              Stowge
            </span>
          )}
        </Link>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 min-h-0 flex flex-col" aria-label="Main navigation">
        <MenuPrimaryLinks filters={pinned} tags={tags} collapsed={collapsed} />
        <div className="flex-1 min-h-0 overflow-y-auto py-3">
        {!collapsed && (
          <div className="mb-4">
            <PinnedFilterList filters={pinned} tags={tags} headingTourId="menu-filters" firstItemTourId={FIRST_PINNED_TOUR_TARGET} draggable onReorder={(src, target, pos) => void reorder(src, target, pos)} />
          </div>
        )}

        <div className="mb-4">
          {collapsed && (
            <div className="border-t border-neutral-800/60 mx-2 mb-1 mt-1" />
          )}
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.route}>
                <NavLink
                  to={item.route}
                    data-tour={`nav-${item.route.replace("/", "")}`}
                  end={item.route === "/system"}
                  title={collapsed ? item.label : undefined}
                  className={() =>
                    clsx(
                      "flex items-center gap-3 text-sm py-2 rounded-md mx-2 transition-colors",
                      collapsed ? "justify-center px-0" : "px-3",
                      isNavItemActive(item.route)
                        ? "bg-neutral-800 text-neutral-100"
                        : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                    )
                  }
                  aria-label={collapsed ? item.label : undefined}
                >
                  <Icon size={16} className="shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>

              </div>
            );
          })}
        </div>
        </div>
      </nav>

      {/* Collapse toggle */}
      <div className="border-t border-neutral-800 p-2 flex justify-end shrink-0">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md text-neutral-600 hover:text-neutral-300 hover:bg-neutral-800 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  );
}
