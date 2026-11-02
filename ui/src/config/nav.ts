import {
  Tags,
  SlidersHorizontal,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  route: string;
  icon: LucideIcon;
  requiresAdmin?: boolean;
}

export const topNavItems: NavItem[] = [
  { label: "Tags", route: "/tags", icon: Tags },
];

export const navItems: NavItem[] = [
  { label: "Settings", route: "/settings", icon: SlidersHorizontal },
  { label: "System", route: "/system", icon: Settings, requiresAdmin: true },
];

export const TAGS_NAV_UPDATED_EVENT = "stowge:tags-nav-updated";
export const USER_NAV_PREFERENCES_UPDATED_EVENT = "stowge:user-nav-preferences-updated";

