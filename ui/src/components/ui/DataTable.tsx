import { useRef, type MouseEvent, type ReactNode } from "react";
import clsx from "clsx";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";

export interface Column<T> {
  key: keyof T & string;
  header: ReactNode;
  render?: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  sortable?: boolean;
  width?: string;
}

export interface DataTableActions<T> {
  header?: string;
  headerClassName?: string;
  className?: string;
  width?: string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T extends object> {
  columns: Column<T>[];
  actions?: DataTableActions<T>;
  rows: T[];
  keyField: keyof T & string;
  emptyMessage?: React.ReactNode;
  footer?: React.ReactNode;
  onRowClick?: (row: T) => void;
  sortKey?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (key: keyof T & string) => void;
  activeRowId?: string;
  tableRef?: React.RefObject<HTMLTableElement | null>;
  /** Fixed table layout: columns with a width keep it exactly, and a column without one takes the rest.
   *  Use it where the rows change often (filters), so columns do not jump with the data. */
  fixedLayout?: boolean;
  /** Smallest table width in fixed layout, as a CSS length; below it the table scrolls sideways. */
  minTableWidth?: string;
}

function shouldIgnoreSortClick(event: MouseEvent<HTMLElement>): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  return Boolean(target.closest("button,select,input,textarea,a,label"));
}

export function DataTable<T extends object>({
  columns,
  actions,
  rows,
  keyField,
  emptyMessage = "No items found.",
  footer,
  onRowClick,
  sortKey,
  sortDirection,
  onSort,
  activeRowId,
  tableRef,
  fixedLayout = false,
  minTableWidth,
}: DataTableProps<T>) {
  const internalRef = useRef<HTMLTableElement>(null);
  const resolvedRef = tableRef ?? internalRef;
  const totalColumnCount = columns.length + (actions ? 1 : 0);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table
          ref={resolvedRef}
          className={clsx(fixedLayout ? "table-fixed w-full" : "min-w-max w-full", "text-sm border-collapse")}
          style={fixedLayout && minTableWidth ? { minWidth: minTableWidth } : undefined}
        >
          <thead>
            <tr className="bg-surface border-b border-border">
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
                      "px-4 py-2.5 text-left text-xs font-medium text-subtle uppercase tracking-wider select-none whitespace-nowrap",
                      isSortable && "cursor-pointer hover:text-secondary transition-colors",
                      col.headerClassName
                    )}
                    onClick={
                      isSortable
                        ? (event) => {
                            if (shouldIgnoreSortClick(event)) return;
                            onSort(col.key);
                          }
                        : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {isSortable && (
                        <SortIcon size={13} className={isActive ? "text-secondary" : "text-faint"} />
                      )}
                    </span>
                  </th>
                );
              })}
              {actions && (
                <th
                  scope="col"
                  style={actions.width ? { width: actions.width, minWidth: actions.width } : undefined}
                  className={clsx(
                    "px-4 py-2.5 text-right text-xs font-medium text-subtle uppercase tracking-wider whitespace-nowrap",
                    actions.headerClassName
                  )}
                >
                  {actions.header || "Actions"}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-canvas divide-y divide-border/70">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={totalColumnCount}
                  className="px-4 py-10 text-center text-sm text-faint"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const rowId = String(row[keyField]);
                const isActive = activeRowId !== undefined && rowId === activeRowId;
                return (
                <tr
                  key={rowId}
                  data-row-id={rowId}
                  className={clsx(
                    "transition-colors",
                    onRowClick ? "cursor-pointer" : "",
                    isActive
                      ? "bg-selected"
                      : "hover:bg-surface/60"
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      style={col.width ? { width: col.width, minWidth: col.width } : undefined}
                      className={clsx(
                        "px-4 py-2.5 text-secondary",
                        col.className
                      )}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? "")}
                    </td>
                  ))}
                  {actions && (
                    <td
                      style={actions.width ? { width: actions.width, minWidth: actions.width } : undefined}
                      className={clsx(
                        "px-4 py-2.5 text-right",
                        actions.className
                      )}
                    >
                      {actions.render(row)}
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
          {footer && (
            <tfoot className="border-t border-border">
              {footer}
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
