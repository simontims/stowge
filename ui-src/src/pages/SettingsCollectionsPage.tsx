import { useEffect, useMemo, useState } from "react";
import { Tag, Plus, Save, Trash2, X, HelpCircle } from "lucide-react";
import type { TablerEntry } from "../lib/tablerIconCatalogue";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { COLLECTIONS_NAV_UPDATED_EVENT } from "../config/nav";
import { apiRequest } from "../lib/api";
import { useServerRetry } from "../lib/useServerRetry";

// ── Tabler icon catalogue (lazy-loaded) ─────────────────────────────────────
// Popular icon names shown immediately when the picker first opens.
// Must match the kebab names produced by tablerIconCatalogue.ts toKebabName().
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

// Module-level cache — catalogue is fetched once and reused for the session.
let _catalogue: TablerEntry[] | null = null;
let _cataloguePromise: Promise<TablerEntry[]> | null = null;

function loadCatalogue(): Promise<TablerEntry[]> {
  if (_catalogue) return Promise.resolve(_catalogue);
  if (!_cataloguePromise) {
    _cataloguePromise = import("../lib/tablerIconCatalogue").then((m) => {
      _catalogue = m.TABLER_CATALOGUE;
      return _catalogue;
    });
  }
  return _cataloguePromise;
}

/** Renders a Tabler icon by stored name. Falls back to the Lucide Tag icon while
 *  the catalogue chunk loads (first use only; cached thereafter). */
function TablerIcon({ name, size = 15 }: { name?: string | null; size?: number }) {
  const [entry, setEntry] = useState<TablerEntry | null>(() =>
    name && _catalogue ? (_catalogue.find((e) => e.name === name) ?? null) : null
  );
  useEffect(() => {
    if (!name) return;
    if (_catalogue) {
      setEntry(_catalogue.find((e) => e.name === name) ?? null);
      return;
    }
    let cancelled = false;
    loadCatalogue().then((cat) => {
      if (!cancelled) setEntry(cat.find((e) => e.name === name) ?? null);
    });
    return () => { cancelled = true; };
  }, [name]);
  if (!name || !entry) return <Tag size={size} />;
  const C = entry.component;
  return <C size={size} stroke={1.5} />;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface CollectionRecord {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  ai_hint: string | null;
  item_count: number;
  created_at: string | null;
  updated_at: string | null;
  actions?: never;
}

interface CollectionForm {
  name: string;
  icon: string;
  description: string;
  ai_hint: string;
}

const EMPTY_FORM: CollectionForm = { name: "", icon: "", description: "", ai_hint: "" };

// ── AI Hint help examples ────────────────────────────────────────────────────
const AI_HINT_EXAMPLES: { label: string; hint: string }[] = [
  {
    label: "Electronic parts",
    hint:
      "These are electronic components, PCB modules, ICs, connectors, or dev boards. " +
      "Read any part numbers or markings carefully. " +
      "Identify the manufacturer and component function if visible.",
  },
  {
    label: "Cologne",
    hint:
      "These are fragrance bottles or cologne/perfume products. " +
      "Look for brand names, product names, and bottle shapes. " +
      "Note the concentration (EDT, EDP, etc.) if visible on the label.",
  },
  {
    label: "Sailing spares",
    hint:
      "These are marine sailing spare parts or rigging hardware. " +
      "Items may include shackles, blocks, cleats, turnbuckles, standing rigging fittings, or deck hardware. " +
      "Note any load ratings, materials (stainless, galvanised), or brand markings.",
  },
  {
    label: "3D printer consumables",
    hint:
      "These are 3D printing consumables such as filament spools, resin bottles, nozzles, or bed adhesives. " +
      "Note the material type (PLA, PETG, ABS, resin), diameter, brand, and colour if visible.",
  },
];

// ── Icon picker ──────────────────────────────────────────────────────────────
const PICKER_PAGE_SIZE = 120;

function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [catalogue, setCatalogue] = useState<TablerEntry[] | null>(_catalogue);
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);

  // Load catalogue when picker opens (no-op if already cached)
  useEffect(() => {
    if (open && !catalogue) {
      loadCatalogue().then(setCatalogue);
    }
  }, [open, catalogue]);

  // Reset browse-all state when search query changes
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
  }

  function select(name: string) {
    onChange(name);
    close();
  }

  const isLoading = open && !catalogue;
  const inSearch = query.trim().length > 0;
  const totalResults = searchResults?.length ?? 0;
  const showLoadMore = !inSearch && showAll && catalogue && page * PICKER_PAGE_SIZE < catalogue.length;

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 transition-colors text-sm"
      >
        {value ? (
          <>
            <TablerIcon name={value} size={16} />
            <span className="text-neutral-400">{value}</span>
          </>
        ) : (
          <span className="text-neutral-500">Choose icon…</span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            onClick={close}
            aria-label="Close icon picker"
          />
          {/* Dialog */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose an icon"
            className="relative z-10 w-full sm:max-w-lg rounded-t-2xl sm:rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl flex flex-col max-h-[85dvh] sm:max-h-[75vh]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-neutral-800 shrink-0">
              <span className="text-sm font-semibold text-neutral-100">Choose icon</span>
              <button
                type="button"
                onClick={close}
                className="text-neutral-500 hover:text-neutral-200 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-neutral-800 shrink-0">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Search 6,000+ icons…"
              />
            </div>

            {/* Body */}
            <div className="overflow-y-auto p-3 flex-1">
              {isLoading ? (
                <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">
                  Loading icons…
                </div>
              ) : (
                <>
                  {/* Section label */}
                  {!inSearch && (
                    <p className="text-[10px] text-neutral-600 uppercase tracking-wider mb-2 px-1">
                      {showAll
                        ? `All icons (${catalogue?.length ?? 0})`
                        : "Popular icons — type to search all"}
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
                    {/* None option — only shown outside search */}
                    {!inSearch && (
                      <button
                        type="button"
                        onClick={() => select("")}
                        title="No icon"
                        className={[
                          "flex flex-col items-center justify-center gap-1 h-14 rounded-lg border text-xs transition-colors",
                          value === ""
                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                            : "border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300",
                        ].join(" ")}
                      >
                        <span className="text-base leading-none">–</span>
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
                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                            : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
                        ].join(" ")}
                      >
                        <C size={18} stroke={1.5} />
                        <span className="text-[10px] text-neutral-600 truncate w-full text-center px-0.5">{name}</span>
                      </button>
                    ))}
                  </div>

                  {/* Browse-all / load-more footer */}
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
                          onClick={() => { setShowAll(false); setPage(1); }}
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
        </div>
      )}
    </>
  );
}

// ── AI Hint help popover ─────────────────────────────────────────────────────
function AiHintHelp() {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-neutral-500 hover:text-neutral-300 transition-colors ml-1"
        aria-label="AI hint examples"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-label="Close help"
          />
          <div className="absolute left-0 top-full mt-2 z-50 w-80 rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-neutral-300">AI Hint examples</p>
            <p className="text-xs text-neutral-500">
              An AI hint gives the model extra context when identifying items in this collection.
            </p>
            {AI_HINT_EXAMPLES.map(({ label, hint }) => (
              <div key={label} className="space-y-0.5">
                <p className="text-xs font-medium text-neutral-300">{label}</p>
                <p className="text-xs text-neutral-500 leading-relaxed">{hint}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

// ── Collection form fields (must be top-level so React doesn't remount on parent re-render) ──
function CollectionFormFields({
  form,
  onChange,
}: {
  form: CollectionForm;
  onChange: (next: CollectionForm) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
          <input
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="Electronic parts"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Description</span>
          <input
            value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })}
            className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="Optional description"
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-neutral-500 shrink-0">Icon</span>
        <IconPicker value={form.icon} onChange={(name) => onChange({ ...form, icon: name })} />
      </div>
      <label className="block">
        <span className="inline-flex items-center gap-1 text-xs tracking-wide text-neutral-500">
          AI Hint
          <AiHintHelp />
        </span>
        <textarea
          value={form.ai_hint}
          onChange={(e) => onChange({ ...form, ai_hint: e.target.value })}
          className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 min-h-[80px]"
          placeholder="Extra context for the AI when identifying items in this collection…"
        />
      </label>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
type CollectionSortKey = "name" | "description" | "item_count";

interface CollectionsSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsCollectionsPage({ embedded, onDirtyChange, saveFnRef }: CollectionsSectionProps = {}) {
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<CollectionSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [addingOpen, setAddingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<CollectionForm>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CollectionForm>(EMPTY_FORM);
  const [initialEditForm, setInitialEditForm] = useState<CollectionForm>(EMPTY_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  const [confirmDeleteCollection, setConfirmDeleteCollection] = useState<CollectionRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingCollection = useMemo(
    () => collections.find((c) => c.id === editingId) || null,
    [collections, editingId]
  );
  const showListView = !addingOpen && !editingId;

  const isEditDirty = useMemo(
    () =>
      editForm.name !== initialEditForm.name ||
      editForm.icon !== initialEditForm.icon ||
      editForm.description !== initialEditForm.description ||
      editForm.ai_hint !== initialEditForm.ai_hint,
    [editForm, initialEditForm]
  );

  // Expose dirty state and save function when embedded
  useEffect(() => { onDirtyChange?.(isEditDirty); }, [isEditDirty, onDirtyChange]);
  if (saveFnRef) saveFnRef.current = isEditDirty ? saveEdit : null;

  useEffect(() => { void loadCollections(); }, []);

  useServerRetry(loadError, loading, () => loadCollections({ background: true }));

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  async function loadCollections(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
      setLoadError("");
    }
    try {
      const data = await apiRequest<CollectionRecord[]>("/api/collections");
      setCollections(data);
    } catch (err) {
      setCollections([]);
      setLoadError((err as Error).message || "Unable to load collections right now.");
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  function startEdit(cat: CollectionRecord) {
    setError("");
    setNotice("");
    const snapshot: CollectionForm = {
      name: cat.name,
      icon: cat.icon || "",
      description: cat.description || "",
      ai_hint: cat.ai_hint || "",
    };
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
    setEditingId(cat.id);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setInitialEditForm(EMPTY_FORM);
    setUnsavedPromptOpen(false);
  }

  async function handleUnsavedSave() { await saveEdit(); }
  function handleUnsavedDiscard() { cancelEdit(); }

  async function createCollection() {
    setError("");
    if (newForm.name.trim().length < 2) {
      setError("Collection name must be at least 2 characters.");
      return;
    }
    setIsCreating(true);
    try {
      await apiRequest<CollectionRecord>("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          name: newForm.name.trim(),
          icon: newForm.icon || null,
          description: newForm.description.trim() || null,
          ai_hint: newForm.ai_hint.trim() || null,
        }),
      });
      setNewForm(EMPTY_FORM);
      setAddingOpen(false);
      await loadCollections();
      window.dispatchEvent(new Event(COLLECTIONS_NAV_UPDATED_EVENT));
    } catch (err) {
      setError((err as Error).message || "Failed to create collection.");
    } finally {
      setIsCreating(false);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setError("");
    if (editForm.name.trim().length < 2) {
      setError("Collection name must be at least 2 characters.");
      return;
    }
    setIsSavingEdit(true);
    try {
      await apiRequest<CollectionRecord>(`/api/collections/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          icon: editForm.icon || null,
          description: editForm.description.trim() || null,
          ai_hint: editForm.ai_hint.trim() || null,
        }),
      });
      cancelEdit();
      setNotice("Collection updated.");
      await loadCollections();
      window.dispatchEvent(new Event(COLLECTIONS_NAV_UPDATED_EVENT));
    } catch (err) {
      setError((err as Error).message || "Failed to update collection.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteCollection(cat: CollectionRecord) {
    setError("");
    setDeletingId(cat.id);
    try {
      await apiRequest(`/api/collections/${cat.id}`, { method: "DELETE" });
      setConfirmDeleteCollection(null);
      if (editingId === cat.id) cancelEdit();
      await loadCollections();
      window.dispatchEvent(new Event(COLLECTIONS_NAV_UPDATED_EVENT));
    } catch (err) {
      setError((err as Error).message || "Failed to delete collection.");
    } finally {
      setDeletingId(null);
    }
  }

  function handleSort(nextKey: CollectionSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  function openCollectionItems(collection: CollectionRecord) {
    if (deletingId === collection.id) return;
    navigate({
      pathname: "/items",
      search: new URLSearchParams({ collection: collection.name }).toString(),
    });
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return collections;
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.description || "").toLowerCase().includes(term)
    );
  }, [collections, search]);

  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sortKey === "item_count") {
        return (a.item_count - b.item_count) * dir;
      }
      const left = (a[sortKey] || "").toLowerCase();
      const right = (b[sortKey] || "").toLowerCase();
      return left.localeCompare(right) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDirection]);

  const columns = useMemo<Column<CollectionRecord>[]>(
    () => [
      {
        key: "icon",
        header: "Icon",
        className: "w-14",
        render: (row) => (
          <span className="flex items-center justify-center w-8 h-8 rounded border border-neutral-800 bg-neutral-900 text-neutral-400">
            <TablerIcon name={row.icon} size={15} />
          </span>
        ),
      },
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => <span className="font-medium text-neutral-200">{row.name}</span>,
      },
      {
        key: "description",
        header: "Description",
        sortable: true,
        render: (row) => (
          <span className="text-neutral-400">{row.description?.trim() || "-"}</span>
        ),
      },
      {
        key: "item_count",
        header: "Items",
        sortable: true,
        className: "w-20",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300">
            {row.item_count}
          </span>
        ),
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-32 text-right",
        headerClassName: "w-32 text-right",
        render: (row) => (
          <div
            className="inline-flex items-center gap-2 justify-end w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => startEdit(row)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              Edit
            </button>
            <DeleteActionButton
              onClick={() => setConfirmDeleteCollection(row)}
              isDeleting={deletingId === row.id}
            />
          </div>
        ),
      },
    ],
    [deletingId]
  );

  const emptyMessage = useMemo(() => {
    if (loading) {
      return "Loading collections...";
    }
    if (loadError) {
      return loadError;
    }
    if (search.trim()) {
      return "No collections match your search.";
    }
    return "No collections yet. Add your first one above.";
  }, [loadError, loading, search]);

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="Collections"
          description="Organise items into collections and guide the AI with per-collection hints"
        />
      )}

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-100">New Collection</h2>
          <CollectionFormFields form={newForm} onChange={setNewForm} />
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void createCollection()}
              disabled={isCreating}
              className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 rounded-md text-sm leading-none font-medium transition-colors"
            >
              <Save size={14} />
              {isCreating ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setAddingOpen(false); setNewForm(EMPTY_FORM); setError(""); }}
              className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm leading-none font-medium"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {editingCollection && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-neutral-100">Edit Collection</h2>
          <CollectionFormFields form={editForm} onChange={setEditForm} />
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setConfirmDeleteCollection(editingCollection)}
              disabled={isSavingEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} /> Delete
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={cancelEdit}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={!isEditDirty || isSavingEdit}
                className={[
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed",
                  isEditDirty
                    ? "border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200"
                    : "border-neutral-700 text-neutral-500",
                ].join(" ")}
              >
                <Save size={14} />
                {isSavingEdit ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {showListView && (
        <>
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search collections…"
            count={loadError ? undefined : filtered.length}
            countLabel="collections"
            loading={loading}
            action={
              <button
                onClick={() => { setAddingOpen(true); setError(""); }}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              >
                <Plus size={14} />
                Add Collection
              </button>
            }
          />
          <DataTable
            columns={columns}
            rows={sorted}
            keyField="id"
            emptyMessage={emptyMessage}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => handleSort(key as CollectionSortKey)}
            onRowClick={openCollectionItems}
          />
        </>
      )}

      {/* Unsaved changes prompt */}
      {unsavedPromptOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
            <p className="text-sm text-neutral-300">
              You have unsaved changes. Do you want to save before leaving this collection?
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setUnsavedPromptOpen(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsavedDiscard}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30"
              >
                Discard
              </button>
              <button
                onClick={() => void handleUnsavedSave()}
                disabled={isSavingEdit}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 disabled:opacity-60"
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        open={Boolean(confirmDeleteCollection)}
        title="Delete Collection"
        message={
          confirmDeleteCollection ? (
            <>
              Permanently delete <span className="font-medium text-neutral-100">{confirmDeleteCollection.name}</span>? This cannot be undone.
            </>
          ) : null
        }
        deleting={Boolean(confirmDeleteCollection && deletingId === confirmDeleteCollection.id)}
        onCancel={() => setConfirmDeleteCollection(null)}
        onConfirm={() => {
          if (confirmDeleteCollection) {
            void deleteCollection(confirmDeleteCollection);
          }
        }}
      />
    </div>
  );
}


