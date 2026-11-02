import { Filter } from "lucide-react";
import { TablerIcon } from "./TablerIcon";

interface ShortcutIconProps {
  filter: { icon?: string | null; color?: string | null };
  size?: number;
}

/** Icon for a shortcut filter: its chosen Tabler icon and colour, or the default filter icon. */
export function ShortcutIcon({ filter, size = 14 }: ShortcutIconProps) {
  if (filter.icon) {
    return <TablerIcon name={filter.icon} size={size} color={filter.color} />;
  }
  return (
    <Filter
      size={size}
      className="shrink-0"
      style={filter.color ? { color: filter.color } : undefined}
      aria-hidden="true"
    />
  );
}
