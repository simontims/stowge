import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, MapPin, Layers } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useServerRetry } from "../lib/useServerRetry";

interface DashboardCounts {
  items: number | null;
  locations: number | null;
  collections: number | null;
}

interface StatCardProps {
  label: string;
  value: number | null;
  icon: React.ReactNode;
  onClick: () => void;
}

function StatCard({ label, value, icon, onClick }: StatCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-900/70 focus:outline-none focus:ring-2 focus:ring-neutral-600"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-400">{label}</span>
        <span className="text-neutral-500">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-neutral-100">{value ?? "--"}</p>
    </button>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<DashboardCounts>({
    items: null,
    locations: null,
    collections: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void loadCounts();
  }, []);

  useServerRetry(error, loading, () => loadCounts({ background: true }));

  async function loadCounts(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
    }

    const failures: string[] = [];

    const loadMetric = async (
      path: string,
      key: keyof DashboardCounts
    ) => {
      try {
        const data = await apiRequest<Array<unknown>>(path);
        setCounts((current) => ({ ...current, [key]: data.length }));
      } catch (err) {
        failures.push((err as Error).message || "Failed to load dashboard counts.");
      }
    };

    await Promise.all([
      loadMetric("/api/items", "items"),
      loadMetric("/api/locations", "locations"),
      loadMetric("/api/collections", "collections"),
    ]);

    setError(failures[0] || "");

    if (!background) {
      setLoading(false);
    }
  }

  const statCards = useMemo(
    () => [
      {
        label: "Total items",
        value: counts.items,
        icon: <Box size={16} />,
        onClick: () => navigate("/items"),
      },
      {
        label: "Total locations",
        value: counts.locations,
        icon: <MapPin size={16} />,
        onClick: () => navigate("/locations"),
      },
      {
        label: "Total collections",
        value: counts.collections,
        icon: <Layers size={16} />,
        onClick: () => navigate("/collections"),
      },
    ],
    [counts.collections, counts.items, counts.locations, navigate]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        description="Overview of your inventory and system state"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            onClick={card.onClick}
          />
        ))}
      </div>

      {loading && <p className="text-xs text-neutral-500">Refreshing counts...</p>}
      {!loading && error && <p className="text-xs text-neutral-500">{error}</p>}
    </div>
  );
}

