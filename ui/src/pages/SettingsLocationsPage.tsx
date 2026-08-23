import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Compass, Edit3, Plus, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
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
import {
  RERUN_HIERARCHY_INTRO_EVENT,
  TOUR_CLOSE_ADD_LOCATION_FORM_EVENT,
  TOUR_OPEN_ADD_LOCATION_FORM_EVENT,
} from "../lib/onboarding";

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

const EMPTY_FORM: LocationForm = {
  name: "",
  description: "",
  area_id: "",
  icon: "",
  color: "",
  photo_path: null,
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

  const [hierarchyExpanded, setHierarchyExpanded] = useState(false);
  const [hierarchyEditKey, setHierarchyEditKey] = useState<string | null>(null);
  const [hierarchyDraftName, setHierarchyDraftName] = useState("");
  const [addingOpen, setAddingOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newForm, setNewForm] = useState<LocationForm>(EMPTY_FORM);
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [areas, setAreas] = useState<AreaRecord[]>([]);
  const [siteFilterId, setSiteFilterId] = useState("");
  const [areaFilterId, setAreaFilterId] = useState("");
  const [savingSite, setSavingSite] = useState(false);
  const [savingArea, setSavingArea] = useState(false);
  const [confirmDeleteSiteId, setConfirmDeleteSiteId] = useState<string | null>(null);
  const [confirmDeleteAreaId, setConfirmDeleteAreaId] = useState<string | null>(null);
  const [deleteSiteMoveToId, setDeleteSiteMoveToId] = useState<string>("");
  const [deleteAreaMoveToId, setDeleteAreaMoveToId] = useState<string>("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [initialEditForm, setInitialEditForm] = useState<LocationForm>(EMPTY_FORM);
  const [editAreaSearch, setEditAreaSearch] = useState("");
  const [editAreaQuery, setEditAreaQuery] = useState("");
  const [editAreaDropdownOpen, setEditAreaDropdownOpen] = useState(false);
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

    function handleTourCloseAddLocationForm() {
      setAddingOpen(false);
    }

    window.addEventListener(TOUR_OPEN_ADD_LOCATION_FORM_EVENT, handleTourOpenAddLocationForm);
    window.addEventListener(TOUR_CLOSE_ADD_LOCATION_FORM_EVENT, handleTourCloseAddLocationForm);
    return () => {
      window.removeEventListener(TOUR_OPEN_ADD_LOCATION_FORM_EVENT, handleTourOpenAddLocationForm);
      window.removeEventListener(TOUR_CLOSE_ADD_LOCATION_FORM_EVENT, handleTourCloseAddLocationForm);
    };
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

  const siteById = useMemo(() => {
    const map = new Map<string, SiteRecord>();
    for (const site of sites) {
      map.set(site.id, site);
    }
    return map;
  }, [sites]);

  const areaById = useMemo(() => {
    const map = new Map<string, AreaRecord>();
    for (const area of areas) {
      map.set(area.id, area);
    }
    return map;
  }, [areas]);

  const areasBySiteId = useMemo(() => {
    const map = new Map<string, AreaRecord[]>();
    for (const area of areas) {
      const key = area.site_id || "__no_site__";
      const current = map.get(key) || [];
      current.push(area);
      map.set(key, current);
    }
    return map;
  }, [areas]);

  const locationCountByAreaId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const location of locations) {
      if (!location.area_id) continue;
      counts.set(location.area_id, (counts.get(location.area_id) || 0) + 1);
    }
    return counts;
  }, [locations]);

  const hasMultipleSites = sites.length > 1;

  function formatAreaLabel(area: AreaRecord): string {
    const siteName = area.site_id ? (siteById.get(area.site_id)?.name || area.site_name || "Site") : "Site";
    return hasMultipleSites ? `${siteName} / ${area.name}` : area.name;
  }

  function formatLocationBreadcrumb(areaId: string | null | undefined): string {
    if (!areaId) return "Unassigned";
    const area = areaById.get(areaId);
    if (!area) return "Unassigned";
    const siteName = area.site_id ? (siteById.get(area.site_id)?.name || area.site_name || "Site") : "Site";
    return hasMultipleSites ? `${siteName} › ${area.name}` : area.name;
  }

  const hierarchySummary = useMemo(() => {
    if (sites.length === 0) return "No sites yet";

    const parts = sites.map((site) => {
      const areaNames = (areasBySiteId.get(site.id) || []).map((area) => area.name);
      const areaSummary = areaNames.length > 0 ? areaNames.join(", ") : "No areas";
      return hasMultipleSites ? `${site.name}: ${areaSummary}` : areaSummary;
    });

    return parts.join(" · ");
  }, [areasBySiteId, hasMultipleSites, sites]);

  useEffect(() => {
    if (!siteFilterId || !areaFilterId) return;
    const selectedArea = areaById.get(areaFilterId);
    if (!selectedArea || selectedArea.site_id !== siteFilterId) {
      setAreaFilterId("");
    }
  }, [areaById, areaFilterId, siteFilterId]);

  function beginHierarchyEdit(key: string, initialName: string) {
    setHierarchyEditKey(key);
    setHierarchyDraftName(initialName);
  }

  function cancelHierarchyEdit() {
    setHierarchyEditKey(null);
    setHierarchyDraftName("");
  }

  async function saveHierarchyEdit() {
    const name = hierarchyDraftName.trim();
    if (name.length < MIN_NAME_LENGTH || !hierarchyEditKey) {
      setError(minimumLengthMessage("Name"));
      return;
    }

    setError("");
    setNotice("");

    try {
      if (hierarchyEditKey === "site:new") {
        setSavingSite(true);
        await apiRequest("/api/sites", {
          method: "POST",
          body: JSON.stringify({ name, description: null }),
        });
        toast.success("Site created.");
      } else if (hierarchyEditKey.startsWith("site:")) {
        const siteId = hierarchyEditKey.slice("site:".length);
        setSavingSite(true);
        await apiRequest(`/api/sites/${siteId}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        });
        toast.success("Site updated.");
      } else if (hierarchyEditKey.startsWith("area:new:")) {
        const siteId = hierarchyEditKey.slice("area:new:".length);
        setSavingArea(true);
        await apiRequest("/api/areas", {
          method: "POST",
          body: JSON.stringify({ name, description: null, site_id: siteId || null }),
        });
        toast.success("Area created.");
      } else if (hierarchyEditKey.startsWith("area:")) {
        const areaId = hierarchyEditKey.slice("area:".length);
        const area = areaById.get(areaId);
        setSavingArea(true);
        await apiRequest(`/api/areas/${areaId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            site_id: area?.site_id || null,
          }),
        });
        toast.success("Area updated.");
      }

      cancelHierarchyEdit();
      await loadHierarchyOptions();
      await loadLocations();
    } catch (err) {
      setError((err as Error).message || "Failed to save changes.");
    } finally {
      setSavingSite(false);
      setSavingArea(false);
    }
  }

  function handleHierarchySiteDelete(siteId: string) {
    setConfirmDeleteSiteId(siteId);
    setDeleteSiteMoveToId("");
  }

  function handleHierarchyAreaDelete(areaId: string) {
    setConfirmDeleteAreaId(areaId);
    setDeleteAreaMoveToId("");
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
    const area = snapshot.area_id ? areaById.get(snapshot.area_id) : null;
    setEditAreaSearch(area ? formatAreaLabel(area) : "");
    setEditAreaQuery("");
    setEditAreaDropdownOpen(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(EMPTY_FORM);
    setInitialEditForm(EMPTY_FORM);
    setEditAreaSearch("");
    setEditAreaQuery("");
    setEditAreaDropdownOpen(false);
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
      toast.success("Location updated.");
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
    return locations.filter((location) => {
      if (siteFilterId) {
        const area = location.area_id ? areaById.get(location.area_id) : null;
        const resolvedSiteId = area?.site_id || location.site_id || "";
        if (resolvedSiteId !== siteFilterId) {
          return false;
        }
      }

      if (areaFilterId && location.area_id !== areaFilterId) {
        return false;
      }

      if (!term) {
        return true;
      }

      const name = location.name.toLowerCase();
      const description = (location.description || "").toLowerCase();
      const count = String(location.item_count);
      const breadcrumb = formatLocationBreadcrumb(location.area_id).toLowerCase();
      return (
        name.includes(term) ||
        description.includes(term) ||
        count.includes(term) ||
        breadcrumb.includes(term)
      );
    });
  }, [areaById, areaFilterId, formatLocationBreadcrumb, locations, search, siteFilterId]);

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
        key: "id",
        header: "",
        className: "w-14",
        headerClassName: "w-14",
        render: (row) => {
          if (row.icon) {
            return (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-neutral-900">
                <TablerIcon name={row.icon} size={15} color={row.color || undefined} />
              </span>
            );
          }

          if (row.photo_url) {
            return (
              <img
                src={row.photo_url}
                alt={row.name}
                className="h-8 w-8 rounded-md border border-neutral-700 object-cover"
              />
            );
          }

          return (
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-xs font-semibold text-neutral-400 uppercase">
              {row.name.trim().charAt(0) || "?"}
            </span>
          );
        },
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
        key: "site_id",
        header: "Site",
        render: (row) => (
          <span className="text-neutral-400">
            {row.site_name || (row.site_id ? siteById.get(row.site_id)?.name : null) || "-"}
          </span>
        ),
      },
      {
        key: "area_id",
        header: "Area",
        render: (row) => (
          <span className="text-neutral-400">
            {row.area_name || (row.area_id ? areaById.get(row.area_id)?.name : null) || "Unassigned"}
          </span>
        ),
      },
      {
        key: "item_count",
        header: "Items",
        sortable: true,
        className: "w-24",
        headerClassName: "w-24",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300">
            {row.item_count}
          </span>
        ),
      },
      {
        key: "actions",
        header: "Actions",
        className: "w-28 text-right",
        headerClassName: "w-28 text-right",
        render: (row) => {
          const isDeleting = deletingId === row.id;
          return (
            <div className="inline-flex items-center gap-2 justify-end w-full">
              <button
                onClick={() => startEdit(row)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
                title={`Edit ${row.name}`}
              >
                <Edit3 size={13} />
              </button>
              <button
                onClick={() => {
                  if (isDeleting) return;
                  openDeleteModal(row);
                }}
                disabled={isDeleting}
                className={[
                  "inline-flex h-8 w-8 items-center justify-center rounded-md border transition-colors",
                  "border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70",
                  isDeleting ? "opacity-60 cursor-not-allowed" : "",
                ].join(" ")}
                title={`Delete ${row.name}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        },
      },
    ],
    [areaById, deletingId, formatLocationBreadcrumb, siteById]
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

  const scopedAreas = useMemo(
    () => areas.filter((area) => !siteFilterId || area.site_id === siteFilterId),
    [areas, siteFilterId]
  );

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
          description="Organize storage into sites, areas, and locations - or ignore the hierarchy entirely and just add locations."
        />
      )}

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 overflow-hidden" data-tour="locations-sites-section">
        <div
          data-tour="locations-hierarchy-toggle"
          role="button"
          tabIndex={0}
          onClick={() => setHierarchyExpanded((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setHierarchyExpanded((current) => !current);
            }
          }}
          className="w-full flex items-center gap-3 px-4 py-3 text-left border-b border-neutral-800 bg-neutral-950/20"
        >
          <ChevronRight
            size={14}
            className={`text-neutral-400 transition-transform ${hierarchyExpanded ? "rotate-90" : "rotate-0"}`}
          />
          <span className="text-sm font-semibold text-neutral-100">Sites &amp; Areas</span>
          <span className="text-xs text-neutral-500 truncate">{hierarchySummary}</span>
          <span className="ml-auto">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                window.dispatchEvent(new CustomEvent(RERUN_HIERARCHY_INTRO_EVENT));
              }}
              className={`${outlinedActionButtonClasses("neutral")} px-2.5 py-1.5 text-xs font-medium`}
            >
              <Compass size={12} />
              Re-run tour
            </button>
          </span>
        </div>

        {hierarchyExpanded && (
          <div className="px-4 py-3 space-y-2">
            {sites.map((site) => {
              const siteKey = `site:${site.id}`;
              const isSiteEditing = hierarchyEditKey === siteKey;
              const siteAreas = areasBySiteId.get(site.id) || [];

              return (
                <div key={site.id} className="rounded-md border border-neutral-800 bg-neutral-950/30 px-3 py-2.5">
                  {isSiteEditing ? (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        value={hierarchyDraftName}
                        onChange={(event) => setHierarchyDraftName(event.target.value)}
                        className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                        placeholder="Site name"
                      />
                      <button
                        type="button"
                        onClick={() => void saveHierarchyEdit()}
                        disabled={savingSite}
                        className={`${outlinedActionButtonClasses("positive")} px-2.5 py-1.5 text-sm`}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={cancelHierarchyEdit}
                        className={`${outlinedActionButtonClasses("neutral")} px-2.5 py-1.5 text-sm`}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-100">{site.name}</span>
                      <span className="text-xs text-neutral-600">{siteAreas.length} {siteAreas.length === 1 ? "area" : "areas"}</span>
                      <div className="ml-auto inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => beginHierarchyEdit(siteKey, site.name)}
                          className="inline-flex items-center p-1.5 rounded-md border border-transparent text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800/60"
                          title="Rename site"
                        >
                          <Edit3 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleHierarchySiteDelete(site.id)}
                          className="inline-flex items-center p-1.5 rounded-md border border-transparent text-neutral-500 hover:text-red-300 hover:bg-neutral-800/60 transition-colors"
                          title="Delete site"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 ml-2 pl-3 border-l border-neutral-800 space-y-1">
                    {siteAreas.map((area) => {
                      const areaKey = `area:${area.id}`;
                      const isAreaEditing = hierarchyEditKey === areaKey;
                      const locationCount = locationCountByAreaId.get(area.id) || 0;

                      return (
                        <div key={area.id}>
                          {isAreaEditing ? (
                            <div className="flex items-center gap-2">
                              <input
                                autoFocus
                                value={hierarchyDraftName}
                                onChange={(event) => setHierarchyDraftName(event.target.value)}
                                className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                                placeholder="Area name"
                              />
                              <button
                                type="button"
                                onClick={() => void saveHierarchyEdit()}
                                disabled={savingArea}
                                className={`${outlinedActionButtonClasses("positive")} px-2.5 py-1.5 text-sm`}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelHierarchyEdit}
                                className={`${outlinedActionButtonClasses("neutral")} px-2.5 py-1.5 text-sm`}
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-neutral-300 font-medium">{area.name}</span>
                              <span className="text-xs text-neutral-600">{locationCount} {locationCount === 1 ? "location" : "locations"}</span>
                              <div className="ml-auto inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => beginHierarchyEdit(areaKey, area.name)}
                                  className="inline-flex items-center p-1.5 rounded-md border border-transparent text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800/60"
                                  title="Rename area"
                                >
                                  <Edit3 size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleHierarchyAreaDelete(area.id)}
                                  className="inline-flex items-center p-1.5 rounded-md border border-transparent text-neutral-500 hover:text-red-300 hover:bg-neutral-800/60 transition-colors"
                                  title="Delete area"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {hierarchyEditKey === `area:new:${site.id}` ? (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          autoFocus
                          value={hierarchyDraftName}
                          onChange={(event) => setHierarchyDraftName(event.target.value)}
                          className="flex-1 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                          placeholder="New area name"
                        />
                        <button
                          type="button"
                          onClick={() => void saveHierarchyEdit()}
                          disabled={savingArea}
                          className={`${outlinedActionButtonClasses("positive")} px-2.5 py-1.5 text-sm`}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelHierarchyEdit}
                          className={`${outlinedActionButtonClasses("neutral")} px-2.5 py-1.5 text-sm`}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => beginHierarchyEdit(`area:new:${site.id}`, "")}
                        data-tour="locations-add-area"
                        className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200 py-0.5"
                      >
                        <Plus size={12} />
                        Add area
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {hierarchyEditKey === "site:new" ? (
              <div className="flex items-center gap-2 pt-2">
                <input
                  autoFocus
                  value={hierarchyDraftName}
                  onChange={(event) => setHierarchyDraftName(event.target.value)}
                  className="w-full max-w-sm bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  placeholder="New site name"
                />
                <button
                  type="button"
                  onClick={() => void saveHierarchyEdit()}
                  disabled={savingSite}
                  className={`${outlinedActionButtonClasses("positive")} px-2.5 py-1.5 text-sm`}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={cancelHierarchyEdit}
                  className={`${outlinedActionButtonClasses("neutral")} px-2.5 py-1.5 text-sm`}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => beginHierarchyEdit("site:new", "")}
                data-tour="locations-add-site"
                className="inline-flex items-center gap-1 text-sm text-emerald-300 hover:text-emerald-200 mt-1"
              >
                <Plus size={13} />
                Add site
              </button>
            )}
          </div>
        )}
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
                    {formatAreaLabel(area)}
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
              <label className="relative block sm:col-span-2">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Site / Area</span>
                <input
                  value={editAreaSearch}
                  onFocus={() => {
                    setEditAreaQuery("");
                    setEditAreaDropdownOpen(true);
                  }}
                  onChange={(e) => {
                    const searchValue = e.target.value;
                    setEditAreaSearch(searchValue);
                    setEditAreaQuery(searchValue);
                    setEditForm((v) => ({ ...v, area_id: "" }));
                  }}
                  onBlur={() => window.setTimeout(() => setEditAreaDropdownOpen(false), 150)}
                  placeholder="Search site or area..."
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
                {editAreaDropdownOpen && (
                  <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-neutral-700 bg-neutral-950 py-1 shadow-lg">
                    {areas
                      .filter((area) => formatAreaLabel(area).toLowerCase().includes(editAreaQuery.trim().toLowerCase()))
                      .map((area) => (
                        <button
                          key={area.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setEditAreaSearch(formatAreaLabel(area));
                            setEditAreaQuery("");
                            setEditForm((v) => ({ ...v, area_id: area.id }));
                            setEditAreaDropdownOpen(false);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
                        >
                          {formatAreaLabel(area)}
                        </button>
                      ))}
                  </div>
                )}
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
            action={
              <div className="flex items-center gap-2 flex-wrap">
                {hasMultipleSites && (
                  <select
                    data-tour="locations-site-filter"
                    value={siteFilterId}
                    onChange={(event) => {
                      const nextSiteId = event.target.value;
                      setSiteFilterId(nextSiteId);
                      if (!nextSiteId) return;
                      const selectedArea = areaById.get(areaFilterId);
                      if (!selectedArea || selectedArea.site_id !== nextSiteId) {
                        setAreaFilterId("");
                      }
                    }}
                    className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  >
                    <option value="">All sites</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>{site.name}</option>
                    ))}
                  </select>
                )}

                <select
                  data-tour="locations-area-filter"
                  value={areaFilterId}
                  onChange={(event) => setAreaFilterId(event.target.value)}
                  className="bg-neutral-950 border border-neutral-700 rounded-md px-3 py-1.5 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">All areas</option>
                  {scopedAreas.map((area) => (
                    <option key={area.id} value={area.id}>{formatAreaLabel(area)}</option>
                  ))}
                </select>

                <button
                  data-tour="locations-add-location-button"
                  onClick={() => { setAddingOpen(true); setError(""); setNotice(""); }}
                  className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
                >
                  <Plus size={14} />
                  Add Location
                </button>
              </div>
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
          .map((area) => ({ id: area.id, name: formatAreaLabel(area) }))}
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



