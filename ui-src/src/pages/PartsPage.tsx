import { useEffect, useMemo, useState } from "react";
import { Plus, Save, Trash2, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable, type Column } from "../components/ui/DataTable";
import { apiRequest } from "../lib/api";

interface Part {
  id: string;
  name: string;
  category: string | null;
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
  category: string | null;
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
  category: string;
  location_id: string;
  status: "draft" | "confirmed";
}

interface LocationOption {
  id: string;
  name: string;
}

const EMPTY_EDIT_FORM: PartEditForm = {
  name: "",
  description: "",
  category: "",
  location_id: "",
  status: "draft",
};

function toEditForm(part: PartDetail): PartEditForm {
  return {
    name: part.name ?? "",
    description: part.description ?? "",
    category: part.category ?? "",
    location_id: part.location_id ?? "",
    status: part.status === "confirmed" ? "confirmed" : "draft",
  };
}

function isSameForm(a: PartEditForm, b: PartEditForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.category.trim() === b.category.trim() &&
    a.location_id === b.location_id &&
    a.status === b.status
  );
}

function TrashCanIcon({ lidOpen }: { lidOpen: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <g
        className={[
          "transition-transform duration-200",
          lidOpen ? "-translate-y-0.5 -rotate-12" : "",
        ].join(" ")}
        style={{ transformOrigin: "9px 7px" }}
      >
        <path d="M8 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path
        d="M8 8.5h8l-.6 9a2 2 0 0 1-2 1.9h-2.8a2 2 0 0 1-2-1.9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.8 11v5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.2 11v5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function PartsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<PartDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [editForm, setEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [initialEditForm, setInitialEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [savingDetail, setSavingDetail] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationFilter, setLocationFilter] = useState("");
  const [locationDropdownOpen, setLocationDropdownOpen] = useState(false);

  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [confirmDeletePartOpen, setConfirmDeletePartOpen] = useState(false);
  const [deletingPartFromModal, setDeletingPartFromModal] = useState(false);

  const hasDirtyChanges = useMemo(
    () => selectedPartId !== null && !isSameForm(editForm, initialEditForm),
    [editForm, initialEditForm, selectedPartId]
  );

  useEffect(() => {
    void loadParts();
    void loadLocations();
  }, []);

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
    if (!armedDeleteId) return;
    const timeout = setTimeout(() => {
      setArmedDeleteId((current) => (current === armedDeleteId ? null : current));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [armedDeleteId]);

  useEffect(() => {
    if (!armedDeleteId) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        setArmedDeleteId(null);
        return;
      }

      const armedButton = target.closest(
        `[data-delete-arm-id="${armedDeleteId}"]`
      );
      if (!armedButton) {
        setArmedDeleteId(null);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [armedDeleteId]);

  useEffect(() => {
    if (selectedPartId === null || !hasDirtyChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasDirtyChanges, selectedPartId]);

  async function loadParts() {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<Part[]>("/api/items");
      setParts(data);
    } catch (err) {
      setError((err as Error).message || "Failed to load parts.");
      setParts([]);
    } finally {
      setLoading(false);
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

  async function deletePart(partId: string) {
    setDeleteError("");
    setDeletingId(partId);
    try {
      await apiRequest(`/api/items/${partId}`, { method: "DELETE" });
      setParts((current) => current.filter((part) => part.id !== partId));
      setArmedDeleteId((current) => (current === partId ? null : current));
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
      setLocationFilter("");
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
    setLocationFilter("");
    setLocationDropdownOpen(false);
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
          category: editForm.category.trim() || null,
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
                category: refreshed.category,
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

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return parts;

    return parts.filter((part) => {
      const name = part.name.toLowerCase();
      const category = (part.category || "").toLowerCase();
      const location = (part.location || "").toLowerCase();
      const status = part.status.toLowerCase();
      return (
        name.includes(term) ||
        category.includes(term) ||
        location.includes(term) ||
        status.includes(term)
      );
    });
  }, [parts, search]);

  const filteredLocations = useMemo(() => {
    const term = locationFilter.trim().toLowerCase();
    if (!term) return locations;
    return locations.filter((location) =>
      location.name.toLowerCase().includes(term)
    );
  }, [locations, locationFilter]);

  const selectedLocationLabel = useMemo(() => {
    if (!editForm.location_id) return "No location";
    return (
      locations.find((location) => location.id === editForm.location_id)?.name ||
      "No location"
    );
  }, [editForm.location_id, locations]);

  const columns = useMemo<Column<Part>[]>(
    () => [
      {
        key: "thumb",
        header: "Image",
        className: "w-20",
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
        render: (row) => (
          <span className="font-medium text-neutral-200">{row.name}</span>
        ),
      },
      {
        key: "category",
        header: "Category",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.category || "-"}
          </span>
        ),
      },
      {
        key: "location",
        header: "Location",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.location || "-"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.status}
          </span>
        ),
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-20 text-center",
        headerClassName: "w-20 text-center",
        render: (row) => {
          const isArmed = armedDeleteId === row.id;
          const isDeleting = deletingId === row.id;
          return (
            <button
              onClick={(event) => {
                event.stopPropagation();
                if (isDeleting) return;
                if (!isArmed) {
                  setArmedDeleteId(row.id);
                  return;
                }
                void deletePart(row.id);
              }}
              className={[
                "part-delete-btn inline-flex items-center justify-center w-10 h-10 rounded-md border transition-colors",
                isArmed
                  ? "part-delete-btn--armed border-red-500/70 text-red-300 bg-red-950/30"
                  : "part-delete-btn--idle border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70",
                isDeleting ? "opacity-60 cursor-not-allowed" : "",
              ].join(" ")}
              data-delete-arm-id={row.id}
              aria-label={
                isArmed
                  ? `Confirm delete ${row.name}`
                  : `Delete ${row.name}`
              }
              title={
                isArmed
                  ? "Click again to delete permanently"
                  : "Click to arm delete"
              }
            >
              <TrashCanIcon lidOpen={isArmed} />
            </button>
          );
        },
      },
    ],
    [armedDeleteId, deletingId]
  );

  return (
    <div>
      <PageHeader
        title="Items"
        description="Browse and manage your items"
        action={
          <button
            onClick={() => navigate("/scan")}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            Add Item
          </button>
        }
      />

      {/* Filter row */}
      <div className="flex items-center gap-2 mb-4">
        <SearchInput
          placeholder="Search items, locations, categories…"
          value={search}
          onChange={setSearch}
          className="flex-1 max-w-sm"
        />
        <span className="text-xs text-neutral-600 ml-auto">
          {loading ? "Loading..." : `${filtered.length} items`}
        </span>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {deleteError && <p className="text-sm text-red-400 mb-3">{deleteError}</p>}

      <DataTable
        columns={columns}
        rows={filtered}
        keyField="id"
        onRowClick={(row) => {
          if (deletingId === row.id) return;
          void openPartModal(row.id);
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
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Category</span>
                    <input
                      value={editForm.category}
                      onChange={(event) =>
                        setEditForm((current) => ({ ...current, category: event.target.value }))
                      }
                      className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      placeholder="Optional"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-xs text-neutral-500 uppercase tracking-wide">Location</span>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setLocationDropdownOpen((open) => {
                            const nextOpen = !open;
                            if (!nextOpen) setLocationFilter("");
                            return nextOpen;
                          });
                        }}
                        className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-left text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                      >
                        {selectedLocationLabel}
                      </button>

                      {locationDropdownOpen && (
                        <div className="absolute z-20 mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 p-2 shadow-lg space-y-2">
                          <input
                            value={locationFilter}
                            onChange={(event) => setLocationFilter(event.target.value)}
                            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                            placeholder="Filter locations..."
                            autoFocus
                          />

                          <div className="max-h-44 overflow-y-auto space-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                setEditForm((current) => ({ ...current, location_id: "" }));
                                setLocationDropdownOpen(false);
                                setLocationFilter("");
                              }}
                              className="w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                            >
                              No location
                            </button>
                            {filteredLocations.map((location) => (
                              <button
                                key={location.id}
                                type="button"
                                onClick={() => {
                                  setEditForm((current) => ({ ...current, location_id: location.id }));
                                  setLocationDropdownOpen(false);
                                  setLocationFilter("");
                                }}
                                className="w-full rounded px-2 py-1.5 text-left text-sm text-neutral-200 hover:bg-neutral-800"
                              >
                                {location.name}
                              </button>
                            ))}
                            {filteredLocations.length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-neutral-500">No locations match.</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
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
