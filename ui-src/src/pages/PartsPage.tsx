import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable, type Column } from "../components/ui/DataTable";

interface Part {
  id: string;
  name: string;
  category: string | null;
  status: string;
  created_at: string;
  thumb: string | null;
  actions?: never;
}

function TrashCanIcon({ lidOpen }: { lidOpen: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
      <g
        className={[
          "transition-transform duration-200",
          lidOpen ? "-translate-y-0.5 -rotate-12" : "",
        ].join(" ")}
        style={{ transformOrigin: "9px 7px" }}
      >
        <path d="M8 6h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M10 4h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </g>
      <path
        d="M8 8.5h8l-.6 9a2 2 0 0 1-2 1.9h-2.8a2 2 0 0 1-2-1.9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.8 11v5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M13.2 11v5.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function PartsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    void loadParts();
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("stowge_token");
    if (!token) return;

    const source = new EventSource(
      `/api/events/parts?token=${encodeURIComponent(token)}`
    );

    const onPartsChanged = () => {
      void loadParts();
    };

    source.addEventListener("parts_changed", onPartsChanged);
    source.onerror = () => {
      // Keep page usable if stream is unavailable; manual refresh still works.
    };

    return () => {
      source.removeEventListener("parts_changed", onPartsChanged);
      source.close();
    };
  }, []);

  useEffect(() => {
    if (!armedDeleteId) return;
    const timeout = setTimeout(() => {
      setArmedDeleteId((current) => (current === armedDeleteId ? null : current));
    }, 3000);
    return () => clearTimeout(timeout);
  }, [armedDeleteId]);

  async function loadParts() {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("stowge_token");
      const res = await fetch("/api/parts", {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : [];
      if (!res.ok) {
        const detail =
          typeof data === "object" && data && "detail" in data
            ? String((data as { detail: unknown }).detail)
            : `HTTP ${res.status}`;
        throw new Error(detail);
      }
      setParts(Array.isArray(data) ? (data as Part[]) : []);
    } catch (err) {
      setError((err as Error).message || "Failed to load parts.");
      setParts([]);
    } finally {
      setLoading(false);
    }
  }

  async function deletePart(partId: string) {
    setDeleteError("");
    setDeletingId(partId);

    try {
      const token = localStorage.getItem("stowge_token");
      const res = await fetch(`/api/parts/${partId}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const text = await res.text();
      const data = text ? (JSON.parse(text) as unknown) : null;

      if (!res.ok) {
        const detail =
          typeof data === "object" && data && "detail" in data
            ? String((data as { detail: unknown }).detail)
            : `HTTP ${res.status}`;
        throw new Error(detail);
      }

      setParts((current) => current.filter((part) => part.id !== partId));
      setArmedDeleteId((current) => (current === partId ? null : current));
    } catch (err) {
      setDeleteError((err as Error).message || "Failed to delete part.");
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return parts;

    return parts.filter((part) => {
      const name = part.name.toLowerCase();
      const category = (part.category || "").toLowerCase();
      const status = part.status.toLowerCase();
      return (
        name.includes(term) ||
        category.includes(term) ||
        status.includes(term)
      );
    });
  }, [parts, search]);

  const columns = useMemo<Column<Part>[]>(
    () => [
      {
        key: "thumb",
        header: "Image",
        className: "w-20",
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
        render: (row) => (
          <span className="font-medium text-neutral-200">{row.name}</span>
        ),
      },
      {
        key: "category",
        header: "Category",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.category || "-"}
          </span>
        ),
      },
      {
        key: "status",
        header: "Status",
        render: (row) => (
          <span className="inline-block text-xs bg-neutral-800 border border-neutral-700 rounded px-2 py-0.5 text-neutral-400">
            {row.status}
          </span>
        ),
      },
      {
        key: "actions",
        header: "ACTIONS",
        className: "w-20 text-center",
        headerClassName: "w-20 text-center",
        render: (row) => {
          const isArmed = armedDeleteId === row.id;
          const isDeleting = deletingId === row.id;
          return (
            <button
              onClick={() => {
                if (isDeleting) return;
                if (!isArmed) {
                  setArmedDeleteId(row.id);
                  return;
                }
                void deletePart(row.id);
              }}
              className={[
                "inline-flex items-center justify-center w-10 h-10 rounded-md border transition-colors",
                isArmed
                  ? "border-red-500/70 text-red-300 bg-red-950/30"
                  : "border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70",
                isDeleting ? "opacity-60 cursor-not-allowed" : "",
              ].join(" ")}
              aria-label={
                isArmed
                  ? `Confirm delete ${row.name}`
                  : `Delete ${row.name}`
              }
              title={
                isArmed
                  ? "Click again to delete permanently"
                  : "Click to arm delete"
              }
            >
              <TrashCanIcon lidOpen={isArmed} />
            </button>
          );
        },
      },
    ],
    [armedDeleteId, deletingId]
  );

  return (
    <div>
      <PageHeader
        title="Parts"
        description="Browse and manage your parts inventory"
        action={
          <button
            onClick={() => navigate("/scan")}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            Add Part
          </button>
        }
      />

      {/* Filter row */}
      <div className="flex items-center gap-2 mb-4">
        <SearchInput
          placeholder="Search parts, locations, categories…"
          value={search}
          onChange={setSearch}
          className="flex-1 max-w-sm"
        />
        <button
          onClick={() => void loadParts()}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
        <span className="text-xs text-neutral-600 ml-auto">
          {loading ? "Loading..." : `${filtered.length} parts`}
        </span>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
      {deleteError && <p className="text-sm text-red-400 mb-3">{deleteError}</p>}

      <DataTable columns={columns} rows={filtered} keyField="id" />
    </div>
  );
}
