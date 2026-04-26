/**
 * Centralized status/stage label mappings for backup operations.
 * These mappings are used to translate backend status codes into human-readable labels.
 * Can be reused across different clients (web UI, mobile, CLI) to ensure consistency.
 */

export interface BackupOperation {
  id: string;
  type: string;
  status: "running" | "completed" | "failed";
  stage: string;
  progress: number;
  message: string;
  error: string | null;
  result: Record<string, unknown> | null;
}

/**
 * Maps backup operation stage codes to human-readable labels.
 * @param op - BackupOperation object, or null if no operation is running
 * @returns Human-readable label for the current stage
 */
export function stageLabel(op: BackupOperation | null): string {
  if (!op) return "Working";
  
  const labels: Record<string, string> = {
    starting: "Starting",
    space_check: "Checking available space",
    db_snapshot: "Creating database backup",
    manifest: "Preparing backup manifest",
    archive: "Creating compressed archive",
    extract: "Unpacking backup archive",
    validate_sql: "Validating SQL backup",
    ready: "Backup ready to restore",
    restore_db: "Restoring SQL backup",
    restore_assets: "Unpacking assets",
    db_maintenance: "Running DB maintenance",
    cleanup_orphans: "Cleaning orphan asset files",
    cleanup: "Deleting temporary files",
    logout: "Logging out users",
    complete: "Completed",
    failed: "Failed",
  };
  
  return labels[op.stage] || op.message || "Working";
}

/**
 * Maps preflight failure codes to human-readable error titles.
 * @param code - Preflight failure code
 * @returns Human-readable error title
 */
export function preflightTitle(code: string): string {
  const labels: Record<string, string> = {
    manifest_version_mismatch: "Backup version is not supported",
    manifest_missing_keys: "Backup manifest is incomplete",
    manifest_invalid_format: "Backup manifest format is invalid",
    manifest_invalid_db_relative_path: "Backup manifest has an invalid database path",
    sql_schema_missing_tables: "Backup database schema is incomplete",
    sql_integrity_failed: "Backup database integrity check failed",
    sql_backup_missing: "Backup SQL snapshot is missing",
    disk_space_insufficient_restore: "Not enough disk space for restore",
    archive_invalid_path: "Backup archive contains invalid paths",
    archive_links_not_allowed: "Backup archive contains unsupported links",
    backup_not_found: "Backup file was not found",
    backup_assets_incomplete: "Backup assets are incomplete",
  };
  
  return labels[code] || "Backup validation failed";
}

/**
 * Determines the state of a restore step based on the current operation.
 * @param op - Current BackupOperation, or null if no operation is running
 * @param stageNames - List of stage names for the step being evaluated
 * @returns "pending" (not yet started), "active" (currently running), or "done" (completed)
 */
export function restoreStepState(
  op: BackupOperation | null,
  stageNames: string[],
): "pending" | "active" | "done" {
  if (!op) return "pending";
  
  const idx = stageNames.indexOf(op.stage);
  if (idx >= 0) return "active";

  const order = ["starting", "restore_db", "restore_assets", "db_maintenance", "cleanup_orphans", "logout", "complete"];
  const currentIdx = order.indexOf(op.stage);
  const maxStageIdx = Math.max(
    ...stageNames.map((name) => order.indexOf(name)).filter((n) => n >= 0),
  );
  
  if (currentIdx > maxStageIdx || op.status === "completed") return "done";
  
  return "pending";
}

/**
 * All available backup operation stage codes (for reference and validation).
 */
export const BACKUP_STAGES = [
  "starting",
  "space_check",
  "db_snapshot",
  "manifest",
  "archive",
  "extract",
  "validate_sql",
  "ready",
  "restore_db",
  "restore_assets",
  "db_maintenance",
  "cleanup_orphans",
  "cleanup",
  "logout",
  "complete",
  "failed",
] as const;

/**
 * All available preflight failure codes (for reference and validation).
 */
export const PREFLIGHT_FAILURE_CODES = [
  "manifest_version_mismatch",
  "manifest_missing_keys",
  "manifest_invalid_format",
  "manifest_invalid_db_relative_path",
  "sql_schema_missing_tables",
  "sql_integrity_failed",
  "sql_backup_missing",
  "disk_space_insufficient_restore",
  "archive_invalid_path",
  "archive_links_not_allowed",
  "backup_not_found",
  "backup_assets_incomplete",
] as const;
