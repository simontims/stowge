import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tag, Package, HardDrive, Image, Database, Archive } from "lucide-react";
import cronstrue from "cronstrue";
import { PageHeader } from "../components/ui/PageHeader";
import { DataTable, type Column } from "../components/ui/DataTable";
import { TablePaneLayout } from "../components/ui/TablePaneLayout";
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
  recycle_bin: {
    item_count: number;
    asset_count: number;
    disk_bytes: number;
  };
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
  created_by_user?: string;
  backup_verified?: boolean;
  backup_verified_at?: string | null;
  backup_verification_method?: string | null;
  backup_verification_error?: string | null;
}

interface BackupListRow {
  filename: string;
  backup_name?: string;
  size_bytes: number;
  created_at: string;
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

type MaintenanceTaskKey = "vacuum" | "orphaned_images_cleanup" | "backup";
type FriendlyFrequency = "daily" | "weekly" | "monthly" | "custom";

interface MaintenanceScheduleRow {
  task_key: MaintenanceTaskKey;
  enabled: boolean;
  is_running: boolean;
  cron_expression: string;
  backup_retention_enabled: boolean;
  backup_retention_days: number;
  backup_include_assets: boolean;
  next_run_at: string | null;
  last_run_at: string | null;
  last_duration_ms: number | null;
  last_status: "success" | "failed" | null;
  last_error: string | null;
  updated_at: string | null;
}

interface FriendlyCronState {
  frequency: FriendlyFrequency;
  time: string;
  dayOfWeek: string;
  dayOfMonth: string;
}

const MAINTENANCE_TASK_META: Record<MaintenanceTaskKey, { title: string; description: string; runLabel: string }> = {
  vacuum: {
    title: "Optimise database",
    description: "Improves storage and speed by tidying up database data.",
    runLabel: "Run now",
  },
  orphaned_images_cleanup: {
    title: "Orphaned image cleanup",
    description: "Deletes asset files that are no longer referenced by any item.",
    runLabel: "Run now",
  },
  backup: {
    title: "Backup",
    description: "Creates a verified backup archive stored in /assets/backups.",
    runLabel: "Run now",
  },
};

const MAINTENANCE_TASK_CARD_ORDER: MaintenanceTaskKey[] = ["backup", "vacuum", "orphaned_images_cleanup"];

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_v, idx) => {
  const value = String(idx + 1);
  return { value, label: value };
});

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

function formatRelativeAge(value: string | undefined): string {
  if (!value) return "-";
  const normalized = value.includes(" ") && !value.includes("T") ? value.replace(" ", "T") : value;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return value;
  const now = new Date();
  const secondsAgo = Math.floor((now.getTime() - dt.getTime()) / 1000);
  
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo}m ago`;
  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo}h ago`;
  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo}d ago`;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (!Number.isFinite(durationMs) || !durationMs || durationMs <= 0) return "<1s";
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)}m`;
}

function parseFriendlyCron(cronExpression: string): FriendlyCronState {
  const fallback: FriendlyCronState = {
    frequency: "custom",
    time: "03:00",
    dayOfWeek: "0",
    dayOfMonth: "1",
  };
  const parts = String(cronExpression || "").trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [minuteRaw, hourRaw, dayOfMonth, month, dayOfWeek] = parts;
  const minute = Number.parseInt(minuteRaw, 10);
  const hour = Number.parseInt(hourRaw, 10);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return fallback;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fallback;

  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { frequency: "daily", time, dayOfWeek: "0", dayOfMonth: "1" };
  }
  if (dayOfMonth === "*" && month === "*" && /^[0-6]$/.test(dayOfWeek)) {
    return { frequency: "weekly", time, dayOfWeek, dayOfMonth: "1" };
  }
  if (/^(?:[1-9]|[12][0-9]|3[01])$/.test(dayOfMonth) && month === "*" && dayOfWeek === "*") {
    return { frequency: "monthly", time, dayOfWeek: "0", dayOfMonth };
  }
  return { ...fallback, time };
}

function buildCronExpression(state: FriendlyCronState, fallbackCron: string): string {
  if (state.frequency === "custom") {
    return fallbackCron;
  }
  const [hourRaw, minuteRaw] = state.time.split(":");
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return fallbackCron;
  }
  const h = String(hour);
  const m = String(minute);
  if (state.frequency === "daily") return `${m} ${h} * * *`;
  if (state.frequency === "weekly") {
    const dow = /^[0-6]$/.test(state.dayOfWeek) ? state.dayOfWeek : "0";
    return `${m} ${h} * * ${dow}`;
  }
  const dom = /^(?:[1-9]|[12][0-9]|3[01])$/.test(state.dayOfMonth) ? state.dayOfMonth : "1";
  return `${m} ${h} ${dom} * *`;
}

function normalizeCronExpressionInput(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === "*****") return "* * * * *";
  return raw.replace(/\s+/g, " ");
}

/**
 * Convert a cron expression whose time fields are in UTC to one whose time
 * fields represent the browser's local timezone.  Only the minute, hour, and
 * (where unambiguous) day-of-week / day-of-month fields are adjusted.
 */
function cronUtcToLocal(utcCron: string): string {
  const parts = utcCron.trim().split(/\s+/);
  if (parts.length !== 5) return utcCron;
  const [minStr, hourStr, dom, month, dow] = parts;
  const utcMin = Number.parseInt(minStr, 10);
  const utcHour = Number.parseInt(hourStr, 10);
  if (!Number.isInteger(utcMin) || utcMin < 0 || utcMin > 59) return utcCron;
  if (!Number.isInteger(utcHour) || utcHour < 0 || utcHour > 23) return utcCron;

  const probe = new Date();
  probe.setUTCHours(utcHour, utcMin, 0, 0);
  const localHour = probe.getHours();
  const localMin = probe.getMinutes();

  let dayShift = probe.getDay() - probe.getUTCDay();
  if (dayShift > 1) dayShift -= 7;
  if (dayShift < -1) dayShift += 7;

  let newDow = dow;
  let newDom = dom;
  if (dayShift !== 0) {
    if (/^[0-6]$/.test(dow)) {
      newDow = String(((Number.parseInt(dow, 10) + dayShift) + 7) % 7);
    }
    if (/^\d+$/.test(dom)) {
      newDom = String(Math.max(1, Math.min(31, Number.parseInt(dom, 10) + dayShift)));
    }
  }

  return `${localMin} ${localHour} ${newDom} ${month} ${newDow}`;
}

/**
 * Inverse of cronUtcToLocal — converts a local-time cron back to UTC for
 * storage and server-side scheduling.
 */
function cronLocalToUtc(localCron: string): string {
  const parts = localCron.trim().split(/\s+/);
  if (parts.length !== 5) return localCron;
  const [minStr, hourStr, dom, month, dow] = parts;
  const localMin = Number.parseInt(minStr, 10);
  const localHour = Number.parseInt(hourStr, 10);
  if (!Number.isInteger(localMin) || localMin < 0 || localMin > 59) return localCron;
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) return localCron;

  const probe = new Date();
  probe.setHours(localHour, localMin, 0, 0);
  const utcHour = probe.getUTCHours();
  const utcMin = probe.getUTCMinutes();

  let dayShift = probe.getUTCDay() - probe.getDay();
  if (dayShift > 1) dayShift -= 7;
  if (dayShift < -1) dayShift += 7;

  let newDow = dow;
  let newDom = dom;
  if (dayShift !== 0) {
    if (/^[0-6]$/.test(dow)) {
      newDow = String(((Number.parseInt(dow, 10) + dayShift) + 7) % 7);
    }
    if (/^\d+$/.test(dom)) {
      newDom = String(Math.max(1, Math.min(31, Number.parseInt(dom, 10) + dayShift)));
    }
  }

  return `${utcMin} ${utcHour} ${newDom} ${month} ${newDow}`;
}

function toHumanCron(cronExpression: string): string {
  const normalized = normalizeCronExpressionInput(cronExpression);
  try {
    return cronstrue.toString(normalized, { throwExceptionOnParseError: true });
  } catch {
    return "Invalid cron expression";
  }
}

/** Like toHumanCron but interprets a UTC-stored cron expression in the browser's local timezone. */
function toHumanCronLocal(utcCronExpression: string): string {
  return toHumanCron(cronUtcToLocal(normalizeCronExpressionInput(utcCronExpression)));
}

function summarizeLastRun(schedule: MaintenanceScheduleRow): ReactNode {
  if (!schedule.last_run_at) return "Never run yet";
  const ranAt = formatDate(schedule.last_run_at);
  const duration = formatDuration(schedule.last_duration_ms);
  if (schedule.last_status === "failed") {
    return (
      <>
        <span className="block">{ranAt}</span>
        <span className="block">Failed in {duration}{schedule.last_error ? `: ${schedule.last_error}` : ""}</span>
      </>
    );
  }
  if (schedule.last_status === "success") {
    return (
      <>
        <span className="block">{ranAt}</span>
        <span className="block">Completed in {duration}</span>
      </>
    );
  }
  return ranAt;
}

function displayBackupName(manifest: BackupManifest | null | undefined): string {
  const value = String(manifest?.backup_name || "").trim();
  return value || "Stowge Manual";
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

  // Status
  const [metrics, setMetrics] = useState<StatusMetrics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Maintenance
  const [maintenanceSchedules, setMaintenanceSchedules] = useState<Record<MaintenanceTaskKey, MaintenanceScheduleRow> | null>(null);
  const [scheduleSaving, setScheduleSaving] = useState<Partial<Record<MaintenanceTaskKey, boolean>>>({});
  const [scheduleModalTaskKey, setScheduleModalTaskKey] = useState<MaintenanceTaskKey | null>(null);
  const [scheduleModalCronDraft, setScheduleModalCronDraft] = useState("");
  const [scheduleModalRetentionEnabledDraft, setScheduleModalRetentionEnabledDraft] = useState(false);
  const [scheduleModalRetentionDaysDraft, setScheduleModalRetentionDaysDraft] = useState(30);
  const [scheduleModalIncludeAssetsDraft, setScheduleModalIncludeAssetsDraft] = useState(true);
  const [scheduleModalAdvancedOpen, setScheduleModalAdvancedOpen] = useState(false);
  const [runningMaintenanceTask, setRunningMaintenanceTask] = useState<Partial<Record<MaintenanceTaskKey, boolean>>>({});
  const [purgeResult, setPurgeResult] = useState<{ deleted: number; freed_bytes: number } | null>(null);
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
  const deletingBackupRef = useRef(false);
  const selectedBackupFilenameRef = useRef<string | null>(null);
  const [backupPage, setBackupPage] = useState(0);
  const BACKUP_PAGE_SIZE = 5;

  // Backup create modal
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [backupIncludeAssets, setBackupIncludeAssets] = useState(true);
  const [backupName, setBackupName] = useState("");
  const [backupOp, setBackupOp] = useState<BackupOperation | null>(null);

  // Restore modal
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<"confirm-test" | "testing" | "invalid" | "ready" | "cancelling" | "restoring" | "done">("confirm-test");
  const [restoreOp, setRestoreOp] = useState<BackupOperation | null>(null);
  const [restoreValidationId, setRestoreValidationId] = useState<string | null>(null);
  const [restoreSummaryManifest, setRestoreSummaryManifest] = useState<BackupManifest | null>(null);
  const restoreApplyButtonRef = useRef<HTMLButtonElement | null>(null);

  const rows = useMemo(() => metrics?.collections ?? [], [metrics]);
  const totalBackupBytes = useMemo(() => {
    return backups.reduce((sum, backup) => sum + backup.size_bytes, 0);
  }, [backups]);
  const backupPageCount = Math.max(1, Math.ceil(backups.length / BACKUP_PAGE_SIZE));
  const pagedBackups = useMemo(() => {
    const start = backupPage * BACKUP_PAGE_SIZE;
    return backups.slice(start, start + BACKUP_PAGE_SIZE);
  }, [backups, backupPage, BACKUP_PAGE_SIZE]);
  useEffect(() => {
    if (backupPage >= backupPageCount) {
      setBackupPage(Math.max(0, backupPageCount - 1));
    }
  }, [backupPageCount, backupPage]);
  const selectedBackupExists = useMemo(() => {
    if (!selectedBackupDetails) return false;
    return backups.some((backup) => backup.filename === selectedBackupDetails.filename);
  }, [backups, selectedBackupDetails]);

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

  async function loadBackups(preferSelected = false, preferredFilename: string | null = null) {
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

      const preferred = preferredFilename
        ? data.backups.find((b) => b.filename === preferredFilename)
        : null;
      const liveSelectedFilename = selectedBackupFilenameRef.current;
      const selected = preferSelected && liveSelectedFilename
        ? data.backups.find((b) => b.filename === liveSelectedFilename)
        : null;
      const next = preferred?.filename ?? selected?.filename ?? data.backups[0].filename;
      setSelectedBackupFilename(next);
    } catch (err) {
      setBackupsError((err as Error).message || "Failed to load backups.");
    } finally {
      setBackupsLoading(false);
    }
  }

  async function loadBackupsTableOnly() {
    setBackupsLoading(true);
    try {
      const data = await apiRequest<{ backups: BackupListRow[] }>("/api/admin/backups");
      setBackups(data.backups);
      setBackupsError("");

      const selected = selectedBackupFilenameRef.current;
      if (selected && !data.backups.some((backup) => backup.filename === selected)) {
        setSelectedBackupFilename(null);
        setSelectedBackupDetails(null);
      }
    } catch (err) {
      setBackupsError((err as Error).message || "Failed to load backups.");
    } finally {
      setBackupsLoading(false);
    }
  }

  useEffect(() => {
    selectedBackupFilenameRef.current = selectedBackupFilename;
  }, [selectedBackupFilename]);

  useEffect(() => {
    if (!restoreModalOpen || restoreStep !== "ready") return;
    restoreApplyButtonRef.current?.focus();
  }, [restoreModalOpen, restoreStep]);

  const backupColumns = useMemo<Column<BackupListRow>[]>(
    () => [
      {
        key: "backup_name",
        header: "Backup",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-neutral-200">{displayBackupName({ backup_name: row.backup_name })}</p>
            <p className="text-[11px] text-neutral-500">
              {formatDate(row.created_at)} · {formatRelativeAge(row.created_at)}
            </p>
          </div>
        ),
      },
      {
        key: "size_bytes",
        header: "Size",
        className: "w-28 text-right",
        headerClassName: "w-28 text-right",
        render: (row) => <span className="text-xs tabular-nums text-neutral-200">{formatBytes(row.size_bytes)}</span>,
      },
    ],
    []
  );

  useEffect(() => {
    void loadMetrics();
    void loadBackups();
    void loadMaintenanceSchedules();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;
    let source: EventSource | null = null;

    const refresh = () => {
      if (disposed || document.hidden) {
        return;
      }
      void loadMaintenanceSchedules();
    };

    const connect = () => {
      if (disposed) {
        return;
      }
      source = new EventSource("/api/events/maintenance");

      const onMaintenanceEvent = () => {
        refresh();
      };

      source.addEventListener("maintenance_schedule_updated", onMaintenanceEvent as EventListener);
      source.addEventListener("maintenance_task_started", onMaintenanceEvent as EventListener);
      source.addEventListener("maintenance_task_completed", onMaintenanceEvent as EventListener);
      source.addEventListener("maintenance_task_failed", onMaintenanceEvent as EventListener);
      source.addEventListener("maintenance_task_skipped", onMaintenanceEvent as EventListener);

      source.onerror = () => {
        source?.close();
        source = null;
        if (!disposed) {
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    };

    connect();

    // Safety net: periodic list sync in case event streams are blocked by proxies.
    const fallbackTimer = window.setInterval(() => {
      refresh();
    }, 120000);

    return () => {
      disposed = true;
      window.clearInterval(fallbackTimer);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      source?.close();
    };
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

  async function loadMaintenanceSchedules() {
    try {
      const data = await apiRequest<{ schedules: MaintenanceScheduleRow[] }>("/api/admin/maintenance/schedules");
      const mapped = data.schedules.reduce((acc, schedule) => {
        acc[schedule.task_key] = schedule;
        return acc;
      }, {} as Record<MaintenanceTaskKey, MaintenanceScheduleRow>);
      setMaintenanceSchedules(mapped);
    } catch (err) {
      setMaintenanceError((err as Error).message || "Failed to load maintenance schedules.");
    }
  }

  async function patchMaintenanceSchedule(
    taskKey: MaintenanceTaskKey,
    payload: Partial<Pick<MaintenanceScheduleRow, "enabled" | "cron_expression" | "backup_retention_enabled" | "backup_retention_days">>
  ) {
    setScheduleSaving((current) => ({ ...current, [taskKey]: true }));
    setMaintenanceError("");
    try {
      const updated = await apiRequest<MaintenanceScheduleRow>(`/api/admin/maintenance/schedules/${taskKey}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setMaintenanceSchedules((current) => {
        if (!current) return current;
        return { ...current, [taskKey]: updated };
      });
    } catch (err) {
      setMaintenanceError((err as Error).message || "Failed to update maintenance schedule.");
    } finally {
      setScheduleSaving((current) => ({ ...current, [taskKey]: false }));
    }
  }

  useEffect(() => {
    if (!scheduleModalTaskKey || !maintenanceSchedules) {
      setScheduleModalAdvancedOpen(false);
      return;
    }
    const schedule = maintenanceSchedules[scheduleModalTaskKey];
    if (!schedule) {
      setScheduleModalAdvancedOpen(false);
      return;
    }
    const normalizedUtcCron = normalizeCronExpressionInput(schedule.cron_expression);
    const localCron = cronUtcToLocal(normalizedUtcCron);
    setScheduleModalCronDraft(localCron);
    setScheduleModalRetentionEnabledDraft(Boolean(schedule.backup_retention_enabled));
    setScheduleModalRetentionDaysDraft(Number.isFinite(schedule.backup_retention_days) ? Math.max(1, Math.min(3650, schedule.backup_retention_days)) : 30);
    setScheduleModalIncludeAssetsDraft(schedule.backup_include_assets !== false);
    setScheduleModalAdvancedOpen(parseFriendlyCron(localCron).frequency === "custom");
  // Intentionally only initialize drafts when modal task changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleModalTaskKey]);

  async function saveScheduleModal() {
    if (!scheduleModalTaskKey || !maintenanceSchedules) {
      return;
    }
    const taskKey = scheduleModalTaskKey;
    const schedule = maintenanceSchedules[taskKey];
    if (!schedule) {
      return;
    }

    const normalizedLocalCron = normalizeCronExpressionInput(scheduleModalCronDraft);
    const normalizedUtcCron = cronLocalToUtc(normalizedLocalCron);
    const payload: Partial<Pick<MaintenanceScheduleRow, "cron_expression" | "backup_retention_enabled" | "backup_retention_days" | "backup_include_assets">> = {};

    if (normalizedUtcCron && normalizedUtcCron !== schedule.cron_expression) {
      payload.cron_expression = normalizedUtcCron;
    }

    if (taskKey === "backup") {
      if (scheduleModalRetentionEnabledDraft !== Boolean(schedule.backup_retention_enabled)) {
        payload.backup_retention_enabled = scheduleModalRetentionEnabledDraft;
      }
      const clampedDays = Math.max(1, Math.min(3650, scheduleModalRetentionDaysDraft));
      if (clampedDays !== schedule.backup_retention_days) {
        payload.backup_retention_days = clampedDays;
      }
      if (scheduleModalIncludeAssetsDraft !== (schedule.backup_include_assets !== false)) {
        payload.backup_include_assets = scheduleModalIncludeAssetsDraft;
      }
    }

    if (Object.keys(payload).length > 0) {
      await patchMaintenanceSchedule(taskKey, payload);
    }

    setScheduleModalTaskKey(null);
  }

  async function handleRunMaintenanceTask(taskKey: MaintenanceTaskKey) {
    setRunningMaintenanceTask((current) => ({ ...current, [taskKey]: true }));
    setMaintenanceError("");
    try {
      if (taskKey === "vacuum") {
        const data = await apiRequest<{ size_before: number; size_after: number; freed_bytes: number }>(
          "/api/admin/maintenance/vacuum",
          { method: "POST" }
        );
        setVacuumResult(data);
      } else if (taskKey === "orphaned_images_cleanup") {
        const data = await apiRequest<{ deleted: number; freed_bytes: number }>(
          "/api/admin/maintenance/orphaned-images",
          { method: "DELETE" }
        );
        setPurgeResult(data);
      } else {
        const started = await apiRequest<{ operation_id: string }>("/api/admin/backups/create", {
          method: "POST",
          body: JSON.stringify({ include_assets: true }),
        });
        const done = await pollOperation(started.operation_id, () => undefined);
        if (done.status !== "completed") {
          throw new Error(done.error || "Backup failed.");
        }
        const createdFilename = String(done.result?.filename || "").trim() || null;
        await loadBackups(Boolean(createdFilename), createdFilename);
      }
      await loadMaintenanceSchedules();
    } catch (err) {
      setMaintenanceError((err as Error).message || "Maintenance task failed.");
    } finally {
      setRunningMaintenanceTask((current) => ({ ...current, [taskKey]: false }));
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
        const createdFilename = String(done.result?.filename || "").trim() || null;
        await loadBackups(Boolean(createdFilename), createdFilename);
      }
      await loadMaintenanceSchedules();
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
    if (!filename || deletingBackupRef.current) {
      return;
    }

    deletingBackupRef.current = true;
    setDeletingBackup(true);
    setDeleteBackupTarget(null);

    try {
      await apiRequest<{ ok: boolean }>(`/api/admin/backups/${encodeURIComponent(filename)}`, {
        method: "DELETE",
      });

      // Optimistically update local list first so users cannot trigger duplicate deletes
      // while waiting for a round-trip refresh.
      setBackups((current) => {
        const remaining = current.filter((backup) => backup.filename !== filename);
        const isDeletingSelected = selectedBackupFilenameRef.current === filename;
        if (isDeletingSelected) {
          const nextSelected = remaining[0]?.filename ?? null;
          setSelectedBackupFilename(nextSelected);
          // Clear details immediately to avoid stale-row actions while next details load.
          setSelectedBackupDetails(null);
        }
        return remaining;
      });

      void loadBackupsTableOnly();
    } catch (err) {
      setBackupsError((err as Error).message || "Failed to delete backup.");
    } finally {
      deletingBackupRef.current = false;
      setDeletingBackup(false);
    }
  }

  useEffect(() => {
    const target = deleteBackupTarget ?? "";
    if (!target || deletingBackup || backupsLoading) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      void handleDeleteBackup(target);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [deleteBackupTarget, deletingBackup, backupsLoading]);

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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <article className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          <p className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Package size={14} />
            Collections
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-100 tabular-nums">{metricsLoading ? "--" : rows.length}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Inventory groups configured</p>
        </article>

        <article className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          <p className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Tag size={14} />
            Items
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-100 tabular-nums">{metricsLoading ? "--" : (metrics?.totals.item_count ?? 0)}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Across all collections</p>
        </article>

        <article className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          <p className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Image size={14} />
            Assets
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-100 tabular-nums">{metricsLoading ? "--" : (metrics?.totals.asset_count ?? 0)}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Image and other files linked to items</p>
        </article>

        <article className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          <p className="text-xs text-neutral-400 flex items-center gap-1.5">
            <Archive size={14} />
            Backups
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-100 tabular-nums">{backupsLoading ? "--" : backups.length}</p>
          <p className="mt-1 text-[11px] text-neutral-500">{backupsLoading ? "Loading backup storage" : `${formatBytes(totalBackupBytes)} total archive storage`}</p>
        </article>

        <article className="rounded-xl border border-neutral-800 bg-neutral-900/40 px-4 py-3">
          <p className="text-xs text-neutral-400 flex items-center gap-1.5">
            <HardDrive size={14} />
            Disk space
          </p>
          <p className="mt-2 text-3xl font-semibold text-neutral-100 tabular-nums">{metricsLoading ? "--" : formatBytes(metrics?.totals.disk_bytes ?? 0)}</p>
          <p className="mt-1 text-[11px] text-neutral-500">Used by database and assets</p>
        </article>
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Maintenance</h2>
          <p className="mt-1 text-xs text-neutral-500">Configure automated schedules and run maintenance tasks manually any time.</p>
        </div>

        {maintenanceError && (
          <p className="text-sm text-red-400">{maintenanceError}</p>
        )}

        {(["vacuum", "orphaned_images_cleanup", "backup"] as MaintenanceTaskKey[]).every((taskKey) => !maintenanceSchedules?.[taskKey]) ? (
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/35 px-3 py-2 text-xs text-neutral-500">Loading maintenance schedules…</div>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              {MAINTENANCE_TASK_CARD_ORDER.map((taskKey) => {
                const schedule = maintenanceSchedules?.[taskKey];
                if (!schedule) return null;
                const saving = Boolean(scheduleSaving[taskKey]);
                const running = Boolean(runningMaintenanceTask[taskKey] || schedule.is_running);
                const meta = MAINTENANCE_TASK_META[taskKey];

                return (
                  <article key={taskKey} className="rounded-xl border border-neutral-800 bg-neutral-950/35 p-4 space-y-3 h-full flex flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-neutral-200 flex items-center gap-2">
                          {taskKey === "backup" && <Archive size={15} className="text-emerald-300" />}
                          {taskKey === "vacuum" && <Database size={15} className="text-sky-300" />}
                          {taskKey === "orphaned_images_cleanup" && <Image size={15} className="text-amber-300" />}
                          {meta.title}
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">{meta.description}</p>
                      </div>
                      <label className="inline-flex items-center">
                        <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
                          <input
                            type="checkbox"
                            checked={schedule.enabled}
                            onChange={(event) => void patchMaintenanceSchedule(taskKey, { enabled: event.target.checked })}
                            disabled={saving}
                            className="peer sr-only"
                            role="switch"
                            aria-label="Enable schedule"
                          />
                          <span className="absolute inset-0 rounded-full border border-neutral-700 bg-neutral-800 transition-colors peer-checked:bg-emerald-600/80 peer-checked:border-emerald-500 peer-disabled:opacity-50" />
                          <span className="absolute left-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                        </span>
                      </label>
                    </div>

                    {taskKey === "vacuum" && vacuumResult && (
                      <p className="text-xs text-emerald-300">
                        {vacuumResult.freed_bytes > 0
                          ? `Freed ${formatBytes(vacuumResult.freed_bytes)} (${formatBytes(vacuumResult.size_before)} -> ${formatBytes(vacuumResult.size_after)}).`
                          : `Database already compact (${formatBytes(vacuumResult.size_after)}).`}
                      </p>
                    )}

                    {taskKey === "orphaned_images_cleanup" && purgeResult && (
                      <p className="text-xs text-emerald-300">
                        Deleted {purgeResult.deleted} file{purgeResult.deleted !== 1 ? "s" : ""}, freed {formatBytes(purgeResult.freed_bytes)}.
                      </p>
                    )}

                    <div className="rounded-md border border-neutral-800 bg-neutral-900/30 px-3 py-2 text-xs text-neutral-400 space-y-1">
                      <p>
                        Schedule: {toHumanCronLocal(schedule.cron_expression)}
                      </p>
                      {taskKey === "backup" && (
                        <p>
                          Retention: {schedule.backup_retention_enabled
                            ? `Delete automatic backups older than ${schedule.backup_retention_days} day${schedule.backup_retention_days === 1 ? "" : "s"}`
                            : "Keep all backups"}
                        </p>
                      )}
                    </div>

                    <div className="grid gap-1 text-xs text-neutral-400 sm:grid-cols-2">
                      <p>Next run: {schedule.enabled ? (schedule.next_run_at ? formatDate(schedule.next_run_at) : "Not scheduled") : "Schedule disabled"}</p>
                      <p>Last run: {summarizeLastRun(schedule)}</p>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setScheduleModalTaskKey(taskKey)}
                        className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium"
                      >
                        Edit schedule
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (taskKey === "backup") {
                            setBackupModalOpen(true);
                            setBackupOp(null);
                            setBackupName("");
                          } else {
                            void handleRunMaintenanceTask(taskKey);
                          }
                        }}
                        disabled={running}
                        className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-500 text-xs font-medium disabled:opacity-60"
                      >
                        {running ? "Running…" : meta.runLabel}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
        <TablePaneLayout
          variant="aside"
          rightVisible={Boolean(selectedBackupFilename)}
          leftPaneClassName="min-w-0 flex-1"
          rightPaneClassName="flex-1 p-3 space-y-3"
          leftHeader={backupsError ? <p className="text-xs text-red-400 mb-2">{backupsError}</p> : undefined}
          rightHeader={
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-neutral-200">Backup details</p>
              {selectedBackupDetails && (
                <span
                  className={[
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
                    selectedBackupDetails.manifest.backup_verified
                      ? "border border-emerald-500/50 bg-emerald-950/30 text-emerald-300"
                      : "border border-neutral-600/60 bg-neutral-900/70 text-neutral-400",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "h-1.5 w-1.5 rounded-full",
                      selectedBackupDetails.manifest.backup_verified ? "bg-emerald-300" : "bg-neutral-500",
                    ].join(" ")}
                  />
                  {selectedBackupDetails.manifest.backup_verified ? "Verified" : "Not verified"}
                </span>
              )}
            </div>
          }
          left={
            <>
              <div
                tabIndex={0}
                className="focus:outline-none min-h-[278px]"
                onKeyDown={(event) => {
                  if (event.key !== "Delete") {
                    return;
                  }
                  if (!selectedBackupFilename || deletingBackup || backupsLoading) {
                    return;
                  }
                  event.preventDefault();
                  setDeleteBackupTarget(selectedBackupFilename);
                }}
              >
                <DataTable
                  columns={backupColumns}
                  rows={pagedBackups}
                  keyField="filename"
                  emptyMessage="No backups found in /assets/backups."
                  activeRowId={selectedBackupFilename ?? undefined}
                  onRowClick={(row) => setSelectedBackupFilename(row.filename)}
                />
              </div>
              {backupPageCount > 1 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-neutral-500">
                    Page {backupPage + 1} of {backupPageCount}
                  </span>
                  <div className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => setBackupPage((p) => Math.max(0, p - 1))}
                      disabled={backupPage === 0}
                      className="inline-flex items-center px-2.5 py-1 text-xs rounded-md rounded-r-none border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
                    >
                      ← Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackupPage((p) => Math.min(backupPageCount - 1, p + 1))}
                      disabled={backupPage >= backupPageCount - 1}
                      className="inline-flex items-center px-2.5 py-1 text-xs rounded-md rounded-l-none -ml-px border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-40 disabled:hover:text-neutral-400 disabled:hover:border-neutral-700"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          }
          right={
            <>
              {backupDetailsLoading && <p className="text-xs text-neutral-500">Loading details…</p>}
              {!backupDetailsLoading && selectedBackupDetails && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-neutral-500">Size</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">{formatBytes(selectedBackupDetails.size_bytes)}</p>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-neutral-500">Database</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">
                        {selectedBackupDetails.manifest.db_bytes ? formatBytes(selectedBackupDetails.manifest.db_bytes) : "--"}
                      </p>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950/35 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-neutral-500">Assets</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-neutral-100">
                        {selectedBackupDetails.manifest.includes_assets
                          ? (selectedBackupDetails.manifest.asset_bytes
                            ? formatBytes(selectedBackupDetails.manifest.asset_bytes)
                            : `${selectedBackupDetails.manifest.asset_included_count ?? 0} files`)
                          : "No"}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-xs text-neutral-400">
                    <p>Created: {formatDate(selectedBackupDetails.manifest.created_at || selectedBackupDetails.modified_at)}</p>
                    <p>Created by: {selectedBackupDetails.manifest.created_by_user || "unknown"}</p>
                    <p>Includes assets: {selectedBackupDetails.manifest.includes_assets ? "Yes" : "No"}</p>
                    <p>Filename: {selectedBackupDetails.filename}</p>
                    <p>Format: tar.gz</p>
                    <p>
                      {selectedBackupDetails.manifest.backup_verified
                        ? "Backup verified"
                        : "Backup not verified"}
                      {selectedBackupDetails.manifest.backup_verified && selectedBackupDetails.manifest.backup_verified_at
                        ? ` · ${formatDate(selectedBackupDetails.manifest.backup_verified_at)}`
                        : ""}
                    </p>
                  </div>
                  {!selectedBackupDetails.manifest.backup_verified && selectedBackupDetails.manifest.backup_verification_error && (
                    <p className="text-xs text-amber-300">
                      Verification note: {selectedBackupDetails.manifest.backup_verification_error}
                    </p>
                  )}
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
                      disabled={deletingBackup || backupsLoading || !selectedBackupExists}
                      className="inline-flex items-center px-3 py-1.5 rounded-md border border-red-500/70 text-red-300 hover:text-red-200 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
              {!backupDetailsLoading && !selectedBackupDetails && selectedBackupFilename && (
                <p className="text-xs text-neutral-500">Select a backup to view details.</p>
              )}
            </>
          }
        />
      </section>

      {scheduleModalTaskKey && maintenanceSchedules?.[scheduleModalTaskKey] && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          {(() => {
            const taskKey = scheduleModalTaskKey;
            const schedule = maintenanceSchedules[taskKey];
            const meta = MAINTENANCE_TASK_META[taskKey];
            const cronValue = normalizeCronExpressionInput(scheduleModalCronDraft);
            const friendly = parseFriendlyCron(cronValue);
            const saving = Boolean(scheduleSaving[taskKey]);
            const controlsDisabled = !schedule.enabled || saving;

            return (
              <div className="w-full max-w-xl rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-100">Edit schedule</h3>
                    <p className="mt-1 text-xs text-neutral-500">{meta.title}</p>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <select
                    value={friendly.frequency}
                    disabled={controlsDisabled}
                    onChange={(event) => {
                      const nextFrequency = event.target.value as FriendlyFrequency;
                      if (nextFrequency === "custom") {
                        setScheduleModalAdvancedOpen(true);
                        return;
                      }
                      const nextState: FriendlyCronState = {
                        ...friendly,
                        frequency: nextFrequency,
                      };
                      const cronExpression = buildCronExpression(nextState, cronValue);
                      setScheduleModalCronDraft(cronExpression);
                    }}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 disabled:opacity-50"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="custom">Custom</option>
                  </select>
                  <select
                    value={friendly.frequency === "monthly" ? friendly.dayOfMonth : friendly.dayOfWeek}
                    disabled={controlsDisabled || friendly.frequency === "daily" || friendly.frequency === "custom"}
                    onChange={(event) => {
                      const nextState: FriendlyCronState = {
                        ...friendly,
                        dayOfWeek: friendly.frequency === "weekly" ? event.target.value : friendly.dayOfWeek,
                        dayOfMonth: friendly.frequency === "monthly" ? event.target.value : friendly.dayOfMonth,
                      };
                      const cronExpression = buildCronExpression(nextState, cronValue);
                      setScheduleModalCronDraft(cronExpression);
                    }}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 disabled:opacity-50"
                  >
                    {friendly.frequency === "monthly"
                      ? MONTH_DAY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>Day {opt.label}</option>)
                      : WEEKDAY_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <input
                    type="time"
                    value={friendly.time}
                    disabled={controlsDisabled || friendly.frequency === "custom"}
                    onChange={(event) => {
                      const nextState: FriendlyCronState = { ...friendly, time: event.target.value || friendly.time };
                      const cronExpression = buildCronExpression(nextState, cronValue);
                      setScheduleModalCronDraft(cronExpression);
                    }}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 disabled:opacity-50"
                  />
                </div>

                <details
                  open={scheduleModalAdvancedOpen}
                  onToggle={(event) => setScheduleModalAdvancedOpen((event.target as HTMLDetailsElement).open)}
                >
                  <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">Advanced</summary>
                  <div className="mt-2 space-y-2">
                    <input
                      type="text"
                      value={scheduleModalCronDraft}
                      disabled={controlsDisabled}
                      onChange={(event) => setScheduleModalCronDraft(event.target.value)}
                      onBlur={() => setScheduleModalCronDraft((current) => normalizeCronExpressionInput(current))}
                      placeholder="0 3 * * *"
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 disabled:opacity-50"
                    />
                    <p className="text-[11px] text-neutral-500">{toHumanCron(cronValue)}</p>
                  </div>
                </details>

                {taskKey === "backup" && (
                  <div className="rounded-md border border-neutral-800 bg-neutral-900/30 p-3 space-y-2">
                    <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={scheduleModalIncludeAssetsDraft}
                        onChange={(event) => setScheduleModalIncludeAssetsDraft(event.target.checked)}
                        disabled={saving}
                        className="rounded border-neutral-700 bg-neutral-950"
                      />
                      Include asset files referenced in the database
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                      <input
                        type="checkbox"
                        checked={scheduleModalRetentionEnabledDraft}
                        onChange={(event) => setScheduleModalRetentionEnabledDraft(event.target.checked)}
                        disabled={saving}
                        className="rounded border-neutral-700 bg-neutral-950"
                      />
                      Permanently delete automatic backups older than
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={3650}
                        value={scheduleModalRetentionDaysDraft}
                        disabled={saving || !scheduleModalRetentionEnabledDraft}
                        onChange={(event) => {
                          const value = Number.parseInt(event.target.value || "", 10);
                          if (!Number.isInteger(value)) {
                            return;
                          }
                          const days = Math.max(1, Math.min(3650, value));
                          setScheduleModalRetentionDaysDraft(days);
                        }}
                        className="w-24 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200 disabled:opacity-50"
                      />
                      <span className="text-xs text-neutral-300">days</span>
                    </div>
                    <p className="text-[11px] text-neutral-500">
                      Removes automatic backup archives older than the configured age when this task runs.
                    </p>
                  </div>
                )}

                <div className="grid gap-1 text-xs text-neutral-400 sm:grid-cols-2">
                  <p>Next run: {schedule.enabled ? (schedule.next_run_at ? formatDate(schedule.next_run_at) : "Not scheduled") : "Schedule disabled"}</p>
                  <p>Last run: {summarizeLastRun(schedule)}</p>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleModalTaskKey(null)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-800 text-neutral-300 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveScheduleModal()}
                    disabled={saving}
                    className="inline-flex items-center px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-200 text-xs disabled:opacity-60"
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {backupModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-neutral-100">Create a backup</h3>
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
                    placeholder="Stowge Manual"
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
                    Backup Now
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
                    ref={restoreApplyButtonRef}
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
