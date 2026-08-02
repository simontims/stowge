import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, Edit3, Plus, Save, Trash2, Upload } from "lucide-react";
import { IconColorPicker } from "../components/ui/IconColorPicker";
import { TablerIcon } from "../components/ui/TablerIcon";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ListToolbar } from "../components/ui/ListToolbar";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { DataTable, type Column } from "../components/ui/DataTable";
import { SettingsSaveBar } from "../components/ui/SettingsSaveBar";
import { DeleteTransferModal } from "../components/ui/DeleteTransferModal";
import { outlinedActionButtonClasses, solidActionButtonClasses } from "../components/ui/buttonStyles";
import { useTableSort } from "../hooks/useTableSort";
import { useResourceList } from "../hooks/useResourceList";
import { useDirtyState } from "../hooks/useDirtyState";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { RERUN_HIERARCHY_INTRO_EVENT, TOUR_OPEN_ADD_LOCATION_FORM_EVENT } from "../lib/onboarding";

interface LocationRecord {
  id: string;
  name: string;
  description: string | null;
  area_id?: string | null;
  area_name?: string | null;
  site_id?: string | null;
  site_name?: string | null;
  icon: string | null;
  color: string | null;
  item_count: number;
  photo_url: string | null;
  created_at: string | null;
  updated_at: string | null;
  actions?: never;
}

interface LocationForm {
  name: string;
  description: string;
  area_id: string;
  icon: string;
  color: string;
  photo_path: string | null;
}

interface SiteRecord {
  id: string;
  name: string;
}

interface AreaRecord {
  id: string;
  name: string;
  site_id: string | null;
  site_name?: string | null;
  description?: string | null;
}

interface SiteForm {
  name: string;
  description: string;
}

interface AreaForm {
  name: string;
  description: string;
  site_id: string;
}

const EMPTY_FORM: LocationForm = {
  name: "",
  description: "",
  area_id: "",
  icon: "",
  color: "",
  photo_path: null,
};

const EMPTY_SITE_FORM: SiteForm = {
  name: "",
  description: "",
};

const EMPTY_AREA_FORM: AreaForm = {
  name: "",
  description: "",
  site_id: "",
};

type LocationSortKey = "name" | "description" | "item_count";

interface LocationsSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsLocationsPage({ embedded, onDirtyChange, saveFnRef }: LocationsSectionProps = {}) {
  const { items: locations, loading, error: loadError, load: loadLocations } = useResourceList<LocationRecord>({ url: "/api/locations", onError: "Unable to load locations right now." });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDirection, handleSort } = useTableSort<LocationSortKey>("name");

  const [addingOpen, setAddingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<LocationForm>(EMPTY_FORM);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [newSiteForm, setNewSiteForm] = useState<SiteForm>(EMPTY_SITE_FORM);
  const [newAreaForm, setNewAreaForm] = useState<AreaForm>(EMPTY_AREA_FORM);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editSiteForm, setEditSiteForm] = useState<SiteForm>(EMPTY_SITE_FORM);
  const [editAreaForm, setEditAreaForm] = useState<AreaForm>(EMPTY_AREA_FORM);
  const [savingSite, setSavingSite] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [confirmDeleteSiteId, setConfirmDeleteSiteId] = useState<string | null>(null);
  const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
  const [deleteSiteMoveToId, setDeleteSiteMoveToId] = useState<string>("");
  const [deleteAreaMoveToId, setDeleteAreaMoveToId] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [initialEditForm, setInitialEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteStep, setDeleteStep] = useState<"confirm" | "progress" | "done">("confirm");
  const [deleteProgress, setDeleteProgress] = useState<string[]>([]);
  const [deleteMoveToId, setDeleteMoveToId] = useState<string>("");

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

  const { isDirty: isEditDirty, unsavedPromptOpen, closePrompt, confirmDiscard } = useDirtyState({
    form: editForm,
    initialForm: initialEditForm,
    isEqual: (a, b) =>
      a.name === b.name &&
      a.description === b.description &&
      a.area_id === b.area_id &&
      a.icon === b.icon &&
      a.color === b.color &&
      a.photo_path === null,
    embedded,
    active: Boolean(editingId),
    onDirtyChange,
  });
  if (saveFnRef) saveFnRef.current = isEditDirty ? saveEdit : null;

  useEffect(() => {
    void loadLocations();
    void loadHierarchyOptions();
  }, []);

  useEffect(() => {
    function handleTourOpenAddLocationForm() {
      setAddingOpen(true);
      setError("");
      setNotice("");
    }

    window.addEventListener(TOUR_OPEN_ADD_LOCATION_FORM_EVENT, handleTourOpenAddLocationForm);
    return () => window.removeEventListener(TOUR_OPEN_ADD_LOCATION_FORM_EVENT, handleTourOpenAddLocationForm);
  }, []);

  async function loadHierarchyOptions() {
    try {
      const [siteRows, areaRows] = await Promise.all([
        apiRequest<SiteRecord[]>("/api/sites"),
        apiRequest<AreaRecord[]>("/api/areas"),
      ]);
      setSites(siteRows || []);
      setAreas(areaRows || []);
    } catch {
      setSites([]);
      setAreas([]);
    }
  }

  useEffect(() => {
    if (!newAreaForm.site_id && sites.length === 1) {
      setNewAreaForm((current) => ({ ...current, site_id: sites[0].id }));
    }
  }, [newAreaForm.site_id, sites]);

  function startEditSite(site: SiteRecord) {
    setEditingSiteId(site.id);
    setEditSiteForm({
      name: site.name,
      description: "",
    });
  }

  function cancelEditSite() {
    setEditingSiteId(null);
    setEditSiteForm(EMPTY_SITE_FORM);
  }

  function startEditArea(area: AreaRecord) {
    setEditingAreaId(area.id);
    setEditAreaForm({
      name: area.name,
      description: area.description || "",
      site_id: area.site_id || (sites.length === 1 ? sites[0].id : ""),
    });
  }

  function cancelEditArea() {
    setEditingAreaId(null);
    setEditAreaForm(EMPTY_AREA_FORM);
  }

  async function createSite() {
    const name = newSiteForm.name.trim();
    if (name.length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Site name"));
      return;
    }

    setSavingSite(true);
    setError("");
    try {
      await apiRequest("/api/sites", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: newSiteForm.description.trim() || null,
        }),
      });
      setNewSiteForm(EMPTY_SITE_FORM);
      await loadHierarchyOptions();
      setNotice("Site created.");
    } catch (err) {
      setError((err as Error).message || "Failed to create site.");
    } finally {
      setSavingSite(false);
    }
  }

  async function saveSiteEdit() {
    if (!editingSiteId) return;
    const name = editSiteForm.name.trim();
    if (name.length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Site name"));
      return;
    }

    setSavingSite(true);
    setError("");
    try {
      await apiRequest(`/api/sites/${editingSiteId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: editSiteForm.description.trim() || null,
        }),
      });
      cancelEditSite();
      await loadHierarchyOptions();
      setNotice("Site updated.");
    } catch (err) {
      setError((err as Error).message || "Failed to update site.");
    } finally {
      setSavingSite(false);
    }
  }

  async function deleteSite(siteId: string) {
    setSavingSite(true);
    setError("");
    try {
      const query = deleteSiteMoveToId ? `?move_to_site_id=${encodeURIComponent(deleteSiteMoveToId)}` : "";
      await apiRequest(`/api/sites/${siteId}${query}`, { method: "DELETE" });
      setConfirmDeleteSiteId(null);
      setDeleteSiteMoveToId("");
      await loadHierarchyOptions();
      await loadLocations();
      setNotice("Site deleted.");
    } catch (err) {
      setError((err as Error).message || "Failed to delete site.");
    } finally {
      setSavingSite(false);
    }
  }

  async function createArea() {
    const name = newAreaForm.name.trim();
    if (name.length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Area name"));
      return;
    }
    if (sites.length > 1 && !newAreaForm.site_id) {
      setError("Select a site for this area.");
      return;
    }

    setSavingArea(true);
    setError("");
    try {
      await apiRequest("/api/areas", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: newAreaForm.description.trim() || null,
          site_id: newAreaForm.site_id || null,
        }),
      });
      setNewAreaForm({ ...EMPTY_AREA_FORM, site_id: sites.length === 1 ? sites[0].id : "" });
      await loadHierarchyOptions();
      setNotice("Area created.");
    } catch (err) {
      setError((err as Error).message || "Failed to create area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function saveAreaEdit() {
    if (!editingAreaId) return;
    const name = editAreaForm.name.trim();
    if (name.length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Area name"));
      return;
    }
    if (sites.length > 1 && !editAreaForm.site_id) {
      setError("Select a site for this area.");
      return;
    }

    setSavingArea(true);
    setError("");
    try {
      await apiRequest(`/api/areas/${editingAreaId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: editAreaForm.description.trim() || null,
          site_id: editAreaForm.site_id || null,
        }),
      });
      cancelEditArea();
      await loadHierarchyOptions();
      await loadLocations();
      setNotice("Area updated.");
    } catch (err) {
      setError((err as Error).message || "Failed to update area.");
    } finally {
      setSavingArea(false);
    }
  }

  async function deleteArea(areaId: string) {
    setSavingArea(true);
    setError("");
    try {
      const query = deleteAreaMoveToId ? `?move_to_area_id=${encodeURIComponent(deleteAreaMoveToId)}` : "";
      await apiRequest(`/api/areas/${areaId}${query}`, { method: "DELETE" });
      setConfirmDeleteAreaId(null);
      setDeleteAreaMoveToId("");
      await loadHierarchyOptions();
      await loadLocations();
      setNotice("Area deleted.");
    } catch (err) {
      setError((err as Error).message || "Failed to delete area.");
    } finally {
      setSavingArea(false);
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeout);
  }, [notice]);

  function startEdit(location: LocationRecord) {
    setError("");
    setNotice("");
    setEditingId(location.id);
    const snapshot: LocationForm = {
      name: location.name,
      description: location.description || "",
      area_id: location.area_id || "",
      icon: location.icon || "",
      color: location.color || "",
      photo_path: null,
    };
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setInitialEditForm(EMPTY_FORM);
    closePrompt();
  }

  async function handleUnsavedSave() {
    await saveEdit();
    // saveEdit calls cancelEdit on success; if it fails the prompt stays open.
  }

  function handleUnsavedDiscard() {
    confirmDiscard();
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
        icon: newForm.icon || null,
        color: newForm.color || null,
        photo_path: newForm.photo_path,
      };

      if (payload.name.length < MIN_NAME_LENGTH) {
        setError(minimumLengthMessage("Location name"));
        return;
      }
      if (areas.length > 1 && !newForm.area_id) {
        setError("Select an area for this location.");
        return;
      }

      const requestPayload = {
        ...payload,
        area_id: newForm.area_id || null,
      };

      setIsCreating(true);
      await apiRequest<LocationRecord>("/api/locations", {
        method: "POST",
        body: JSON.stringify(requestPayload),
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
        area_id?: string | null;
        icon: string | null;
        color: string | null;
        photo_path?: string | null;
      } = {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        area_id: editForm.area_id || null,
        icon: editForm.icon || null,
        color: editForm.color || null,
      };
      if (editForm.photo_path !== null) {
        payload.photo_path = editForm.photo_path;
      }

      if (payload.name.length < MIN_NAME_LENGTH) {
        setError(minimumLengthMessage("Location name"));
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

  async function deleteLocation(location: LocationRecord) {
    setError("");
    setNotice("");
    setDeletingId(location.id);
    setDeleteStep("progress");
    setDeleteProgress([]);

    const targetLocation = deleteMoveToId
      ? locations.find((loc) => loc.id === deleteMoveToId) ?? null
      : null;

    try {
      setDeleteProgress([`Moving items to ${targetLocation ? `"${targetLocation.name}"` : "no location"}…`]);
      const url = deleteMoveToId
        ? `/api/locations/${location.id}?move_to_location_id=${deleteMoveToId}`
        : `/api/locations/${location.id}`;
      setDeleteProgress((current) => [...current, `Deleting location "${location.name}"…`]);
      await apiRequest(url, {
        method: "DELETE",
      });
      setDeleteProgress((current) => [...current, "Complete."]);
      setDeleteStep("done");
      setNotice("Location deleted.");
      await loadLocations();
    } catch (err) {
      setError((err as Error).message || "Failed to delete location.");
      setConfirmDeleteId(null);
      setDeleteStep("confirm");
    } finally {
      setDeletingId(null);
    }
  }

  function openDeleteModal(location: LocationRecord) {
    setDeleteStep("confirm");
    setDeleteProgress([]);
    setDeleteMoveToId("");
    setConfirmDeleteId(location.id);
  }

  function closeDeleteModal() {
    setConfirmDeleteId(null);
    setDeleteStep("confirm");
    setDeleteProgress([]);
    setDeleteMoveToId("");
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

  const columns = useMemo<Column<LocationRecord>[]>(
    () => [
      {
        key: "icon",
        header: "Icon",
        className: "w-20",
        render: (row) =>
          row.icon ? (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-900">
              <TablerIcon name={row.icon} size={16} color={row.color || undefined} />
            </span>
          ) : (
            <span className="text-xs text-neutral-600">none</span>
          ),
      },
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
        key: "area_name",
        header: "Area",
        render: (row) => (
          <span className="text-neutral-400">{row.area_name || "General"}</span>
        ),
      },
      {
        key: "site_name",
        header: "Site",
        render: (row) => (
          <span className="text-neutral-500">{row.site_name || "Home"}</span>
        ),
      },
      {
        key: "item_count",
        header: "Item Count",
        sortable: true,
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
                  openDeleteModal(row);
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

  const confirmDeleteSite = useMemo(
    () => sites.find((site) => site.id === confirmDeleteSiteId) || null,
    [sites, confirmDeleteSiteId]
  );

  const confirmDeleteArea = useMemo(
    () => areas.find((area) => area.id === confirmDeleteAreaId) || null,
    [areas, confirmDeleteAreaId]
  );

  const siteAreaCount = useMemo(
    () => (confirmDeleteSite ? areas.filter((area) => area.site_id === confirmDeleteSite.id).length : 0),
    [areas, confirmDeleteSite]
  );

  const areaLocationCount = useMemo(
    () => (confirmDeleteArea ? locations.filter((location) => location.area_id === confirmDeleteArea.id).length : 0),
    [locations, confirmDeleteArea]
  );

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="Locations"
          description="Add, edit, and delete storage locations for your inventory"
        />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent(RERUN_HIERARCHY_INTRO_EVENT))}
          className={`${outlinedActionButtonClasses("neutral")} px-3 py-1.5 text-sm font-medium`}
        >
          <Compass size={14} />
          Re-run Sites &amp; Areas Tour
        </button>
      </div>

      <section data-tour="locations-sites-section" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-100">Sites</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <input
            value={newSiteForm.name}
            onChange={(e) => setNewSiteForm((v) => ({ ...v, name: e.target.value }))}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="New site name"
          />
          <input
            value={newSiteForm.description}
            onChange={(e) => setNewSiteForm((v) => ({ ...v, description: e.target.value }))}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="Description (optional)"
          />
          <button
            type="button"
            onClick={() => void createSite()}
            disabled={savingSite}
            className={`${solidActionButtonClasses("positive")} px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <Plus size={14} />
            Add Site
          </button>
        </div>
        <div className="space-y-2">
          {sites.map((site) => {
            const isEditing = editingSiteId === site.id;
            return (
              <div key={site.id} className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3 space-y-2">
                {isEditing ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      value={editSiteForm.name}
                      onChange={(e) => setEditSiteForm((v) => ({ ...v, name: e.target.value }))}
                      className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    />
                    <input
                      value={editSiteForm.description}
                      onChange={(e) => setEditSiteForm((v) => ({ ...v, description: e.target.value }))}
                      className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="Description (optional)"
                    />
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void saveSiteEdit()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:border-neutral-500 text-sm">
                        <Save size={13} /> Save
                      </button>
                      <button type="button" onClick={cancelEditSite} className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-200 text-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-200">{site.name}</p>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => startEditSite(site)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm">
                        <Edit3 size={13} /> Edit
                      </button>
                      <button type="button" onClick={() => { setConfirmDeleteSiteId(site.id); setDeleteSiteMoveToId(""); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70 text-sm">
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section data-tour="locations-areas-section" className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-100">Areas</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input
            value={newAreaForm.name}
            onChange={(e) => setNewAreaForm((v) => ({ ...v, name: e.target.value }))}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="New area name"
          />
          <input
            value={newAreaForm.description}
            onChange={(e) => setNewAreaForm((v) => ({ ...v, description: e.target.value }))}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
            placeholder="Description (optional)"
          />
          <select
            value={newAreaForm.site_id}
            onChange={(e) => setNewAreaForm((v) => ({ ...v, site_id: e.target.value }))}
            className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
          >
            <option value="">{sites.length > 1 ? "Select site..." : "Default site"}</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void createArea()}
            disabled={savingArea}
            className={`${solidActionButtonClasses("positive")} px-3 py-2 disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <Plus size={14} />
            Add Area
          </button>
        </div>
        <div className="space-y-2">
          {areas.map((area) => {
            const isEditing = editingAreaId === area.id;
            return (
              <div key={area.id} className="rounded-md border border-neutral-800 bg-neutral-950/35 p-3 space-y-2">
                {isEditing ? (
                  <div className="grid gap-2 sm:grid-cols-4">
                    <input
                      value={editAreaForm.name}
                      onChange={(e) => setEditAreaForm((v) => ({ ...v, name: e.target.value }))}
                      className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    />
                    <input
                      value={editAreaForm.description}
                      onChange={(e) => setEditAreaForm((v) => ({ ...v, description: e.target.value }))}
                      className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="Description (optional)"
                    />
                    <select
                      value={editAreaForm.site_id}
                      onChange={(e) => setEditAreaForm((v) => ({ ...v, site_id: e.target.value }))}
                      className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    >
                      <option value="">{sites.length > 1 ? "Select site..." : "Default site"}</option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>{site.name}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void saveAreaEdit()} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-200 hover:border-neutral-500 text-sm">
                        <Save size={13} /> Save
                      </button>
                      <button type="button" onClick={cancelEditArea} className="inline-flex items-center px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-200 text-sm">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-neutral-200">{(sites.length > 1 ? `${area.site_name || "Site"} / ` : "") + area.name}</p>
                    </div>
                    <div className="inline-flex items-center gap-2">
                      <button type="button" onClick={() => startEditArea(area)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm">
                        <Edit3 size={13} /> Edit
                      </button>
                      <button type="button" onClick={() => { setConfirmDeleteAreaId(area.id); setDeleteAreaMoveToId(""); }} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70 text-sm">
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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
            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Area</span>
              <select
                data-tour="locations-area-select"
                value={newForm.area_id}
                onChange={(e) => setNewForm((v) => ({ ...v, area_id: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                <option value="">{areas.length > 1 ? "Select area..." : "Default area"}</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {(sites.length > 1 ? `${area.site_name || "Site"} / ` : "") + area.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="sm:col-span-2 flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-500 shrink-0">Icon</span>
              <IconColorPicker
                title={newForm.name || "Location"}
                value={newForm.icon}
                onChange={(name) => setNewForm((v) => ({ ...v, icon: name }))}
                color={newForm.color}
                onColorChange={(hex) => setNewForm((v) => ({ ...v, color: hex }))}
              />
            </div>
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
            {areas.length > 1 && (
              <label className="block sm:col-span-2">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Area</span>
                <select
                  value={editForm.area_id}
                  onChange={(e) => setEditForm((v) => ({ ...v, area_id: e.target.value }))}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">Select area...</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>
                      {(sites.length > 1 ? `${area.site_name || "Site"} / ` : "") + area.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="sm:col-span-2 flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-500 shrink-0">Icon</span>
              <IconColorPicker
                title={editForm.name || "Location"}
                value={editForm.icon}
                onChange={(name) => setEditForm((v) => ({ ...v, icon: name }))}
                color={editForm.color}
                onColorChange={(hex) => setEditForm((v) => ({ ...v, color: hex }))}
              />
            </div>
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

          <SettingsSaveBar
            isDirty={isEditDirty}
            saving={isSavingEdit}
            onSave={() => void saveEdit()}
            onCancel={cancelEdit}
            onDelete={() => editingLocation && openDeleteModal(editingLocation)}
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
            placeholder="Search locations…"
            loading={loading}
            action={
              <button
                data-tour="locations-add-location-button"
                onClick={() => { setAddingOpen(true); setError(""); setNotice(""); }}
                className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
              >
                <Plus size={14} />
                Add Location
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
            onSort={(key) => handleSort(key as LocationSortKey)}
          />
          {!loadError && (
            <p className="text-xs text-neutral-600 text-right">
              {loading ? "Loading…" : `${filtered.length} location${filtered.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </>
      )}

      <UnsavedChangesDialog
        open={unsavedPromptOpen}
        message="You have unsaved changes. Do you want to save before leaving this location?"
        saving={isSavingEdit}
        onCancel={closePrompt}
        onDiscard={handleUnsavedDiscard}
        onSave={() => void handleUnsavedSave()}
      />

      <DeleteTransferModal
        open={Boolean(confirmDeleteLocation)}
        title="Delete Location"
        entityKindLabel="Location"
        entityName={confirmDeleteLocation?.name || ""}
        itemCount={confirmDeleteLocation?.item_count || 0}
        moveToLabel="Move items to"
        noneOptionLabel="No location"
        moveOptions={locations
          .filter((location) => location.id !== confirmDeleteLocation?.id)
          .map((location) => ({ id: location.id, name: location.name }))}
        moveToId={deleteMoveToId}
        onMoveToIdChange={setDeleteMoveToId}
        step={deleteStep}
        progressMessages={deleteProgress}
        onCancel={closeDeleteModal}
        onConfirm={() => {
          if (!confirmDeleteLocation) return;
          void deleteLocation(confirmDeleteLocation);
        }}
        onDone={closeDeleteModal}
      />

      <DeleteTransferModal
        open={Boolean(confirmDeleteSite)}
        title="Delete Site"
        entityKindLabel="Site"
        entityName={confirmDeleteSite?.name || ""}
        itemCount={siteAreaCount}
        itemLabelSingular="area"
        itemLabelPlural="areas"
        moveToLabel="Move areas to"
        noneOptionLabel="No target site"
        moveOptions={sites
          .filter((site) => site.id !== confirmDeleteSite?.id)
          .map((site) => ({ id: site.id, name: site.name }))}
        moveToId={deleteSiteMoveToId}
        onMoveToIdChange={setDeleteSiteMoveToId}
        step="confirm"
        progressMessages={[]}
        onCancel={() => {
          setConfirmDeleteSiteId(null);
          setDeleteSiteMoveToId("");
        }}
        onConfirm={() => {
          if (!confirmDeleteSite) return;
          void deleteSite(confirmDeleteSite.id);
        }}
        onDone={() => {
          setConfirmDeleteSiteId(null);
          setDeleteSiteMoveToId("");
        }}
      />

      <DeleteTransferModal
        open={Boolean(confirmDeleteArea)}
        title="Delete Area"
        entityKindLabel="Area"
        entityName={confirmDeleteArea?.name || ""}
        itemCount={areaLocationCount}
        moveToLabel="Move locations to"
        noneOptionLabel="No target area"
        moveOptions={areas
          .filter((area) => area.id !== confirmDeleteArea?.id)
          .map((area) => ({ id: area.id, name: (sites.length > 1 ? `${area.site_name || "Site"} / ` : "") + area.name }))}
        moveToId={deleteAreaMoveToId}
        onMoveToIdChange={setDeleteAreaMoveToId}
        step="confirm"
        progressMessages={[]}
        onCancel={() => {
          setConfirmDeleteAreaId(null);
          setDeleteAreaMoveToId("");
        }}
        onConfirm={() => {
          if (!confirmDeleteArea) return;
          void deleteArea(confirmDeleteArea.id);
        }}
        onDone={() => {
          setConfirmDeleteAreaId(null);
          setDeleteAreaMoveToId("");
        }}
      />


    </div>
  );
}



