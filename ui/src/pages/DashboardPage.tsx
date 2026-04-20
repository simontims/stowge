import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tag } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { TablerIcon } from "../components/ui/TablerIcon";
import { apiRequest } from "../lib/api";

interface CollectionStatusRow {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  item_count: number;
  asset_count: number;
  disk_bytes: number;
}

interface UncollectedStats {
  item_count: number;
  asset_count: number;
  disk_bytes: number;
}

interface StatusMetrics {
  server: "ok";
  collections: CollectionStatusRow[];
  uncollected: UncollectedStats;
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

interface DashboardPageProps {
  embedded?: boolean;
}

export function DashboardPage({ embedded = false }: DashboardPageProps) {
  const navigate = useNavigate();

  // ── Status ──
  const [metrics, setMetrics] = useState<StatusMetrics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);

  // ── Maintenance ──
  const [orphanScan, setOrphanScan] = useState<{ file_count: number; disk_bytes: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; freed_bytes: number } | null>(null);
  const [vacuuming, setVacuuming] = useState(false);
  const [vacuumResult, setVacuumResult] = useState<{ size_before: number; size_after: number; freed_bytes: number } | null>(null);
  const [maintenanceError, setMaintenanceError] = useState("");

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

    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => metrics?.collections ?? [], [metrics]);
  const uncollected = metrics?.uncollected;

  async function handleScanOrphans() {
    setScanning(true);
    setMaintenanceError("");
    setOrphanScan(null);
    setPurgeResult(null);
    try {
      const data = await apiRequest<{ file_count: number; disk_bytes: number }>(
        "/api/admin/maintenance/orphaned-images"
      );
      setOrphanScan(data);
    } catch (err) {
      setMaintenanceError((err as Error).message || "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  async function handlePurgeOrphans() {
    setPurging(true);
    setMaintenanceError("");
    try {
      const data = await apiRequest<{ deleted: number; freed_bytes: number }>(
        "/api/admin/maintenance/orphaned-images",
        { method: "DELETE" }
      );
      setPurgeResult(data);
      setOrphanScan(null);
    } catch (err) {
      setMaintenanceError((err as Error).message || "Purge failed.");
    } finally {
      setPurging(false);
    }
  }

  async function handleVacuum() {
    setVacuuming(true);
    setMaintenanceError("");
    setVacuumResult(null);
    try {
      const data = await apiRequest<{ size_before: number; size_after: number; freed_bytes: number }>(
        "/api/admin/maintenance/vacuum",
        { method: "POST" }
      );
      setVacuumResult(data);
    } catch (err) {
      setMaintenanceError((err as Error).message || "Optimise failed.");
    } finally {
      setVacuuming(false);
    }
  }

  return (
    <div className="space-y-5">
      {!embedded && <PageHeader title="Status" />}

      {loadError && !metricsLoading && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      {/* Collections table */}
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
              <tr
                key={row.id}
                className="text-neutral-200 cursor-pointer hover:bg-neutral-800/40 transition-colors"
                onClick={() => navigate(`/items?collection=${encodeURIComponent(row.name)}`)}
              >
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <TablerIcon name={row.icon} size={15} color={row.color} />
                    {row.name}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">{row.item_count}</td>
                <td className="px-4 py-3 tabular-nums">{row.asset_count}</td>
                <td className="px-4 py-3 tabular-nums">{formatBytes(row.disk_bytes)}</td>
              </tr>
            ))}
            {uncollected && uncollected.item_count > 0 && (
              <tr
                className="text-neutral-200 cursor-pointer hover:bg-neutral-800/40 transition-colors"
                onClick={() => navigate("/items?collection=__none")}
              >
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Tag size={15} />
                    No collection
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">{uncollected.item_count}</td>
                <td className="px-4 py-3 tabular-nums">{uncollected.asset_count}</td>
                <td className="px-4 py-3 tabular-nums">{formatBytes(uncollected.disk_bytes)}</td>
              </tr>
            )}
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

      {/* Maintenance */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Maintenance</h2>
          <p className="mt-1 text-xs text-neutral-500">Database and storage housekeeping tools.</p>
        </div>

        {maintenanceError && (
          <p className="text-sm text-red-400">{maintenanceError}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Orphaned images */}
          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Orphaned images</p>
            <p className="text-xs text-neutral-500">
              Asset files on disk no longer referenced by any item. These accumulate from incomplete cleanup operations.
            </p>
            {purgeResult ? (
              <p className="text-xs text-emerald-300">
                Deleted {purgeResult.deleted} file{purgeResult.deleted !== 1 ? "s" : ""}, freed {formatBytes(purgeResult.freed_bytes)}.
              </p>
            ) : orphanScan ? (
              orphanScan.file_count === 0 ? (
                <p className="text-xs text-neutral-500">No orphaned files found.</p>
              ) : (
                <p className="text-xs text-neutral-400">
                  Found {orphanScan.file_count} orphaned file{orphanScan.file_count !== 1 ? "s" : ""} ({formatBytes(orphanScan.disk_bytes)}).
                </p>
              )
            ) : null}
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleScanOrphans}
                disabled={scanning || purging}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {scanning ? "Scanning…" : "Scan"}
              </button>
              {orphanScan && orphanScan.file_count > 0 && !purgeResult && (
                <button
                  type="button"
                  onClick={handlePurgeOrphans}
                  disabled={purging || scanning}
                  className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 bg-red-950/30 text-red-300 hover:text-red-200 hover:bg-red-900/30 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {purging ? "Deleting…" : `Delete ${orphanScan.file_count} file${orphanScan.file_count !== 1 ? "s" : ""}`}
                </button>
              )}
            </div>
          </div>

          {/* Database */}
          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Optimise database</p>
            <p className="text-xs text-neutral-500">
              Reclaims space from deleted records (VACUUM), updates query statistics (ANALYZE), and runs PRAGMA optimize.
            </p>
            {vacuumResult && (
              <p className="text-xs text-emerald-300">
                {vacuumResult.freed_bytes > 0
                  ? `Freed ${formatBytes(vacuumResult.freed_bytes)} (${formatBytes(vacuumResult.size_before)} → ${formatBytes(vacuumResult.size_after)}).`
                  : `Database already compact (${formatBytes(vacuumResult.size_after)}).`}
              </p>
            )}
            <button
              type="button"
              onClick={handleVacuum}
              disabled={vacuuming}
              className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {vacuuming ? "Optimising…" : "Optimise"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

