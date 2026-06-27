import { useEffect, useMemo, useState } from "react";
import { Plus, Save, HelpCircle, Settings } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ListToolbar } from "../components/ui/ListToolbar";
import { SettingsSaveBar } from "../components/ui/SettingsSaveBar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton } from "../components/ui/DeleteControls";
import { DeleteTransferModal } from "../components/ui/DeleteTransferModal";
import { IconColorPicker } from "../components/ui/IconColorPicker";
import { TablerIcon } from "../components/ui/TablerIcon";
import { solidActionButtonClasses } from "../components/ui/buttonStyles";
import { useTableSort } from "../hooks/useTableSort";
import { COLLECTIONS_NAV_UPDATED_EVENT } from "../config/nav";
import { apiRequest } from "../lib/api";
import { formatBytes } from "../lib/format";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";

// ── Types ────────────────────────────────────────────────────────────────────
interface CollectionRecord {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  description: string | null;
  ai_hint: string | null;
  item_count: number;
  created_at: string | null;
  updated_at: string | null;
  actions?: never;
}

interface CollectionListRow extends CollectionRecord {
  asset_count: number;
  disk_bytes: number;
  isSynthetic?: boolean;
  syntheticKind?: "none" | "recycle-bin";
}

interface DeletedItemRow {
  id: string;
  name: string;
  description: string | null;
  collection: string | null;
  location: string | null;
  status: string;
  quantity: number;
  created_at: string;
  thumb: string | null;
  actions?: never;
}

interface CollectionStatusMetrics {
  item_count?: number;
  asset_count?: number;
  disk_bytes?: number;
}

interface CollectionsStatusResponse {
  collections?: Array<{
    id: string;
    name: string;
    item_count: number;
    asset_count: number;
    disk_bytes: number;
  }>;
  uncollected?: CollectionStatusMetrics;
  recycle_bin?: CollectionStatusMetrics;
  totals?: CollectionStatusMetrics;
}

interface CollectionForm {
  name: string;
  icon: string;
  color: string;
  description: string;
  ai_hint: string;
}

const EMPTY_FORM: CollectionForm = { name: "", icon: "", color: "", description: "", ai_hint: "" };


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
        <IconColorPicker
          title={form.name}
          value={form.icon}
          onChange={(name) => onChange({ ...form, icon: name })}
          color={form.color}
          onColorChange={(hex) => onChange({ ...form, color: hex })}
        />
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
type CollectionSortKey = "name" | "description" | "item_count" | "asset_count" | "disk_bytes";

interface CollectionsSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsCollectionsPage({ embedded, onDirtyChange, saveFnRef }: CollectionsSectionProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [uncollectedItemCount, setUncollectedItemCount] = useState(0);
  const [uncollectedAssetCount, setUncollectedAssetCount] = useState(0);
  const [uncollectedDiskBytes, setUncollectedDiskBytes] = useState(0);
  const [recycleBinAssetCount, setRecycleBinAssetCount] = useState(0);
  const [recycleBinDiskBytes, setRecycleBinDiskBytes] = useState(0);
  const [totals, setTotals] = useState<{ item_count: number; asset_count: number; disk_bytes: number }>({
    item_count: 0,
    asset_count: 0,
    disk_bytes: 0,
  });
  const [collectionStatsByName, setCollectionStatsByName] = useState<Record<string, { asset_count: number; disk_bytes: number }>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [deletedLoadError, setDeletedLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDirection, handleSort } = useTableSort<CollectionSortKey>("name");

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
  // Delete modal state
  const [deleteStep, setDeleteStep] = useState<"confirm" | "progress" | "done">("confirm");
  const [deleteProgress, setDeleteProgress] = useState<string[]>([]);
  const [deleteMoveToId, setDeleteMoveToId] = useState<string>("");
  const [deletedItems, setDeletedItems] = useState<DeletedItemRow[]>([]);
  const [emptyRecycleBinOpen, setEmptyRecycleBinOpen] = useState(false);
  const [emptyingRecycleBin, setEmptyingRecycleBin] = useState(false);
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);

  const editingCollection = useMemo(
    () => collections.find((c) => c.id === editingId) || null,
    [collections, editingId]
  );
  const showListView = !addingOpen && !editingId;

  const isEditDirty = useMemo(
    () =>
      editForm.name !== initialEditForm.name ||
      editForm.icon !== initialEditForm.icon ||
      editForm.color !== initialEditForm.color ||
      editForm.description !== initialEditForm.description ||
      editForm.ai_hint !== initialEditForm.ai_hint,
    [editForm, initialEditForm]
  );

  // Expose dirty state and save function when embedded
  useEffect(() => { onDirtyChange?.(isEditDirty); }, [isEditDirty, onDirtyChange]);
  if (saveFnRef) saveFnRef.current = isEditDirty ? saveEdit : null;

  useEffect(() => { void loadCollections(); }, []);

  useEffect(() => {
    const shouldOpenRecycleBin = Boolean((location.state as { openRecycleBin?: boolean } | null)?.openRecycleBin);
    if (!shouldOpenRecycleBin) return;

    setRecycleBinOpen(true);
    navigate({ pathname: "/collections", search: location.search }, { replace: true, state: null });
  }, [location.search, location.state, navigate]);

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

      try {
        const status = await apiRequest<CollectionsStatusResponse>("/api/status/collections");
        const nextStatsByName: Record<string, { asset_count: number; disk_bytes: number }> = {};
        for (const row of status.collections || []) {
          nextStatsByName[row.name] = {
            asset_count: row.asset_count ?? 0,
            disk_bytes: row.disk_bytes ?? 0,
          };
        }
        setCollectionStatsByName(nextStatsByName);
        setUncollectedItemCount(status.uncollected?.item_count ?? 0);
        setUncollectedAssetCount(status.uncollected?.asset_count ?? 0);
        setUncollectedDiskBytes(status.uncollected?.disk_bytes ?? 0);
        setRecycleBinAssetCount(status.recycle_bin?.asset_count ?? 0);
        setRecycleBinDiskBytes(status.recycle_bin?.disk_bytes ?? 0);
        setTotals({
          item_count: status.totals?.item_count ?? 0,
          asset_count: status.totals?.asset_count ?? 0,
          disk_bytes: status.totals?.disk_bytes ?? 0,
        });
      } catch {
        setCollectionStatsByName({});
        setUncollectedItemCount(0);
        setUncollectedAssetCount(0);
        setUncollectedDiskBytes(0);
        setRecycleBinAssetCount(0);
        setRecycleBinDiskBytes(0);
        setTotals({ item_count: 0, asset_count: 0, disk_bytes: 0 });
      }

      try {
        const deleted = await apiRequest<DeletedItemRow[]>("/api/items/deleted");
        setDeletedItems(deleted || []);
        setDeletedLoadError("");
      } catch (deletedErr) {
        setDeletedItems([]);
        setDeletedLoadError((deletedErr as Error).message || "Unable to load recycle bin items.");
      }
    } catch (err) {
      setCollections([]);
      setCollectionStatsByName({});
      setUncollectedItemCount(0);
      setUncollectedAssetCount(0);
      setUncollectedDiskBytes(0);
      setRecycleBinAssetCount(0);
      setRecycleBinDiskBytes(0);
      setTotals({ item_count: 0, asset_count: 0, disk_bytes: 0 });
      setDeletedItems([]);
      setDeletedLoadError("");
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
      color: cat.color || "",
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
    if (newForm.name.trim().length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Collection name"));
      return;
    }
    setIsCreating(true);
    try {
      await apiRequest<CollectionRecord>("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          name: newForm.name.trim(),
          icon: newForm.icon || null,
          color: newForm.color || null,
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
    if (editForm.name.trim().length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Collection name"));
      return;
    }
    setIsSavingEdit(true);
    try {
      await apiRequest<CollectionRecord>(`/api/collections/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          icon: editForm.icon || null,
          color: editForm.color || null,
          description: editForm.description.trim() || null,
          ai_hint: editForm.ai_hint.trim() || null,
        }),
      });
      cancelEdit();
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
    setDeleteStep("progress");
    setDeleteProgress([]);

    const targetCollection = deleteMoveToId
      ? collections.find((c) => c.id === deleteMoveToId) ?? null
      : null;

    try {
      // Step 1: move/clear items
      setDeleteProgress([`Moving items to ${targetCollection ? `"${targetCollection.name}"` : "no collection"}…`]);
      const url = deleteMoveToId
        ? `/api/collections/${cat.id}?move_to_collection_id=${deleteMoveToId}`
        : `/api/collections/${cat.id}`;
      // Step 2: delete collection (done server-side in the same DELETE request)
      setDeleteProgress((p) => [...p, `Deleting collection "${cat.name}"…`]);
      await apiRequest(url, { method: "DELETE" });
      setDeleteProgress((p) => [...p, "Complete."]);
      setDeleteStep("done");
      if (editingId === cat.id) cancelEdit();
      await loadCollections();
      window.dispatchEvent(new Event(COLLECTIONS_NAV_UPDATED_EVENT));
    } catch (err) {
      setError((err as Error).message || "Failed to delete collection.");
      setConfirmDeleteCollection(null);
      setDeleteStep("confirm");
    } finally {
      setDeletingId(null);
    }
  }

  function openDeleteModal(cat: CollectionRecord) {
    setDeleteStep("confirm");
    setDeleteProgress([]);
    setDeleteMoveToId("");
    setConfirmDeleteCollection(cat);
  }

  function closeDeleteModal() {
    setConfirmDeleteCollection(null);
    setDeleteStep("confirm");
    setDeleteProgress([]);
    setDeleteMoveToId("");
  }

  function openCollectionItems(collection: CollectionListRow) {
    if (collection.syntheticKind === "recycle-bin") {
      setRecycleBinOpen(true);
      return;
    }
    setRecycleBinOpen(false);
    if (deletingId === collection.id) return;
    navigate({
      pathname: "/items",
      search: new URLSearchParams({
        collection: collection.syntheticKind === "none" ? "__none" : collection.name,
      }).toString(),
    });
  }

  function openDeletedItemForRestore(itemId: string) {
    navigate(`/items/${itemId}/edit`, { state: { restoreOnSave: true, returnToRecycleBin: true } });
  }

  async function emptyRecycleBin() {
    setError("");
    setEmptyingRecycleBin(true);
    try {
      await apiRequest<{ deleted: number }>("/api/items/deleted/purge", { method: "POST" });
      setEmptyRecycleBinOpen(false);
      await loadCollections({ background: true });
    } catch (err) {
      setError((err as Error).message || "Failed to empty recycle bin.");
    } finally {
      setEmptyingRecycleBin(false);
    }
  }

  const listRows = useMemo<CollectionListRow[]>(() => {
    const rows: CollectionListRow[] = collections.map((collection) => ({
      ...collection,
      asset_count: collectionStatsByName[collection.name]?.asset_count ?? 0,
      disk_bytes: collectionStatsByName[collection.name]?.disk_bytes ?? 0,
    }));

    if (uncollectedItemCount > 0) {
      rows.push({
        id: "__none__",
        name: "No Collection",
        icon: null,
        color: null,
        description: "Items not assigned to any collection",
        ai_hint: null,
        item_count: uncollectedItemCount,
        asset_count: uncollectedAssetCount,
        disk_bytes: uncollectedDiskBytes,
        created_at: null,
        updated_at: null,
        isSynthetic: true,
        syntheticKind: "none",
      });
    }

    rows.push({
      id: "__recycle_bin__",
      name: "Recycle Bin",
      icon: null,
      color: null,
      description: "Deleted items can be restored",
      ai_hint: null,
      item_count: deletedItems.length,
      asset_count: recycleBinAssetCount,
      disk_bytes: recycleBinDiskBytes,
      created_at: null,
      updated_at: null,
      isSynthetic: true,
      syntheticKind: "recycle-bin",
    });

    return rows;
  }, [
    collections,
    collectionStatsByName,
    uncollectedItemCount,
    uncollectedAssetCount,
    uncollectedDiskBytes,
    deletedItems.length,
    recycleBinAssetCount,
    recycleBinDiskBytes,
  ]);

  const filteredDeletedItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deletedItems;
    return deletedItems.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        (item.description || "").toLowerCase().includes(term) ||
        (item.collection || "").toLowerCase().includes(term) ||
        (item.location || "").toLowerCase().includes(term)
    );
  }, [deletedItems, search]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return listRows;
    return listRows.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        (c.description || "").toLowerCase().includes(term)
    );
  }, [listRows, search]);

  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const rows = [...filtered];

    const specialTailRank = (row: CollectionListRow): number => {
      if (row.syntheticKind === "none") return 1;
      if (row.syntheticKind === "recycle-bin") return 2;
      return 0;
    };

    rows.sort((a, b) => {
      const rankDiff = specialTailRank(a) - specialTailRank(b);
      if (rankDiff !== 0) {
        return rankDiff;
      }

      if (sortKey === "item_count" || sortKey === "asset_count" || sortKey === "disk_bytes") {
        return (a[sortKey] - b[sortKey]) * dir;
      }
      const left = (a[sortKey] || "").toLowerCase();
      const right = (b[sortKey] || "").toLowerCase();
      return left.localeCompare(right) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDirection]);

  const columns = useMemo<Column<CollectionListRow>[]>(
    () => [
      {
        key: "icon",
        header: "Icon",
        className: "w-14",
        render: (row) => (
          <span className="flex items-center justify-center w-8 h-8 rounded border border-neutral-800 bg-neutral-900 text-neutral-400">
            {row.isSynthetic ? <span className="text-xs text-neutral-500">-</span> : <TablerIcon name={row.icon} size={15} color={row.color} />}
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
      ...(embedded ? [
        {
          key: "asset_count",
          header: "Assets",
          sortable: true,
          className: "w-24",
          render: (row: CollectionListRow) => (
            <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300">
              {row.asset_count}
            </span>
          ),
        },
        {
          key: "disk_bytes",
          header: "Disk space",
          sortable: true,
          className: "w-28 tabular-nums",
          render: (row: CollectionListRow) => (
            <span className="text-neutral-300">{formatBytes(row.disk_bytes)}</span>
          ),
        },
      ] as Column<CollectionListRow>[] : []),
      ...(embedded ? [{
        key: "actions",
        header: "ACTIONS",
        className: "w-32 text-right",
        headerClassName: "w-32 text-right",
        render: (row: CollectionListRow) => (
          <div
            className="inline-flex items-center gap-2 justify-end w-full"
            onClick={(event) => event.stopPropagation()}
          >
            {!row.isSynthetic && (
              <>
                <button
                  onClick={() => startEdit(row)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                >
                  Edit
                </button>
                <DeleteActionButton
                  onClick={() => openDeleteModal(row)}
                  isDeleting={deletingId === row.id}
                />
              </>
            )}
            {row.syntheticKind === "recycle-bin" && (
              <button
                onClick={() => setEmptyRecycleBinOpen(true)}
                disabled={deletedItems.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Empty
              </button>
            )}
          </div>
        ),
      } as Column<CollectionListRow>] : []),
    ],
    [deletingId, deletedItems.length, embedded]
  );

  const recycleBinColumns = useMemo<Column<DeletedItemRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        render: (row) => <span className="font-medium text-neutral-200">{row.name}</span>,
      },
      {
        key: "collection",
        header: "Collection",
        render: (row) => <span className="text-neutral-400">{row.collection || "-"}</span>,
      },
      {
        key: "location",
        header: "Location",
        render: (row) => <span className="text-neutral-400">{row.location || "-"}</span>,
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-28 text-right",
        headerClassName: "w-28 text-right",
        render: (row) => (
          <div
            className="inline-flex items-center gap-2 justify-end w-full"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={() => openDeletedItemForRestore(row.id)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-900/30 text-xs"
            >
              Restore
            </button>
          </div>
        ),
      },
    ],
    []
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
          action={
            <button
              onClick={() => navigate({ pathname: "/system", search: "?tab=collections" })}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm font-medium transition-colors"
            >
              <Settings size={14} />
              Manage in System
            </button>
          }
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
          <SettingsSaveBar
            isDirty={isEditDirty}
            saving={isSavingEdit}
            onSave={() => void saveEdit()}
            onCancel={cancelEdit}
            onDelete={() => editingCollection && openDeleteModal(editingCollection)}
            deleteDisabled={isSavingEdit}
          />
        </section>
      )}

      <StatusMessage error={error} notice={notice} />

      {showListView && (
        <>
          <ListToolbar
            search={search}
            onSearchChange={setSearch}
            placeholder="Search collections…"
            loading={loading}
            action={
              recycleBinOpen ? (
                <button
                  onClick={() => setRecycleBinOpen(false)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm font-medium transition-colors"
                >
                  Back to Collections
                </button>
              ) : embedded ? (
                <button
                  onClick={() => { setAddingOpen(true); setError(""); }}
                  className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
                >
                  <Plus size={14} />
                  Add Collection
                </button>
              ) : null
            }
          />
          {!recycleBinOpen && (
            <>
              <DataTable
                columns={columns}
                rows={sorted}
                keyField="id"
                emptyMessage={emptyMessage}
                sortKey={sortKey}
                sortDirection={sortDirection}
                onSort={(key) => handleSort(key as CollectionSortKey)}
                onRowClick={openCollectionItems}
                footer={embedded ? (
                  <tr className="bg-neutral-900/60 text-neutral-100">
                    <td className="px-4 py-2.5 font-semibold" colSpan={3}>Total</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{totals.item_count}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{totals.asset_count}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{formatBytes(totals.disk_bytes)}</td>
                    <td className="px-4 py-2.5" />
                  </tr>
                ) : undefined}
              />
              {!loadError && (
                <p className="text-xs text-neutral-600 text-right">
                  {loading ? "Loading…" : `${filtered.length} collection${filtered.length !== 1 ? "s" : ""}`}
                </p>
              )}
            </>
          )}

          {recycleBinOpen && (
            <section className="space-y-2 pt-0">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-100">Recycle Bin</h3>
                <span className="text-xs text-neutral-500">
                  {filteredDeletedItems.length} item{filteredDeletedItems.length !== 1 ? "s" : ""}
                </span>
              </div>

              {deletedLoadError ? (
                <p className="text-sm text-red-400">{deletedLoadError}</p>
              ) : (
                <DataTable
                  columns={recycleBinColumns}
                  rows={filteredDeletedItems}
                  keyField="id"
                  emptyMessage="Recycle bin is empty."
                />
              )}
            </section>
          )}
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

      <DeleteTransferModal
        open={Boolean(confirmDeleteCollection)}
        title="Delete Collection"
        entityKindLabel="Collection"
        entityName={confirmDeleteCollection?.name || ""}
        itemCount={confirmDeleteCollection?.item_count || 0}
        moveToLabel="Move items to"
        noneOptionLabel="No collection"
        moveOptions={collections
          .filter((c) => c.id !== confirmDeleteCollection?.id)
          .map((c) => ({ id: c.id, name: c.name }))}
        moveToId={deleteMoveToId}
        onMoveToIdChange={setDeleteMoveToId}
        step={deleteStep}
        progressMessages={deleteProgress}
        onCancel={closeDeleteModal}
        onConfirm={() => {
          if (!confirmDeleteCollection) return;
          void deleteCollection(confirmDeleteCollection);
        }}
        onDone={closeDeleteModal}
      />

      <DeleteTransferModal
        open={emptyRecycleBinOpen}
        title="Empty Recycle Bin"
        entityKindLabel="Recycle Bin"
        entityName="Recycle Bin"
        itemCount={deletedItems.length}
        moveToLabel="Move items to"
        noneOptionLabel="No collection"
        moveOptions={[]}
        moveToId=""
        onMoveToIdChange={() => {}}
        step="confirm"
        progressMessages={[]}
        showMoveSelector={false}
        confirmDescription={(
          <>
            Permanently delete {deletedItems.length} {deletedItems.length === 1 ? "item" : "items"} in the recycle bin?
          </>
        )}
        confirmButtonLabel={emptyingRecycleBin ? "Deleting..." : "Permanently Delete"}
        confirmDisabled={emptyingRecycleBin || deletedItems.length === 0}
        onCancel={() => setEmptyRecycleBinOpen(false)}
        onConfirm={() => void emptyRecycleBin()}
        onDone={() => setEmptyRecycleBinOpen(false)}
      />
    </div>
  );
}

