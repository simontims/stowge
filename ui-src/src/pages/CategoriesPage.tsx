import { useEffect, useMemo, useState } from "react";
import {
  Anchor, BarChart3, Battery, Bike, Book, Box, Brain, Cable, Camera, Car,
  Cpu, Droplets, Dumbbell, Flame, Flower2, Gamepad2, Gem, Guitar, Hammer,
  HardDrive, HeartPulse, Home, Layers, Leaf, Lightbulb, Microscope, Monitor,
  Music, Package, Paintbrush, Fish, Pill, Plane, Plug, Printer, Radio,
  Ruler, Scissors, Server, Settings, Shield, ShoppingBag, Shirt, Sofa,
  Tag, Thermometer, Truck, Tv, Watch, Wifi, Wrench, Zap,
  Save, Trash2, X, HelpCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable, type Column } from "../components/ui/DataTable";
import { apiRequest } from "../lib/api";

// ── Icon catalogue ───────────────────────────────────────────────────────────
interface IconEntry { name: string; icon: LucideIcon }

const ICON_CATALOGUE: IconEntry[] = [
  { name: "anchor", icon: Anchor },
  { name: "bar-chart-3", icon: BarChart3 },
  { name: "battery", icon: Battery },
  { name: "bike", icon: Bike },
  { name: "book", icon: Book },
  { name: "box", icon: Box },
  { name: "brain", icon: Brain },
  { name: "cable", icon: Cable },
  { name: "camera", icon: Camera },
  { name: "car", icon: Car },
  { name: "cpu", icon: Cpu },
  { name: "droplets", icon: Droplets },
  { name: "dumbbell", icon: Dumbbell },
  { name: "flame", icon: Flame },
  { name: "flower-2", icon: Flower2 },
  { name: "gamepad-2", icon: Gamepad2 },
  { name: "gem", icon: Gem },
  { name: "guitar", icon: Guitar },
  { name: "hammer", icon: Hammer },
  { name: "hard-drive", icon: HardDrive },
  { name: "heart-pulse", icon: HeartPulse },
  { name: "home", icon: Home },
  { name: "layers", icon: Layers },
  { name: "leaf", icon: Leaf },
  { name: "lightbulb", icon: Lightbulb },
  { name: "microscope", icon: Microscope },
  { name: "monitor", icon: Monitor },
  { name: "music", icon: Music },
  { name: "package", icon: Package },
  { name: "paintbrush", icon: Paintbrush },
  { name: "fish", icon: Fish },
  { name: "pill", icon: Pill },
  { name: "plane", icon: Plane },
  { name: "plug", icon: Plug },
  { name: "printer", icon: Printer },
  { name: "radio", icon: Radio },
  { name: "ruler", icon: Ruler },
  { name: "scissors", icon: Scissors },
  { name: "server", icon: Server },
  { name: "settings", icon: Settings },
  { name: "shield", icon: Shield },
  { name: "shopping-bag", icon: ShoppingBag },
  { name: "shirt", icon: Shirt },
  { name: "sofa", icon: Sofa },
  { name: "tag", icon: Tag },
  { name: "thermometer", icon: Thermometer },
  { name: "truck", icon: Truck },
  { name: "tv", icon: Tv },
  { name: "watch", icon: Watch },
  { name: "wifi", icon: Wifi },
  { name: "wrench", icon: Wrench },
  { name: "zap", icon: Zap },
];

function getIconComponent(name: string | null | undefined): LucideIcon {
  if (!name) return Tag;
  return ICON_CATALOGUE.find((e) => e.name === name)?.icon ?? Tag;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface CategoryRecord {
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

interface CategoryForm {
  name: string;
  icon: string;
  description: string;
  ai_hint: string;
}

const EMPTY_FORM: CategoryForm = { name: "", icon: "", description: "", ai_hint: "" };

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
function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ICON_CATALOGUE.filter((e) => e.name.includes(q)) : ICON_CATALOGUE;
  }, [query]);

  return (
    <div className="space-y-2">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
        placeholder="Filter icons…"
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 max-h-44 overflow-y-auto">
        {/* None option */}
        <button
          type="button"
          onClick={() => onChange("")}
          title="No icon"
          className={[
            "flex items-center justify-center w-9 h-9 rounded border text-xs transition-colors",
            value === ""
              ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
              : "border-neutral-700 text-neutral-500 hover:border-neutral-500 hover:text-neutral-300",
          ].join(" ")}
        >
          –
        </button>
        {filtered.map(({ name, icon: Icon }) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(name)}
            title={name}
            className={[
              "flex items-center justify-center w-9 h-9 rounded border transition-colors",
              value === name
                ? "border-emerald-500 bg-emerald-950/40 text-emerald-300"
                : "border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200",
            ].join(" ")}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>
    </div>
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
              An AI hint gives the model extra context when identifying items in this category.
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

// ── Page ─────────────────────────────────────────────────────────────────────
export function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const [addingOpen, setAddingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<CategoryForm>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CategoryForm>(EMPTY_FORM);
  const [initialEditForm, setInitialEditForm] = useState<CategoryForm>(EMPTY_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  const [confirmDeleteCategory, setConfirmDeleteCategory] = useState<CategoryRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const editingCategory = useMemo(
    () => categories.find((c) => c.id === editingId) || null,
    [categories, editingId]
  );

  const isEditDirty = useMemo(
    () =>
      editForm.name !== initialEditForm.name ||
      editForm.icon !== initialEditForm.icon ||
      editForm.description !== initialEditForm.description ||
      editForm.ai_hint !== initialEditForm.ai_hint,
    [editForm, initialEditForm]
  );

  useEffect(() => { void loadCategories(); }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(t);
  }, [notice]);

  async function loadCategories() {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<CategoryRecord[]>("/api/categories");
      setCategories(data);
    } catch (err) {
      setCategories([]);
      setError((err as Error).message || "Failed to load categories.");
    } finally {
      setLoading(false);
    }
  }

  function startEdit(cat: CategoryRecord) {
    setError("");
    setNotice("");
    const snapshot: CategoryForm = {
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

  function requestCancelEdit() {
    if (isEditDirty) { setUnsavedPromptOpen(true); return; }
    cancelEdit();
  }

  async function handleUnsavedSave() { await saveEdit(); }
  function handleUnsavedDiscard() { cancelEdit(); }

  async function createCategory() {
    setError("");
    if (newForm.name.trim().length < 2) {
      setError("Category name must be at least 2 characters.");
      return;
    }
    setIsCreating(true);
    try {
      await apiRequest<CategoryRecord>("/api/categories", {
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
      await loadCategories();
    } catch (err) {
      setError((err as Error).message || "Failed to create category.");
    } finally {
      setIsCreating(false);
    }
  }

  async function saveEdit() {
    if (!editingId) return;
    setError("");
    if (editForm.name.trim().length < 2) {
      setError("Category name must be at least 2 characters.");
      return;
    }
    setIsSavingEdit(true);
    try {
      await apiRequest<CategoryRecord>(`/api/categories/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          icon: editForm.icon || null,
          description: editForm.description.trim() || null,
          ai_hint: editForm.ai_hint.trim() || null,
        }),
      });
      cancelEdit();
      setNotice("Category updated.");
      await loadCategories();
    } catch (err) {
      setError((err as Error).message || "Failed to update category.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteCategory(cat: CategoryRecord) {
    setError("");
    setDeletingId(cat.id);
    try {
      await apiRequest(`/api/categories/${cat.id}`, { method: "DELETE" });
      setConfirmDeleteCategory(null);
      if (editingId === cat.id) cancelEdit();
      await loadCategories();
    } catch (err) {
      setError((err as Error).message || "Failed to delete category.");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.description || "").toLowerCase().includes(term)
    );
  }, [categories, search]);

  const columns = useMemo<Column<CategoryRecord>[]>(
    () => [
      {
        key: "icon",
        header: "Icon",
        className: "w-14",
        render: (row) => {
          const Icon = getIconComponent(row.icon);
          return (
            <span className="flex items-center justify-center w-8 h-8 rounded border border-neutral-800 bg-neutral-900 text-neutral-400">
              <Icon size={15} />
            </span>
          );
        },
      },
      {
        key: "name",
        header: "Name",
        render: (row) => <span className="font-medium text-neutral-200">{row.name}</span>,
      },
      {
        key: "description",
        header: "Description",
        render: (row) => (
          <span className="text-neutral-400">{row.description?.trim() || "-"}</span>
        ),
      },
      {
        key: "item_count",
        header: "Items",
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
          <div className="inline-flex items-center gap-2 justify-end w-full">
            <button
              onClick={() => startEdit(row)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              Edit
            </button>
            <button
              onClick={() => setConfirmDeleteCategory(row)}
              disabled={deletingId === row.id}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70 disabled:opacity-60"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ),
      },
    ],
    [deletingId]
  );

  function CategoryFormFields({
    form,
    onChange,
  }: {
    form: CategoryForm;
    onChange: (next: CategoryForm) => void;
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
        <div>
          <span className="text-xs uppercase tracking-wide text-neutral-500">Icon</span>
          <div className="mt-2">
            <IconPicker value={form.icon} onChange={(name) => onChange({ ...form, icon: name })} />
          </div>
        </div>
        <label className="block">
          <span className="inline-flex items-center gap-1 text-xs uppercase tracking-wide text-neutral-500">
            AI Hint
            <AiHintHelp />
          </span>
          <textarea
            value={form.ai_hint}
            onChange={(e) => onChange({ ...form, ai_hint: e.target.value })}
            className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 min-h-[80px]"
            placeholder="Extra context for the AI when identifying items in this category…"
          />
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Categories"
        description="Organise items into categories and guide the AI with per-category hints."
        action={
          !addingOpen && !editingId ? (
            <button
              onClick={() => { setAddingOpen(true); setError(""); }}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              Add Category
            </button>
          ) : null
        }
      />

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">New Category</h2>
            <button
              onClick={() => { setAddingOpen(false); setNewForm(EMPTY_FORM); setError(""); }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              <X size={13} /> Cancel
            </button>
          </div>
          <CategoryFormFields form={newForm} onChange={setNewForm} />
          <button
            onClick={() => void createCategory()}
            disabled={isCreating}
            className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Save size={14} />
            {isCreating ? "Saving..." : "Save"}
          </button>
        </section>
      )}

      {editingCategory && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">Edit Category</h2>
            <button
              onClick={requestCancelEdit}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              <X size={13} /> Close
            </button>
          </div>
          <CategoryFormFields form={editForm} onChange={setEditForm} />
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setConfirmDeleteCategory(editingCategory)}
              disabled={isSavingEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} /> Delete
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
        </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {!editingId && (
        <>
          <div className="flex items-center gap-2">
            <SearchInput
              placeholder="Search categories…"
              value={search}
              onChange={setSearch}
              className="flex-1 max-w-sm"
            />
            <span className="text-xs text-neutral-600 ml-auto">
              {loading ? "Loading…" : `${filtered.length} categories`}
            </span>
          </div>
          <DataTable
            columns={columns}
            rows={filtered}
            keyField="id"
            emptyMessage="No categories yet. Add your first one above."
          />
        </>
      )}

      {/* Unsaved changes prompt */}
      {unsavedPromptOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
            <p className="text-sm text-neutral-300">
              You have unsaved changes. Do you want to save before leaving this category?
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

      {/* Delete confirm */}
      {confirmDeleteCategory && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Delete Category</h3>
            <p className="text-sm text-neutral-300">
              Permanently delete <span className="font-medium text-neutral-100">{confirmDeleteCategory.name}</span>? This cannot be undone.
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteCategory(null)}
                disabled={deletingId === confirmDeleteCategory.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteCategory(confirmDeleteCategory)}
                disabled={deletingId === confirmDeleteCategory.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                <Trash2 size={14} />
                {deletingId === confirmDeleteCategory.id ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
