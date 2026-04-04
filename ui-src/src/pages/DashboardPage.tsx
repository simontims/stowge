import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";

interface CollectionStatusRow {
  id: string;
  name: string;
  item_count: number;
  asset_count: number;
  disk_bytes: number;
}

interface StatusMetrics {
  server: "ok";
  collections: CollectionStatusRow[];
  totals: {
    item_count: number;
    asset_count: number;
    disk_bytes: number;
  };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function DashboardPage() {
  const [metrics, setMetrics] = useState<StatusMetrics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;

    async function loadMetrics() {
      setMetricsLoading(true);
      try {
        const data = await apiRequest<StatusMetrics>("/api/status/collections");
        if (!cancelled) {
          setMetrics(data);
          setLoadError("");
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as Error).message || "Failed to load collection metrics.");
        }
      } finally {
        if (!cancelled) {
          setMetricsLoading(false);
        }
      }
    }

    void loadMetrics();

    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => metrics?.collections ?? [], [metrics]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        description="Collection storage metrics"
      />

      {loadError && !metricsLoading && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/40">
        <table className="min-w-full divide-y divide-neutral-800 text-sm">
          <thead className="bg-neutral-950/50">
            <tr className="text-left text-neutral-400">
              <th className="px-4 py-3 font-medium">Collection</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Assets (photos)</th>
              <th className="px-4 py-3 font-medium">Disk space</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {rows.map((row) => (
              <tr key={row.id} className="text-neutral-200">
                <td className="px-4 py-3">{row.name}</td>
                <td className="px-4 py-3 tabular-nums">{row.item_count}</td>
                <td className="px-4 py-3 tabular-nums">{row.asset_count}</td>
                <td className="px-4 py-3 tabular-nums">{formatBytes(row.disk_bytes)}</td>
              </tr>
            ))}
            {!metricsLoading && rows.length === 0 && !loadError && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  No collections found.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="bg-neutral-950/50 text-neutral-100">
            <tr>
              <td className="px-4 py-3 font-semibold">Total</td>
              <td className="px-4 py-3 font-semibold tabular-nums">{metrics?.totals.item_count ?? "--"}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">{metrics?.totals.asset_count ?? "--"}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">
                {metrics ? formatBytes(metrics.totals.disk_bytes) : "--"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {metricsLoading && <p className="text-xs text-neutral-500">Loading collection metrics…</p>}
    </div>
  );
}

