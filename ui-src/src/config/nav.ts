import {
  Activity,
  Package,
  MapPin,
  Layers,
  Factory,
  Wrench,
  Settings,
  Users,
  Brain,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavGroup = "SYSTEM";

export interface NavItem {
  label: string;
  route: string;
  icon: LucideIcon;
  group?: NavGroup;
}

export const NAV_GROUPS: NavGroup[] = [
  "SYSTEM",
];

export const topNavItems: NavItem[] = [
  { label: "Collections", route: "/collections", icon: Layers   },
  { label: "Items",       route: "/items",       icon: Package  },
  { label: "Locations",   route: "/locations",   icon: MapPin   },
];

export const navItems: NavItem[] = [
  { label: "Status",    route: "/",               icon: Activity, group: "SYSTEM" },
  { label: "Suppliers", route: "/suppliers",       icon: Factory,  group: "SYSTEM" },
  { label: "Projects",  route: "/projects",        icon: Wrench,   group: "SYSTEM" },
  { label: "Settings",  route: "/settings",        icon: Settings, group: "SYSTEM" },
  { label: "AI",        route: "/settings/ai",     icon: Brain,    group: "SYSTEM" },
  { label: "Users",     route: "/settings/users",  icon: Users,    group: "SYSTEM" },
];

export const groupedNav = NAV_GROUPS.map((group) => ({
  group,
  items: navItems.filter((item) => item.group === group),
}));

export const COLLECTIONS_NAV_UPDATED_EVENT = "stowge:collections-nav-updated";

