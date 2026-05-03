import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { COLLECTIONS_NAV_UPDATED_EVENT, navItems, topNavItems } from "../../config/nav";
import { apiRequest } from "../../lib/api";
import { TablerIcon } from "../ui/TablerIcon";
import type { CurrentUser } from "../../lib/types";

interface CollectionNavItem {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  const location = useLocation();
  const [collections, setCollections] = useState<CollectionNavItem[]>([]);
  const [collectionNavOrder, setCollectionNavOrder] = useState<string[]>([]);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: "before" | "after" } | null>(null);

  const activeCollectionFilter = useMemo(
    () => new URLSearchParams(location.search).get("collection")?.trim() || "",
    [location.search]
  );

  const END_DROP_ZONE_ID = "__end_drop_zone__";

  function isNavItemActive(route: string): boolean {
    const [path] = route.split("?");
    return location.pathname === path;
  }

  const orderedCollections = useMemo(() => {
    if (!collections.length) return [];

    const byId = new Map(collections.map((collection) => [collection.id, collection]));
    const ordered: CollectionNavItem[] = [];
    const seen = new Set<string>();

    for (const id of collectionNavOrder) {
      const entry = byId.get(id);
      if (!entry || seen.has(id)) continue;
      ordered.push(entry);
      seen.add(id);
    }

    for (const collection of collections) {
      if (!seen.has(collection.id)) {
        ordered.push(collection);
      }
    }

    return ordered;
  }, [collectionNavOrder, collections]);

  async function persistCollectionNavOrder(nextOrder: string[]) {
    try {
      await apiRequest("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ collection_nav_order: nextOrder }),
      });
    } catch {
      // Keep local ordering even if persistence fails; it can be retried by the next drag.
    }
  }

  function applyCollectionReorder(sourceId: string, targetId: string, position: "before" | "after") {
    const currentOrder = orderedCollections.map((entry) => entry.id);
    const sourceIdx = currentOrder.indexOf(sourceId);
    if (sourceIdx < 0) return;

    const nextOrder = [...currentOrder];
    nextOrder.splice(sourceIdx, 1);

    if (targetId === END_DROP_ZONE_ID) {
      nextOrder.push(sourceId);
      setCollectionNavOrder(nextOrder);
      void persistCollectionNavOrder(nextOrder);
      return;
    }

    const targetIdx = currentOrder.indexOf(targetId);
    if (targetIdx < 0) return;

    let insertIdx = targetIdx;
    if (sourceIdx < targetIdx) {
      insertIdx -= 1;
    }
    if (position === "after") {
      insertIdx += 1;
    }

    nextOrder.splice(Math.max(0, Math.min(insertIdx, nextOrder.length)), 0, sourceId);
    setCollectionNavOrder(nextOrder);
    void persistCollectionNavOrder(nextOrder);
  }

  useEffect(() => {
    let active = true;

    async function loadCollections() {
      try {
        const [data, me] = await Promise.all([
          apiRequest<CollectionNavItem[]>("/api/collections"),
          apiRequest<CurrentUser>("/api/me"),
        ]);
        if (active) {
          setCollections(data || []);
          setCollectionNavOrder(Array.isArray(me.collection_nav_order) ? me.collection_nav_order : []);
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

                  {!collapsed && item.route === "/collections" && collections.length > 0 && (
                    <div className="mt-1 space-y-0.5 px-2">
                      {orderedCollections.map((collection) => {
                        const isActive =
                          location.pathname === "/items" && activeCollectionFilter === collection.name;

                        return (
                          <div
                            key={collection.id}
                            draggable
                            onDragStart={(event) => {
                              setDraggingCollectionId(collection.id);
                              setDropIndicator(null);
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", collection.id);
                            }}
                            onDragEnd={() => {
                              setDraggingCollectionId(null);
                              setDropIndicator(null);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              const rect = event.currentTarget.getBoundingClientRect();
                              const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                              setDropIndicator({ targetId: collection.id, position });
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const sourceId = draggingCollectionId || event.dataTransfer.getData("text/plain");
                              const targetId = collection.id;
                              const insertPosition =
                                dropIndicator?.targetId === targetId ? dropIndicator.position : "before";
                              if (!sourceId || sourceId === targetId) {
                                setDraggingCollectionId(null);
                                setDropIndicator(null);
                                return;
                              }

                              applyCollectionReorder(sourceId, targetId, insertPosition);
                              setDraggingCollectionId(null);
                              setDropIndicator(null);
                            }}
                            className={clsx(
                              "relative ml-5 rounded-md",
                              draggingCollectionId === collection.id ? "opacity-60" : "opacity-100"
                            )}
                          >
                            {dropIndicator?.targetId === collection.id && dropIndicator.position === "before" && (
                              <div className="absolute -top-0.5 left-0 right-0 h-0.5 rounded bg-blue-400" />
                            )}
                            <NavLink
                              to={{
                                pathname: "/items",
                                search: new URLSearchParams({ collection: collection.name }).toString(),
                              }}
                              className={clsx(
                                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                              isActive
                                ? "bg-neutral-800/80 text-neutral-100"
                                : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
                              )}
                            >
                              <TablerIcon name={collection.icon} size={14} color={collection.color} />
                              {collection.name}
                            </NavLink>
                            {dropIndicator?.targetId === collection.id && dropIndicator.position === "after" && (
                              <div className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded bg-blue-400" />
                            )}
                          </div>
                        );
                      })}

                      {draggingCollectionId && (
                        <div
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDropIndicator({ targetId: END_DROP_ZONE_ID, position: "after" });
                          }}
                          onDrop={(event) => {
                            event.preventDefault();
                            const sourceId = draggingCollectionId || event.dataTransfer.getData("text/plain");
                            if (!sourceId) {
                              setDraggingCollectionId(null);
                              setDropIndicator(null);
                              return;
                            }

                            applyCollectionReorder(sourceId, END_DROP_ZONE_ID, "after");
                            setDraggingCollectionId(null);
                            setDropIndicator(null);
                          }}
                          className="ml-5 h-3 rounded-md"
                        >
                          {dropIndicator?.targetId === END_DROP_ZONE_ID && (
                            <div className="mt-1 h-0.5 rounded bg-blue-400" />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mb-4">
          {collapsed && (
            <div className="border-t border-neutral-800/60 mx-2 mb-1 mt-1" />
          )}
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.route}>
                <NavLink
                  to={item.route}
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
