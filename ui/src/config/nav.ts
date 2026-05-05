import {
  Layers,
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
  { label: "Collections", route: "/collections", icon: Layers },
];

export const navItems: NavItem[] = [
  { label: "System", route: "/system", icon: Settings, requiresAdmin: true },
];

export const COLLECTIONS_NAV_UPDATED_EVENT = "stowge:collections-nav-updated";

