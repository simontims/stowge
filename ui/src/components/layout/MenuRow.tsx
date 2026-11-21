import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import clsx from "clsx";

interface MenuRowProps {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  /** Icon-only layout for the collapsed sidebar (the label moves to title and aria-label). */
  collapsed?: boolean;
  /** Taller rows (44px) for touch, used in the mobile drawer. */
  touch?: boolean;
  onNavigate?: () => void;
  /** data-tour value, so a tour can point at this row. */
  tourId?: string;
}

/** One plain row of the menu (All items, Recycle Bin, Settings, System). Every menu row is built here
 *  so they cannot drift apart in size, alignment or colour. */
export function MenuRow({ to, icon: Icon, label, active, collapsed = false, touch = false, onNavigate, tourId }: MenuRowProps) {
  return (
    <Link
      to={to}
      data-tour={tourId}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={clsx(
        "flex items-center gap-3 text-sm py-2 rounded-md mx-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus",
        touch && "min-h-11",
        collapsed ? "justify-center px-0" : "px-3",
        active ? "bg-surface-2 text-heading" : "text-muted hover:text-body hover:bg-surface-2/50",
      )}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

/** The ITEMS label above All items, Filters and Recycle Bin: they are all views of the same inventory.
 *  Written as "Items" and drawn in capitals, so a screen reader says a word, not a spelling. In the
 *  collapsed rail it becomes a thin rule. */
export function ItemsSectionLabel({ collapsed = false, tourId }: { collapsed?: boolean; tourId?: string }) {
  if (collapsed) return <div data-tour={tourId} className="mx-2 mt-3 mb-1 border-t border-border-strong" aria-hidden="true" />;
  return <p data-tour={tourId} className="px-5 pt-4 pb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">Items</p>;
}

/** The rule above Settings and System, which are about the app rather than the items. */
export function AppSectionRule() {
  return <div className="mx-2 mb-1 border-t border-border-strong" aria-hidden="true" />;
}
