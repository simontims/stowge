import { useEffect, useMemo, useState } from "react";
import { Edit3, Pin, Plus, Save, Trash2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { IconColorPicker } from "../components/ui/IconColorPicker";
import { StatusMessage } from "../components/ui/StatusMessage";
import { TagChips } from "../components/ui/TagChips";
import { TablerIcon } from "../components/ui/TablerIcon";
import { outlinedActionButtonClasses, solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { TAGS_NAV_UPDATED_EVENT, USER_NAV_PREFERENCES_UPDATED_EVENT } from "../config/nav";
import { useTableSort } from "../hooks/useTableSort";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { createTag, deleteTag, listTags, pinTagToMenu, updateTag } from "../lib/tags";
import type { ItemTag, Tag } from "../lib/types";

interface TagForm {
  name: string;
  icon: string;
  color: string;
  description: string;
}

interface DeletedItemRow {
  id: string;
  name: string;
  tags: ItemTag[];
  location: string | null;
  actions?: never;
}

type TagRow = Tag & { actions?: never };
type TagSortKey = "name" | "description" | "item_count";

const EMPTY_FORM: TagForm = { name: "", icon: "", color: "", description: "" };

/** The delete confirmation text: says how many items lose the tag. */
export function tagDeleteSummary(itemCount: number): string {
  if (itemCount === 0) return "No items use this tag.";
  if (itemCount === 1) return "1 item will lose this tag.";
  return `${itemCount} items will lose this tag.`;
}

export function TagsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [tags, setTags] = useState<TagRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDirection, handleSort } = useTableSort<TagSortKey>("name");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TagForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [deletedItems, setDeletedItems] = useState<DeletedItemRow[]>([]);
  const [deletedLoadError, setDeletedLoadError] = useState("");
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [emptyBinOpen, setEmptyBinOpen] = useState(false);
  const [emptyingBin, setEmptyingBin] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

  // Coming back from restoring an item opens the recycle bin.
  useEffect(() => {
    const shouldOpen = Boolean((location.state as { openRecycleBin?: boolean } | null)?.openRecycleBin);
    if (!shouldOpen) return;
    setRecycleBinOpen(true);
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [location.search, location.state, navigate]);

  async function loadAll() {
    setLoading(true);
    setLoadError("");
    try {
      setTags(await listTags());
    } catch (err) {
      setTags([]);
      setLoadError((err as Error).message || "Unable to load tags right now.");
    } finally {
      setLoading(false);
    }
    try {
      setDeletedItems((await apiRequest<DeletedItemRow[]>("/api/items/deleted")) || []);
      setDeletedLoadError("");
    } catch (err) {
      setDeletedItems([]);
      setDeletedLoadError((err as Error).message || "Unable to load recycle bin items.");
    }
  }

  function tagsChanged() {
    window.dispatchEvent(new Event(TAGS_NAV_UPDATED_EVENT));
  }

  function openAdd() {
    setError("");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(tag: Tag) {
    setError("");
    setEditingId(tag.id);
    setForm({
      name: tag.name,
      icon: tag.icon || "",
      color: tag.color || "",
      description: tag.description || "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  async function saveForm() {
    setError("");
    if (form.name.trim().length < MIN_NAME_LENGTH) {
      setError(minimumLengthMessage("Tag name"));
      return;
    }
    const body = {
      name: form.name.trim(),
      icon: form.icon || null,
      color: form.color || null,
      description: form.description.trim() || null,
    };
    setSaving(true);
    try {
      if (editingId) await updateTag(editingId, body);
      else await createTag(body);
      closeForm();
      await loadAll();
      tagsChanged();
    } catch (err) {
      setError((err as Error).message || (editingId ? "Failed to update tag." : "Failed to create tag."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteTag(deleteTarget.id);
      const untagged = result?.items_untagged ?? deleteTarget.item_count;
      toast.success(`Tag deleted`, { description: `${deleteTarget.name}. ${tagDeleteSummary(untagged).replace("will lose", "lost")}` });
      setDeleteTarget(null);
      await loadAll();
      tagsChanged();
      window.dispatchEvent(new Event(USER_NAV_PREFERENCES_UPDATED_EVENT));
    } catch (err) {
      setError((err as Error).message || "Failed to delete tag.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  async function pin(tag: Tag) {
    try {
      const outcome = await pinTagToMenu(tag);
      if (outcome === "exists") {
        toast(`A filter for ${tag.name} is already in your menu`);
        return;
      }
      window.dispatchEvent(new Event(USER_NAV_PREFERENCES_UPDATED_EVENT));
      toast.success(`Filter for ${tag.name} pinned to your menu`);
    } catch (err) {
      toast.error((err as Error).message || "Failed to pin the tag filter.");
    }
  }

  async function emptyRecycleBin() {
    setEmptyingBin(true);
    try {
      await apiRequest<{ deleted: number }>("/api/items/deleted/purge", { method: "POST" });
      setEmptyBinOpen(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message || "Failed to empty recycle bin.");
      setEmptyBinOpen(false);
    } finally {
      setEmptyingBin(false);
    }
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const dir = sortDirection === "asc" ? 1 : -1;
    const filtered = term
      ? tags.filter((t) => t.name.toLowerCase().includes(term) || (t.description || "").toLowerCase().includes(term))
      : [...tags];
    filtered.sort((a, b) => {
      if (sortKey === "item_count") return (a.item_count - b.item_count) * dir;
      return (a[sortKey] || "").toLowerCase().localeCompare((b[sortKey] || "").toLowerCase()) * dir;
    });
    return filtered;
  }, [tags, search, sortKey, sortDirection]);

  const filteredDeleted = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return deletedItems;
    return deletedItems.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        (item.location || "").toLowerCase().includes(term) ||
        (item.tags || []).some((t) => t.name.toLowerCase().includes(term)),
    );
  }, [deletedItems, search]);

  const columns = useMemo<Column<TagRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-center gap-2 font-medium text-neutral-200">
            <TablerIcon name={row.icon} size={15} color={row.color} />
            {row.name}
          </span>
        ),
      },
      {
        key: "description",
        header: "Description",
        sortable: true,
        render: (row) => <span className="text-neutral-400">{row.description?.trim() || "-"}</span>,
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
    ],
    [],
  );

  const recycleBinColumns = useMemo<Column<DeletedItemRow>[]>(
    () => [
      { key: "name", header: "Name", render: (row) => <span className="font-medium text-neutral-200">{row.name}</span> },
      { key: "tags", header: "Tags", render: (row) => <TagChips tags={row.tags} emptyLabel="-" /> },
      { key: "location", header: "Location", render: (row) => <span className="text-neutral-400">{row.location || "-"}</span> },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-28 text-right",
        headerClassName: "w-28 text-right",
        render: (row) => (
          <div className="inline-flex items-center gap-2 justify-end w-full" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => navigate(`/items/${row.id}/edit`, { state: { restoreOnSave: true, returnToRecycleBin: true } })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 hover:bg-emerald-900/30 text-xs"
            >
              Restore
            </button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  const emptyMessage = loading
    ? "Loading tags..."
    : loadError || (search.trim() ? "No tags match your search." : "No tags yet. Add your first one above.");

  return (
    <div className="space-y-5">
      {!embedded && <PageHeader title="Tags" description="Group items with tags. An item can have several." />}

      <StatusMessage error={formOpen ? "" : error} notice="" />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder={recycleBinOpen ? "Search recycle bin…" : "Search tags…"}
        loading={loading}
        action={
          <>
            {recycleBinOpen ? (
              <button onClick={() => setRecycleBinOpen(false)} className={`${outlinedActionButtonClasses("neutral")} gap-1.5 px-3 py-1.5 text-sm font-medium`}>
                Back to Tags
              </button>
            ) : (
              <>
                <button onClick={openAdd} className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}>
                  <Plus size={14} />
                  Add Tag
                </button>
                <button onClick={() => setRecycleBinOpen(true)} className={`${outlinedActionButtonClasses("neutral")} gap-1.5 px-3 py-1.5 text-sm font-medium`}>
                  <Trash2 size={14} />
                  Recycle Bin ({deletedItems.length})
                </button>
              </>
            )}
          </>
        }
      />

      {!recycleBinOpen && (
        <>
          <DataTable
            columns={columns}
            actions={{
              header: "",
              width: "340px",
              render: (row) => (
                <div className="inline-flex items-center gap-2 justify-end w-full" onClick={(event) => event.stopPropagation()}>
                  <button onClick={() => void pin(row)} className={`${tableActionButtonClasses("neutral")} whitespace-nowrap`} title="Pin a filter that shows only items with this tag to your menu">
                    <Pin size={13} />
                    Pin tag filter
                  </button>
                  <button onClick={() => openEdit(row)} className={tableActionButtonClasses("neutral")}>
                    <Edit3 size={13} />
                    Edit
                  </button>
                  <DeleteActionButton onClick={() => setDeleteTarget(row)} />
                </div>
              ),
            }}
            rows={rows}
            keyField="id"
            emptyMessage={emptyMessage}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => handleSort(key as TagSortKey)}
            onRowClick={(row) => navigate({ pathname: "/items", search: new URLSearchParams({ tag: row.name }).toString() })}
          />
          {!loadError && (
            <p className="text-xs text-neutral-600 text-right">
              {loading ? "Loading…" : `${rows.length} tag${rows.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </>
      )}

      {recycleBinOpen && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-100">Recycle Bin</h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-neutral-500">
                {filteredDeleted.length} item{filteredDeleted.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => setEmptyBinOpen(true)}
                disabled={deletedItems.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed text-xs"
              >
                Empty
              </button>
            </div>
          </div>
          {deletedLoadError ? (
            <p className="text-sm text-red-400">{deletedLoadError}</p>
          ) : (
            <DataTable columns={recycleBinColumns} rows={filteredDeleted} keyField="id" emptyMessage="Recycle bin is empty." />
          )}
        </section>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit tag" : "Add tag"}
            className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-4"
          >
            <h3 className="text-sm font-semibold text-neutral-100">{editingId ? "Edit Tag" : "Add Tag"}</h3>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Cables"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Description</span>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Optional description"
              />
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-500 shrink-0">Icon</span>
              <IconColorPicker
                title={form.name}
                value={form.icon}
                onChange={(name) => setForm((f) => ({ ...f, icon: name }))}
                color={form.color}
                onColorChange={(hex) => setForm((f) => ({ ...f, color: hex }))}
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <div className="flex items-center justify-end gap-2">
              <button onClick={closeForm} disabled={saving} className={`${outlinedActionButtonClasses("neutral")} gap-1 px-3 py-1.5 text-sm font-medium`}>
                Cancel
              </button>
              <button onClick={() => void saveForm()} disabled={saving} className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}>
                <Save size={14} />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Tag"
        message={
          <>
            Delete tag <span className="font-medium text-neutral-100">{deleteTarget?.name || ""}</span>?{" "}
            {tagDeleteSummary(deleteTarget?.item_count ?? 0)} The items are kept. Filters pinned for this tag are removed.
          </>
        }
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

      <DeleteConfirmDialog
        open={emptyBinOpen}
        title="Empty Recycle Bin"
        message={`Permanently delete ${deletedItems.length} ${deletedItems.length === 1 ? "item" : "items"} in the recycle bin?`}
        confirmLabel="Permanently Delete"
        deleting={emptyingBin}
        onCancel={() => setEmptyBinOpen(false)}
        onConfirm={() => void emptyRecycleBin()}
      />
    </div>
  );
}
