import { useState } from "react";

export type TableSortDirection = "asc" | "desc";

export function useTableSort<K extends string>(initialKey: K, initialDirection: TableSortDirection = "asc") {
  const [sortKey, setSortKey] = useState<K>(initialKey);
  const [sortDirection, setSortDirection] = useState<TableSortDirection>(initialDirection);

  function handleSort(nextKey: K) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  return {
    sortKey,
    sortDirection,
    setSortKey,
    setSortDirection,
    handleSort,
  };
}