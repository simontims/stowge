import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Edit3, ExternalLink, Filter, Plus, Save, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { useResourceList } from "../hooks/useResourceList";
import { useTableSort } from "../hooks/useTableSort";
import { useModalState } from "../hooks/useModalState";
import { apiRequest } from "../lib/api";

interface ApiKeyRecord {
  id: string;
  key_type: "user" | "system";
  name: string;
  key_prefix: string;
  owner_user_id: string | null;
  owner_email: string | null;
  scopes: string[];
  status: "active" | "expired" | "revoked";
  created_by_user_id: string;
  created_by_email: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revoked_by_email: string | null;
  revoked_reason: string | null;
}

interface UserRecord {
  id: string;
  email: string;
  role: "admin" | "user";
}

interface CreateApiKeyForm {
  name: string;
  keyType: "user" | "system";
  userId: string;
  expiresAtLocal: string;
  scopes: Record<string, boolean>;
}

interface EditKeyForm {
  name: string;
  expiresAtLocal: string;
  scopes: Record<string, boolean>;
}

type SortKey = "name" | "key_type" | "status" | "created_at" | "created_by_email" | "last_used_at";
type StatusFilter = "active" | "expired" | "revoked";

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "expired", label: "Expired" },
  { value: "revoked", label: "Revoked" },
];

interface ApiKeySectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

const SCOPE_OPTIONS: Array<{ key: string; label: string; description: string; availableNow: boolean }> = [
  { key: "items.read", label: "Read Items", description: "List, search, and fetch item details", availableNow: true },
  { key: "tags.read", label: "Read Tags", description: "Browse tags", availableNow: true },
  { key: "locations.read", label: "Read Locations", description: "Browse location metadata", availableNow: true },
  { key: "items.write", label: "Write Items", description: "Create and update items", availableNow: true },
  { key: "items.delete", label: "Delete Items", description: "Delete items", availableNow: true },
  { key: "tags.write", label: "Write Tags", description: "Create and update tags", availableNow: true },
  { key: "tags.delete", label: "Delete Tags", description: "Delete tags", availableNow: true },
  { key: "locations.write", label: "Write Locations", description: "Create and update locations", availableNow: true },
  { key: "locations.delete", label: "Delete Locations", description: "Delete locations", availableNow: true },
];

const READ_SCOPE_KEYS = ["items.read", "tags.read", "locations.read"];
const EXTERNAL_API_DOCS_PATH = "/external-api/docs";

const EMPTY_FORM: CreateApiKeyForm = {
  name: "",
  keyType: "system",
  userId: "",
  expiresAtLocal: "",
  scopes: SCOPE_OPTIONS.reduce<Record<string, boolean>>((acc, entry) => {
    acc[entry.key] = entry.availableNow && READ_SCOPE_KEYS.includes(entry.key);
    return acc;
  }, {}),
};

function formatDate(value: string | null): string {
  if (!value) return "-";
  const stamp = Date.parse(value);
  if (Number.isNaN(stamp)) return value;
  return new Date(stamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(row: ApiKeyRecord): string {
  if (row.status === "revoked") return "Revoked";
  if (row.status === "expired") return "Expired";
  if (!row.expires_at) return "Active";

  const expires = Date.parse(row.expires_at);
  if (Number.isNaN(expires)) return "Active";
  const days = (expires - Date.now()) / (1000 * 60 * 60 * 24);
  if (days <= 7) return "Expiring Soon";
  return "Active";
}

function statusClasses(label: string): string {
  if (label === "Revoked") return "border-danger-500/40 bg-danger-950/30 text-danger-300";
  if (label === "Expired") return "border-warning-500/40 bg-warning-950/30 text-warning-300";
  if (label === "Expiring Soon") return "border-warning-400/40 bg-warning-950/20 text-warning-200";
  return "border-success-500/40 bg-success-950/30 text-success-300";
}

function getEnabledScopes(form: CreateApiKeyForm): string[] {
  const availableNow = new Set(SCOPE_OPTIONS.filter((entry) => entry.availableNow).map((entry) => entry.key));
  return Object.entries(form.scopes)
    .filter(([scope, enabled]) => enabled && availableNow.has(scope))
    .map(([scope]) => scope);
}

function localInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T23:59:59.999`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isoToLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function getEditableScopeState(scopes: string[]): Record<string, boolean> {
  const scopeSet = new Set(scopes);
  return SCOPE_OPTIONS.reduce<Record<string, boolean>>((acc, entry) => {
    acc[entry.key] = entry.availableNow && scopeSet.has(entry.key);
    return acc;
  }, {});
}

export function SettingsApiKeysPage({ embedded, onDirtyChange, saveFnRef }: ApiKeySectionProps = {}) {
  const {
    items: apiKeys,
    loading,
    error,
    setError,
    load: loadApiKeys,
  } = useResourceList<ApiKeyRecord>({ url: "/api/api-keys", onError: "Failed to load API keys." });

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingEditId, setSavingEditId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<Record<StatusFilter, boolean>>({
    active: true,
    expired: true,
    revoked: true,
  });
  const [statusFilterMenuOpen, setStatusFilterMenuOpen] = useState(false);
  const [statusFilterMenuPosition, setStatusFilterMenuPosition] = useState<{ top: number; left: number } | null>(null);
  const [createForm, setCreateForm] = useState<CreateApiKeyForm>(EMPTY_FORM);
  const [editKeyForm, setEditKeyForm] = useState<EditKeyForm>({
    name: "",
    expiresAtLocal: "",
    scopes: { ...EMPTY_FORM.scopes },
  });
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [revealedName, setRevealedName] = useState<string>("");
  const [copyConfirmed, setCopyConfirmed] = useState(false);

  const revokeModal = useModalState<ApiKeyRecord>();
  const deleteModal = useModalState<ApiKeyRecord>();
  const editKeyModal = useModalState<ApiKeyRecord>();
  const statusFilterButtonRef = useRef<HTMLButtonElement | null>(null);
  const statusFilterMenuRef = useRef<HTMLDivElement | null>(null);
  const { sortKey, sortDirection, handleSort } = useTableSort<SortKey>("created_at", "desc");
  const selectedOwner = useMemo(
    () => users.find((user) => user.id === createForm.userId) || null,
    [users, createForm.userId]
  );
  const editHasChanges = useMemo(() => {
    const target = editKeyModal.target;
    if (!target) return false;

    const currentName = editKeyForm.name.trim();
    const originalName = target.name.trim();
    if (currentName !== originalName) return true;

    const currentExpiry = localInputToIso(editKeyForm.expiresAtLocal);
    const originalExpiry = target.expires_at;
    const normalizedCurrentExpiry = currentExpiry || null;
    const normalizedOriginalExpiry = originalExpiry || null;
    if (normalizedCurrentExpiry !== normalizedOriginalExpiry) return true;

    const currentScopes = Object.entries(editKeyForm.scopes)
      .filter(([scope, enabled]) => enabled && SCOPE_OPTIONS.some((entry) => entry.availableNow && entry.key === scope))
      .map(([scope]) => scope)
      .sort();
    const originalScopes = Object.entries(getEditableScopeState(target.scopes))
      .filter(([, enabled]) => enabled)
      .map(([scope]) => scope)
      .sort();

    if (currentScopes.length !== originalScopes.length) return true;
    return currentScopes.some((scope, index) => scope !== originalScopes[index]);
  }, [editKeyForm, editKeyModal.target]);

  useEffect(() => {
    onDirtyChange?.(false);
    if (saveFnRef) {
      saveFnRef.current = null;
    }
  }, [onDirtyChange, saveFnRef]);

  useEffect(() => {
    void loadApiKeys();
    void loadUsers();
  }, []);

  useEffect(() => {
    if (!statusFilterMenuOpen) return;

    const handleOutsidePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusFilterMenuRef.current?.contains(target)) return;
      if (statusFilterButtonRef.current?.contains(target)) return;
      setStatusFilterMenuOpen(false);
    };

    const closeMenu = () => setStatusFilterMenuOpen(false);
    window.addEventListener("mousedown", handleOutsidePointer);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("mousedown", handleOutsidePointer);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [statusFilterMenuOpen]);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const rows = await apiRequest<UserRecord[]>("/api/users");
      setUsers(rows);
    } catch (err) {
      setError((err as Error).message || "Failed to load users.");
    } finally {
      setLoadingUsers(false);
    }
  }

  const filteredKeys = useMemo(() => {
    const visibleKeys = apiKeys.filter((row) => statusFilters[row.status]);
    const term = search.trim().toLowerCase();
    if (!term) return visibleKeys;

    return visibleKeys.filter((row) => {
      const status = statusLabel(row).toLowerCase();
      const haystack = [
        row.name,
        row.key_prefix,
        row.key_type,
        row.expires_at ? formatDate(row.expires_at) : "forever",
        row.owner_email || "",
        row.created_by_email || "",
        row.scopes.join(" "),
        status,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [apiKeys, search, statusFilters]);

  const selectedStatusCount = useMemo(
    () => STATUS_FILTER_OPTIONS.filter((option) => statusFilters[option.value]).length,
    [statusFilters]
  );

  const sortedKeys = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const rows = [...filteredKeys];
    rows.sort((left, right) => {
      if (sortKey === "created_at" || sortKey === "last_used_at") {
        const leftTs = left[sortKey] ? Date.parse(left[sortKey] as string) : 0;
        const rightTs = right[sortKey] ? Date.parse(right[sortKey] as string) : 0;
        return (leftTs - rightTs) * direction;
      }
      const a = String(left[sortKey] || "").toLowerCase();
      const b = String(right[sortKey] || "").toLowerCase();
      return a.localeCompare(b) * direction;
    });
    return rows;
  }, [filteredKeys, sortDirection, sortKey]);

  const columns = useMemo<Column<ApiKeyRecord>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => <span className="text-heading">{row.name}</span>,
      },
      {
        key: "key_type",
        header: "Type",
        sortable: true,
        render: (row) => <span className="text-secondary">{row.key_type === "system" ? "System" : "User"}</span>,
      },
      {
        key: "status",
        header: (
          <span className="inline-flex items-center gap-2">
            <span>Status</span>
            <button
              ref={statusFilterButtonRef}
              type="button"
              aria-label="Filter status"
              aria-expanded={statusFilterMenuOpen}
              onClick={(e) => {
                e.stopPropagation();
                if (statusFilterMenuOpen) {
                  setStatusFilterMenuOpen(false);
                  return;
                }
                const rect = e.currentTarget.getBoundingClientRect();
                setStatusFilterMenuPosition({
                  top: rect.bottom + 6,
                  left: Math.max(8, rect.left - 8),
                });
                setStatusFilterMenuOpen(true);
              }}
              className={`inline-flex items-center justify-center rounded border px-1.5 py-0.5 ${
                selectedStatusCount === STATUS_FILTER_OPTIONS.length
                  ? "border-border-strong text-subtle hover:text-secondary"
                  : "border-success-500/70 text-success-300"
              }`}
            >
              <Filter size={12} />
            </button>
          </span>
        ),
        sortable: true,
        render: (row) => {
          const label = statusLabel(row);
          return (
            <span className={`inline-flex items-center rounded border px-2 py-0.5 text-xs ${statusClasses(label)}`}>
              {label}
            </span>
          );
        },
      },
      {
        key: "expires_at",
        header: "Validity",
        render: (row) => (
          <span className="text-secondary whitespace-nowrap">
            {row.expires_at ? formatDate(row.expires_at) : "Forever"}
          </span>
        ),
      },
      {
        key: "scopes",
        header: "Scopes",
        render: (row) => (
          <span className="text-muted text-xs whitespace-nowrap">
            {row.scopes.length === 1 ? "1 scope" : `${row.scopes.length} scopes`}
          </span>
        ),
      },
      {
        key: "created_at",
        header: "Created",
        sortable: true,
        render: (row) => <span className="text-secondary">{formatDate(row.created_at)}</span>,
      },
      {
        key: "created_by_email",
        header: "Created By",
        sortable: true,
        render: (row) => <span className="text-muted">{row.created_by_email || "unknown"}</span>,
      },
      {
        key: "last_used_at",
        header: "Last Used",
        sortable: true,
        render: (row) => <span className="text-muted">{formatDate(row.last_used_at)}</span>,
      },
    ],
    [selectedStatusCount, statusFilterMenuOpen]
  );

  const activeScopeCount = getEnabledScopes(createForm).length;

  async function createApiKey() {
    setError("");
    setNotice("");

    const name = createForm.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }

    if (createForm.keyType === "user" && !createForm.userId) {
      setError("Select an owner user for user-bound keys.");
      return;
    }

    const scopes = getEnabledScopes(createForm);
    if (scopes.length === 0) {
      setError("Select at least one permission scope.");
      return;
    }

    const expiresAt = localInputToIso(createForm.expiresAtLocal);
    if (createForm.expiresAtLocal && !expiresAt) {
      setError("Expiry must be a valid date/time.");
      return;
    }

    setCreating(true);
    try {
      const payload: Record<string, unknown> = {
        name,
        key_type: createForm.keyType,
        user_id: createForm.keyType === "user" ? createForm.userId : null,
        scopes,
      };
      if (expiresAt) {
        payload.expires_at = expiresAt;
      }

      const response = await apiRequest<{ api_key: string; record: ApiKeyRecord }>("/api/api-keys", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setRevealedKey(response.api_key);
      setRevealedName(response.record.name);
      setAddingOpen(false);
      setCreateForm(EMPTY_FORM);
      await loadApiKeys();
    } catch (err) {
      setError((err as Error).message || "Failed to create API key.");
    } finally {
      setCreating(false);
    }
  }

  async function revokeApiKey(row: ApiKeyRecord) {
    setError("");
    setNotice("");
    setRevokingId(row.id);

    try {
      await apiRequest(`/api/api-keys/${row.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: "Revoked by admin" }),
      });
      revokeModal.close();
      await loadApiKeys();
    } catch (err) {
      setError((err as Error).message || "Failed to revoke API key.");
    } finally {
      setRevokingId(null);
    }
  }

  async function deleteApiKey(row: ApiKeyRecord) {
    setError("");
    setNotice("");
    setDeletingId(row.id);

    try {
      await apiRequest(`/api/api-keys/${row.id}`, {
        method: "DELETE",
      });
      deleteModal.close();
      await loadApiKeys();
    } catch (err) {
      setError((err as Error).message || "Failed to delete API key.");
    } finally {
      setDeletingId(null);
    }
  }

  function openEditKey(row: ApiKeyRecord) {
    const nextScopes = getEditableScopeState(row.scopes);
    setEditKeyForm({
      name: row.name,
      expiresAtLocal: isoToLocalInput(row.expires_at),
      scopes: nextScopes,
    });
    editKeyModal.open(row);
  }

  async function saveEditedKey(row: ApiKeyRecord) {
    setError("");
    setNotice("");

    const name = editKeyForm.name.trim();
    if (!name) {
      setError("Name is required.");
      return;
    }

    const expiresAt = localInputToIso(editKeyForm.expiresAtLocal);
    if (editKeyForm.expiresAtLocal && !expiresAt) {
      setError("Expiry must be a valid date/time.");
      return;
    }

    const scopes = Object.entries(editKeyForm.scopes)
      .filter(([scope, enabled]) => enabled && SCOPE_OPTIONS.some((entry) => entry.availableNow && entry.key === scope))
      .map(([scope]) => scope);

    if (scopes.length === 0) {
      setError("Select at least one permission scope.");
      return;
    }

    setSavingEditId(row.id);
    try {
      const payload: Record<string, unknown> = { name, scopes };
      payload.expires_at = expiresAt || null;

      await apiRequest(`/api/api-keys/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      editKeyModal.close();
      await loadApiKeys();
    } catch (err) {
      setError((err as Error).message || "Failed to update API key.");
    } finally {
      setSavingEditId(null);
    }
  }

  async function copyRevealedKey() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopyConfirmed(true);
      window.setTimeout(() => setCopyConfirmed(false), 1000);
    } catch {
      setError("Could not copy to clipboard. Copy manually before closing.");
    }
  }

  function closeCreateForm() {
    setAddingOpen(false);
    setCreateForm(EMPTY_FORM);
    setError("");
  }

  function updateScope(scope: string, enabled: boolean) {
    setCreateForm((current) => ({
      ...current,
      scopes: {
        ...current.scopes,
        [scope]: enabled,
      },
    }));
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="System / API Keys"
          description="Manage API keys for integrations and automation"
        />
      )}

      {revealedKey && (
        <section className="rounded-lg border border-success-500/30 bg-success-950/20 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-success-200">New Key Created: {revealedName}</h2>
            <button
              onClick={() => setRevealedKey(null)}
              className="inline-flex items-center justify-center p-1.5 rounded-md border border-success-600/50 text-success-300 hover:text-success-100"
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
          <p className="text-sm text-success-100/90">
            Copy this key now; it will only be available once.
          </p>
          <div className="rounded-md border border-success-700/40 bg-canvas/70 px-3 py-2 font-mono text-xs text-success-200 break-all">
            {revealedKey}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void copyRevealedKey()}
              className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
            >
              <Copy size={14} />
              {copyConfirmed ? "Copied" : "Copy Key"}
            </button>
          </div>
        </section>
      )}

      {addingOpen && (
        <section className="rounded-lg border border-border bg-surface/40 p-4 space-y-4">
          <h2 className="text-sm font-semibold text-heading">Create API Key</h2>

          <div className="grid gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-subtle">Name</span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm((current) => ({ ...current, name: e.target.value }))}
                className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                placeholder="Key Name"
              />
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-subtle">Key Type</span>
                <select
                  value={createForm.keyType}
                  onChange={(e) => {
                    const next = e.target.value as "user" | "system";
                    setCreateForm((current) => ({
                      ...current,
                      keyType: next,
                      userId: next === "system" ? "" : current.userId,
                    }));
                  }}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                >
                  <option value="system">System (integration identity)</option>
                  <option value="user">User-bound (acts as selected user)</option>
                </select>
              </label>

              <label className="block">
                <span className="text-xs uppercase tracking-wide text-subtle">Expiry Date (optional)</span>
                <input
                  type="date"
                  value={createForm.expiresAtLocal}
                  onChange={(e) => setCreateForm((current) => ({ ...current, expiresAtLocal: e.target.value }))}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                />
              </label>
            </div>

            {createForm.keyType === "user" && (
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-subtle">Owner User</span>
                <select
                  value={createForm.userId}
                  onChange={(e) => setCreateForm((current) => ({ ...current, userId: e.target.value }))}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                >
                  <option value="">Select user...</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.email} ({user.role})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-subtle mt-1">User-bound keys represent actions as the owning user account.</p>
                {selectedOwner && (
                  <p className="text-xs text-subtle mt-1">
                    Selected owner: <span className="text-secondary">{selectedOwner.email}</span> ({selectedOwner.role})
                  </p>
                )}
              </label>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-subtle">Permissions</span>
                <span className="text-xs text-subtle">{activeScopeCount} selected</span>
              </div>
              <p className="text-xs text-subtle">These scopes map directly to the external API operations shown in the API docs.</p>
              <div className="grid gap-2 md:grid-cols-2">
                {SCOPE_OPTIONS.map((entry) => {
                  const checked = Boolean(createForm.scopes[entry.key]);
                  const disabled = !entry.availableNow;
                  return (
                    <label
                      key={entry.key}
                      className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                        disabled
                          ? "border-border-faint bg-canvas/30 opacity-70"
                          : "border-border bg-canvas/60"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => updateScope(entry.key, e.target.checked)}
                        disabled={disabled}
                        className="mt-0.5 h-4 w-4 rounded border-border-hover bg-surface text-success-500"
                      />
                      <span className="space-y-0.5">
                        <span className="block text-sm text-body">
                          {entry.label}
                          {!entry.availableNow && <span className="ml-2 text-xs text-subtle">Coming soon</span>}
                        </span>
                        <span className="block text-xs text-subtle">{entry.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => void createApiKey()}
              disabled={creating}
              className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
            >
              <Save size={14} />
              {creating ? "Creating..." : "Create Key"}
            </button>
            <button
              onClick={closeCreateForm}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-strong text-secondary hover:text-heading hover:border-border-hover text-sm font-medium"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <StatusMessage error={error} notice={notice} />

      <ListToolbar
        search={search}
        onSearchChange={setSearch}
        placeholder="Search API keys..."
        loading={loading || loadingUsers}
        action={
          <div className="flex-1 inline-flex items-center gap-2">
            <button
              onClick={() => setAddingOpen(true)}
              className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
            >
              <Plus size={14} />
              Add Key
            </button>
            <a
              href={EXTERNAL_API_DOCS_PATH}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted hover:text-heading hover:underline underline-offset-2"
            >
              API Docs
              <ExternalLink size={13} />
            </a>
          </div>
        }
      />

      {statusFilterMenuOpen && statusFilterMenuPosition && (
        <div
          ref={statusFilterMenuRef}
          className="fixed z-50 min-w-40 rounded-md border border-border-strong bg-surface shadow-xl normal-case tracking-normal"
          style={{ top: statusFilterMenuPosition.top, left: statusFilterMenuPosition.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-2.5 py-1.5 text-[11px] uppercase tracking-wide text-subtle border-b border-border">
            Status
          </div>
          {STATUS_FILTER_OPTIONS.map((option) => {
            const checked = statusFilters[option.value];
            return (
              <label
                key={option.value}
                className="w-full inline-flex items-center gap-2 px-2.5 py-1.5 text-left text-xs text-secondary hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const nextChecked = e.target.checked;
                    setStatusFilters((current) => ({
                      ...current,
                      [option.value]: nextChecked,
                    }));
                  }}
                  className="h-3.5 w-3.5 rounded border-border-hover bg-surface text-success-500"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      )}

      <DataTable
        columns={columns}
        actions={{
          header: "",
          render: (row) => {
            const isRevoked = row.status === "revoked";
            const revoking = revokingId === row.id;
            const deleting = deletingId === row.id;
            return (
              <div className="inline-flex items-center gap-2">
                <button
                  onClick={() => {
                    if (isRevoked || revoking || deleting) return;
                    openEditKey(row);
                  }}
                  disabled={isRevoked || revoking || deleting}
                  title={isRevoked ? "Revoked keys cannot be edited" : "Edit key"}
                  className={tableActionButtonClasses("neutral")}
                >
                  <Edit3 size={13} />
                  Edit
                </button>
                {isRevoked ? (
                  <button
                    onClick={() => {
                      if (deleting) return;
                      deleteModal.open(row);
                    }}
                    disabled={deleting}
                    title="Delete key"
                    className={tableActionButtonClasses("danger-hover")}
                  >
                    <Trash2 size={13} />
                    {deleting ? "Deleting..." : "Delete"}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (revoking || deleting) return;
                      revokeModal.open(row);
                    }}
                    disabled={revoking || deleting}
                    title="Revoke key"
                    className={tableActionButtonClasses("danger-hover")}
                  >
                    <Trash2 size={13} />
                    {revoking ? "Revoking..." : "Revoke"}
                  </button>
                )}
              </div>
            );
          },
        }}
        rows={sortedKeys}
        keyField="id"
        emptyMessage={error || (loading ? "Loading API keys..." : "No API keys found.")}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={(key) => handleSort(key as SortKey)}
        footer={sortedKeys.length > 0 && (
          <tr>
            <td colSpan={9} className="px-4 py-2.5 text-right text-xs text-faint">
              {loading ? "Loading…" : `${sortedKeys.length} key${sortedKeys.length !== 1 ? "s" : ""}`}
            </td>
          </tr>
        )}
      />

      {revokeModal.target && (
        <div className="fixed inset-0 z-50 bg-scrim/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-heading">Revoke API Key</h3>
              <button
                onClick={revokeModal.close}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border-strong text-muted hover:text-heading hover:border-border-hover"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <p className="text-sm text-secondary">
              Revoke <span className="font-medium text-heading">{revokeModal.target.name}</span>?
            </p>
            <p className="text-xs text-subtle">This takes effect immediately. The key record is preserved for history.</p>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={revokeModal.close}
                disabled={revokingId === revokeModal.target.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border-strong text-secondary hover:text-heading hover:border-border-hover disabled:bg-transparent disabled:text-disabled-fg disabled:cursor-not-allowed disabled:border-disabled-border"
              >
                Cancel
              </button>
              <button
                onClick={() => void revokeApiKey(revokeModal.target!)}
                disabled={revokingId === revokeModal.target.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-danger-500/70 text-danger-300 bg-danger-950/30 hover:text-danger-200 hover:bg-danger-900/30 disabled:bg-transparent disabled:text-disabled-fg disabled:cursor-not-allowed disabled:border-disabled-border"
              >
                <Trash2 size={13} />
                {revokingId === revokeModal.target.id ? "Revoking..." : "Confirm Revoke"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModal.target && (
        <div className="fixed inset-0 z-50 bg-scrim/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-border bg-surface shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-heading">Delete Revoked API Key</h3>
              <button
                onClick={deleteModal.close}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border-strong text-muted hover:text-heading hover:border-border-hover"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <p className="text-sm text-secondary">
              Permanently delete <span className="font-medium text-heading">{deleteModal.target.name}</span>?
            </p>
            <p className="text-xs text-subtle">This removes the key record from history and cannot be undone.</p>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={deleteModal.close}
                disabled={deletingId === deleteModal.target.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border-strong text-secondary hover:text-heading hover:border-border-hover disabled:bg-transparent disabled:text-disabled-fg disabled:cursor-not-allowed disabled:border-disabled-border"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteApiKey(deleteModal.target!)}
                disabled={deletingId === deleteModal.target.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-danger-500/70 text-danger-300 bg-danger-950/30 hover:text-danger-200 hover:bg-danger-900/30 disabled:bg-transparent disabled:text-disabled-fg disabled:cursor-not-allowed disabled:border-disabled-border"
              >
                <Trash2 size={13} />
                {deletingId === deleteModal.target.id ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editKeyModal.target && (
        <div className="fixed inset-0 z-50 bg-scrim/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-heading">Edit API Key</h3>
              <button
                onClick={editKeyModal.close}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-border-strong text-muted hover:text-heading hover:border-border-hover"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-subtle">Name</span>
                <input
                  value={editKeyForm.name}
                  onChange={(e) => setEditKeyForm((current) => ({ ...current, name: e.target.value }))}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-subtle">Expiry Date (optional)</span>
                <input
                  type="date"
                  value={editKeyForm.expiresAtLocal}
                  onChange={(e) => setEditKeyForm((current) => ({ ...current, expiresAtLocal: e.target.value }))}
                  className="mt-1 w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                />
              </label>
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              {SCOPE_OPTIONS.map((entry) => {
                const checked = Boolean(editKeyForm.scopes[entry.key]);
                const disabled = !entry.availableNow;
                return (
                  <label
                    key={`edit-${entry.key}`}
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 ${
                      disabled
                        ? "border-border-faint bg-canvas/30 opacity-70"
                        : "border-border bg-canvas/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setEditKeyForm((current) => ({
                          ...current,
                          scopes: {
                            ...current.scopes,
                            [entry.key]: e.target.checked,
                          },
                        }))
                      }
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 rounded border-border-hover bg-surface text-success-500"
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm text-body">
                        {entry.label}
                        {!entry.availableNow && <span className="ml-2 text-xs text-subtle">Coming soon</span>}
                      </span>
                      <span className="block text-xs text-subtle">{entry.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={editKeyModal.close}
                disabled={savingEditId === editKeyModal.target.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border-strong text-sm font-medium text-secondary hover:text-heading hover:border-border-hover disabled:bg-transparent disabled:text-disabled-fg disabled:cursor-not-allowed disabled:border-disabled-border"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveEditedKey(editKeyModal.target!)}
                disabled={savingEditId === editKeyModal.target.id || !editHasChanges}
                className={`${solidActionButtonClasses("positive")} px-2.5 py-1.5`}
              >
                <Save size={13} />
                {savingEditId === editKeyModal.target.id ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
