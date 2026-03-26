import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { UnsavedChangesDialog } from "../components/ui/UnsavedChangesDialog";
import { apiRequest, getCurrentUserId } from "../lib/api";

interface UserRecord {
  id: string;
  email: string;
  firstname: string;
  surname: string;
  role: "admin" | "user";
  created_at: string | null;
  last_login_at: string | null;
}

interface UserForm {
  email: string;
  firstname: string;
  surname: string;
  password: string;
  role: "admin" | "user";
}

const EMPTY_NEW_USER: UserForm = {
  email: "",
  firstname: "",
  surname: "",
  password: "",
  role: "user",
};

const RETRY_DELAY_MS = 5000;

export function SettingsUsersPage() {
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

  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const currentUserId = useMemo(() => getCurrentUserId(), []);
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
        (u.surname || "").toLowerCase().includes(term) ||
        u.role.toLowerCase().includes(term)
    );
  }, [users, search]);

  const isEditDirty = useMemo(
    () =>
      editForm.email !== initialEditForm.email ||
      editForm.firstname !== initialEditForm.firstname ||
      editForm.surname !== initialEditForm.surname ||
      editForm.password !== "" ||
      editForm.role !== initialEditForm.role,
    [editForm, initialEditForm]
  );

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    if (loading || !error) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void loadUsers({ background: true });
    }, RETRY_DELAY_MS);

    return () => window.clearTimeout(retryTimer);
  }, [error, loading]);

  useEffect(() => {
    if (!armedDeleteId) return;
    const timeout = setTimeout(() => {
      setArmedDeleteId((current) => (current === armedDeleteId ? null : current));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [armedDeleteId]);

  useEffect(() => {
    if (!editingId || !isEditDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [editingId, isEditDirty]);

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
    if (newUser.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsCreating(true);
    try {
      await apiRequest("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: newUser.email.trim(),
          firstname: newUser.firstname.trim(),
          surname: newUser.surname.trim(),
          password: newUser.password,
          role: newUser.role,
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
      surname: user.surname || "",
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

  function requestCancelEdit() {
    if (isEditDirty) {
      setUnsavedPromptOpen(true);
      return;
    }
    closeEditNow();
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
    if (editForm.password && editForm.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSavingEdit(true);
    try {
      await apiRequest(`/api/users/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          email: editForm.email.trim(),
          firstname: editForm.firstname.trim(),
          surname: editForm.surname.trim(),
          role: editForm.role,
          password: editForm.password || undefined,
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
      setArmedDeleteId(null);
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
      <PageHeader
        title="Settings / Users"
        description="Manage accounts and access for your Stowge instance"
        action={
          showListView ? (
            <button
              onClick={() => setAddingOpen(true)}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              <Plus size={14} />
              Add User
            </button>
          ) : null
        }
      />

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Add User</h2>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Role</span>
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser((v) => ({ ...v, role: e.target.value as "admin" | "user" }))
                }
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Firstname</span>
              <input
                value={newUser.firstname}
                onChange={(e) => setNewUser((v) => ({ ...v, firstname: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Surname</span>
              <input
                value={newUser.surname}
                onChange={(e) => setNewUser((v) => ({ ...v, surname: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block sm:col-span-2">
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((v) => ({ ...v, email: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Role</span>
              <select
                value={editForm.role}
                onChange={(e) =>
                  setEditForm((v) => ({ ...v, role: e.target.value as "admin" | "user" }))
                }
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Firstname</span>
              <input
                value={editForm.firstname}
                onChange={(e) => setEditForm((v) => ({ ...v, firstname: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Surname</span>
              <input
                value={editForm.surname}
                onChange={(e) => setEditForm((v) => ({ ...v, surname: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">New Password (optional)</span>
              <input
                type="password"
                value={editForm.password}
                onChange={(e) => setEditForm((v) => ({ ...v, password: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={requestCancelEdit}
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

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {showListView && (
        <ListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search users…"
          count={filteredUsers.length}
          countLabel="users"
          loading={loading}
        />
      )}

      {showListView && (
        <section className="rounded-lg border border-neutral-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-neutral-900 border-b border-neutral-800">
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Email</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Firstname</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Surname</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Role</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Last Login</th>
                  <th className="px-4 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="bg-neutral-950 divide-y divide-neutral-800/70">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-neutral-600">
                      {loading ? "Loading users..." : "No users found."}
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user) => {
                    const isCurrentUser = user.id === currentUserId;
                    const isArmed = armedDeleteId === user.id;
                    const isDeleting = deletingId === user.id;

                    return (
                      <tr key={user.id} className="hover:bg-neutral-900/60 transition-colors">
                        <td className="px-4 py-2.5 text-neutral-200">{user.email}</td>
                        <td className="px-4 py-2.5 text-neutral-300">{user.firstname || "-"}</td>
                        <td className="px-4 py-2.5 text-neutral-300">{user.surname || "-"}</td>
                        <td className="px-4 py-2.5 text-neutral-300">{user.role}</td>
                        <td className="px-4 py-2.5 text-neutral-500">
                          {user.last_login_at
                            ? new Date(user.last_login_at).toLocaleString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "never"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => startEdit(user)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                            >
                              <Edit3 size={13} />
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                if (isDeleting) return;
                                if (isCurrentUser) {
                                  setError("You cannot delete your own account.");
                                  return;
                                }
                                if (!isArmed) {
                                  setArmedDeleteId(user.id);
                                  return;
                                }
                                void deleteUser(user);
                              }}
                              disabled={isDeleting}
                              className={[
                                "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border transition-colors",
                                isCurrentUser
                                  ? "border-neutral-800 text-neutral-600 cursor-not-allowed"
                                  : isArmed
                                    ? "border-red-500/70 text-red-300 bg-red-950/30"
                                    : "border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70",
                                isDeleting ? "opacity-60 cursor-not-allowed" : "",
                              ].join(" ")}
                              title={
                                isCurrentUser
                                  ? "You cannot delete your own account"
                                  : isArmed
                                    ? "Click again to confirm delete"
                                    : "Click to arm delete"
                              }
                            >
                              <Trash2 size={13} />
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <UnsavedChangesDialog
        open={unsavedPromptOpen}
        message="You have unsaved changes. Do you want to save before leaving this user?"
        saving={isSavingEdit}
        onCancel={() => setUnsavedPromptOpen(false)}
        onDiscard={handleUnsavedDiscard}
        onSave={() => void handleUnsavedSave()}
      />
    </div>
  );
}
