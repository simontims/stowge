import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import Sketch from "@uiw/react-color-sketch";
import { TablerIcon } from "./TablerIcon";
import type { TablerEntry } from "../../lib/tablerIconCatalogue";

const POPULAR_NAMES: string[] = [
  "anchor", "archive", "battery", "bell", "bike", "book", "box", "brain",
  "camera", "car", "cpu", "database", "dumbbell", "flame", "flower",
  "folder", "gem", "guitar", "hammer", "heart",
  "headphones", "home", "key", "leaf", "lightbulb",
  "lock", "microscope", "monitor", "music", "package", "paintbrush",
  "fish", "pill", "plane", "plug", "printer", "radio", "ruler",
  "scissors", "server", "settings", "shield", "shirt", "shopping-bag",
  "sofa", "star", "sun", "tag", "thermometer", "tools",
  "truck", "tv", "user", "users", "watch", "wifi", "wrench",
];

let _catalogue: TablerEntry[] | null = null;
let _cataloguePromise: Promise<TablerEntry[]> | null = null;

function loadCatalogue(): Promise<TablerEntry[]> {
  if (_catalogue) return Promise.resolve(_catalogue);
  if (!_cataloguePromise) {
    _cataloguePromise = import("../../lib/tablerIconCatalogue").then((m) => {
      _catalogue = m.TABLER_CATALOGUE;
      return _catalogue;
    });
  }
  return _cataloguePromise;
}

const PICKER_PAGE_SIZE = 120;
const COLOR_PRESETS = [
  "#f87171", "#fb923c", "#fbbf24", "#facc15", "#a3e635",
  "#4ade80", "#2dd4bf", "#38bdf8", "#60a5fa", "#818cf8",
  "#c084fc", "#f472b6", "#94a3b8",
];

interface IconColorPickerProps {
  title: string;
  value: string;
  onChange: (name: string) => void;
  color: string;
  onColorChange: (hex: string) => void;
  placeholder?: string;
}

export function IconColorPicker({
  title,
  value,
  onChange,
  color,
  onColorChange,
  placeholder = "Choose icon...",
}: IconColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"icon" | "color">("icon");
  const [query, setQuery] = useState("");
  const [catalogue, setCatalogue] = useState<TablerEntry[] | null>(_catalogue);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const didRevealRef = useRef(false);
  const iconSearchRef = useRef<HTMLInputElement | null>(null);
  const colorPanelRef = useRef<HTMLDivElement | null>(null);
  const lastFocusedIconRef = useRef<HTMLElement | null>(null);
  const lastFocusedColorRef = useRef<HTMLElement | null>(null);
  const [draftColor, setDraftColor] = useState(color);

  useEffect(() => {
    if (open && !catalogue) {
      loadCatalogue().then(setCatalogue);
    }
  }, [open, catalogue]);

  useEffect(() => {
    if (!open) {
      didRevealRef.current = false;
      return;
    }
    if (didRevealRef.current || !catalogue) return;
    didRevealRef.current = true;
    if (value && !POPULAR_NAMES.includes(value)) {
      setQuery(value);
    }
  }, [open, value, catalogue]);

  useEffect(() => {
    setPage(1);
    setShowAll(false);
  }, [query]);

  const popular = useMemo(
    () => (catalogue ? catalogue.filter((e) => POPULAR_NAMES.includes(e.name)) : []),
    [catalogue]
  );

  const searchResults = useMemo(() => {
    if (!catalogue || !query.trim()) return null;
    const q = query.trim().toLowerCase();
    return catalogue.filter((e) => e.name.includes(q));
  }, [catalogue, query]);

  const displayIcons: TablerEntry[] = useMemo(() => {
    if (searchResults) return searchResults.slice(0, 200);
    if (showAll && catalogue) return catalogue.slice(0, page * PICKER_PAGE_SIZE);
    return popular;
  }, [searchResults, showAll, catalogue, popular, page]);

  function close() {
    setOpen(false);
    setQuery("");
    setShowAll(false);
    setPage(1);
    lastFocusedIconRef.current = null;
    lastFocusedColorRef.current = null;
  }

  function openPicker() {
    setDraftColor(color);
    setTab("icon");
    setOpen(true);
  }

  function switchTab(next: "icon" | "color") {
    if (tab === next) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      if (tab === "icon") lastFocusedIconRef.current = active;
      if (tab === "color") lastFocusedColorRef.current = active;
    }
    setTab(next);
  }

  function select(name: string) {
    onChange(name);
  }

  function applyColor() {
    onColorChange(draftColor);
  }

  function done() {
    applyColor();
    close();
  }

  function removeColor() {
    setDraftColor("");
    onColorChange("");
  }

  const isLoading = open && !catalogue;
  const inSearch = query.trim().length > 0;
  const totalResults = searchResults?.length ?? 0;
  const showLoadMore = !inSearch && showAll && catalogue && page * PICKER_PAGE_SIZE < catalogue.length;
  const dialogTitle = title.trim() || "Item";

  useEffect(() => {
    if (!open) return;
    const target = tab === "icon"
      ? (lastFocusedIconRef.current && document.contains(lastFocusedIconRef.current)
        ? lastFocusedIconRef.current
        : iconSearchRef.current)
      : (lastFocusedColorRef.current && document.contains(lastFocusedColorRef.current)
        ? lastFocusedColorRef.current
        : colorPanelRef.current);
    target?.focus();
  }, [open, tab]);

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 transition-colors text-sm"
      >
        {value ? (
          <>
            <TablerIcon name={value} size={16} color={color || undefined} />
            <span className="text-neutral-400">{value}</span>
          </>
        ) : (
          <span className="text-neutral-500">{placeholder}</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={close}
            aria-label="Close icon picker"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose an icon and colour"
            className="relative z-10 w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[75vh]"
          >
            <div className="flex items-center justify-between px-4 pt-4 shrink-0">
              <span className="text-sm font-semibold text-neutral-100">{dialogTitle}</span>
              <button
                type="button"
                onClick={close}
                className="text-neutral-500 hover:text-neutral-200 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex gap-4 px-4 mt-3 border-b border-neutral-800 shrink-0">
              <button
                type="button"
                onClick={() => switchTab("icon")}
                className={"pb-2 text-sm font-medium border-b-2 transition-colors " + (
                  tab === "icon" ? "border-neutral-300 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
                )}
              >
                Icon
              </button>
              <button
                type="button"
                onClick={() => switchTab("color")}
                className={"pb-2 text-sm font-medium border-b-2 transition-colors " + (
                  tab === "color" ? "border-neutral-300 text-neutral-100" : "border-transparent text-neutral-500 hover:text-neutral-300"
                )}
              >
                Colour
              </button>
            </div>

            <div className="h-[27rem] flex-shrink-0">
              {tab === "color" && (
                <div className="h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-neutral-800 shrink-0" />
                  <div className="flex-1 overflow-y-auto flex gap-4 p-4">
                    <div ref={colorPanelRef} tabIndex={-1} className="flex flex-col items-center gap-2 flex-shrink-0 pt-4 outline-none">
                      <div className="flex items-center justify-center w-20 h-20 rounded-lg border border-neutral-700 bg-neutral-950">
                        {value ? (
                          <TablerIcon name={value} size={40} color={draftColor || undefined} />
                        ) : (
                          <span className="text-neutral-600 text-2xl">-</span>
                        )}
                      </div>
                      <span className="text-xs text-neutral-500 text-center max-w-[80px] break-words">
                        {value || "no icon"}
                      </span>
                    </div>

                    <div className="flex-1 flex flex-col items-center justify-start gap-3">
                      <div data-color-mode="dark">
                        <Sketch
                          color={draftColor || "#60a5fa"}
                          disableAlpha
                          presetColors={COLOR_PRESETS}
                          onChange={(c) => setDraftColor(c.hex)}
                        />
                      </div>
                      {draftColor && (
                        <button
                          type="button"
                          onClick={removeColor}
                          className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-600 transition-colors"
                        >
                          Remove colour
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {tab === "icon" && (
                <div className="h-full flex flex-col">
                  <div className="px-4 py-3 border-b border-neutral-800 shrink-0">
                    <input
                      ref={iconSearchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="Search 6,000+ icons..."
                    />
                  </div>

                  <div className="overflow-y-auto p-3 flex-1">
                    {isLoading ? (
                      <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">
                        Loading icons...
                      </div>
                    ) : (
                      <>
                        {!inSearch && (
                          <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-2 px-1">
                            {showAll
                              ? `All icons (${catalogue?.length ?? 0})`
                              : "Popular icons - type to search all"}
                          </p>
                        )}
                        {inSearch && totalResults > 0 && (
                          <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-2 px-1">
                            {totalResults > 200
                              ? `Showing 200 of ${totalResults} results`
                              : `${totalResults} result${totalResults !== 1 ? "s" : ""}`}
                          </p>
                        )}
                        {inSearch && totalResults === 0 && (
                          <p className="text-sm text-neutral-500 text-center py-8">No icons match "{query}"</p>
                        )}

                        <div className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-1.5">
                          {!inSearch && (
                            <button
                              type="button"
                              onClick={() => select("")}
                              title="No icon"
                              className={[
                                "flex flex-col items-center justify-center gap-1 h-14 rounded-lg border text-xs transition-colors",
                                value === ""
                                  ? "border-white bg-neutral-800/60 text-white"
                                  : "border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300",
                              ].join(" ")}
                            >
                              <span className="text-base leading-none">-</span>
                              <span className="text-[10px] text-neutral-600 truncate w-full text-center px-0.5">none</span>
                            </button>
                          )}

                          {displayIcons.map(({ name, component: C }) => (
                            <button
                              key={name}
                              type="button"
                              onClick={() => select(name)}
                              title={name}
                              className={[
                                "flex flex-col items-center justify-center gap-1 h-14 rounded-lg border transition-colors",
                                value === name
                                  ? "border-white bg-neutral-800/60 text-white"
                                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
                              ].join(" ")}
                            >
                              <C size={18} stroke={1.5} color={value === name && draftColor ? draftColor : undefined} />
                              <span className="text-[10px] text-neutral-600 truncate w-full text-center px-0.5">{name}</span>
                            </button>
                          ))}
                        </div>

                        {!inSearch && (
                          <div className="mt-3 flex justify-center gap-2">
                            {!showAll && (
                              <button
                                type="button"
                                onClick={() => setShowAll(true)}
                                className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-600 transition-colors"
                              >
                                Browse all {catalogue?.length ?? "6,000+"} icons
                              </button>
                            )}
                            {showLoadMore && (
                              <button
                                type="button"
                                onClick={() => setPage((p) => p + 1)}
                                className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-600 transition-colors"
                              >
                                Load more
                              </button>
                            )}
                            {showAll && !showLoadMore && (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowAll(false);
                                  setPage(1);
                                }}
                                className="text-xs text-neutral-500 hover:text-neutral-300 px-3 py-1.5 rounded-md border border-neutral-700 hover:border-neutral-600 transition-colors"
                              >
                                Show popular only
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-neutral-800 shrink-0 bg-neutral-950/50">
              <button
                type="button"
                onClick={done}
                className="text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
