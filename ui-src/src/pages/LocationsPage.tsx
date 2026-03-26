import { useEffect, useMemo, useRef, useState } from "react";
import { Edit3, Plus, Save, Trash2, Upload, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { apiRequest } from "../lib/api";

interface LocationRecord {
  id: string;
  name: string;
  description: string | null;
  item_count: number;
  photo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  actions?: never;
}

interface LocationForm {
  name: string;
  description: string;
  photo_path: string | null;
}

const EMPTY_FORM: LocationForm = {
  name: "",
  description: "",
  photo_path: null,
};

const RETRY_DELAY_MS = 5000;

export function LocationsPage() {
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const [addingOpen, setAddingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<LocationForm>(EMPTY_FORM);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [initialEditForm, setInitialEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [uploadingTarget, setUploadingTarget] = useState<"new" | "edit" | null>(null);
  const newPhotoInputRef = useRef<HTMLInputElement>(null);
  const editPhotoInputRef = useRef<HTMLInputElement>(null);

  const editingLocation = useMemo(
    () => locations.find((location) => location.id === editingId) || null,
    [locations, editingId]
  );
  const showListView = !addingOpen && !editingLocation;

  const confirmDeleteLocation = useMemo(
    () => locations.find((location) => location.id === confirmDeleteId) || null,
    [locations, confirmDeleteId]
  );

  const isEditDirty = useMemo(
    () =>
      editForm.name !== initialEditForm.name ||
      editForm.description !== initialEditForm.description ||
      editForm.photo_path !== null,
    [editForm, initialEditForm]
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (loading || !loadError) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void loadLocations({ background: true });
    }, RETRY_DELAY_MS);

    return () => window.clearTimeout(retryTimer);
  }, [loadError, loading]);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!editingId || !isEditDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editingId, isEditDirty]);

  async function loadLocations(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
      setLoadError("");
    }
    try {
      const data = await apiRequest<LocationRecord[]>("/api/locations");
      setLocations(data);
    } catch (err) {
      setLocations([]);
      setLoadError((err as Error).message || "Unable to load locations right now.");
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  function startEdit(location: LocationRecord) {
    setError("");
    setNotice("");
    setEditingId(location.id);
    const snapshot: LocationForm = {
      name: location.name,
      description: location.description || "",
      photo_path: null,
    };
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setInitialEditForm(EMPTY_FORM);
    setUnsavedPromptOpen(false);
  }

  function requestCancelEdit() {
    if (isEditDirty) {
      setUnsavedPromptOpen(true);
      return;
    }
    cancelEdit();
  }

  async function handleUnsavedSave() {
    await saveEdit();
    // saveEdit calls cancelEdit on success; if it fails the prompt stays open.
  }

  function handleUnsavedDiscard() {
    cancelEdit();
  }

  async function uploadPhoto(file: File, target: "new" | "edit") {
    setError("");
    setNotice("");
    setUploadingTarget(target);

    try {
      const fd = new FormData();
      fd.append("photo", file, file.name || "location-photo.jpg");

      const data = await apiRequest<{ photo_path: string }>("/api/locations/photo", {
        method: "POST",
        body: fd,
      });

      if (target === "new") {
        setNewForm((current) => ({ ...current, photo_path: data.photo_path }));
      } else {
        setEditForm((current) => ({ ...current, photo_path: data.photo_path }));
      }
      setNotice("Photo uploaded.");
    } catch (err) {
      setError((err as Error).message || "Failed to upload photo.");
    } finally {
      setUploadingTarget(null);
    }
  }

  async function createLocation() {
    setError("");
    setNotice("");

    try {
      const payload = {
        name: newForm.name.trim(),
        description: newForm.description.trim(),
        photo_path: newForm.photo_path,
      };

      if (payload.name.length < 2) {
        setError("Location name must be at least 2 characters.");
        return;
      }

      setIsCreating(true);
      await apiRequest<LocationRecord>("/api/locations", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setNewForm(EMPTY_FORM);
      setAddingOpen(false);
      await loadLocations();
    } catch (err) {
      setError((err as Error).message || "Failed to create location.");
    } finally {
      setIsCreating(false);
    }
  }

  async function saveEdit() {
    if (!editingId) return;

    setError("");
    setNotice("");

    try {
      const payload: {
        name: string;
        description: string;
        photo_path?: string | null;
      } = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
      };
      if (editForm.photo_path !== null) {
        payload.photo_path = editForm.photo_path;
      }

      if (payload.name.length < 2) {
        setError("Location name must be at least 2 characters.");
        return;
      }

      setIsSavingEdit(true);
      await apiRequest<LocationRecord>(`/api/locations/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      cancelEdit();
      setNotice("Location updated.");
      await loadLocations();
    } catch (err) {
      setError((err as Error).message || "Failed to update location.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteLocation(locationId: string) {
    setError("");
    setNotice("");
    setDeletingId(locationId);

    try {
      await apiRequest(`/api/locations/${locationId}`, {
        method: "DELETE",
      });
      setConfirmDeleteId(null);
      setNotice("Location deleted.");
      await loadLocations();
    } catch (err) {
      setError((err as Error).message || "Failed to delete location.");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return locations;

    return locations.filter((location) => {
      const name = location.name.toLowerCase();
      const description = (location.description || "").toLowerCase();
      const count = String(location.item_count);
      return name.includes(term) || description.includes(term) || count.includes(term);
    });
  }, [locations, search]);

  const columns = useMemo<Column<LocationRecord>[]>(
    () => [
      {
        key: "photo_url",
        header: "Photo",
        className: "w-20",
        render: (row) =>
          row.photo_url ? (
            <img
              src={row.photo_url}
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
        header: "Item Count",
        className: "w-28",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300">
            {row.item_count}
          </span>
        ),
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-44 text-right",
        headerClassName: "w-44 text-right",
        render: (row) => {
          const isDeleting = deletingId === row.id;
          return (
            <div className="inline-flex items-center gap-2 justify-end w-full">
              <button
                onClick={() => startEdit(row)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                title={`Edit ${row.name}`}
              >
                <Edit3 size={13} />
                Edit
              </button>
              <button
                onClick={() => {
                  if (isDeleting) return;
                  setConfirmDeleteId(row.id);
                }}
                disabled={isDeleting}
                className={[
                  "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors",
                  "border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70",
                  isDeleting ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
                title={`Delete ${row.name}`}
              >
                <Trash2 size={13} />
                Delete
              </button>
            </div>
          );
        },
      },
    ],
    [deletingId]
  );

  const emptyMessage = useMemo(() => {
    if (loading) {
      return "Loading locations...";
    }
    if (loadError) {
      return loadError;
    }
    if (search.trim()) {
      return "No locations match your search.";
    }
    return "No locations found. Add your first one above.";
  }, [loadError, loading, search]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Locations"
        description="Add, edit, and delete storage locations for your inventory"
        action={
          showListView ? (
            <button
              onClick={() => {
                setAddingOpen(true);
                setError("");
                setNotice("");
              }}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              <Plus size={14} />
              Add Location
            </button>
          ) : null
        }
      />

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">New Location</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
              <input
                value={newForm.name}
                onChange={(e) => setNewForm((v) => ({ ...v, name: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Shelf A"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Description</span>
              <textarea
                value={newForm.description}
                onChange={(e) => setNewForm((v) => ({ ...v, description: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 min-h-[96px]"
                placeholder="Where this location is and what it stores"
              />
            </label>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => newPhotoInputRef.current?.click()}
                disabled={uploadingTarget === "new"}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Upload size={13} />
                {uploadingTarget === "new" ? "Uploading..." : "Upload Photo"}
              </button>
              <input
                ref={newPhotoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void uploadPhoto(file, "new");
                  }
                  e.currentTarget.value = "";
                }}
              />
              {newForm.photo_path && (
                <span className="text-xs text-emerald-400">Photo ready to save.</span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void createLocation()}
              disabled={isCreating}
              className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 rounded-md text-sm leading-none font-medium transition-colors"
            >
              <Save size={14} />
              {isCreating ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setAddingOpen(false);
                setNewForm(EMPTY_FORM);
                setError("");
              }}
              className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm leading-none font-medium"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {editingLocation && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Edit Location</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Description</span>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((v) => ({ ...v, description: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 min-h-[96px]"
              />
            </label>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => editPhotoInputRef.current?.click()}
                disabled={uploadingTarget === "edit"}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <Upload size={13} />
                {uploadingTarget === "edit"
                  ? "Uploading..."
                  : editForm.photo_path || editingLocation.photo_url
                    ? "Replace Photo"
                    : "Upload Photo"}
              </button>
              <input
                ref={editPhotoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void uploadPhoto(file, "edit");
                  }
                  e.currentTarget.value = "";
                }}
              />
              {editForm.photo_path && (
                <span className="text-xs text-emerald-400">New photo ready to save.</span>
              )}
              {!editForm.photo_path && editingLocation.photo_url && (
                <img
                  src={editingLocation.photo_url}
                  alt={editingLocation.name}
                  className="w-10 h-10 object-cover rounded border border-neutral-800"
                />
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => setConfirmDeleteId(editingId)}
              disabled={isSavingEdit}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70 text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={requestCancelEdit}
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
            placeholder="Search locations…"
            count={filtered.length}
            countLabel="locations"
            loading={loading}
          />

          <DataTable
            columns={columns}
            rows={filtered}
            keyField="id"
            emptyMessage={emptyMessage}
          />
        </>
      )}

      <UnsavedChangesDialog
        open={unsavedPromptOpen}
        message="You have unsaved changes. Do you want to save before leaving this location?"
        saving={isSavingEdit}
        onCancel={() => setUnsavedPromptOpen(false)}
        onDiscard={handleUnsavedDiscard}
        onSave={() => void handleUnsavedSave()}
      />

      {confirmDeleteLocation && (        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-100">Delete Location</h3>
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <p className="text-sm text-neutral-300">
              Delete location <span className="font-medium text-neutral-100">{confirmDeleteLocation.name}</span>?
            </p>

            {confirmDeleteLocation.item_count > 0 && (
              <p className="text-xs text-amber-300">
                {confirmDeleteLocation.item_count} item
                {confirmDeleteLocation.item_count !== 1 ? "s" : ""} currently in this location will have their location removed.
              </p>
            )}

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                disabled={deletingId === confirmDeleteLocation.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteLocation(confirmDeleteLocation.id)}
                disabled={deletingId === confirmDeleteLocation.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                <Trash2 size={13} />
                {deletingId === confirmDeleteLocation.id ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
