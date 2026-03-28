import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Server } from "lucide-react";
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
  const [status, setStatus] = useState<StatusMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  const poll = useCallback(async (background: boolean) => {
    if (!background) setLoading(true);
    try {
      const data = await apiRequest<StatusMetrics>("/api/status/collections");
      if (mountedRef.current) {
        setStatus(data);
        setError("");
      }
    } catch {
      if (mountedRef.current) {
        setError("Cannot reach Stowge server.");
        console.debug("Cannot reach Stowge server.");
      }
    }
    if (!background && mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void poll(false);
    const id = window.setInterval(() => void poll(true), 5000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, [poll]);

  const rows = useMemo(() => status?.collections ?? [], [status]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Status"
        description="Server connection and collection storage metrics"
      />

      <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4">
        <div className="flex items-center gap-2 text-sm text-neutral-300">
          <Server size={16} className="text-neutral-400" />
          <span>Connection to server status:</span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs font-medium",
              error
                ? "bg-red-900/40 text-red-300 border border-red-800"
                : "bg-emerald-900/30 text-emerald-300 border border-emerald-800",
            ].join(" ")}
          >
            {error ? "Disconnected" : "Connected"}
          </span>
        </div>
        {!error && <p className="mt-2 text-xs text-neutral-500">Metrics are up to date.</p>}
        {error && <p className="mt-2 text-xs text-neutral-500">{error}</p>}
      </div>

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
            {!loading && rows.length === 0 && (
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
              <td className="px-4 py-3 font-semibold tabular-nums">{status?.totals.item_count ?? "--"}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">{status?.totals.asset_count ?? "--"}</td>
              <td className="px-4 py-3 font-semibold tabular-nums">
                {status ? formatBytes(status.totals.disk_bytes) : "--"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {loading && <p className="text-xs text-neutral-500">Refreshing status metrics...</p>}
    </div>
  );
}

