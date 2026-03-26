import { useEffect, useMemo, useState } from "react";
import { Box, MapPin, Layers } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";

interface DashboardCounts {
  items: number | null;
  locations: number | null;
  collections: number | null;
}

interface StatCardProps {
  label: string;
  value: number | null;
  icon: React.ReactNode;
}

function StatCard({ label, value, icon }: StatCardProps) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-neutral-400">{label}</span>
        <span className="text-neutral-500">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-neutral-100">{value ?? "--"}</p>
    </section>
  );
}

export function DashboardPage() {
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

  async function loadCounts() {
    setError("");

    let pending = 3;
    const finishOne = () => {
      pending -= 1;
      if (pending <= 0) {
        setLoading(false);
      }
    };

    const loadMetric = async (
      path: string,
      key: keyof DashboardCounts,
      failureMessage: string
    ) => {
      try {
        const data = await apiRequest<Array<unknown>>(path);
        setCounts((current) => ({ ...current, [key]: data.length }));
      } catch {
        setError((current) => current || failureMessage);
      } finally {
        finishOne();
      }
    };

    void loadMetric("/api/items", "items", "Failed to load item count");
    void loadMetric("/api/locations", "locations", "Failed to load location count");
    void loadMetric("/api/collections", "collections", "Failed to load collection count");
  }

  const statCards = useMemo(
    () => [
      { label: "Total items", value: counts.items, icon: <Box size={16} /> },
      { label: "Total locations", value: counts.locations, icon: <MapPin size={16} /> },
      { label: "Total collections", value: counts.collections, icon: <Layers size={16} /> },
    ],
    [counts.collections, counts.items, counts.locations]
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Overview of your inventory at a glance"
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {statCards.map((card) => (
          <StatCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
          />
        ))}
      </div>

      {loading && <p className="text-xs text-neutral-500">Refreshing counts...</p>}
      {!loading && error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

