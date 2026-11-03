import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import clsx from "clsx";
import { ShortcutIcon } from "../ui/ShortcutIcon";
import {
  END_OF_LIST,
  buildShortcutFilterSearch,
  isShortcutFilterActive,
  type ShortcutFilter,
  type TagRef,
} from "../../lib/shortcutFilters";

interface PinnedFilterListProps {
  filters: ShortcutFilter[];
  tags: TagRef[];
  /** Drag to reorder. Off in the mobile drawer, where HTML drag and drop does not work. */
  draggable?: boolean;
  onReorder?: (sourceId: string, targetId: string, position: "before" | "after") => void;
  /** data-tour value for the first filter, so a tour can point at it. */
  firstItemTourId?: string;
}

/** The user's pinned filters as one ordered list, shown under the Tags menu entry. */
export function PinnedFilterList({ filters, tags, draggable = false, onReorder, firstItemTourId }: PinnedFilterListProps) {
  const location = useLocation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ targetId: string; position: "before" | "after" } | null>(null);

  if (filters.length === 0) return null;

  function finishDrag() {
    setDraggingId(null);
    setDropIndicator(null);
  }

  return (
    <>
    <div className="ml-5 mt-1 text-[10px] uppercase tracking-wider text-neutral-600">Filters</div>
    <ul className="mt-1 space-y-0.5 px-2" aria-label="Pinned filters">
      {filters.map((shortcut, index) => {
        const isActive =
          location.pathname === "/items" && isShortcutFilterActive(shortcut, location.search, tags);

        return (
          <li
            key={shortcut.id}
            data-testid={`pinned-${shortcut.id}`}
            draggable={draggable}
            onDragStart={
              draggable
                ? (event) => {
                    setDraggingId(shortcut.id);
                    setDropIndicator(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", shortcut.id);
                  }
                : undefined
            }
            onDragEnd={draggable ? finishDrag : undefined}
            onDragOver={
              draggable
                ? (event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    setDropIndicator({ targetId: shortcut.id, position });
                  }
                : undefined
            }
            onDrop={
              draggable
                ? (event) => {
                    event.preventDefault();
                    const sourceId = draggingId || event.dataTransfer.getData("text/plain");
                    const insertPosition =
                      dropIndicator?.targetId === shortcut.id ? dropIndicator.position : "before";
                    if (sourceId && sourceId !== shortcut.id) {
                      onReorder?.(sourceId, shortcut.id, insertPosition);
                    }
                    finishDrag();
                  }
                : undefined
            }
            className={clsx("relative ml-5 rounded-md", draggingId === shortcut.id ? "opacity-60" : "opacity-100")}
          >
            {dropIndicator?.targetId === shortcut.id && dropIndicator.position === "before" && (
              <div data-testid="drop-indicator" className="absolute -top-0.5 left-0 right-0 h-0.5 rounded bg-blue-400" />
            )}
            <NavLink
              to={{ pathname: "/items", search: buildShortcutFilterSearch(shortcut, tags) }}
              data-tour={index === 0 ? firstItemTourId : undefined}
              className={clsx(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                isActive
                  ? "bg-neutral-800/80 text-neutral-100"
                  : "text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300",
              )}
            >
              <ShortcutIcon filter={shortcut} size={14} />
              <span className="truncate">{shortcut.name}</span>
            </NavLink>
            {dropIndicator?.targetId === shortcut.id && dropIndicator.position === "after" && (
              <div data-testid="drop-indicator" className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded bg-blue-400" />
            )}
          </li>
        );
      })}

      {draggable && draggingId && (
        <li
          aria-hidden="true"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropIndicator({ targetId: END_OF_LIST, position: "after" });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const sourceId = draggingId || event.dataTransfer.getData("text/plain");
            if (sourceId) onReorder?.(sourceId, END_OF_LIST, "after");
            finishDrag();
          }}
          className="ml-5 h-3 rounded-md"
        >
          {dropIndicator?.targetId === END_OF_LIST && (
            <div data-testid="drop-indicator" className="mt-1 h-0.5 rounded bg-blue-400" />
          )}
        </li>
      )}
    </ul>
    </>
  );
}
