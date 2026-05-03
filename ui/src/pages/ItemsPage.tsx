import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { ItemDetailPanel } from "../components/ui/ItemDetailPanel";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { buildCenteredExcerpt, splitMatchSegments } from "../lib/itemSearch";
import { useBeforeUnload } from "../lib/useBeforeUnload";

const MOBILE_BREAKPOINT = 1024; // lg breakpoint
const DELETE_TOAST_TIMEOUT_MS = 5000;

interface Part {
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

export interface PartDetail {
  id: string;
  name: string;
  description: string | null;
  collection: string | null;
  location_id: string | null;
  location: string | null;
  status: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  images: Array<{
    id: string;
    thumb_url: string;
    display_url: string;
    original_url: string | null;
    is_primary: boolean;
  }>;
}

export interface PartEditForm {
  name: string;
  description: string;
  collection: string;
  location_id: string;
  status: "draft" | "confirmed";
  quantity: number;
}

export interface LocationOption {
  id: string;
  name: string;
}

export interface CollectionOption {
  id: string;
  name: string;
}

const EMPTY_EDIT_FORM: PartEditForm = {
  name: "",
  description: "",
  collection: "",
  location_id: "",
  status: "draft",
  quantity: 1,
};

function toEditForm(part: PartDetail): PartEditForm {
  return {
    name: part.name ?? "",
    description: part.description ?? "",
    collection: part.collection ?? "",
    location_id: part.location_id ?? "",
    status: part.status === "confirmed" ? "confirmed" : "draft",
    quantity: part.quantity ?? 1,
  };
}

function isSameForm(a: PartEditForm, b: PartEditForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.collection.trim() === b.collection.trim() &&
    a.location_id === b.location_id &&
    a.status === b.status &&
    a.quantity === b.quantity
  );
}

function imageStateSignature(images: Array<{ id: string; is_primary: boolean }>): string {
  return images.map((img) => `${img.id}:${img.is_primary ? "1" : "0"}`).join("|");
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

function renderHighlightedText(value: string, query: string, keyPrefix: string): ReactNode {
  const segments = splitMatchSegments(value, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark
            key={`${keyPrefix}-${index}`}
            className="rounded-sm bg-amber-300/15 px-0.5 text-amber-100"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${keyPrefix}-${index}`}>{segment.text}</span>
        )
      )}
    </>
  );
}

function renderItemNameContent(row: Part, query: string, excerptLength: number, keyPrefix: string): ReactNode {
  const descriptionExcerpt = buildCenteredExcerpt(row.description, query, excerptLength);

  if (!descriptionExcerpt) {
    return (
      <div className="flex min-h-[2.5rem] items-center">
        <div className="break-words font-medium text-neutral-200">
          {renderHighlightedText(row.name, query, `${keyPrefix}-name`)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-1">
      <div className="break-words font-medium text-neutral-200">
        {renderHighlightedText(row.name, query, `${keyPrefix}-name`)}
      </div>
      {descriptionExcerpt ? (
        <div className="break-words text-xs leading-5 text-neutral-500">
          {renderHighlightedText(descriptionExcerpt, query, `${keyPrefix}-description`)}
        </div>
      ) : null}
    </div>
  );
}

export function ItemsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");

  // Sync search when ?q= param changes (e.g. navigating from topbar search)
  const qParam = searchParams.get("q") ?? "";
  useEffect(() => { setSearch(qParam); }, [qParam]);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ItemSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Debounced search value — used when building API requests
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedPart, setSelectedPart] = useState<PartDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [editForm, setEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [initialEditForm, setInitialEditForm] = useState<PartEditForm>(EMPTY_EDIT_FORM);
  const [draftImages, setDraftImages] = useState<PartDetail["images"]>([]);
  const [initialImageSignature, setInitialImageSignature] = useState("");
  const [savingDetail, setSavingDetail] = useState(false);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);

  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [deletingPartFromModal, setDeletingPartFromModal] = useState(false);
  const [deletedToast, setDeletedToast] = useState<{ id: string; name: string } | null>(null);
  const [undoingDelete, setUndoingDelete] = useState(false);
  const undoToastTimerRef = useRef<number | null>(null);
  const undoToastDeadlineRef = useRef<number | null>(null);
  const undoToastRemainingMsRef = useRef<number>(DELETE_TOAST_TIMEOUT_MS);

  const tableRef = useRef<HTMLTableElement>(null);

  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : MOBILE_BREAKPOINT
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const isMobile = windowWidth < MOBILE_BREAKPOINT;

  const collectionFilter = searchParams.get("collection")?.trim() || "";
  const isUncollectedFilter = collectionFilter === "__none";
  const collectionLabel = isUncollectedFilter ? "No collection" : collectionFilter;
  const activeCollectionOption = useMemo(
    () => collectionOptions.find((option) => option.name === collectionFilter) ?? null,
    [collectionFilter, collectionOptions]
  );

  // Debounced collection filter — reduces write traffic on PATCH /api/me
  const [debouncedCollectionFilter, setDebouncedCollectionFilter] = useState(collectionFilter);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCollectionFilter(collectionFilter), 300);
    return () => clearTimeout(t);
  }, [collectionFilter]);

  const collectionFilterSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (collectionFilterSavedRef.current === null) {
      collectionFilterSavedRef.current = debouncedCollectionFilter;
      return;
    }
    if (debouncedCollectionFilter === collectionFilterSavedRef.current) return;
    collectionFilterSavedRef.current = debouncedCollectionFilter;
    const debouncedIsUncollected = debouncedCollectionFilter === "__none";
    void apiRequest("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ last_open_collection: debouncedIsUncollected ? null : (debouncedCollectionFilter || null) }),
    }).catch(() => {});
  }, [debouncedCollectionFilter]);

  const hasDirtyChanges = useMemo(() => {
    if (selectedPartId === null) return false;
    const formDirty = !isSameForm(editForm, initialEditForm);
    const imageDirty = imageStateSignature(draftImages) !== initialImageSignature;
    return formDirty || imageDirty;
  }, [draftImages, editForm, initialEditForm, initialImageSignature, selectedPartId]);
  useBeforeUnload(hasDirtyChanges);

  useEffect(() => {
    void loadLocations();
    void loadCollectionOptions();
  }, []);

  // Reload items whenever debounced search, collection filter, or sort changes
  useEffect(() => {
    void loadParts({ q: debouncedSearch, collection: collectionFilter, sortKey, sortDir: sortDirection });
  }, [debouncedSearch, collectionFilter, sortKey, sortDirection]);

  // Keep a ref to current load params so the SSE handler always uses fresh values
  const loadParamsRef = useRef({ q: debouncedSearch, collection: collectionFilter, sortKey, sortDir: sortDirection });
  loadParamsRef.current = { q: debouncedSearch, collection: collectionFilter, sortKey, sortDir: sortDirection };

  function clearUndoToastTimer() {
    if (undoToastTimerRef.current !== null) {
      window.clearTimeout(undoToastTimerRef.current);
      undoToastTimerRef.current = null;
    }
  }

  function startUndoToastTimer(durationMs: number) {
    clearUndoToastTimer();
    const remaining = Math.max(0, durationMs);
    undoToastRemainingMsRef.current = remaining;

    if (remaining === 0) {
      setDeletedToast(null);
      undoToastDeadlineRef.current = null;
      undoToastRemainingMsRef.current = DELETE_TOAST_TIMEOUT_MS;
      return;
    }

    undoToastDeadlineRef.current = Date.now() + remaining;
    undoToastTimerRef.current = window.setTimeout(() => {
      setDeletedToast(null);
      undoToastTimerRef.current = null;
      undoToastDeadlineRef.current = null;
      undoToastRemainingMsRef.current = DELETE_TOAST_TIMEOUT_MS;
    }, remaining);
  }

  function showDeletedToast(id: string, name: string) {
    setDeletedToast({ id, name });
    startUndoToastTimer(DELETE_TOAST_TIMEOUT_MS);
  }

  function handleToastMouseEnter() {
    if (!deletedToast) return;
    if (undoToastDeadlineRef.current !== null) {
      undoToastRemainingMsRef.current = Math.max(0, undoToastDeadlineRef.current - Date.now());
    }
    clearUndoToastTimer();
    undoToastDeadlineRef.current = null;
  }

  function handleToastMouseLeave() {
    if (!deletedToast) return;
    startUndoToastTimer(undoToastRemainingMsRef.current);
  }

  useEffect(() => {
    return () => {
      clearUndoToastTimer();
    };
  }, []);

  useEffect(() => {
    const navState = location.state as { deletedItemId?: string; deletedItemName?: string } | null;
    if (!navState?.deletedItemId) {
      return;
    }

    showDeletedToast(navState.deletedItemId, navState.deletedItemName || "Item");
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  useEffect(() => {
    const source = new EventSource("/api/events/items");

    const onItemsChanged = () => {
      void loadParts({ ...loadParamsRef.current, background: true });
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

  async function loadParts(params?: { q?: string; collection?: string; sortKey?: ItemSortKey; sortDir?: "asc" | "desc"; background?: boolean }) {
    const background = params?.background ?? false;

    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const qs = new URLSearchParams();
      if (params?.q?.trim()) qs.set("q", params.q.trim());
      if (params?.collection) qs.set("collection", params.collection);
      if (params?.sortKey) qs.set("sort_by", params.sortKey);
      if (params?.sortDir) qs.set("sort_dir", params.sortDir);
      const url = `/api/items${qs.size ? `?${qs.toString()}` : ""}`;
      const data = await apiRequest<Part[]>(url);
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
    const partName = parts.find((part) => part.id === partId)?.name ?? "Item";
    try {
      await apiRequest(`/api/items/${partId}`, { method: "DELETE" });
      setParts((current) => current.filter((part) => part.id !== partId));
      showDeletedToast(partId, partName);
    } catch (err) {
      setDeleteError((err as Error).message || "Failed to delete part.");
    } finally {
      setDeletingId(null);
    }
  }

  async function deletePartFromModal() {
    if (!selectedPartId) return;
    const partName = selectedPart?.name ?? "Item";
    setDeletingPartFromModal(true);
    try {
      await apiRequest(`/api/items/${selectedPartId}`, { method: "DELETE" });
      setParts((current) => current.filter((part) => part.id !== selectedPartId));
      showDeletedToast(selectedPartId, partName);
      closeModalNow();
    } catch (err) {
      setDetailError((err as Error).message || "Failed to delete item.");
    } finally {
      setDeletingPartFromModal(false);
    }
  }

  async function undoDelete() {
    if (!deletedToast || undoingDelete) return;

    setUndoingDelete(true);
    setDeleteError("");
    try {
      await apiRequest(`/api/items/${deletedToast.id}/restore`, { method: "POST" });
      setDeletedToast(null);
      clearUndoToastTimer();
      undoToastDeadlineRef.current = null;
      undoToastRemainingMsRef.current = DELETE_TOAST_TIMEOUT_MS;
      await loadParts({ ...loadParamsRef.current, background: true });
    } catch (err) {
      setDeleteError((err as Error).message || "Failed to restore item.");
    } finally {
      setUndoingDelete(false);
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
      setDraftImages(detail.images);
      setInitialImageSignature(imageStateSignature(detail.images));
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
    setDraftImages([]);
    setInitialImageSignature("");
    setUnsavedPromptOpen(false);
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

    const formDirty = !isSameForm(editForm, initialEditForm);
    const imageDirty = imageStateSignature(draftImages) !== initialImageSignature;

    const trimmedName = editForm.name.trim();
    if (formDirty && trimmedName.length < MIN_NAME_LENGTH) {
      setDetailError(minimumLengthMessage("Name"));
      return false;
    }

    setSavingDetail(true);
    setDetailError("");
    try {
      if (formDirty) {
        await apiRequest(`/api/items/${selectedPartId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: trimmedName,
            description: editForm.description.trim() || null,
            collection: editForm.collection.trim() || null,
            location_id: editForm.location_id || null,
            status: editForm.status,
            quantity: editForm.quantity,
          }),
        });
      }

      if (imageDirty) {
        const desiredPrimary = draftImages.find((img) => img.is_primary)?.id || null;
        if (desiredPrimary) {
          await apiRequest(`/api/images/${desiredPrimary}/set-primary`, { method: "POST" });
        }
      }

      const refreshed = await apiRequest<PartDetail>(`/api/items/${selectedPartId}`);
      const refreshedForm = toEditForm(refreshed);

      const noLongerMatchesCollectionFilter =
        (isUncollectedFilter && !!refreshed.collection) ||
        (!isUncollectedFilter && !!collectionFilter && refreshed.collection !== collectionFilter);

      if (noLongerMatchesCollectionFilter) {
        setParts((current) => current.filter((p) => p.id !== refreshed.id));
        closeModalNow();
        return true;
      }

      setSelectedPart(refreshed);
      setDraftImages(refreshed.images);
      setInitialImageSignature(imageStateSignature(refreshed.images));
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
                quantity: refreshed.quantity,
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

  async function handleSetPrimaryImage(imageId: string) {
    setDraftImages((prev) => prev.map((img) => ({ ...img, is_primary: img.id === imageId })));
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

  useEffect(() => {
    if (isMobile) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedPartId) return;
        const row = parts.find((r) => r.id === selectedPartId);
        if (!row || deletingId === row.id) return;
        e.preventDefault();
        void deletePart(row.id);
        return;
      }

      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      if (parts.length === 0) return;
      const currentIdx = selectedPartId ? parts.findIndex((r) => r.id === selectedPartId) : -1;
      let nextIdx: number;
      if (e.key === "ArrowDown") {
        nextIdx = currentIdx < parts.length - 1 ? currentIdx + 1 : 0;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : parts.length - 1;
      }
      const nextRow = parts[nextIdx];
      if (!nextRow || deletingId === nextRow.id) return;
      void openPartModal(nextRow.id);
      requestAnimationFrame(() => {
        const el = tableRef.current?.querySelector<HTMLTableRowElement>(`[data-row-id="${nextRow.id}"]`);
        el?.scrollIntoView({ block: "nearest" });
      });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isMobile, parts, selectedPartId, deletingId]);

  const columnWidths = useMemo(
    () => ({
      name: getColumnWidth(parts.map((part) => part.name), 18, 34),
      collection: getColumnWidth(parts.map((part) => part.collection), 14, 26),
      location: getColumnWidth(parts.map((part) => part.location), 14, 26),
      status: getColumnWidth(parts.map((part) => part.status), 10, 14),
    }),
    [parts]
  );

  const desktopDescriptionExcerptLength = useMemo(() => {
    const widthChars = Number.parseInt(columnWidths.name, 10);
    return Number.isFinite(widthChars) ? Math.max(42, widthChars * 2) : 56;
  }, [columnWidths.name]);

  const mobileDescriptionExcerptLength = 44;
  const activeResultQuery = debouncedSearch;

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
        render: (row) => renderItemNameContent(row, activeResultQuery, desktopDescriptionExcerptLength, `desktop-${row.id}`),
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
        key: "quantity",
        header: "Qty",
        width: "5ch",
        render: (row) => (
          <span className="text-sm text-neutral-300">{row.quantity}</span>
        ),
      },
    ],
    [activeResultQuery, columnWidths, desktopDescriptionExcerptLength]
  );

  const emptyMessage = useMemo(() => {
    if (loading) {
      return "Loading items...";
    }
    if (error) {
      return error;
    }
    if (collectionFilter && search.trim()) {
      return `No items in ${collectionLabel} match your search.`;
    }
    if (collectionFilter) {
      return `No items found in ${collectionLabel}.`;
    }
    if (search.trim()) {
      return "No items match your search.";
    }
    return "No items yet. Add your first one above.";
  }, [collectionFilter, error, loading, search]);

  return (
    <div className="space-y-5 h-full flex flex-col">
      <PageHeader
        title={collectionLabel || "Items"}
      />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-0 overflow-hidden">
        {/* Left side: Table (always visible on desktop, hidden when detail open on mobile) */}
        <div
          className={`flex-1 min-h-0 flex flex-col overflow-hidden ${
            isMobile && selectedPartId ? "hidden" : ""
          }`}
        >
          <div
            className={`space-y-4 flex-1 min-h-0 flex flex-col overflow-hidden ${
              collectionFilter ? "" : "p-4"
            }`}
          >
            <ListToolbar
              search={search}
              onSearchChange={setSearch}
              placeholder={collectionFilter ? "Search by name and description" : "Search items, locations, collections…"}
              loading={loading}
              action={
                <button
                  onClick={() => {
                    if (!collectionFilter) {
                      navigate("/add");
                      return;
                    }

                    const nextSearch = new URLSearchParams();
                    if (activeCollectionOption?.id) {
                      nextSearch.set("collection_id", activeCollectionOption.id);
                    } else {
                      nextSearch.set("collection", collectionFilter);
                    }

                    navigate({
                      pathname: "/add",
                      search: nextSearch.toString(),
                    });
                  }}
                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                >
                  <Plus size={14} />
                  Add Item
                </button>
              }
            />

            {deleteError && <p className="text-sm text-red-400">{deleteError}</p>}

            <div className="flex-1 min-h-0 overflow-y-auto">
              {isMobile ? (
                <div className="pr-1">
                  {parts.length === 0 ? (
                    <div className="border border-neutral-800 rounded-lg p-6 text-sm text-neutral-500 text-center">
                      {emptyMessage}
                    </div>
                  ) : (
                    <div className="space-y-2 pb-2">
                      {parts.map((row) => {
                        const isDeleting = deletingId === row.id;
                        return (
                          <article
                            key={row.id}
                            className="rounded-lg border border-neutral-800 bg-neutral-950 p-2.5"
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                type="button"
                                onClick={() => {
                                  if (isDeleting) return;
                                  void openPartModal(row.id);
                                }}
                                className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                              >
                                {row.thumb ? (
                                  <img
                                    src={row.thumb}
                                    alt={row.name}
                                    className="h-14 w-14 shrink-0 rounded border border-neutral-800 object-cover"
                                  />
                                ) : (
                                  <div className="h-14 w-14 shrink-0 rounded border border-neutral-800 bg-neutral-900 text-[10px] text-neutral-500 flex items-center justify-center">
                                    no image
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-neutral-100">
                                      {renderItemNameContent(row, activeResultQuery, mobileDescriptionExcerptLength, `mobile-${row.id}`)}
                                    </div>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    <span className="inline-flex items-center rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300">
                                      {row.collection || "No collection"}
                                    </span>
                                    <span className="inline-flex items-center rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[11px] text-neutral-300">
                                      {row.location || "No location"}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-neutral-500">Status: {row.status}</p>
                                </div>
                              </button>

                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <DataTable
                    columns={columns}
                    rows={parts}
                    keyField="id"
                    emptyMessage={emptyMessage}
                    sortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={(key) => handleSort(key as ItemSortKey)}
                    activeRowId={selectedPartId ?? undefined}
                    tableRef={tableRef}
                    onRowClick={(row) => {
                      if (deletingId === row.id) return;
                      void openPartModal(row.id);
                    }}
                  />
                  <p className="text-xs text-neutral-600 text-right pt-1">
                    {loading ? "Loading…" : `${parts.length} item${parts.length !== 1 ? "s" : ""}`}
                  </p>
                </>
              )}
            </div>

          </div>
        </div>

        {/* Right side: Detail panel (visible on desktop if selected, full-screen on mobile if selected) */}
        {selectedPartId && (
          <div
            className={
              isMobile
                ? "fixed inset-0 z-40 w-full"
                : "hidden lg:flex lg:w-96 lg:border-l border-neutral-800"
            }
          >
            <ItemDetailPanel
              selectedPart={selectedPart}
              images={draftImages}
              editForm={editForm}
              detailLoading={detailLoading}
              detailError={detailError}
              savingDetail={savingDetail}
              deletingPartFromModal={deletingPartFromModal}
              locations={locations}
              collectionOptions={collectionOptions}
              hasDirtyChanges={hasDirtyChanges}
              onEditChange={setEditForm}
              onSave={async () => {
                const ok = await savePartChanges();
                if (ok) {
                  closeModalNow();
                }
              }}
              onClose={requestCloseModal}
              onConfirmDelete={deletePartFromModal}
              isMobile={isMobile}
              onSetPrimaryImage={handleSetPrimaryImage}
            />
          </div>
        )}
      </div>

      {/* Unsaved changes dialog */}
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
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {deletedToast && (
        <div
          className="fixed bottom-4 right-4 z-[80] rounded-lg border border-amber-500/50 bg-amber-950/95 backdrop-blur px-3 py-2.5 shadow-xl min-w-[220px]"
          onMouseEnter={handleToastMouseEnter}
          onMouseLeave={handleToastMouseLeave}
        >
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-100 truncate">Item deleted</p>
              <p className="text-xs text-amber-300/80 truncate">{deletedToast.name}</p>
            </div>
            <button
              onClick={() => void undoDelete()}
              disabled={undoingDelete}
              className="text-xs px-2 py-1 rounded border border-amber-300/70 text-amber-100 hover:border-amber-200 disabled:opacity-60"
            >
              {undoingDelete ? "Undoing..." : "Undo"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

