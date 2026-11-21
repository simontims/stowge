import { useEffect, useMemo, useState } from "react";
import { Edit3, Pin, Plus, Save } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { IconColorPicker } from "../components/ui/IconColorPicker";
import { StatusMessage } from "../components/ui/StatusMessage";
import { TablerIcon } from "../components/ui/TablerIcon";
import { outlinedActionButtonClasses, solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { TAGS_NAV_UPDATED_EVENT, USER_NAV_PREFERENCES_UPDATED_EVENT } from "../config/nav";
import { useResourceList } from "../hooks/useResourceList";
import { useTableSort } from "../hooks/useTableSort";
import { countLabel, emptyListMessage } from "../lib/listState";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { createTag, deleteTag, listTags, pinTagToMenu, updateTag } from "../lib/tags";
import type { Tag } from "../lib/types";

interface TagForm {
  name: string;
  icon: string;
  color: string;
  description: string;
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
  const navigate = useNavigate();
  const { items: tags, loading, error: loadError, load: loadAll } = useResourceList<TagRow>({
    fetcher: listTags,
    onError: "Unable to load tags right now.",
  });
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const { sortKey, sortDirection, handleSort } = useTableSort<TagSortKey>("name");

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TagForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void loadAll();
  }, []);

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

  const columns = useMemo<Column<TagRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-center gap-2 font-medium text-body">
            <TablerIcon name={row.icon} size={15} color={row.color} />
            {row.name}
          </span>
        ),
      },
      {
        key: "description",
        header: "Description",
        sortable: true,
        render: (row) => <span className="text-muted">{row.description?.trim() || "-"}</span>,
      },
      {
        key: "item_count",
        header: "Items",
        sortable: true,
        className: "w-20",
        render: (row) => (
          <span className="inline-block text-xs bg-surface-2 border border-border-strong rounded px-2 py-0.5 text-secondary">
            {row.item_count}
          </span>
        ),
      },
    ],
    [],
  );

  const emptyMessage = emptyListMessage({
    loading,
    error: loadError,
    search,
    noun: "tags",
    none: "No tags yet. Add your first one above.",
  });

  return (
    <div className="space-y-5">
      {embedded ? (
        <p className="text-sm text-subtle">Items can have one or more tags.</p>
      ) : (
        <PageHeader title="Tags" description="Items can have one or more tags." />
      )}

      <StatusMessage error={formOpen ? "" : error} notice="" />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search tags…"
        loading={loading}
        action={
          <button onClick={openAdd} className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}>
            <Plus size={14} />
            Add Tag
          </button>
        }
      />

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
        <p className="text-xs text-faint text-right">
          {countLabel(loading, rows.length, "tag")}
        </p>
      )}

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-scrim/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? "Edit tag" : "Add tag"}
            className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl p-4 space-y-4"
          >
            <h3 className="text-sm font-semibold text-heading">{editingId ? "Edit Tag" : "Add Tag"}</h3>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-subtle">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                placeholder="Cables"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-subtle">Description</span>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                placeholder="Optional description"
              />
            </label>
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-subtle shrink-0">Icon</span>
              <IconColorPicker
                title={form.name}
                value={form.icon}
                onChange={(name) => setForm((f) => ({ ...f, icon: name }))}
                color={form.color}
                onColorChange={(hex) => setForm((f) => ({ ...f, color: hex }))}
              />
            </div>
            {error && <p className="text-sm text-danger-400">{error}</p>}
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
            Delete tag <span className="font-medium text-heading">{deleteTarget?.name || ""}</span>?{" "}
            {tagDeleteSummary(deleteTarget?.item_count ?? 0)} The items are kept. Filters pinned for this tag are removed.
          </>
        }
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />

    </div>
  );
}
