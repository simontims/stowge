import {
  SlidersHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  route: string;
  icon: LucideIcon;
  requiresAdmin?: boolean;
  /** "items": views of the inventory (sits in the ITEMS section with All items and Filters).
   *  "app": configuration (Settings, System), pinned at the bottom of the menu. */
  group: "items" | "app";
}

export const navItems: NavItem[] = [
  { label: "Recycle Bin", route: "/recycle-bin", icon: Trash2, group: "items" },
  { label: "Settings", route: "/settings", icon: SlidersHorizontal, group: "app" },
  { label: "System", route: "/system", icon: Settings, requiresAdmin: true, group: "app" },
];

export const TAGS_NAV_UPDATED_EVENT = "stowge:tags-nav-updated";
export const USER_NAV_PREFERENCES_UPDATED_EVENT = "stowge:user-nav-preferences-updated";

