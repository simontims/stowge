import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { apiRequest } from "../lib/api";
import { useServerRetry } from "../lib/useServerRetry";

interface Part {
  id: string;
  name: string;
  collection: string | null;
  location: string | null;
  status: string;
  created_at: string;
  thumb: string | null;
  actions?: never;
}

interface PartDetail {
  id: string;
  name: string;
  description: string | null;
  collection: string | null;
  location_id: string | null;
  location: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  images: Array<{
    id: string;
    thumb_url: string;
    display_url: string;
    original_url: string | null;
  }>;
}

interface PartEditForm {
  name: string;
  description: string;
  collection: string;
  location_id: string;
  status: "draft" | "confirmed";
}

interface LocationOption {
  id: string;
  name: string;
}

interface CollectionOption {
  id: string;
  name: string;
}

const EMPTY_EDIT_FORM: PartEditForm = {
  name: "",
  description: "",
  collection: "",
  location_id: "",
  status: "draft",
};

function toEditForm(part: PartDetail): PartEditForm {
  return {
    name: part.name ?? "",
    description: part.description ?? "",
    collection: part.collection ?? "",
    location_id: part.location_id ?? "",
    status: part.status === "confirmed" ? "confirmed" : "draft",
  };
}

function isSameForm(a: PartEditForm, b: PartEditForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.collection.trim() === b.collection.trim() &&
    a.location_id === b.location_id &&
    a.status === b.status
  );
}

type ItemSortKey = "name" | "collection" | "location" | "status";

function getColumnWidth(values: Array<string | null | undefined>, minimum: number, maximum: number): string {
  const longest = values.reduce((currentMax, value) => {
    const normalized = (value || "-").trim();
    return Math.max(currentMax, normalized.length);
  }, 0);
  const target = Math.min(maximum, Math.max(minimum, longest + 4));
  return `${target}ch`;
}

export function ItemsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeletePart, setConfirmDeletePart] = useState<Part | null>(null);
  const [sortKey, setSortKey] = useState<ItemSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<PartDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [editForm, setEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [initialEditForm, setInitialEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [savingDetail, setSavingDetail] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);

  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [confirmDeletePartOpen, setConfirmDeletePartOpen] = useState(false);
  const [deletingPartFromModal, setDeletingPartFromModal] = useState(false);

  const collectionFilter = searchParams.get("collection")?.trim() || "";

  const hasDirtyChanges = useMemo(
    () => selectedPartId !== null && !isSameForm(editForm, initialEditForm),
    [editForm, initialEditForm, selectedPartId]
  );

  useEffect(() => {
    void loadParts();
    void loadLocations();
    void loadCollectionOptions();
  }, []);

  useServerRetry(error, loading, () => loadParts({ background: true }));

  useEffect(() => {
    const source = new EventSource("/api/events/items");

    const onItemsChanged = () => {
      void loadParts();
    };

    source.addEventListener("items_changed", onItemsChanged);
    source.onerror = () => {
      // Keep page usable if stream is unavailable; manual refresh still works.
    };

    return () => {
      source.removeEventListener("items_changed", onItemsChanged);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (selectedPartId === null || !hasDirtyChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDirtyChanges, selectedPartId]);

  async function loadParts(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const data = await apiRequest<Part[]>("/api/items");
      setParts(data);
    } catch (err) {
      setError((err as Error).message || "Failed to load parts.");
      setParts([]);
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function loadLocations() {
    try {
      const data = await apiRequest<LocationOption[]>("/api/locations");
      setLocations(data || []);
    } catch {
      setLocations([]);
    }
  }

  async function loadCollectionOptions() {
    try {
      const data = await apiRequest<CollectionOption[]>("/api/collections");
      setCollectionOptions(data || []);
    } catch {
      setCollectionOptions([]);
    }
  }

  async function deletePart(partId: string) {
    setDeleteError("");
    setDeletingId(partId);
    try {
      await apiRequest(`/api/items/${partId}`, { method: "DELETE" });
      setParts((current) => current.filter((part) => part.id !== partId));
      setConfirmDeletePart(null);
    } catch (err) {
      setDeleteError((err as Error).message || "Failed to delete part.");
    } finally {
      setDeletingId(null);
    }
  }

  async function deletePartFromModal() {
    if (!selectedPartId) return;
    setDeletingPartFromModal(true);
    try {
      await apiRequest(`/api/items/${selectedPartId}`, { method: "DELETE" });
      setParts((current) => current.filter((part) => part.id !== selectedPartId));
      closeModalNow();
    } catch (err) {
      setDetailError((err as Error).message || "Failed to delete item.");
      setConfirmDeletePartOpen(false);
    } finally {
      setDeletingPartFromModal(false);
    }
  }

  async function openPartModal(partId: string) {
    setSelectedPartId(partId);
    setSelectedPart(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const detail = await apiRequest<PartDetail>(`/api/items/${partId}`);
      const mapped = toEditForm(detail);
      setSelectedPart(detail);
      setEditForm(mapped);
      setInitialEditForm(mapped);
    } catch (err) {
      setDetailError((err as Error).message || "Failed to load part details.");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeModalNow() {
    setSelectedPartId(null);
    setSelectedPart(null);
    setDetailError("");
    setDetailLoading(false);
    setSavingDetail(false);
    setEditForm(EMPTY_EDIT_FORM);
    setInitialEditForm(EMPTY_EDIT_FORM);
    setUnsavedPromptOpen(false);
    setConfirmDeletePartOpen(false);
  }

  function requestCloseModal() {
    if (hasDirtyChanges) {
      setUnsavedPromptOpen(true);
      return;
    }
    closeModalNow();
  }

  async function savePartChanges(): Promise<boolean> {
    if (!selectedPartId || !selectedPart) return false;
    if (!hasDirtyChanges) return true;

    const trimmedName = editForm.name.trim();
    if (trimmedName.length < 2) {
      setDetailError("Name must be at least 2 characters.");
      return false;
    }

    setSavingDetail(true);
    setDetailError("");
    try {
      await apiRequest(`/api/items/${selectedPartId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: trimmedName,
          description: editForm.description.trim() || null,
          collection: editForm.collection.trim() || null,
          location_id: editForm.location_id || null,
          status: editForm.status,
        }),
      });

      const refreshed = await apiRequest<PartDetail>(`/api/items/${selectedPartId}`);
      const refreshedForm = toEditForm(refreshed);
      setSelectedPart(refreshed);
      setEditForm(refreshedForm);
      setInitialEditForm(refreshedForm);
      setParts((current) =>
        current.map((p) =>
          p.id === refreshed.id
            ? {
                ...p,
                name: refreshed.name,
                collection: refreshed.collection,
                location: refreshed.location,
                status: refreshed.status,
              }
            : p
        )
      );
      return true;
    } catch (err) {
      setDetailError((err as Error).message || "Failed to save changes.");
      return false;
    } finally {
      setSavingDetail(false);
    }
  }

  async function handleUnsavedSave() {
    const ok = await savePartChanges();
    if (!ok) return;

    setUnsavedPromptOpen(false);
    closeModalNow();
  }

  function handleUnsavedDiscard() {
    setUnsavedPromptOpen(false);
    closeModalNow();
  }

  function handleUnsavedCancel() {
    setUnsavedPromptOpen(false);
  }

  function handleSort(nextKey: ItemSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  function clearCollectionFilter() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("collection");
    setSearchParams(nextParams, { replace: true });
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const normalizedCollectionFilter = collectionFilter.toLowerCase();

    return parts.filter((part) => {
      const collection = (part.collection || "").toLowerCase();

      if (normalizedCollectionFilter && collection !== normalizedCollectionFilter) {
        return false;
      }

      if (!term) {
        return true;
      }

      const name = part.name.toLowerCase();
      const location = (part.location || "").toLowerCase();
      const status = part.status.toLowerCase();
      return (
        name.includes(term) ||
        collection.includes(term) ||
        location.includes(term) ||
        status.includes(term)
      );
    });
  }, [collectionFilter, parts, search]);

  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => {
      const left = (a[sortKey] || "").toLowerCase();
      const right = (b[sortKey] || "").toLowerCase();
      return left.localeCompare(right) * dir;
    });
    return rows;
  }, [filtered, sortKey, sortDirection]);

  const columnWidths = useMemo(
    () => ({
      name: getColumnWidth(parts.map((part) => part.name), 18, 34),
      collection: getColumnWidth(parts.map((part) => part.collection), 14, 26),
      location: getColumnWidth(parts.map((part) => part.location), 14, 26),
      status: getColumnWidth(parts.map((part) => part.status), 10, 14),
    }),
    [parts]
  );

  const columns = useMemo<Column<Part>[]>(
    () => [
      {
        key: "thumb",
        header: "Image",
        className: "w-20",
        width: "5.5rem",
        render: (row) =>
          row.thumb ? (
            <img
              src={row.thumb}
              alt={row.name}
              className="w-10 h-10 object-cover rounded border border-neutral-800"
            />
          ) : (
            <span className="text-xs text-neutral-600">none</span>
          ),
      },
      {
        key: "name",
        header: "Name",
        sortable: true,
        width: columnWidths.name,
        render: (row) => (
          <span className="font-medium text-neutral-200">{row.name}</span>
        ),
      },
      {
        key: "collection",
        header: "Collection",
        sortable: true,
        width: columnWidths.collection,
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.collection || "-"}
          </span>
        ),
      },
      {
        key: "location",
        header: "Location",
        sortable: true,
        width: columnWidths.location,
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.location || "-"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        sortable: true,
        width: columnWidths.status,
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.status}
          </span>
        ),
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-40 text-right",
        headerClassName: "w-40 text-right",
        width: "10rem",
        render: (row) => {
          const isDeleting = deletingId === row.id;
          return (
            <div
              className="inline-flex items-center justify-end w-full"
              onClick={(event) => event.stopPropagation()}
            >
              <DeleteActionButton
                onClick={() => setConfirmDeletePart(row)}
                isDeleting={isDeleting}
              />
            </div>
          );
        },
      },
    ],
    [columnWidths, deletingId]
  );

  const emptyMessage = useMemo(() => {
    if (loading) {
      return "Loading items...";
    }
    if (error) {
      return error;
    }
    if (collectionFilter && search.trim()) {
      return `No items in ${collectionFilter} match your search.`;
    }
    if (collectionFilter) {
      return `No items found in ${collectionFilter}.`;
    }
    if (search.trim()) {
      return "No items match your search.";
    }
    return "No items yet. Add your first one above.";
  }, [collectionFilter, error, loading, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Items"
        description="Browse and manage your items"
        action={
          <button
            onClick={() => navigate("/add")}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            Add Item
          </button>
        }
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search items, locations, collections…"
        count={filtered.length}
        countLabel="items"
        loading={loading}
      />

      {collectionFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/30 px-3 py-1.5 text-emerald-200">
            Collection: {collectionFilter}
          </span>
          <button
            type="button"
            onClick={clearCollectionFilter}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-2.5 py-1.5 text-neutral-300 transition-colors hover:border-neutral-600 hover:text-neutral-100"
          >
            Clear filter
          </button>
        </div>
      )}

      {deleteError && <p className="text-sm text-red-400 mb-3">{deleteError}</p>}

      <DataTable
        columns={columns}
        rows={sorted}
        keyField="id"
        emptyMessage={emptyMessage}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key) => handleSort(key as ItemSortKey)}
        onRowClick={(row) => {
          if (deletingId === row.id) return;
          void openPartModal(row.id);
        }}
      />

      <DeleteConfirmDialog
        open={Boolean(confirmDeletePart)}
        title="Delete Item"
        message={
          confirmDeletePart ? (
            <>
              Permanently delete <span className="font-medium text-neutral-100">{confirmDeletePart.name}</span>? This cannot be undone.
            </>
          ) : null
        }
        deleting={Boolean(confirmDeletePart && deletingId === confirmDeletePart.id)}
        onCancel={() => setConfirmDeletePart(null)}
        onConfirm={() => {
          if (confirmDeletePart) {
            void deletePart(confirmDeletePart.id);
          }
        }}
      />

      {selectedPartId && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-neutral-100">Item Details</h3>
                {selectedPart && (
                  <p className="text-xs text-neutral-500">ID: {selectedPart.id}</p>
                )}
              </div>
              <button
                onClick={requestCloseModal}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>

            {detailLoading && (
              <p className="text-sm text-neutral-400">Loading part details...</p>
            )}

            {!detailLoading && detailError && (
              <p className="text-sm text-red-400">{detailError}</p>
            )}

            {!detailLoading && selectedPart && (
              <>
                {selectedPart.images[0] && (
                  <img
                    src={selectedPart.images[0].display_url}
                    alt={selectedPart.name}
                    className="w-full max-h-80 object-cover rounded-md border border-neutral-800"
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Name</span>
                    <input
                      value={editForm.name}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, name: event.target.value }))
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      placeholder="Part name"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Collection</span>
                    <select
                      value={editForm.collection}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, collection: event.target.value }))
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                    >
                      <option value="">No collection</option>
                      {collectionOptions.map((collection) => (
                        <option key={collection.id} value={collection.name}>
                          {collection.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Location</span>
                    <select
                      value={editForm.location_id}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          location_id: event.target.value,
                        }))
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                    >
                      <option value="">No location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Status</span>
                    <select
                      value={editForm.status}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          status: event.target.value === "confirmed" ? "confirmed" : "draft",
                        }))
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                    >
                      <option value="draft">draft</option>
                      <option value="confirmed">confirmed</option>
                    </select>
                  </label>

                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Description</span>
                    <textarea
                      value={editForm.description}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, description: event.target.value }))
                      }
                      rows={4}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      placeholder="Optional notes"
                    />
                  </label>
                </div>

                <div className="text-xs text-neutral-500">
                  Created: {new Date(selectedPart.created_at).toLocaleString()} | Updated: {new Date(selectedPart.updated_at).toLocaleString()}
                </div>

                <div className="pt-1 flex items-center justify-between gap-2">
                  <button
                    onClick={() => setConfirmDeletePartOpen(true)}
                    disabled={savingDetail || deletingPartFromModal}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                  <div className="flex items-center gap-2">
                  <button
                    onClick={requestCloseModal}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                  >
                    Close
                  </button>
                  <button
                    onClick={async () => {
                      const ok = await savePartChanges();
                      if (ok) {
                        closeModalNow();
                      }
                    }}
                    disabled={!hasDirtyChanges || savingDetail}
                    className={[
                      "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-60",
                      hasDirtyChanges
                        ? "border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200"
                        : "border-neutral-700 text-neutral-500",
                    ].join(" ")}
                  >
                    <Save size={14} />
                    {savingDetail ? "Saving..." : "Save"}
                  </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {unsavedPromptOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
            <p className="text-sm text-neutral-300">
              You have unsaved changes. Do you want to save before leaving this item?
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={handleUnsavedCancel}
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
                disabled={savingDetail}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 disabled:opacity-60"
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeletePartOpen && selectedPart && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-neutral-100">Delete Item</h3>
            <p className="text-sm text-neutral-300">
              Permanently delete <span className="font-medium text-neutral-100">{selectedPart.name}</span>? This cannot be undone.
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeletePartOpen(false)}
                disabled={deletingPartFromModal}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void deletePartFromModal()}
                disabled={deletingPartFromModal}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                <Trash2 size={14} />
                {deletingPartFromModal ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

