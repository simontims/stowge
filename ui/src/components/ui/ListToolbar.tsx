import type { ReactNode } from "react";
import { SearchInput } from "./SearchInput";

interface ListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  count?: number;
  countLabel?: string;
  loading?: boolean;
  action?: ReactNode;
}

export function ListToolbar({
  search,
  onSearchChange,
  placeholder = "Search…",
  count,
  countLabel = "items",
  loading = false,
  action,
}: ListToolbarProps) {
  return (
    <div className="flex items-center gap-2">
      <SearchInput
        placeholder={placeholder}
        value={search}
        onChange={onSearchChange}
        className="flex-1 max-w-sm"
      />
      {action}
      <span className="text-xs text-neutral-600 ml-auto">
        {loading ? "Loading..." : count !== undefined ? `${count} ${countLabel}` : null}
      </span>
    </div>
  );
}
