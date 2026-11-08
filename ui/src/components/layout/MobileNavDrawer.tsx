import { useEffect, useMemo } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import clsx from "clsx";
import { navItems } from "../../config/nav";
import { useCurrentUser } from "../../lib/UserContext";
import { usePinnedFilters } from "../../lib/usePinnedFilters";
import { PinnedFilterList } from "./PinnedFilterList";
import { MenuPrimaryLinks } from "./MenuPrimaryLinks";

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const location = useLocation();
  const currentUser = useCurrentUser();
  const { pinned, tags } = usePinnedFilters();

  // Filter nav items based on user role
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => !item.requiresAdmin || currentUser.role === "admin"),
    [currentUser.role]
  );

  function isNavItemActive(route: string): boolean {
    const [path] = route.split("?");
    return location.pathname === path;
  }

  // Close on route change
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={clsx(
          "fixed inset-0 z-40 bg-scrim/60 md:hidden transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-64 bg-surface border-r border-border flex flex-col md:hidden transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        inert={!open}
        aria-label="Navigation"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-border shrink-0">
          <Link
            to="/items"
            aria-label="Stowge, all items"
            onClick={onClose}
            className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus"
          >
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-info-600 text-on-solid font-bold text-xs select-none">
              S
            </span>
            <span className="font-semibold text-sm text-heading">Stowge</span>
          </Link>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-subtle hover:text-body hover:bg-surface-2 transition-colors"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 min-h-0 flex flex-col" aria-label="Main navigation">
          <MenuPrimaryLinks filters={pinned} tags={tags} touch onNavigate={onClose} />
          <div className="flex-1 min-h-0 overflow-y-auto py-3">
          <div className="mb-4">
            <PinnedFilterList filters={pinned} tags={tags} touch />
          </div>

          <div className="mb-4">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.route}>
                  <NavLink
                    to={item.route}
                    end={item.route === "/system"}
                    className={() =>
                      clsx(
                        "flex items-center gap-3 px-3 py-2 min-h-11 mx-2 text-sm rounded-md transition-colors",
                        isNavItemActive(item.route)
                          ? "bg-surface-2 text-heading"
                          : "text-muted hover:text-body hover:bg-surface-2/50"
                      )
                    }
                  >
                    <Icon size={16} className="shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                </div>
              );
            })}
          </div>
          </div>
        </nav>
      </div>
    </>
  );
}
