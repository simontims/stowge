import clsx from "clsx";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export interface Column<T> {
  key: keyof T & string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  width?: string;
}

interface DataTableProps<T extends object> {
  columns: Column<T>[];
  rows: T[];
  keyField: keyof T & string;
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: keyof T & string) => void;
}

export function DataTable<T extends object>({
  columns,
  rows,
  keyField,
  emptyMessage = "No items found.",
  onRowClick,
  sortKey,
  sortDirection,
  onSort,
}: DataTableProps<T>) {
  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-max w-full text-sm border-collapse">
          <thead>
            <tr className="bg-neutral-900 border-b border-neutral-800">
              {columns.map((col) => {
                const isSortable = col.sortable && onSort;
                const isActive = isSortable && sortKey === col.key;
                const SortIcon = isActive
                  ? sortDirection === "asc" ? ArrowUp : ArrowDown
                  : ArrowUpDown;

                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                    className={clsx(
                      "px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider select-none whitespace-nowrap",
                      isSortable && "cursor-pointer hover:text-neutral-300 transition-colors",
                      col.headerClassName
                    )}
                    onClick={isSortable ? () => onSort(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {isSortable && (
                        <SortIcon size={13} className={isActive ? "text-neutral-300" : "text-neutral-600"} />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="bg-neutral-950 divide-y divide-neutral-800/70">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-10 text-center text-sm text-neutral-600"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={String(row[keyField])}
                  className={clsx(
                    "hover:bg-neutral-900/60 transition-colors",
                    onRowClick ? "cursor-pointer" : ""
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                      className={clsx(
                        "px-4 py-2.5 text-neutral-300",
                        col.className
                      )}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
