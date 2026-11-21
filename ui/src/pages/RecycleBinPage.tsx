import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { StatusMessage } from "../components/ui/StatusMessage";
import { TagChips } from "../components/ui/TagChips";
import { apiRequest } from "../lib/api";
import type { ItemTag } from "../lib/types";

interface DeletedItemRow {
  id: string;
  name: string;
  tags: ItemTag[];
  location: string | null;
  actions?: never;
}

/** Every deleted item, for all tags and locations. Restore opens the item with the restore pending;
 *  Empty removes them for good. */
export function RecycleBinPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DeletedItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [emptyOpen, setEmptyOpen] = useState(false);
  const [emptying, setEmptying] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setItems((await apiRequest<DeletedItemRow[]>("/api/items/deleted")) || []);
      setLoadError("");
    } catch (err) {
      setItems([]);
      setLoadError((err as Error).message || "Unable to load the recycle bin.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function emptyBin() {
    setEmptying(true);
    try {
      await apiRequest<{ deleted: number }>("/api/items/deleted/purge", { method: "POST" });
      setEmptyOpen(false);
      await load();
    } catch (err) {
      setError((err as Error).message || "Failed to empty the recycle bin.");
      setEmptyOpen(false);
    } finally {
      setEmptying(false);
    }
  }

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(term) ||
        (item.location || "").toLowerCase().includes(term) ||
        (item.tags || []).some((t) => t.name.toLowerCase().includes(term)),
    );
  }, [items, search]);

  const columns = useMemo<Column<DeletedItemRow>[]>(
    () => [
      { key: "name", header: "Name", render: (row) => <span className="font-medium text-body">{row.name}</span> },
      { key: "tags", header: "Tags", render: (row) => <TagChips tags={row.tags} emptyLabel="-" /> },
      { key: "location", header: "Location", render: (row) => <span className="text-muted">{row.location || "-"}</span> },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-28 text-right",
        headerClassName: "w-28 text-right",
        render: (row) => (
          <div className="inline-flex items-center gap-2 justify-end w-full" onClick={(event) => event.stopPropagation()}>
            <button
              onClick={() => navigate(`/items/${row.id}/edit`, { state: { restoreOnSave: true, returnToRecycleBin: true } })}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-success-500/70 bg-success-950/30 text-success-300 hover:text-success-200 hover:bg-success-900/30 text-xs"
            >
              Restore
            </button>
          </div>
        ),
      },
    ],
    [navigate],
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Recycle Bin" description="Deleted items from every tag and location. Restore one, or empty the bin to delete them for good." />

      <StatusMessage error={error} notice="" />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search recycle bin…"
        loading={loading}
        count={rows.length}
        action={
          <button
                onClick={() => setEmptyOpen(true)}
                disabled={items.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-danger-500/70 text-danger-300 bg-danger-950/30 hover:text-danger-200 hover:bg-danger-900/30 disabled:bg-transparent disabled:text-disabled-fg disabled:border-disabled-border disabled:cursor-not-allowed text-xs"
              >
                Empty
              </button>
        }
      />

      {loadError ? (
        <p className="text-sm text-danger-400">{loadError}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          keyField="id"
          emptyMessage={loading ? "Loading..." : search.trim() ? "No deleted items match your search." : "Recycle bin is empty."}
        />
      )}

      <DeleteConfirmDialog
        open={emptyOpen}
        title="Empty Recycle Bin"
        message={`Permanently delete ${items.length} ${items.length === 1 ? "item" : "items"} in the recycle bin?`}
        confirmLabel="Permanently Delete"
        deleting={emptying}
        onCancel={() => setEmptyOpen(false)}
        onConfirm={() => void emptyBin()}
      />
    </div>
  );
}
