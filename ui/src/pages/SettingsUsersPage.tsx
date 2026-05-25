import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { useTableSort } from "../hooks/useTableSort";
import { apiRequest } from "../lib/api";
import { useCurrentUser } from "../lib/UserContext";
import { useBeforeUnload } from "../lib/useBeforeUnload";

interface UserRecord {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: "admin" | "user";
  created_at: string | null;
  last_login_at: string | null;
}

interface UserForm {
  email: string;
  firstname: string;
  lastname: string;
  password: string;
  role: "admin" | "user";
}

type UserSortKey = "email" | "firstname" | "lastname" | "role" | "last_login_at";

const EMPTY_NEW_USER: UserForm = {
  email: "",
  firstname: "",
  lastname: "",
  password: "",
  role: "user",
};

interface UsersSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsUsersPage({ embedded, onDirtyChange, saveFnRef }: UsersSectionProps = {}) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [newUser, setNewUser] = useState<UserForm>(EMPTY_NEW_USER);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserForm>(EMPTY_NEW_USER);
  const [initialEditForm, setInitialEditForm] = useState<UserForm>(EMPTY_NEW_USER);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);
  const { sortKey, sortDirection, handleSort } = useTableSort<UserSortKey>("email");

  const currentUser = useCurrentUser();
  const currentUserId = currentUser.id;
  const editingUser = users.find((u) => u.id === editingId) || null;

  const showListView = !addingOpen && !editingId;

  const [search, setSearch] = useState("");


  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(term) ||
        (u.firstname || "").toLowerCase().includes(term) ||
        (u.lastname || "").toLowerCase().includes(term) ||
        u.role.toLowerCase().includes(term)
    );
  }, [users, search]);

  const sortedFilteredUsers = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const rows = [...filteredUsers];
    rows.sort((a, b) => {
      if (sortKey === "last_login_at") {
        const left = a.last_login_at ? Date.parse(a.last_login_at) : 0;
        const right = b.last_login_at ? Date.parse(b.last_login_at) : 0;
        return (left - right) * direction;
      }

      const left = (a[sortKey] || "").toLowerCase();
      const right = (b[sortKey] || "").toLowerCase();
      return left.localeCompare(right) * direction;
    });
    return rows;
  }, [filteredUsers, sortDirection, sortKey]);

  const isEditDirty = useMemo(
    () =>
      editForm.email !== initialEditForm.email ||
      editForm.firstname !== initialEditForm.firstname ||
      editForm.lastname !== initialEditForm.lastname ||
      editForm.password !== "" ||
      editForm.role !== initialEditForm.role,
    [editForm, initialEditForm]
  );
  useBeforeUnload(!embedded && Boolean(editingId) && isEditDirty);

  // Expose dirty state and save function when embedded
  useEffect(() => { onDirtyChange?.(isEditDirty); }, [isEditDirty, onDirtyChange]);
  if (saveFnRef) saveFnRef.current = isEditDirty ? saveEdit : null;

  const columns = useMemo<Column<UserRecord>[]>(
    () => [
      {
        key: "email",
        header: "Email",
        sortable: true,
        render: (row) => <span className="text-neutral-200">{row.email}</span>,
      },
      {
        key: "firstname",
        header: "Firstname",
        sortable: true,
        render: (row) => <span className="text-neutral-300">{row.firstname || "-"}</span>,
      },
      {
        key: "lastname",
        header: "Lastname",
        sortable: true,
        render: (row) => <span className="text-neutral-300">{row.lastname || "-"}</span>,
      },
      {
        key: "role",
        header: "Role",
        sortable: true,
        render: (row) => <span className="text-neutral-300">{row.role}</span>,
      },
      {
        key: "last_login_at",
        header: "Last Login",
        sortable: true,
        render: (row) => (
          <span className="text-neutral-500">
            {row.last_login_at
              ? new Date(row.last_login_at).toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "never"}
          </span>
        ),
      },
    ],
    []
  );

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
      setError("");
      setNotice("");
    }
    try {
      const data = await apiRequest<UserRecord[]>("/api/users");
      setUsers(data);
    } catch (err) {
      setUsers([]);
      setError((err as Error).message || "Failed to load users.");
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function createUser() {
    setError("");
    setNotice("");

    if (!newUser.email.trim()) {
      setError("Email is required.");
      return;
    }
    if (!newUser.password) {
      setError("Password is required.");
      return;
    }

    setIsCreating(true);
    try {
      await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUser.email.trim(),
          firstname: newUser.firstname.trim(),
          lastname: newUser.lastname.trim(),
          password: newUser.password,
        }),
      });
      setNewUser(EMPTY_NEW_USER);
      setAddingOpen(false);
      setNotice("User created.");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message || "Failed to create user.");
    } finally {
      setIsCreating(false);
    }
  }

  function startEdit(user: UserRecord) {
    setError("");
    setNotice("");
    setEditingId(user.id);
    const snapshot: UserForm = {
      email: user.email,
      firstname: user.firstname || "",
      lastname: user.lastname || "",
      password: "",
      role: user.role,
    };
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
  }

  function closeEditNow() {
    setEditingId(null);
    setEditForm(EMPTY_NEW_USER);
    setInitialEditForm(EMPTY_NEW_USER);
    setUnsavedPromptOpen(false);
  }

  async function handleUnsavedSave() {
    await saveEdit();
  }

  function handleUnsavedDiscard() {
    closeEditNow();
  }

  async function saveEdit() {
    if (!editingId) return;

    setError("");
    setNotice("");

    if (!editForm.email.trim()) {
      setError("Email is required.");
      return;
    }

    setIsSavingEdit(true);
    try {
      // Prevent self-demotion from admin to user
      if (editingId === currentUserId && initialEditForm.role === "admin" && editForm.role === "user") {
        setError("You cannot demote your own admin role.");
        setIsSavingEdit(false);
        return;
      }

      await apiRequest(`/api/users/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: editForm.email.trim(),
          firstname: editForm.firstname.trim(),
          lastname: editForm.lastname.trim(),
          password: editForm.password || undefined,
          role: editForm.role,
        }),
      });
      closeEditNow();
      setNotice("User updated.");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message || "Failed to update user.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function deleteUser(user: UserRecord) {
    setError("");
    setNotice("");

    if (user.id === currentUserId) {
      setError("You cannot delete your own account.");
      return;
    }

    setDeletingId(user.id);
    try {
      await apiRequest(`/api/users/${user.id}`, { method: "DELETE" });
      setConfirmDeleteUser(null);
      setNotice("User deleted.");
      await loadUsers();
    } catch (err) {
      setError((err as Error).message || "Failed to delete user.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="System / Users"
          description="Manage accounts and access for your Stowge instance"
        />
      )}

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Add User</h2>
          <div className="grid gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Email</span>
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="user@example.com"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Firstname</span>
                <input
                  value={newUser.firstname}
                  onChange={(e) => setNewUser((v) => ({ ...v, firstname: e.target.value }))}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Lastname</span>
                <input
                  value={newUser.lastname}
                  onChange={(e) => setNewUser((v) => ({ ...v, lastname: e.target.value }))}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Password</span>
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser((v) => ({ ...v, password: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void createUser()}
              disabled={isCreating}
              className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 rounded-md text-sm leading-none font-medium transition-colors"
            >
              <Save size={14} />
              {isCreating ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => { setAddingOpen(false); setNewUser(EMPTY_NEW_USER); setError(""); }}
              className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm leading-none font-medium"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {editingUser && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Edit User</h2>
          <p className="text-sm text-neutral-500">Editing {editingUser.email}</p>
          <div className="grid gap-3">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Firstname</span>
                <input
                  value={editForm.firstname}
                  onChange={(e) => setEditForm((v) => ({ ...v, firstname: e.target.value }))}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              </label>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-neutral-500">Lastname</span>
                <input
                  value={editForm.lastname}
                  onChange={(e) => setEditForm((v) => ({ ...v, lastname: e.target.value }))}
                  className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">New Password (optional)</span>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((v) => ({ ...v, password: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Role</span>
              <select
                value={editForm.role}
                onChange={(e) => setEditForm((v) => ({ ...v, role: e.target.value as "admin" | "user" }))}
                disabled={editingId === currentUserId && editForm.role === "admin"}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 disabled:opacity-60 disabled:cursor-not-allowed"
                title={editingId === currentUserId && editForm.role === "admin" ? "You cannot demote your own admin role" : ""}
              >
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
              {editingId === currentUserId && editForm.role === "admin" && (
                <p className="text-xs text-neutral-500 mt-1">You cannot change your own role</p>
              )}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={closeEditNow}
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
              {isSavingEdit ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </section>
      )}

      <StatusMessage error={showListView ? "" : error} notice={notice} />

      {showListView && (
        <ListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search users…"
          loading={loading}
          action={
            <button
              onClick={() => setAddingOpen(true)}
              className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
            >
              <Plus size={14} />
              Add User
            </button>
          }
        />
      )}

      {showListView && (
        <>
          <DataTable
            columns={columns}
            actions={{
              header: "",
              render: (user) => {
                const isCurrentUser = user.id === currentUserId;
                const isDeleting = deletingId === user.id;
                return (
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => startEdit(user)}
                      className={tableActionButtonClasses("neutral")}
                    >
                      <Edit3 size={13} />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (isDeleting || isCurrentUser) return;
                        setConfirmDeleteUser(user);
                      }}
                      disabled={isDeleting || isCurrentUser}
                      className={tableActionButtonClasses("danger-hover")}
                      title={isCurrentUser ? "You cannot delete your own account" : "Delete user"}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                );
              },
            }}
            rows={sortedFilteredUsers}
            keyField="id"
            emptyMessage={error || (loading ? "Loading users..." : "No users found.")}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => handleSort(key as UserSortKey)}
            footer={sortedFilteredUsers.length > 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-2.5 text-right text-xs text-neutral-600">
                  {loading ? "Loading…" : `${filteredUsers.length} user${filteredUsers.length !== 1 ? "s" : ""}`}
                </td>
              </tr>
            )}
          />
        </>
      )}

      <UnsavedChangesDialog
        open={unsavedPromptOpen}
        message="You have unsaved changes. Do you want to save before leaving this user?"
        saving={isSavingEdit}
        onCancel={() => setUnsavedPromptOpen(false)}
        onDiscard={handleUnsavedDiscard}
        onSave={() => void handleUnsavedSave()}
      />

      {confirmDeleteUser && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-neutral-100">Delete User</h3>
              <button
                onClick={() => setConfirmDeleteUser(null)}
                className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600"
                title="Close"
              >
                <X size={13} />
              </button>
            </div>

            <p className="text-sm text-neutral-300">
              Delete user <span className="font-medium text-neutral-100">{confirmDeleteUser.email}</span>?
            </p>

            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteUser(null)}
                disabled={deletingId === confirmDeleteUser.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void deleteUser(confirmDeleteUser)}
                disabled={deletingId === confirmDeleteUser.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                <Trash2 size={13} />
                {deletingId === confirmDeleteUser.id ? "Deleting..." : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
