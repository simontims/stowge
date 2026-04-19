import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search,
  ArrowRight,
  Plus,
  MoveRight,
  MapPin,
  BarChart3,
} from "lucide-react";
import clsx from "clsx";
import { navItems } from "../../config/nav";

interface Command {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();

  function go(route: string) {
    navigate(route);
    onClose();
  }

  // Static quick-action commands
  const staticCommands: Command[] = [
    {
      id: "add-item",
      label: "Add Item",
      description: "Add a new item to inventory",
      icon: <Plus size={14} />,
      action: () => go("/add"),
    },
    {
      id: "search-items",
      label: "Search Items",
      description: "Browse the items list",
      icon: <Search size={14} />,
      action: () => go("/items"),
    },
    {
      id: "move-stock",
      label: "Move Stock",
      description: "Move stock to another location",
      icon: <MoveRight size={14} />,
      action: () => go("/add"),
    },
    {
      id: "adjust-qty",
      label: "Adjust Quantity",
      description: "Update stock quantity for an item",
      icon: <BarChart3 size={14} />,
      action: () => go("/items"),
    },
    {
      id: "open-locations",
      label: "Open Locations",
      description: "Browse storage locations",
      icon: <MapPin size={14} />,
      action: () => go("/system?tab=locations"),
    },
  ];

  // Nav items as Go To commands (deduplicated against static list)
  const staticIds = new Set(staticCommands.map((c) => c.id));
  const navCommands: Command[] = navItems
    .filter((item) => !staticIds.has(`nav-${item.route}`))
    .map((item) => ({
      id: `nav-${item.route}`,
      label: `Go to ${item.label}`,
      icon: <item.icon size={14} />,
      action: () => go(item.route),
    }));

  const allCommands = [...staticCommands, ...navCommands];

  const filtered = query.trim()
    ? allCommands.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.description?.toLowerCase().includes(query.toLowerCase())
      )
    : allCommands;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Defer focus so the element is visible
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll active item into view
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // Global Ctrl+K — toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        if (open) onClose();
      }
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[activeIndex]?.action();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search row */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-neutral-800">
          <Search size={15} className="text-neutral-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search actions and pages…"
            className="flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-500 outline-none"
            aria-label="Command search"
            aria-autocomplete="list"
            aria-controls="command-list"
            aria-activedescendant={
              filtered[activeIndex] ? `cmd-${filtered[activeIndex].id}` : undefined
            }
          />
          <kbd className="text-[10px] text-neutral-600 border border-neutral-700 rounded px-1.5 py-0.5 font-mono shrink-0">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id="command-list"
          role="listbox"
          aria-label="Commands"
          className="max-h-80 overflow-y-auto py-1.5"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-8 text-sm text-neutral-500 text-center">
              No results for &ldquo;{query}&rdquo;
            </li>
          ) : (
            filtered.map((cmd, i) => (
              <li
                key={cmd.id}
                id={`cmd-${cmd.id}`}
                role="option"
                aria-selected={i === activeIndex}
              >
                <button
                  onPointerEnter={() => setActiveIndex(i)}
                  onClick={cmd.action}
                  className={clsx(
                    "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                    i === activeIndex
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400"
                  )}
                >
                  <span
                    className={clsx(
                      "shrink-0 transition-colors",
                      i === activeIndex ? "text-neutral-300" : "text-neutral-600"
                    )}
                  >
                    {cmd.icon}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{cmd.label}</span>
                  {cmd.description && (
                    <span className="text-xs text-neutral-600 hidden sm:block shrink-0 truncate max-w-[160px]">
                      {cmd.description}
                    </span>
                  )}
                  <ArrowRight
                    size={12}
                    className={clsx(
                      "shrink-0 transition-colors",
                      i === activeIndex ? "text-neutral-500" : "text-neutral-800"
                    )}
                  />
                </button>
              </li>
            ))
          )}
        </ul>

        {/* Footer hint */}
        <div className="border-t border-neutral-800 px-4 py-2 flex items-center gap-4 text-[11px] text-neutral-600">
          <span>
            <kbd className="font-mono">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono">Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
