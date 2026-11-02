import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { DeleteActionButton, DeleteConfirmDialog } from "../components/ui/DeleteControls";
import { outlinedActionButtonClasses, solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { createHint, deleteHint, listHints, updateHint } from "../lib/tags";
import type { AiHint } from "../lib/types";

type HintRow = AiHint & { actions?: never };

interface HintForm {
  name: string;
  text: string;
}

const EMPTY_FORM: HintForm = { name: "", text: "" };

/** AI hints: named text sent to the AI with each photo. Pick one on the Add screen. */
export function SettingsHintsPage() {
  const [hints, setHints] = useState<HintRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AiHint | null>(null);
  const [form, setForm] = useState<HintForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AiHint | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      setHints(await listHints());
    } catch (err) {
      setHints([]);
      setLoadError((err as Error).message || "Unable to load AI hints right now.");
    } finally {
      setLoading(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  }

  function openEdit(hint: AiHint) {
    setEditing(hint);
    setForm({ name: hint.name, text: hint.text });
    setFormError("");
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
  }

  async function save() {
    setFormError("");
    const isDefault = Boolean(editing?.is_default);
    if (!isDefault && form.name.trim().length < MIN_NAME_LENGTH) {
      setFormError(minimumLengthMessage("Hint name"));
      return;
    }
    setSaving(true);
    try {
      if (editing && isDefault) {
        await updateHint(editing.id, { text: form.text });
      } else if (editing) {
        await updateHint(editing.id, { name: form.name.trim(), text: form.text });
      } else {
        await createHint({ name: form.name.trim(), text: form.text });
      }
      closeForm();
      await load();
    } catch (err) {
      setFormError((err as Error).message || "Failed to save hint.");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteHint(deleteTarget.id);
      toast.success("Hint deleted", { description: deleteTarget.name });
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error((err as Error).message || "Failed to delete hint.");
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  }

  // The server returns the Default first, then by name; keep that order.
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return hints;
    return hints.filter((h) => h.name.toLowerCase().includes(term) || h.text.toLowerCase().includes(term));
  }, [hints, search]);

  const columns = useMemo<Column<HintRow>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        width: "14rem",
        render: (row) => (
          <span className="inline-flex items-center gap-2 font-medium text-neutral-200">
            {row.name}
            {row.is_default && (
              <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-neutral-500">
                Default
              </span>
            )}
          </span>
        ),
      },
      {
        key: "text",
        header: "Text",
        render: (row) => (
          <span className="block max-w-xl truncate text-neutral-400">{row.text.trim() || "(empty: nothing is sent)"}</span>
        ),
      },
    ],
    [],
  );

  const emptyMessage = loading ? "Loading AI hints..." : loadError || (search.trim() ? "No hints match your search." : "No hints yet.");

  return (
    <div className="space-y-5">
      <p className="text-sm text-neutral-500">Sent to the AI with each photo. Pick one on the Add screen.</p>

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search hints..."
        loading={loading}
        action={
          <button type="button" onClick={openAdd} className={`${solidActionButtonClasses("brand")} px-3 py-1.5`}>
            <Plus size={14} />
            Add Hint
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
              <button type="button" onClick={() => openEdit(row)} className={tableActionButtonClasses("neutral")}>
                <Edit3 size={13} />
                Edit
              </button>
              {!row.is_default && <DeleteActionButton onClick={() => setDeleteTarget(row)} />}
            </div>
          ),
        }}
        rows={rows}
        keyField="id"
        emptyMessage={emptyMessage}
      />

      {formOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editing ? "Edit hint" : "Add hint"}
            className="w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-4"
          >
            <h3 className="text-sm font-semibold text-neutral-100">{editing ? "Edit Hint" : "Add Hint"}</h3>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                disabled={Boolean(editing?.is_default)}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 disabled:opacity-60"
                placeholder="Electronic parts"
              />
              {editing?.is_default && <span className="mt-1 block text-xs text-neutral-600">The Default hint cannot be renamed or deleted.</span>}
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Text</span>
              <textarea
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 min-h-[160px]"
                placeholder="What the AI should know about these items…"
              />
            </label>
            {formError && <p className="text-sm text-red-400">{formError}</p>}
            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={closeForm} disabled={saving} className={`${outlinedActionButtonClasses("neutral")} gap-1 px-3 py-1.5 text-sm font-medium`}>
                Cancel
              </button>
              <button type="button" onClick={() => void save()} disabled={saving} className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}>
                <Save size={14} />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Hint"
        message={
          <>
            Delete hint <span className="font-medium text-neutral-100">{deleteTarget?.name || ""}</span>? Anyone who had it
            selected on the Add screen goes back to Default.
          </>
        }
        deleting={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
