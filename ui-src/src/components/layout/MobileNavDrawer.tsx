import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { X } from "lucide-react";
import clsx from "clsx";
import { COLLECTIONS_NAV_UPDATED_EVENT, groupedNav, topNavItems } from "../../config/nav";
import { apiRequest } from "../../lib/api";

interface CollectionNavItem {
  id: string;
  name: string;
}

interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
  const location = useLocation();
  const [collections, setCollections] = useState<CollectionNavItem[]>([]);

  const activeCollectionFilter = useMemo(
    () => new URLSearchParams(location.search).get("collection")?.trim() || "",
    [location.search]
  );

  // Close on route change
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    let active = true;

    async function loadCollections() {
      try {
        const data = await apiRequest<CollectionNavItem[]>("/api/collections");
        if (active) {
          setCollections(data || []);
        }
      } catch {
        if (active) {
          setCollections([]);
        }
      }
    }

    void loadCollections();

    const refreshCollections = () => {
      void loadCollections();
    };

    window.addEventListener(COLLECTIONS_NAV_UPDATED_EVENT, refreshCollections);
    return () => {
      active = false;
      window.removeEventListener(COLLECTIONS_NAV_UPDATED_EVENT, refreshCollections);
    };
  }, []);

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
          {topNavItems.length > 0 && (
            <div className="mb-4">
              {topNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.route}
                    to={item.route}
                    end
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 px-3 py-2 mx-2 text-sm rounded-md transition-colors",
                        isActive
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                      )
                    }
                  >
                    <Icon size={16} className="shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          )}

          {groupedNav.map(({ group, items }) => (
            <div key={group} className="mb-4">
              <div className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 select-none">
                {group}
              </div>
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.route}>
                    <NavLink
                      to={item.route}
                      end={item.route === "/settings"}
                      className={({ isActive }) =>
                        clsx(
                          "flex items-center gap-3 px-3 py-2 mx-2 text-sm rounded-md transition-colors",
                          isActive
                            ? "bg-neutral-800 text-neutral-100"
                            : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                        )
                      }
                    >
                      <Icon size={16} className="shrink-0" />
                      <span>{item.label}</span>
                    </NavLink>

                    {item.route === "/collections" && collections.length > 0 && (
                      <div className="mt-1 space-y-0.5 px-2">
                        {collections.map((collection) => {
                          const isActive =
                            location.pathname === "/items" && activeCollectionFilter === collection.name;

                          return (
                            <NavLink
                              key={collection.id}
                              to={{
                                pathname: "/items",
                                search: new URLSearchParams({ collection: collection.name }).toString(),
                              }}
                              className={clsx(
                                "ml-5 flex items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                                isActive
                                  ? "bg-neutral-800/80 text-neutral-100"
                                  : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                              )}
                            >
                              {collection.name}
                            </NavLink>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}
