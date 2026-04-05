import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight, Tag } from "lucide-react";
import clsx from "clsx";
import type { TablerEntry } from "../../lib/tablerIconCatalogue";
import { COLLECTIONS_NAV_UPDATED_EVENT, groupedNav, topNavItems } from "../../config/nav";
import { apiRequest } from "../../lib/api";

// ── Tabler icon catalogue (module-level cache) ────────────────────────────────
let _catalogue: TablerEntry[] | null = null;
let _cataloguePromise: Promise<TablerEntry[]> | null = null;
function loadCatalogue(): Promise<TablerEntry[]> {
  if (_catalogue) return Promise.resolve(_catalogue);
  if (!_cataloguePromise) {
    _cataloguePromise = import("../../lib/tablerIconCatalogue").then((m) => {
      _catalogue = m.TABLER_CATALOGUE;
      return _catalogue;
    });
  }
  return _cataloguePromise;
}
function TablerIcon({ name, size = 15 }: { name?: string | null; size?: number }) {
  const [entry, setEntry] = useState<TablerEntry | null>(() =>
    name && _catalogue ? (_catalogue.find((e) => e.name === name) ?? null) : null
  );
  useEffect(() => {
    if (!name) return;
    if (_catalogue) { setEntry(_catalogue.find((e) => e.name === name) ?? null); return; }
    let cancelled = false;
    loadCatalogue().then((cat) => { if (!cancelled) setEntry(cat.find((e) => e.name === name) ?? null); });
    return () => { cancelled = true; };
  }, [name]);
  if (!name || !entry) return <Tag size={size} />;
  const C = entry.component;
  return <C size={size} stroke={1.5} />;
}

interface CollectionNavItem {
  id: string;
  name: string;
  icon: string | null;
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const [collections, setCollections] = useState<CollectionNavItem[]>([]);

  const activeCollectionFilter = useMemo(
    () => new URLSearchParams(location.search).get("collection")?.trim() || "",
    [location.search]
  );

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
        <img
          src="/stowgeLogoOptimized.webp"
          alt="Stowge"
          className="w-[46px] h-[46px] rounded-md object-cover shrink-0"
        />
        {!collapsed && (
          <span className="font-semibold text-sm text-neutral-100 tracking-wide -translate-y-[2px]">
            Stowge
          </span>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
        {topNavItems.length > 0 && (
          <div className="mb-4">
            {topNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.route}>
                  <NavLink
                    to={item.route}
                    end={item.route === "/settings"}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 text-sm py-2 rounded-md mx-2 transition-colors",
                        collapsed ? "justify-center px-0" : "px-3",
                        isActive
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                      )
                    }
                    aria-label={collapsed ? item.label : undefined}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>

                  {!collapsed && item.route === "/collections" && collections.length > 0 && (
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
                              "ml-5 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                              isActive
                                ? "bg-neutral-800/80 text-neutral-100"
                                : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                            )}
                          >
                            <TablerIcon name={collection.icon} size={14} />
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
        )}

        {groupedNav.map(({ group, items }) => (
          <div key={group} className="mb-4">
            {!collapsed && (
              <div className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-neutral-600 select-none">
                {group}
              </div>
            )}
            {collapsed && (
              <div className="border-t border-neutral-800/60 mx-2 mb-1 mt-1" />
            )}
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.route}>
                  <NavLink
                    to={item.route}
                    end={item.route === "/settings"}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      clsx(
                        "flex items-center gap-3 text-sm py-2 rounded-md mx-2 transition-colors",
                        collapsed ? "justify-center px-0" : "px-3",
                        isActive
                          ? "bg-neutral-800 text-neutral-100"
                          : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                      )
                    }
                    aria-label={collapsed ? item.label : undefined}
                  >
                    <Icon size={16} className="shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>

                  {!collapsed && item.route === "/collections" && collections.length > 0 && (
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
                              "ml-5 flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                              isActive
                                ? "bg-neutral-800/80 text-neutral-100"
                                : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                            )}
                          >
                            <TablerIcon name={collection.icon} size={14} />
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
