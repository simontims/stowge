import { NavLink } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { groupedNav } from "../../config/nav";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
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
        <span className="flex items-center justify-center w-7 h-7 rounded-md bg-blue-600 text-white font-bold text-xs select-none shrink-0">
          S
        </span>
        {!collapsed && (
          <span className="font-semibold text-sm text-neutral-100 tracking-wide">
            Stowge
          </span>
        )}
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-3" aria-label="Main navigation">
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
                <NavLink
                  key={item.route}
                  to={item.route}
                  end={item.route === "/"}
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
