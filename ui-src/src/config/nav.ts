import {
  Home,
  Package,
  MapPin,
  Tag,
  Factory,
  Wrench,
  Plus,
  Upload,
  BarChart3,
  Settings,
  Users,
  Brain,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavGroup = "INVENTORY" | "RELATIONSHIPS" | "TOOLS" | "SYSTEM";

export interface NavItem {
  label: string;
  route: string;
  icon: LucideIcon;
  group: NavGroup;
}

export const NAV_GROUPS: NavGroup[] = [
  "INVENTORY",
  "RELATIONSHIPS",
  "TOOLS",
  "SYSTEM",
];

export const navItems: NavItem[] = [
  { label: "Dashboard",  route: "/",           icon: Home,      group: "INVENTORY"     },
  { label: "Items",      route: "/items",       icon: Package,   group: "INVENTORY"     },
  { label: "Locations",  route: "/locations",   icon: MapPin,    group: "INVENTORY"     },
  { label: "Categories", route: "/categories",  icon: Tag,       group: "INVENTORY"     },
  { label: "Suppliers",  route: "/suppliers",   icon: Factory,   group: "RELATIONSHIPS" },
  { label: "Projects",   route: "/projects",    icon: Wrench,    group: "RELATIONSHIPS" },
  { label: "Add",         route: "/add",         icon: Plus,      group: "TOOLS"         },
  { label: "Imports",    route: "/imports",     icon: Upload,    group: "TOOLS"         },
  { label: "Reports",    route: "/reports",     icon: BarChart3, group: "TOOLS"         },
  { label: "Settings",   route: "/settings",    icon: Settings,  group: "SYSTEM"        },
  { label: "AI",         route: "/settings/ai", icon: Brain,     group: "SYSTEM"        },
  { label: "Users",      route: "/settings/users", icon: Users,  group: "SYSTEM"        },
];

export const groupedNav = NAV_GROUPS.map((group) => ({
  group,
  items: navItems.filter((item) => item.group === group),
}));
