import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { MenuNav } from "./MenuNav";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ collapsed, onToggleCollapse }: SidebarProps) {
  return (
    <aside
      className={clsx(
        "hidden md:flex flex-col border-r border-border bg-surface transition-[width] duration-200 shrink-0 overflow-hidden",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo row */}
      <div
        className={clsx(
          "flex items-center h-14 border-b border-border shrink-0",
          collapsed ? "justify-center px-0" : "px-4 gap-2"
        )}
      >
        <Link
          to="/items"
          aria-label="Stowge, all items"
          className={clsx("flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus", collapsed && "justify-center")}
        >
          <img
            src="/stowgeLogoOptimized.webp"
            alt=""
            className="w-[46px] h-[46px] rounded-md object-cover shrink-0"
          />
          {!collapsed && (
            <span className="font-semibold text-sm text-heading tracking-wide -translate-y-[2px]">
              Stowge
            </span>
          )}
        </Link>
      </div>

      <MenuNav variant="sidebar" collapsed={collapsed} />

      {/* Collapse toggle */}
      <div className="border-t border-border p-2 flex justify-end shrink-0">
        <button
          onClick={onToggleCollapse}
          data-tour="menu-collapse"
          className="p-1.5 rounded-md text-faint hover:text-secondary hover:bg-surface-2 transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  );
}
