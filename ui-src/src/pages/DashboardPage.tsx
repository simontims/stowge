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
  const [connected, setConnected] = useState<boolean | null>(null); // null = checking
  const [metrics, setMetrics] = useState<StatusMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const mountedRef = useRef(true);
  const prevConnected = useRef<boolean | null>(null);
  const failCountRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Backoff: 5s → 10s → 20s → 30s (cap), resets to 5s on success
  function nextInterval(failures: number): number {
    if (failures === 0) return 5000;
    if (failures === 1) return 10000;
    if (failures === 2) return 20000;
    return 30000;
  }

  // --- Ping poll with backoff ---
  const schedulePing = useCallback(() => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }, []);

  const ping = useCallback(async () => {
    try {
      await apiRequest<{ ok: boolean }>("/api/ping");
      if (!mountedRef.current) return;
      failCountRef.current = 0;
      setConnected(true);
    } catch {
      if (!mountedRef.current) return;
      failCountRef.current += 1;
      setConnected(false);
    }
    if (!mountedRef.current) return;
    const delay = nextInterval(failCountRef.current);
    timeoutRef.current = setTimeout(() => void ping(), delay);
  }, [schedulePing]);

  // --- Metrics fetch: only when connected ---
  const fetchMetrics = useCallback(async (background: boolean) => {
    if (!background) setMetricsLoading(true);
    try {
      const data = await apiRequest<StatusMetrics>("/api/status/collections");
      if (mountedRef.current) setMetrics(data);
    } catch {
      // Connection already shown as disconnected via ping poll.
    }
    if (!background && mountedRef.current) setMetricsLoading(false);
  }, []);

  // Start ping loop on mount
  useEffect(() => {
    mountedRef.current = true;
    void ping();
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, [ping]);

  // When connection state changes to connected, reload metrics
  useEffect(() => {
    if (connected === true && prevConnected.current !== true) {
      void fetchMetrics(prevConnected.current !== null);
    }
    prevConnected.current = connected;
  }, [connected, fetchMetrics]);

  const rows = useMemo(() => metrics?.collections ?? [], [metrics]);

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
          {connected === null ? (
            <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-neutral-800 text-neutral-400 border border-neutral-700">
              Checking…
            </span>
          ) : (
            <span
              className={[
                "rounded-full px-2 py-0.5 text-xs font-medium",
                connected
                  ? "bg-emerald-900/30 text-emerald-300 border border-emerald-800"
                  : "bg-red-900/40 text-red-300 border border-red-800",
              ].join(" ")}
            >
              {connected ? "Connected" : "Disconnected"}
            </span>
          )}
        </div>
        {connected === false && (
          <p className="mt-2 text-xs text-neutral-500">Cannot reach Stowge server.</p>
        )}
        {connected === true && !metricsLoading && (
          <p className="mt-2 text-xs text-neutral-500">Metrics are up to date.</p>
        )}
      </div>

      {connected === true && (
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
              {!metricsLoading && rows.length === 0 && (
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
      )}

      {metricsLoading && <p className="text-xs text-neutral-500">Loading collection metrics…</p>}
    </div>
  );
}

