import { useEffect, useMemo, useState } from "react";
import { Plus, Filter } from "lucide-react";
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
}

const COLUMNS: Column<Part>[] = [
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
];

export function PartsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadParts(search);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function loadParts(query: string) {
    setLoading(true);
    setError("");
    try {
      const token = localStorage.getItem("stowge_token");
      const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const res = await fetch(`/api/parts${params}`, {
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

  const filtered = useMemo(() => parts, [parts]);

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
          onClick={() => void loadParts(search)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
        >
          <Filter size={13} />
          Refresh
        </button>
        <span className="text-xs text-neutral-600 ml-auto">
          {loading ? "Loading..." : `${filtered.length} parts`}
        </span>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      <DataTable columns={COLUMNS} rows={filtered} keyField="id" />
    </div>
  );
}
