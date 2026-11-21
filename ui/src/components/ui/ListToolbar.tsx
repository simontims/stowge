import type { ReactNode } from "react";
import { SearchInput } from "./SearchInput";
import { LOADING_TEXT } from "../../lib/listState";

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
    <div className="flex flex-wrap items-center gap-2">
      <SearchInput
        placeholder={placeholder}
        value={search}
        onChange={onSearchChange}
        className="w-full sm:w-auto sm:flex-1 sm:max-w-sm"
      />
      {action}
      <span className="text-xs text-faint ml-auto">
        {loading ? LOADING_TEXT : count !== undefined ? `${count} ${countLabel}` : null}
      </span>
    </div>
  );
}
