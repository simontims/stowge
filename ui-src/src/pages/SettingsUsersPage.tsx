import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
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

export function SettingsUsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [newUser, setNewUser] = useState<UserForm>(EMPTY_NEW_USER);
  const [isCreating, setIsCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<UserForm>(EMPTY_NEW_USER);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [addingOpen, setAddingOpen] = useState(false);

  const currentUserId = useMemo(() => getCurrentUserId(), []);
  const editingUser = users.find((u) => u.id === editingId) || null;

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    if (!armedDeleteId) return;
    const timeout = setTimeout(() => {
      setArmedDeleteId((current) => (current === armedDeleteId ? null : current));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [armedDeleteId]);

  async function loadUsers() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest<UserRecord[]>("/api/users");
      setUsers(data);
    } catch (err) {
      setUsers([]);
      setError((err as Error).message || "Failed to load users.");
    } finally {
      setLoading(false);
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
    setEditForm({
      email: user.email,
      firstname: user.firstname || "",
      surname: user.surname || "",
      password: "",
      role: user.role,
    });
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
      setEditingId(null);
      setEditForm(EMPTY_NEW_USER);
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
        description="Manage accounts and access for your Stowge instance."
        action={null}
      />

      {addingOpen && (
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-neutral-100">Add User</h2>
          <button
            onClick={() => { setAddingOpen(false); setNewUser(EMPTY_NEW_USER); setError(""); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
          >
            <X size={13} />
            Cancel
          </button>
        </div>

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

        <button
          onClick={() => void createUser()}
          disabled={isCreating}
          className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
        >
          <Save size={14} />
          {isCreating ? "Saving..." : "Save"}
        </button>
      </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <div className="flex justify-end">
        {!addingOpen && (
          <button
            onClick={() => setAddingOpen(true)}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            Add User
          </button>
        )}
      </div>

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
                <th className="px-4 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider">Actions</th>
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
                users.map((user) => {
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

      {editingUser && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">Edit User</h2>
            <button
              onClick={() => {
                setEditingId(null);
                setEditForm(EMPTY_NEW_USER);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              <X size={13} />
              Close
            </button>
          </div>

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

          <button
            onClick={() => void saveEdit()}
            disabled={isSavingEdit}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Save size={14} />
            {isSavingEdit ? "Saving..." : "Save Changes"}
          </button>
        </section>
      )}
    </div>
  );
}
