import { useEffect, useMemo } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import clsx from "clsx";
import { navItems } from "../../config/nav";
import { useCurrentUser } from "../../lib/UserContext";
import { usePinnedFilters } from "../../lib/usePinnedFilters";
import { PinnedFilterList } from "./PinnedFilterList";

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
          "fixed inset-0 z-40 bg-black/60 md:hidden transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={clsx(
          "fixed inset-y-0 left-0 z-50 w-64 bg-neutral-900 border-r border-neutral-800 flex flex-col md:hidden transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
      >
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-neutral-800 shrink-0">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white font-bold text-xs select-none">
              S
            </span>
            <span className="font-semibold text-sm text-neutral-100">Stowge</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
          <div className="mb-4">
            <PinnedFilterList filters={pinned} tags={tags} />
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
                        "flex items-center gap-3 px-3 py-2 mx-2 text-sm rounded-md transition-colors",
                        isNavItemActive(item.route)
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
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
        </nav>
      </div>
    </>
  );
}
