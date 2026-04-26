import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tag } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { TablerIcon } from "../components/ui/TablerIcon";
import { apiRequest, UNAUTHORIZED_EVENT } from "../lib/api";
import { stageLabel, preflightTitle, restoreStepState } from "../lib/statusMappings";

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

interface BackupManifest {
  backup_name?: string;
  created_at?: string;
  includes_assets?: boolean;
  asset_included_count?: number;
  asset_missing_count?: number;
  db_bytes?: number;
  asset_bytes?: number;
  app_version?: string;
}

interface BackupListRow {
  filename: string;
  size_bytes: number;
  modified_at: string;
}

interface BackupDetails {
  filename: string;
  size_bytes: number;
  modified_at: string;
  manifest: BackupManifest;
}

interface BackupOperation {
  id: string;
  type: string;
  status: "running" | "completed" | "failed";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

interface PreflightFailure {
  code: string;
  message: string;
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

function formatDate(value: string | undefined): string {
  if (!value) return "-";
  const normalized = value.includes(" ") && !value.includes("T") ? value.replace(" ", "T") : value;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(dt);
}

function displayBackupName(manifest: BackupManifest | null | undefined): string {
  const value = String(manifest?.backup_name || "").trim();
  return value || "Stowge Backup";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getPreflightFailure(op: BackupOperation | null): PreflightFailure | null {
  const value = op?.result?.preflight_failure;
  if (!value || typeof value !== "object") return null;
  const code = String((value as { code?: unknown }).code || "").trim();
  const message = String((value as { message?: unknown }).message || "").trim();
  if (!code && !message) return null;
  return { code: code || "backup_error", message };
}

async function pollOperation(
  operationId: string,
  onUpdate: (op: BackupOperation) => void,
): Promise<BackupOperation> {
  // Poll-based progress keeps backend implementation simple and supports modal stage updates.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const op = await apiRequest<BackupOperation>(`/api/admin/backups/operations/${encodeURIComponent(operationId)}`);
    onUpdate(op);
    if (op.status === "completed" || op.status === "failed") {
      return op;
    }
    await delay(700);
  }
}

interface DashboardPageProps {
  embedded?: boolean;
}

export function DashboardPage({ embedded = false }: DashboardPageProps) {
  const navigate = useNavigate();

  // Status
  const [metrics, setMetrics] = useState<StatusMetrics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Maintenance
  const [orphanScan, setOrphanScan] = useState<{ file_count: number; disk_bytes: number } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; freed_bytes: number } | null>(null);
  const [vacuuming, setVacuuming] = useState(false);
  const [vacuumResult, setVacuumResult] = useState<{ size_before: number; size_after: number; freed_bytes: number } | null>(null);
  const [maintenanceError, setMaintenanceError] = useState("");

  // Backups list/detail
  const [backups, setBackups] = useState<BackupListRow[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState("");
  const [selectedBackupFilename, setSelectedBackupFilename] = useState<string | null>(null);
  const [selectedBackupDetails, setSelectedBackupDetails] = useState<BackupDetails | null>(null);
  const [backupDetailsLoading, setBackupDetailsLoading] = useState(false);
  const [deleteBackupTarget, setDeleteBackupTarget] = useState<string | null>(null);
  const [deletingBackup, setDeletingBackup] = useState(false);

  // Backup create modal
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backupIncludeAssets, setBackupIncludeAssets] = useState(false);
  const [backupName, setBackupName] = useState("");
  const [backupOp, setBackupOp] = useState<BackupOperation | null>(null);

  // Restore modal
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<"confirm-test" | "testing" | "invalid" | "ready" | "cancelling" | "restoring" | "done">("confirm-test");
  const [restoreOp, setRestoreOp] = useState<BackupOperation | null>(null);
  const [restoreValidationId, setRestoreValidationId] = useState<string | null>(null);
  const [restoreSummaryManifest, setRestoreSummaryManifest] = useState<BackupManifest | null>(null);

  const rows = useMemo(() => metrics?.collections ?? [], [metrics]);
  const uncollected = metrics?.uncollected;

  async function loadMetrics() {
    setMetricsLoading(true);
    try {
      const data = await apiRequest<StatusMetrics>("/api/status/collections");
      setMetrics(data);
      setLoadError("");
    } catch (err) {
      setLoadError((err as Error).message || "Failed to load collection metrics.");
    } finally {
      setMetricsLoading(false);
    }
  }

  async function loadBackups(preferSelected = false) {
    setBackupsLoading(true);
    try {
      const data = await apiRequest<{ backups: BackupListRow[] }>("/api/admin/backups");
      setBackups(data.backups);
      setBackupsError("");

      if (data.backups.length === 0) {
        setSelectedBackupFilename(null);
        setSelectedBackupDetails(null);
        return;
      }

      const selected = preferSelected && selectedBackupFilename
        ? data.backups.find((b) => b.filename === selectedBackupFilename)
        : null;
      const next = selected?.filename ?? data.backups[0].filename;
      setSelectedBackupFilename(next);
    } catch (err) {
      setBackupsError((err as Error).message || "Failed to load backups.");
    } finally {
      setBackupsLoading(false);
    }
  }

  useEffect(() => {
    void loadMetrics();
    void loadBackups();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedBackupFilename) {
      setSelectedBackupDetails(null);
      return;
    }
    const filename: string = selectedBackupFilename;

    let cancelled = false;
    async function loadDetails() {
      setBackupDetailsLoading(true);
      try {
        const details = await apiRequest<BackupDetails>(`/api/admin/backups/${encodeURIComponent(filename)}`);
        if (!cancelled) {
          setSelectedBackupDetails(details);
        }
      } catch {
        if (!cancelled) {
          setSelectedBackupDetails(null);
        }
      } finally {
        if (!cancelled) {
          setBackupDetailsLoading(false);
        }
      }
    }

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedBackupFilename]);

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

  async function startBackup() {
    setBackupOp({
      id: "",
      type: "backup-create",
      status: "running",
      stage: "starting",
      progress: 1,
      message: "Starting backup",
      error: null,
      result: null,
    });

    try {
      const started = await apiRequest<{ operation_id: string }>("/api/admin/backups/create", {
        method: "POST",
        body: JSON.stringify({
          include_assets: backupIncludeAssets,
          backup_name: backupName.trim() || undefined,
        }),
      });
      const done = await pollOperation(started.operation_id, setBackupOp);
      if (done.status === "completed") {
        await loadBackups(true);
      }
    } catch (err) {
      setBackupOp({
        id: "",
        type: "backup-create",
        status: "failed",
        stage: "failed",
        progress: 100,
        message: "Backup failed",
        error: (err as Error).message || "Backup failed",
        result: null,
      });
    }
  }

  async function downloadBackup(filename: string) {
    const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}/download`, {
      credentials: "include",
    });
    if (res.status === 401) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      throw new Error(`Download failed (HTTP ${res.status})`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteBackup(filename: string) {
    setDeletingBackup(true);
    try {
      await apiRequest<{ ok: boolean }>(`/api/admin/backups/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });
      setDeleteBackupTarget(null);
      await loadBackups(false);
    } finally {
      setDeletingBackup(false);
    }
  }

  function openRestoreFlow() {
    setRestoreModalOpen(true);
    setRestoreStep("confirm-test");
    setRestoreOp(null);
    setRestoreValidationId(null);
    setRestoreSummaryManifest(null);
  }

  async function handleRestoreTest() {
    if (!selectedBackupFilename) return;
    setRestoreStep("testing");
    setRestoreOp({
      id: "",
      type: "restore-test",
      status: "running",
      stage: "starting",
      progress: 1,
      message: "Starting restore test",
      error: null,
      result: null,
    });

    try {
      const started = await apiRequest<{ operation_id: string }>(
        `/api/admin/backups/${encodeURIComponent(selectedBackupFilename)}/restore-test`,
        { method: "POST" }
      );
      const done = await pollOperation(started.operation_id, setRestoreOp);
      if (done.status === "failed") {
        setRestoreStep("invalid");
        return;
      }

      const result = done.result ?? {};
      const validationId = String(result.validation_id || "").trim();
      if (!validationId) {
        setRestoreStep("invalid");
        setRestoreOp((current) => ({
          ...(current ?? done),
          status: "failed",
          error: "Restore test did not return validation data.",
        }));
        return;
      }

      setRestoreValidationId(validationId);
      setRestoreSummaryManifest((result.manifest as BackupManifest) ?? null);
      setRestoreStep("ready");
    } catch (err) {
      setRestoreStep("invalid");
      setRestoreOp({
        id: "",
        type: "restore-test",
        status: "failed",
        stage: "failed",
        progress: 100,
        message: "Restore test failed",
        error: (err as Error).message || "Restore test failed",
        result: null,
      });
    }
  }

  async function handleRestoreCancel() {
    if (!restoreValidationId) {
      setRestoreModalOpen(false);
      return;
    }
    setRestoreStep("cancelling");
    try {
      await apiRequest<{ ok: boolean }>("/api/admin/backups/restore/cancel", {
        method: "POST",
        body: JSON.stringify({ validation_id: restoreValidationId }),
      });
    } finally {
      setRestoreValidationId(null);
      setRestoreModalOpen(false);
    }
  }

  async function handleRestoreApply() {
    if (!restoreValidationId) return;
    setRestoreStep("restoring");
    setRestoreOp({
      id: "",
      type: "restore-apply",
      status: "running",
      stage: "starting",
      progress: 1,
      message: "Starting restore",
      error: null,
      result: null,
    });

    try {
      const started = await apiRequest<{ operation_id: string }>("/api/admin/backups/restore/apply", {
        method: "POST",
        body: JSON.stringify({ validation_id: restoreValidationId }),
      });
      const done = await pollOperation(started.operation_id, setRestoreOp);
      if (done.status === "failed") {
        setRestoreStep("invalid");
        return;
      }
      setRestoreStep("done");
      await loadBackups(true);
    } catch (err) {
      setRestoreStep("invalid");
      setRestoreOp({
        id: "",
        type: "restore-apply",
        status: "failed",
        stage: "failed",
        progress: 100,
        message: "Restore failed",
        error: (err as Error).message || "Restore failed",
        result: null,
      });
    }
  }

  async function handleCompleteLogout() {
    try {
      await fetch("/api/logout", { method: "POST", credentials: "include" });
    } finally {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
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

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Maintenance</h2>
          <p className="mt-1 text-xs text-neutral-500">Database, storage, and backup tools.</p>
        </div>

        {maintenanceError && (
          <p className="text-sm text-red-400">{maintenanceError}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Orphaned images</p>
            <p className="text-xs text-neutral-500">
              Asset files on disk no longer referenced by any item. These accumulate from incomplete cleanup operations.
            </p>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
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
              </div>
              <div className="flex gap-2 flex-wrap md:flex-nowrap md:flex-shrink-0">
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
          </div>

          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Optimise database</p>
            <p className="text-xs text-neutral-500">
              Reclaims space from deleted records (VACUUM), updates query statistics (ANALYZE), and runs PRAGMA optimize.
            </p>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                {vacuumResult && (
                  <p className="text-xs text-emerald-300">
                    {vacuumResult.freed_bytes > 0
                      ? `Freed ${formatBytes(vacuumResult.freed_bytes)} (${formatBytes(vacuumResult.size_before)} → ${formatBytes(vacuumResult.size_after)}).`
                      : `Database already compact (${formatBytes(vacuumResult.size_after)}).`}
                  </p>
                )}
              </div>
              <div className="md:flex-shrink-0">
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
          </div>

          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Backup / Restore</p>
            <p className="text-xs text-neutral-500">
              Create compressed backups and restore from archive with validation.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setBackupModalOpen(true);
                  setBackupOp(null);
                  setBackupName("");
                }}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium"
              >
                Backup / Restore
              </button>
              <button
                type="button"
                onClick={() => void loadBackups(true)}
                disabled={backupsLoading}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-400 hover:text-neutral-200 text-xs"
              >
                {backupsLoading ? "Refreshing…" : "Refresh list"}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="rounded-md border border-neutral-800 p-3">
            <p className="text-sm font-medium text-neutral-200 mb-2">Backups</p>
            {backupsError && <p className="text-xs text-red-400 mb-2">{backupsError}</p>}
            <div className="max-h-64 overflow-auto space-y-1 pr-1">
              {backups.map((backup) => {
                const selected = backup.filename === selectedBackupFilename;
                return (
                  <button
                    key={backup.filename}
                    type="button"
                    onClick={() => setSelectedBackupFilename(backup.filename)}
                    className={[
                      "w-full text-left rounded-md border px-2.5 py-2",
                      selected
                        ? "border-neutral-600 bg-neutral-800/50"
                        : "border-neutral-800 bg-neutral-900/20 hover:bg-neutral-800/30",
                    ].join(" ")}
                  >
                    <p className="text-xs text-neutral-200 font-medium">{backup.filename}</p>
                    <p className="text-[11px] text-neutral-500">{formatDate(backup.modified_at)} · {formatBytes(backup.size_bytes)}</p>
                  </button>
                );
              })}
              {!backupsLoading && backups.length === 0 && (
                <p className="text-xs text-neutral-500">No backups found in /assets/backups.</p>
              )}
            </div>
          </div>

          <div className="rounded-md border border-neutral-800 p-3 space-y-2">
            <p className="text-sm font-medium text-neutral-200">Backup details</p>
            {backupDetailsLoading && <p className="text-xs text-neutral-500">Loading details…</p>}
            {!backupDetailsLoading && selectedBackupDetails && (
              <>
                <p className="text-xs text-neutral-400">Backup name: {displayBackupName(selectedBackupDetails.manifest)}</p>
                <p className="text-xs text-neutral-400">Date: {formatDate(selectedBackupDetails.manifest.created_at || selectedBackupDetails.modified_at)}</p>
                <p className="text-xs text-neutral-400">Includes assets: {selectedBackupDetails.manifest.includes_assets ? "Yes" : "No"}</p>
                <p className="text-xs text-neutral-400">Assets: {selectedBackupDetails.manifest.includes_assets ? (selectedBackupDetails.manifest.asset_included_count ?? 0) : "Not included"}</p>
                <p className="text-xs text-neutral-400">Archive size: {formatBytes(selectedBackupDetails.size_bytes)}</p>
                {!!selectedBackupDetails.manifest.asset_missing_count && (
                  <p className="text-xs text-amber-300">
                    Missing referenced files at backup time: {selectedBackupDetails.manifest.asset_missing_count}
                  </p>
                )}
                <div className="flex gap-2 flex-wrap pt-1">
                  <button
                    type="button"
                    onClick={() => void downloadBackup(selectedBackupDetails.filename)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium"
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={openRestoreFlow}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 bg-red-950/30 text-red-300 hover:text-red-200 hover:bg-red-900/30 text-xs font-medium"
                  >
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteBackupTarget(selectedBackupDetails.filename)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 text-red-300 hover:text-red-200 text-xs font-medium"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
            {!backupDetailsLoading && !selectedBackupDetails && (
              <p className="text-xs text-neutral-500">Select a backup to view details.</p>
            )}
          </div>
        </div>
      </section>

      {backupModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Create backup</h3>
            {!backupOp && (
              <>
                <label className="flex items-start gap-2 text-sm text-neutral-300">
                  <input
                    type="checkbox"
                    checked={backupIncludeAssets}
                    onChange={(event) => setBackupIncludeAssets(event.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Include asset files referenced in the database.</span>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-xs text-neutral-400">Backup name (optional)</span>
                  <input
                    type="text"
                    value={backupName}
                    onChange={(event) => setBackupName(event.target.value)}
                    placeholder="Stowge Backup"
                    maxLength={120}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900/60 px-2.5 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
                  />
                </label>
                <p className="text-xs text-neutral-500">
                  Backups are stored in /assets/backups and include a manifest plus SQL snapshot.
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBackupModalOpen(false)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void startBackup()}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs"
                  >
                    Start backup
                  </button>
                </div>
              </>
            )}

            {backupOp && (
              <>
                <p className="text-xs text-neutral-300">{backupOp.message}</p>
                <div className="h-2 rounded bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-neutral-300" style={{ width: `${Math.max(2, backupOp.progress)}%` }} />
                </div>
                {backupOp.status === "failed" && (
                  <p className="text-xs text-red-400">{backupOp.error || "Backup failed"}</p>
                )}
                {backupOp.status === "completed" && (
                  <p className="text-xs text-emerald-300">Backup completed successfully.</p>
                )}
                <div className="flex justify-end">
                  {backupOp.status === "running" ? (
                    <button
                      type="button"
                      disabled
                      className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-500 text-xs"
                    >
                      Running…
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setBackupModalOpen(false)}
                      className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs"
                    >
                      OK
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {restoreModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Restore backup</h3>

            {restoreStep === "confirm-test" && (
              <>
                <p className="text-sm text-neutral-300">Test backup for restore? You will be prompted again before any restore takes place.</p>
                <p className="text-xs text-neutral-500">
                  Backup name: {displayBackupName(selectedBackupDetails?.manifest)}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreModalOpen(false)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRestoreTest()}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs"
                  >
                    Proceed
                  </button>
                </div>
              </>
            )}

            {(restoreStep === "testing" || restoreStep === "restoring" || restoreStep === "cancelling") && (
              <>
                <p className="text-xs text-neutral-300">
                  {restoreStep === "cancelling" ? "Deleting temporary files" : stageLabel(restoreOp)}
                </p>
                <div className="h-2 rounded bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-neutral-300" style={{ width: `${Math.max(2, restoreOp?.progress ?? 2)}%` }} />
                </div>

                {restoreStep === "restoring" && (
                  <div className="rounded-md border border-neutral-800 bg-neutral-900/30 p-2 space-y-1 text-xs">
                    {[
                      { key: "restore_db", text: "Restore SQL backup over live database" },
                      { key: "restore_assets", text: "Unpack assets to configured location" },
                      { key: "db_maintenance", text: "Run DB maintenance task" },
                      { key: "cleanup_orphans", text: "Clean orphan asset files" },
                    ].map((step) => {
                      const state = restoreStepState(restoreOp, [step.key]);
                      return (
                        <p
                          key={step.key}
                          className={[
                            "transition-colors",
                            state === "done"
                              ? "text-emerald-300"
                              : state === "active"
                                ? "text-neutral-200"
                                : "text-neutral-500",
                          ].join(" ")}
                        >
                          {state === "done" ? "[done] " : state === "active" ? "[in progress] " : "[pending] "}
                          {step.text}
                        </p>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {restoreStep === "invalid" && (
              <>
                {(() => {
                  const failure = getPreflightFailure(restoreOp);
                  return (
                    <>
                      <p className="text-sm text-red-300 font-medium">
                        {preflightTitle(failure?.code || "backup_error")}
                      </p>
                      <p className="text-sm text-red-400">{failure?.message || restoreOp?.error || "Backup validation failed."}</p>
                      {failure?.code && (
                        <p className="text-xs text-neutral-500">Validation code: {failure.code}</p>
                      )}
                    </>
                  );
                })()}
                <p className="text-xs text-neutral-500">Deleting temporary files</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setRestoreModalOpen(false)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs"
                  >
                    OK
                  </button>
                </div>
              </>
            )}

            {restoreStep === "ready" && (
              <>
                <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 space-y-2 text-xs">
                  <p className="text-amber-200 font-semibold">Backup ready to restore</p>
                  <p className="text-neutral-200">Backup name: {displayBackupName(restoreSummaryManifest)}</p>
                  <p className="text-neutral-200">Date: {formatDate(restoreSummaryManifest?.created_at)}</p>
                  <p className="text-neutral-200">
                    Assets: {restoreSummaryManifest?.includes_assets ? (restoreSummaryManifest?.asset_included_count ?? 0) : "Not included"}
                  </p>
                  <p className="text-amber-100">Any existing data will be overwritten.</p>
                  <p className="text-amber-100">Any existing assets will be deleted. Backup assets are restored only if included.</p>
                  <p className="text-amber-100">You will be logged out when restore completes.</p>
                  <p className="text-amber-100">If needed, create a new admin or reset password from the console with stowge admin create / stowge reset-password.</p>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRestoreCancel()}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRestoreApply()}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 bg-red-950/30 text-red-300 text-xs"
                  >
                    Proceed restore
                  </button>
                </div>
              </>
            )}

            {restoreStep === "done" && (
              <>
                <div className="rounded-md border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-2 text-xs text-emerald-200">
                  <p className="font-semibold">Restore completed</p>
                  <p>Database restore completed.</p>
                  <p>Assets restored according to backup contents.</p>
                  <p>Database maintenance and orphan cleanup completed.</p>
                  <p>If needed, create a new admin or reset password from the console with stowge admin create / stowge reset-password.</p>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleCompleteLogout()}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs"
                  >
                    Complete - logout
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {deleteBackupTarget && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Delete backup</h3>
            <p className="text-sm text-neutral-300">Delete {deleteBackupTarget} from /assets/backups?</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteBackupTarget(null)}
                disabled={deletingBackup}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-300 text-xs disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteBackup(deleteBackupTarget)}
                disabled={deletingBackup}
                className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 bg-red-950/30 text-red-300 text-xs disabled:opacity-60"
              >
                {deletingBackup ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
