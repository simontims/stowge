import { useEffect, useMemo, useRef, useState } from "react";
import { Edit3, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { USER_NAV_PREFERENCES_UPDATED_EVENT } from "../config/nav";
import { useTableSort } from "../hooks/useTableSort";
import { apiRequest } from "../lib/api";
import type { AreaOption, CollectionOption, CurrentUser, LocationOption, SiteOption } from "../lib/types";
import { normalizeShortcutFilter, type ShortcutFilter } from "../lib/shortcutFilters";

type ShortcutSortKey = "name" | "query" | "pinned";

interface ShortcutFormState {
  id: string;
  name: string;
  query: string;
  collection: string;
  statuses: string[];
  site_id: string;
  area_id: string;
  location_id: string;
  quantityMode: "any" | "exact" | "min" | "max" | "range";
  quantityExact: string;
  quantityMin: string;
  quantityMax: string;
  pinned: boolean;
}

interface ItemsBootstrapPayload {
  collections?: CollectionOption[];
  sites?: SiteOption[];
  areas?: AreaOption[];
  locations?: LocationOption[];
  statuses?: string[];
}

const EMPTY_FORM: ShortcutFormState = {
  id: "",
  name: "",
  query: "",
  collection: "",
  statuses: [],
  site_id: "",
  area_id: "",
  location_id: "",
  quantityMode: "any",
  quantityExact: "",
  quantityMin: "",
  quantityMax: "",
  pinned: true,
};

function newShortcutId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseOptionalNonNegativeInt(textValue: string): number | null {
  const value = textValue.trim();
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function normalizeList(input: ShortcutFilter[]): ShortcutFilter[] {
  return input
    .map((row) => normalizeShortcutFilter(row))
    .filter((row) => Boolean(row.id) && Boolean(row.name));
}

function toForm(row: ShortcutFilter): ShortcutFormState {
  const statuses = Array.isArray(row.statuses) ? row.statuses : [];

  let quantityMode: ShortcutFormState["quantityMode"] = "any";
  let quantityExact = "";
  let quantityMin = "";
  let quantityMax = "";

  if (row.quantity_min !== null && row.quantity_max !== null) {
    if (row.quantity_min === row.quantity_max) {
      quantityMode = "exact";
      quantityExact = String(row.quantity_min);
    } else {
      quantityMode = "range";
      quantityMin = String(row.quantity_min);
      quantityMax = String(row.quantity_max);
    }
  } else if (row.quantity_min !== null) {
    quantityMode = "min";
    quantityMin = String(row.quantity_min);
  } else if (row.quantity_max !== null) {
    quantityMode = "max";
    quantityMax = String(row.quantity_max);
  }

  return {
    id: row.id,
    name: row.name,
    query: row.query,
    collection: row.collection || "",
    statuses,
    site_id: row.site_id || "",
    area_id: row.area_id || "",
    location_id: row.location_id || "",
    quantityMode,
    quantityExact,
    quantityMin,
    quantityMax,
    pinned: row.pinned,
  };
}

function fromForm(form: ShortcutFormState): ShortcutFilter {
  let quantityMin: number | null = null;
  let quantityMax: number | null = null;

  if (form.quantityMode === "exact") {
    const exact = parseOptionalNonNegativeInt(form.quantityExact);
    quantityMin = exact;
    quantityMax = exact;
  } else if (form.quantityMode === "min") {
    quantityMin = parseOptionalNonNegativeInt(form.quantityMin);
  } else if (form.quantityMode === "max") {
    quantityMax = parseOptionalNonNegativeInt(form.quantityMax);
  } else if (form.quantityMode === "range") {
    quantityMin = parseOptionalNonNegativeInt(form.quantityMin);
    quantityMax = parseOptionalNonNegativeInt(form.quantityMax);
  }

  return normalizeShortcutFilter({
    id: form.id,
    name: form.name,
    query: form.query,
    collection: form.collection || null,
    statuses: form.statuses,
    status: form.statuses.length === 1 ? form.statuses[0] : null,
    site_id: form.site_id || null,
    area_id: form.area_id || null,
    location_id: form.location_id || null,
    quantity_min: quantityMin,
    quantity_max: quantityMax,
    pinned: form.pinned,
  });
}

function quantitySummary(row: ShortcutFilter): string {
  if (row.quantity_min !== null && row.quantity_max !== null) {
    if (row.quantity_min === row.quantity_max) {
      return `= ${row.quantity_min}`;
    }
    return `${row.quantity_min} to ${row.quantity_max}`;
  }
  if (row.quantity_min !== null) return `>= ${row.quantity_min}`;
  if (row.quantity_max !== null) return `<= ${row.quantity_max}`;
  return "Any";
}

export function SettingsShortcutsPage() {
  const [loading, setLoading] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [shortcuts, setShortcuts] = useState<ShortcutFilter[]>([]);
  const [addingOpen, setAddingOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShortcutFilter | null>(null);
  const [form, setForm] = useState<ShortcutFormState>(EMPTY_FORM);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const statusMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusMenuRef = useRef<HTMLDivElement | null>(null);

  const { sortKey, sortDirection, handleSort } = useTableSort<ShortcutSortKey>("name");

  const siteById = useMemo(() => {
    const index = new Map<string, SiteOption>();
    for (const site of sites) {
      index.set(site.id, site);
    }
    return index;
  }, [sites]);

  const areaById = useMemo(() => {
    const index = new Map<string, AreaOption>();
    for (const area of areas) {
      index.set(area.id, area);
    }
    return index;
  }, [areas]);

  const locationById = useMemo(() => {
    const index = new Map<string, LocationOption>();
    for (const location of locations) {
      index.set(location.id, location);
    }
    return index;
  }, [locations]);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return shortcuts;
    }

    return shortcuts.filter((row) => {
      const parts = [
        row.name,
        row.query,
        row.collection || "",
        row.statuses.join(", "),
        row.site_id ? siteById.get(row.site_id)?.name || "" : "",
        row.area_id ? areaById.get(row.area_id)?.name || "" : "",
        row.location_id ? locationById.get(row.location_id)?.name || "" : "",
        quantitySummary(row),
      ];
      return parts.some((value) => value.toLowerCase().includes(term));
    });
  }, [search, shortcuts, siteById, areaById, locationById]);

  const sortedRows = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      if (sortKey === "pinned") {
        return ((a.pinned ? 1 : 0) - (b.pinned ? 1 : 0)) * dir;
      }
      const left = (a[sortKey] || "").toLowerCase();
      const right = (b[sortKey] || "").toLowerCase();
      return left.localeCompare(right) * dir;
    });
    return rows;
  }, [filteredRows, sortDirection, sortKey]);

  const scopedAreas = useMemo(
    () => areas.filter((area) => !form.site_id || area.site_id === form.site_id),
    [areas, form.site_id]
  );

  const scopedLocations = useMemo(
    () => locations.filter((location) => {
      if (form.area_id && location.area_id !== form.area_id) {
        return false;
      }
      if (form.site_id && location.site_id !== form.site_id) {
        return false;
      }
      return true;
    }),
    [form.area_id, form.site_id, locations]
  );

  const statusSummary = useMemo(() => {
    if (!form.statuses.length) return "Any status";
    if (form.statuses.length <= 2) return form.statuses.join(", ");
    return `${form.statuses.length} selected`;
  }, [form.statuses]);

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (!statusMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusMenuRef.current?.contains(target)) return;
      if (statusMenuButtonRef.current?.contains(target)) return;
      setStatusMenuOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStatusMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [statusMenuOpen]);

  function resetForm() {
    setForm(EMPTY_FORM);
  }

  function openAddModal() {
    setEditingId(null);
    resetForm();
    setAddingOpen(true);
  }

  function openEditModal(row: ShortcutFilter) {
    setAddingOpen(false);
    setEditingId(row.id);
    setForm(toForm(row));
  }

  function closeFormModal() {
    setAddingOpen(false);
    setEditingId(null);
    setStatusMenuOpen(false);
    resetForm();
  }

  async function persistShortcuts(nextRows: ShortcutFilter[], successMessage: string): Promise<boolean> {
    try {
      const payload = normalizeList(nextRows);
      const me = await apiRequest<CurrentUser>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ shortcut_filters: payload }),
      });

      const nextSaved = normalizeList(me.shortcut_filters || []);
      setShortcuts(nextSaved);
      window.dispatchEvent(new Event(USER_NAV_PREFERENCES_UPDATED_EVENT));
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error((err as Error).message || "Failed to save shortcut filters.");
      return false;
    }
  }

  async function loadData() {
    setLoading(true);

    try {
      const [me, bootstrap] = await Promise.all([
        apiRequest<CurrentUser>("/api/me"),
        apiRequest<ItemsBootstrapPayload>("/api/items/bootstrap"),
      ]);

      const shortcutRows = normalizeList(me.shortcut_filters || []);
      setShortcuts(shortcutRows);
      setCollections(bootstrap.collections || []);
      setSites(bootstrap.sites || []);
      setAreas(bootstrap.areas || []);
      setLocations(bootstrap.locations || []);

      const bootStatuses = Array.isArray(bootstrap.statuses) ? bootstrap.statuses : [];
      const shortcutStatuses = shortcutRows.flatMap((row) => row.statuses || []);
      const mergedStatuses = Array.from(
        new Set([...bootStatuses, ...shortcutStatuses].map((value) => value.trim()).filter(Boolean))
      );
      setStatusOptions(mergedStatuses);
    } catch (err) {
      toast.error((err as Error).message || "Failed to load shortcut filters.");
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof ShortcutFormState>(key: K, value: ShortcutFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateSite(nextSiteId: string) {
    setForm((current) => {
      const selectedArea = current.area_id ? areaById.get(current.area_id) : null;
      const keepArea = selectedArea && selectedArea.site_id === nextSiteId;
      const keepLocation = keepArea && current.location_id
        ? locationById.get(current.location_id)?.area_id === selectedArea?.id
        : false;
      return {
        ...current,
        site_id: nextSiteId,
        area_id: keepArea ? current.area_id : "",
        location_id: keepLocation ? current.location_id : "",
      };
    });
  }

  function updateArea(nextAreaId: string) {
    setForm((current) => {
      const selectedLocation = current.location_id ? locationById.get(current.location_id) : null;
      const keepLocation = selectedLocation?.area_id === nextAreaId;
      return {
        ...current,
        area_id: nextAreaId,
        location_id: keepLocation ? current.location_id : "",
      };
    });
  }

  function toggleStatusSelection(status: string, checked: boolean) {
    const normalized = status.trim();
    if (!normalized) return;
    const current = form.statuses || [];
    const next = checked
      ? Array.from(new Set([...current, normalized]))
      : current.filter((value) => value !== normalized);
    updateForm("statuses", next);
  }

  function validateForm(): boolean {
    const name = form.name.trim();
    if (!name) {
      toast.error("Filter name is required.");
      return false;
    }

    if (form.quantityMode === "exact") {
      if (!form.quantityExact.trim() || parseOptionalNonNegativeInt(form.quantityExact) === null) {
        toast.error("Exact quantity must be a whole number 0 or greater.");
        return false;
      }
    }

    if (form.quantityMode === "min") {
      if (!form.quantityMin.trim() || parseOptionalNonNegativeInt(form.quantityMin) === null) {
        toast.error("Quantity min must be a whole number 0 or greater.");
        return false;
      }
    }

    if (form.quantityMode === "max") {
      if (!form.quantityMax.trim() || parseOptionalNonNegativeInt(form.quantityMax) === null) {
        toast.error("Quantity max must be a whole number 0 or greater.");
        return false;
      }
    }

    if (form.quantityMode === "range") {
      const min = parseOptionalNonNegativeInt(form.quantityMin);
      const max = parseOptionalNonNegativeInt(form.quantityMax);
      if (min === null || max === null) {
        toast.error("Range requires both minimum and maximum quantities.");
        return false;
      }
      if (min > max) {
        toast.error("Quantity min cannot be greater than quantity max.");
        return false;
      }
    }

    return true;
  }

  async function upsertShortcutFromForm() {
    if (!validateForm()) {
      return;
    }

    const baseId = editingId || newShortcutId();
    const normalized = fromForm({ ...form, id: baseId, name: form.name.trim() });

    const nextRows = editingId
      ? shortcuts.map((row) => (row.id === editingId ? normalized : row))
      : [...shortcuts, normalized];

    setModalSaving(true);
    const ok = await persistShortcuts(nextRows, editingId ? "Filter updated." : "Filter created.");
    setModalSaving(false);
    if (ok) {
      closeFormModal();
    }
  }

  async function removeShortcut(id: string) {
    const nextRows = shortcuts.filter((row) => row.id !== id);
    setDeleting(true);
    const ok = await persistShortcuts(nextRows, "Filter removed.");
    setDeleting(false);
    if (!ok) {
      return;
    }
    setDeleteTarget(null);
  }

  const columns = useMemo<Column<ShortcutFilter>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => <span className="font-medium text-neutral-200">{row.name}</span>,
      },
      {
        key: "query",
        header: "Query",
        sortable: true,
        render: (row) => <span className="text-neutral-400">{row.query || "-"}</span>,
      },
      {
        key: "collection",
        header: "Scope",
        render: (row) => {
          const collection = row.collection === "__none" ? "No collection" : (row.collection || "Any collection");
          const status = row.statuses.length > 0 ? `Status: ${row.statuses.join(", ")}` : "Any status";
          const site = row.site_id ? siteById.get(row.site_id)?.name || "Site" : "Any site";
          const area = row.area_id ? areaById.get(row.area_id)?.name || "Area" : "Any area";
          const location = row.location_id ? locationById.get(row.location_id)?.name || "Location" : "Any location";

          return (
            <span className="text-neutral-400 text-xs leading-5">
              {collection} · {status} · {site} / {area} / {location}
            </span>
          );
        },
      },
      {
        key: "id",
        header: "Quantity",
        render: (row) => <span className="text-neutral-400">{quantitySummary(row)}</span>,
      },
      {
        key: "pinned",
        header: "Pinned",
        sortable: true,
        className: "w-24",
        headerClassName: "w-24",
        render: (row) => (
          <span
            className={[
              "inline-flex items-center rounded border px-2 py-0.5 text-xs",
              row.pinned
                ? "border-emerald-600/40 bg-emerald-900/20 text-emerald-300"
                : "border-neutral-700 bg-neutral-900 text-neutral-500",
            ].join(" ")}
          >
            {row.pinned ? "Yes" : "No"}
          </span>
        ),
      },
    ],
    [siteById, areaById, locationById]
  );

  const emptyMessage = useMemo(() => {
    if (loading) {
      return "Loading shortcut filters...";
    }
    if (search.trim()) {
      return "No shortcut filters match your search.";
    }
    return "No shortcut filters yet. Add your first filter.";
  }, [loading, search]);

  const modalOpen = addingOpen || Boolean(editingId);
  const modalTitle = editingId ? "Edit Filter" : "Add Filter";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Settings"
        description="Create reusable item filter shortcuts and pin the important ones to navigation."
      />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search filters..."
        loading={loading}
        action={
          <button
            type="button"
            onClick={openAddModal}
            className={`${solidActionButtonClasses("brand")} px-3 py-1.5`}
          >
            <Plus size={14} />
            Add Filter
          </button>
        }
      />

      <DataTable
        columns={columns}
        actions={{
          header: "",
          width: "180px",
          render: (row) => (
            <div className="inline-flex items-center gap-2 justify-end w-full">
              <button
                type="button"
                onClick={() => openEditModal(row)}
                className={tableActionButtonClasses("neutral")}
              >
                <Edit3 size={13} />
                Edit
              </button>
              <DeleteActionButton onClick={() => setDeleteTarget(row)} />
            </div>
          ),
        }}
        rows={sortedRows}
        keyField="id"
        emptyMessage={emptyMessage}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key) => handleSort(key as ShortcutSortKey)}
        footer={sortedRows.length > 0 && (
          <tr>
            <td colSpan={6} className="px-4 py-2.5 text-right text-xs text-neutral-600">
              {sortedRows.length} filter{sortedRows.length === 1 ? "" : "s"} · {sortedRows.filter((row) => row.pinned).length} pinned
            </td>
          </tr>
        )}
      />

      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-3xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-100">{modalTitle}</h3>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
                <input
                  value={form.name}
                  onChange={(event) => updateForm("name", event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  placeholder="Low stock drills"
                />
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Search Query</span>
                <input
                  value={form.query}
                  onChange={(event) => updateForm("query", event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  placeholder="e.g. m6 screw"
                />
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Collection</span>
                <select
                  value={form.collection}
                  onChange={(event) => updateForm("collection", event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">Any collection</option>
                  <option value="__none">No collection</option>
                  {collections.map((option) => (
                    <option key={option.id} value={option.name}>{option.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Status</span>
                <div className="mt-1 relative">
                  <button
                    ref={statusMenuButtonRef}
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={statusMenuOpen}
                    onClick={() => setStatusMenuOpen((current) => !current)}
                    className="w-full inline-flex items-center justify-between gap-2 bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 hover:border-neutral-600"
                  >
                    <span className="truncate">{statusSummary}</span>
                    <span className="text-neutral-500">{statusMenuOpen ? "▲" : "▼"}</span>
                  </button>

                  {statusMenuOpen && (
                    <div
                      ref={statusMenuRef}
                      role="listbox"
                      aria-multiselectable="true"
                      className="absolute z-30 mt-1 w-full rounded-md border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden"
                    >
                      <div className="max-h-56 overflow-y-auto">
                        {(statusOptions.length ? statusOptions : ["draft", "confirmed"]).map((statusValue) => {
                          const checked = form.statuses.includes(statusValue);
                          return (
                            <label
                              key={statusValue}
                              className="w-full inline-flex items-center gap-2 px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => toggleStatusSelection(statusValue, event.target.checked)}
                                className="h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                              />
                              <span className="truncate">{statusValue}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="border-t border-neutral-800 p-2 flex items-center justify-between">
                        <button
                          type="button"
                          onClick={() => updateForm("statuses", [])}
                          className="text-xs text-neutral-400 hover:text-neutral-200"
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusMenuOpen(false)}
                          className="text-xs text-neutral-300 hover:text-neutral-100"
                        >
                          Done
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-neutral-500">Leave empty for any status.</p>
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Site</span>
                <select
                  value={form.site_id}
                  onChange={(event) => updateSite(event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">Any site</option>
                  {sites.map((site) => (
                    <option key={site.id} value={site.id}>{site.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Area</span>
                <select
                  value={form.area_id}
                  onChange={(event) => updateArea(event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">Any area</option>
                  {scopedAreas.map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Location</span>
                <select
                  value={form.location_id}
                  onChange={(event) => updateForm("location_id", event.target.value)}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="">Any location</option>
                  {scopedLocations.map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3">
                <label className="block">
                  <span className="text-xs uppercase tracking-wide text-neutral-500">Quantity Filter</span>
                  <select
                    value={form.quantityMode}
                    onChange={(event) => updateForm("quantityMode", event.target.value as ShortcutFormState["quantityMode"])}
                    className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  >
                    <option value="any">Any quantity</option>
                    <option value="exact">Exact quantity</option>
                    <option value="min">At least</option>
                    <option value="max">At most</option>
                    <option value="range">Range</option>
                  </select>
                </label>

                {form.quantityMode === "exact" && (
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Exact Quantity</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.quantityExact}
                      onChange={(event) => updateForm("quantityExact", event.target.value)}
                      className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="0"
                    />
                  </label>
                )}

                {form.quantityMode === "min" && (
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Minimum Quantity</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.quantityMin}
                      onChange={(event) => updateForm("quantityMin", event.target.value)}
                      className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="0"
                    />
                  </label>
                )}

                {form.quantityMode === "max" && (
                  <label className="block">
                    <span className="text-xs uppercase tracking-wide text-neutral-500">Maximum Quantity</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={form.quantityMax}
                      onChange={(event) => updateForm("quantityMax", event.target.value)}
                      className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      placeholder="0"
                    />
                  </label>
                )}

                {form.quantityMode === "range" && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">Min</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={form.quantityMin}
                        onChange={(event) => updateForm("quantityMin", event.target.value)}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                        placeholder="0"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">Max</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={form.quantityMax}
                        onChange={(event) => updateForm("quantityMax", event.target.value)}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                        placeholder="0"
                      />
                    </label>
                  </div>
                )}
              </div>

              <label className="md:col-span-2 inline-flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => updateForm("pinned", event.target.checked)}
                  className="h-4 w-4 rounded border-neutral-600 bg-neutral-900"
                />
                <span className="text-sm text-neutral-300">Pin this filter in the left navigation</span>
              </label>
            </div>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeFormModal}
                disabled={modalSaving}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-sm font-medium text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void upsertShortcutFromForm()}
                disabled={modalSaving}
                className={`${solidActionButtonClasses("positive")} px-2.5 py-1.5`}
              >
                <Save size={13} />
                {modalSaving ? "Saving..." : "Save Filter"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Filter"
        message={
          <>
            Delete shortcut filter <span className="font-medium text-neutral-100">{deleteTarget?.name || ""}</span>?
          </>
        }
        onCancel={() => setDeleteTarget(null)}
        deleting={deleting}
        onConfirm={() => {
          if (!deleteTarget) return;
          void removeShortcut(deleteTarget.id);
        }}
      />
    </div>
  );
}
