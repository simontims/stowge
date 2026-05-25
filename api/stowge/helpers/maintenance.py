"""Maintenance scheduler: background thread that runs periodic tasks.

Tasks: vacuum (SQLite optimization), orphaned_images_cleanup, backup.
"""

import logging
import os
import time
import threading
from datetime import datetime, timedelta, timezone
from threading import Lock

from croniter import croniter
from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..asset_paths import location_photo_variant_paths
from ..backup_restore import (BackupError, create_backup_archive,
                              ensure_backups_dir, read_manifest_from_archive,
                              remove_tmp_dir, set_backup_verification_metadata,
                              start_restore_validation)
from ..datetime_utils import coerce_utc, now_utc, utc_iso
from ..db import DATABASE_FILE, SessionLocal
from ..images import assets_dir
from ..models import Location, MaintenanceSchedule, PartImage
from .events import publish_maintenance_event

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

APP_VERSION = os.getenv("APP_VERSION", "0.1.0")

_MAINTENANCE_TASK_KEYS = ("vacuum", "orphaned_images_cleanup", "backup")
_MAINTENANCE_TASK_DEFAULTS: dict[str, dict[str, str]] = {
    "vacuum": {
        "cron": "0 3 * * 0",
        "description": "Optimise SQLite database",
    },
    "orphaned_images_cleanup": {
        "cron": "0 4 * * 0",
        "description": "Delete orphaned image assets",
    },
    "backup": {
        "cron": "0 2 * * *",
        "description": "Create verified backup archive",
    },
}

MAINTENANCE_TASK_KEYS = _MAINTENANCE_TASK_KEYS  # public alias

# ---------------------------------------------------------------------------
# Scheduler State
# ---------------------------------------------------------------------------

_MAINTENANCE_SCHEDULER_LOCK = Lock()
_MAINTENANCE_SCHEDULER_THREAD: threading.Thread | None = None
_MAINTENANCE_SCHEDULER_STOP = threading.Event()
_MAINTENANCE_SCHEDULER_POLL_SECONDS = 1.0
_MAINTENANCE_STARTUP_DEFER_SECONDS = 60

_MAINTENANCE_TASK_RUN_LOCK = Lock()
_MAINTENANCE_TASK_RUNNING: set[str] = set()


def get_scheduler_stop_event() -> threading.Event:
    return _MAINTENANCE_SCHEDULER_STOP


def get_task_run_lock() -> Lock:
    return _MAINTENANCE_TASK_RUN_LOCK


def get_running_tasks() -> set[str]:
    with _MAINTENANCE_TASK_RUN_LOCK:
        return set(_MAINTENANCE_TASK_RUNNING)


# ---------------------------------------------------------------------------
# Task Claim / Release
# ---------------------------------------------------------------------------

def _log_scheduler(message: str):
    logging.getLogger("uvicorn.error").info("[maintenance-scheduler] %s", str(message).strip())


def try_claim_maintenance_task(task_key: str) -> bool:
    with _MAINTENANCE_TASK_RUN_LOCK:
        if task_key in _MAINTENANCE_TASK_RUNNING:
            return False
        _MAINTENANCE_TASK_RUNNING.add(task_key)
        return True


def release_maintenance_task(task_key: str):
    with _MAINTENANCE_TASK_RUN_LOCK:
        _MAINTENANCE_TASK_RUNNING.discard(task_key)


def is_maintenance_task_running(task_key: str) -> bool:
    with _MAINTENANCE_TASK_RUN_LOCK:
        return task_key in _MAINTENANCE_TASK_RUNNING


# ---------------------------------------------------------------------------
# Schedule Helpers
# ---------------------------------------------------------------------------

def compute_next_run_utc(cron_expression: str, *, after: datetime | None = None) -> datetime:
    base = after or now_utc()
    candidate = croniter(cron_expression, base).get_next(datetime)
    if candidate.tzinfo is None:
        return candidate.replace(tzinfo=timezone.utc)
    return candidate.astimezone(timezone.utc)


def serialize_maintenance_schedule(row: MaintenanceSchedule) -> dict:
    retention_days = int(row.backup_retention_days or 30)
    if retention_days < 1:
        retention_days = 1
    return {
        "task_key": row.task_key,
        "enabled": bool(row.enabled),
        "is_running": is_maintenance_task_running(row.task_key),
        "cron_expression": row.cron_expression,
        "backup_retention_enabled": bool(row.backup_retention_enabled),
        "backup_retention_days": retention_days,
        "backup_include_assets": bool(row.backup_include_assets) if row.backup_include_assets is not None else True,
        "next_run_at": utc_iso(coerce_utc(row.next_run_at)),
        "last_run_at": utc_iso(coerce_utc(row.last_run_at)),
        "last_duration_ms": row.last_duration_ms,
        "last_status": row.last_status,
        "last_error": row.last_error,
        "updated_at": utc_iso(coerce_utc(row.updated_at)),
    }


def ensure_maintenance_schedules(db: Session):
    now = now_utc()
    existing = {
        row.task_key: row
        for row in db.query(MaintenanceSchedule)
        .filter(MaintenanceSchedule.task_key.in_(_MAINTENANCE_TASK_KEYS))
        .all()
    }
    changed = False
    for task_key in _MAINTENANCE_TASK_KEYS:
        row = existing.get(task_key)
        default_cron = _MAINTENANCE_TASK_DEFAULTS[task_key]["cron"]
        if row is None:
            db.add(
                MaintenanceSchedule(
                    task_key=task_key,
                    enabled=0,
                    cron_expression=default_cron,
                    next_run_at=None,
                    updated_at=now,
                )
            )
            changed = True
            continue
        if not (row.cron_expression or "").strip():
            row.cron_expression = default_cron
            row.updated_at = now
            changed = True
    if changed:
        db.commit()


def backup_retention_settings(db: Session) -> tuple[bool, int]:
    row = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.task_key == "backup").first()
    if not row:
        return False, 30
    days = int(row.backup_retention_days or 30)
    days = max(1, min(3650, days))
    return bool(row.backup_retention_enabled), days


# ---------------------------------------------------------------------------
# Task Implementations
# ---------------------------------------------------------------------------

def run_vacuum_once() -> dict:
    import sqlite3 as _sqlite3

    db_file = DATABASE_FILE
    if not db_file or not db_file.endswith(".db"):
        raise RuntimeError("VACUUM is only supported for SQLite databases")
    size_before = os.path.getsize(db_file) if os.path.isfile(db_file) else 0
    raw = _sqlite3.connect(db_file)
    try:
        raw.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        raw.execute("VACUUM")
        raw.execute("ANALYZE")
        raw.execute("PRAGMA optimize")
    finally:
        raw.close()
    size_after = os.path.getsize(db_file) if os.path.isfile(db_file) else 0
    return {
        "size_before": size_before,
        "size_after": size_after,
        "freed_bytes": max(0, size_before - size_after),
    }


def purge_old_backups(*, older_than_days: int) -> dict:
    cutoff = now_utc() - timedelta(days=older_than_days)
    backups_dir = ensure_backups_dir(assets_dir())
    deleted = 0
    freed_bytes = 0
    skipped_non_automatic = 0

    for name in os.listdir(backups_dir):
        if not name.endswith(".tar.gz"):
            continue
        path = os.path.join(backups_dir, name)
        if not os.path.isfile(path):
            continue
        try:
            manifest = read_manifest_from_archive(path)
            backup_name = str(manifest.get("backup_name") or "").strip()
            created_by = str(manifest.get("created_by_user") or "").strip().lower()
            is_automatic = backup_name == "Stowge Automatic" or created_by == "system/scheduler"
            if not is_automatic:
                skipped_non_automatic += 1
                continue

            stat = os.stat(path)
            modified_at = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
            if modified_at >= cutoff:
                continue
            freed_bytes += int(stat.st_size)
            os.remove(path)
            deleted += 1
        except (OSError, BackupError):
            continue

    return {
        "deleted": deleted,
        "freed_bytes": freed_bytes,
        "older_than_days": older_than_days,
        "skipped_non_automatic": skipped_non_automatic,
    }


def build_tracked_paths(db: Session) -> set[str]:
    """Return the set of all asset relative paths referenced in the database."""
    tracked: set[str] = set()

    def _norm_rel(path_value: str) -> str:
        return str(path_value).replace("\\", "/")

    for (pt, pd, po) in db.query(
        PartImage.path_thumb, PartImage.path_display, PartImage.path_original
    ).all():
        for p in (pt, pd, po):
            if p:
                tracked.add(_norm_rel(str(p)))
    for (photo_path,) in db.query(Location.photo_path).filter(
        Location.photo_path.isnot(None)
    ).all():
        for variant_path in location_photo_variant_paths(photo_path):
            tracked.add(_norm_rel(variant_path))
    return tracked


def purge_orphaned_images_once(db: Session) -> dict:
    tracked = build_tracked_paths(db)
    base_assets_dir = assets_dir()
    deleted = 0
    freed_bytes = 0
    for root, _dirs, files in os.walk(base_assets_dir):
        if os.path.basename(root) == "backups":
            continue
        for fname in files:
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, base_assets_dir).replace("\\", "/")
            if rel_path.startswith("backups/"):
                continue
            if rel_path not in tracked:
                try:
                    freed_bytes += os.path.getsize(abs_path)
                    os.remove(abs_path)
                    deleted += 1
                except OSError:
                    pass
    for root, _dirs, _files in os.walk(base_assets_dir, topdown=False):
        if root == base_assets_dir:
            continue
        if os.path.basename(root) == "backups":
            continue
        try:
            if not os.listdir(root):
                os.rmdir(root)
        except OSError:
            pass
    return {"deleted": deleted, "freed_bytes": freed_bytes}


class BackupVerificationFailed(RuntimeError):
    """Raised when backup verification fails but the archive was created."""
    def __init__(self, message: str, result: dict):
        super().__init__(message)
        self.result = result


def run_backup_once(
    db: Session,
    *,
    include_assets: bool = True,
    backup_name: str | None = None,
    created_by_user: str = "system",
    progress_callback=None,
) -> dict:
    retention_enabled, retention_days = backup_retention_settings(db)

    result = create_backup_archive(
        db=db,
        db_file=DATABASE_FILE,
        assets_root=assets_dir(),
        include_assets=include_assets,
        backup_name=backup_name,
        app_version=APP_VERSION,
        created_by_user=created_by_user,
        progress_callback=progress_callback,
    )

    verification_error: str | None = None
    if progress_callback is not None:
        progress_callback(stage="verify", progress=96, message="Verifying backup integrity")
    try:
        verify_result = start_restore_validation(
            backup_path=result["path"],
            assets_root=assets_dir(),
            enforce_restore_space=False,
        )
        remove_tmp_dir(str(verify_result.get("tmp_dir") or ""))
    except Exception as exc:
        verification_error = str(exc)

    manifest = set_backup_verification_metadata(
        result["path"],
        verified=verification_error is None,
        error=verification_error,
    )
    if verification_error is not None:
        raise BackupVerificationFailed(
            f"Backup verification failed: {verification_error}",
            result={"filename": result["filename"], "archive_bytes": result["archive_bytes"], "manifest": manifest},
        )

    retention_result = {"deleted": 0, "freed_bytes": 0, "older_than_days": retention_days}
    if retention_enabled:
        retention_result = purge_old_backups(older_than_days=retention_days)

    return {
        "filename": result["filename"],
        "archive_bytes": result["archive_bytes"],
        "manifest": manifest,
        "retention": retention_result,
    }


# ---------------------------------------------------------------------------
# Task Execution & Recording
# ---------------------------------------------------------------------------

def _record_maintenance_run_result(
    db: Session,
    *,
    task_key: str,
    status: str,
    duration_ms: int,
    error: str | None,
):
    row = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.task_key == task_key).first()
    if not row:
        return
    now = now_utc()
    row.last_run_at = coerce_utc(now)
    row.last_duration_ms = duration_ms
    row.last_status = status
    row.last_error = error
    row.updated_at = coerce_utc(now)
    if bool(row.enabled):
        try:
            row.next_run_at = coerce_utc(compute_next_run_utc(row.cron_expression, after=now))
        except Exception:
            row.next_run_at = None
    else:
        row.next_run_at = None
    db.commit()
    publish_maintenance_event(
        "maintenance_schedule_updated",
        {
            "task_key": task_key,
            "status": status,
            "duration_ms": duration_ms,
            "error": error,
        },
    )


def _run_maintenance_task_by_key(task_key: str, db: Session, *, run_source: str) -> dict:
    if task_key == "vacuum":
        return run_vacuum_once()
    if task_key == "orphaned_images_cleanup":
        return purge_orphaned_images_once(db)
    if task_key == "backup":
        backup_name = "Stowge Automatic" if run_source == "scheduler" else None
        created_by = "system/scheduler" if run_source == "scheduler" else "admin/manual"
        schedule_row = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.task_key == "backup").first()
        include_assets = bool(schedule_row.backup_include_assets) if schedule_row and schedule_row.backup_include_assets is not None else True
        return run_backup_once(db, include_assets=include_assets, backup_name=backup_name, created_by_user=created_by)
    raise RuntimeError(f"Unknown maintenance task: {task_key}")


def execute_maintenance_task(task_key: str, *, run_source: str, db: Session | None = None):
    if not try_claim_maintenance_task(task_key):
        message = f"task={task_key} source={run_source} reason=already_running"
        if run_source == "manual":
            raise HTTPException(status_code=409, detail=f"Maintenance task '{task_key}' is already running")
        _log_scheduler(f"skipped {message}")
        publish_maintenance_event(
            "maintenance_task_skipped",
            {
                "task_key": task_key,
                "source": run_source,
                "reason": "already_running",
            },
        )
        return {"task_key": task_key, "status": "skipped", "reason": "already_running"}

    started_wall = now_utc()
    started_perf = time.perf_counter()
    _log_scheduler(f"starting task={task_key} source={run_source}")
    publish_maintenance_event(
        "maintenance_task_started",
        {
            "task_key": task_key,
            "source": run_source,
            "started_at": utc_iso(started_wall),
        },
    )
    owns_db = db is None
    if owns_db:
        db = SessionLocal()
    try:
        result = _run_maintenance_task_by_key(task_key, db, run_source=run_source)
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        _record_maintenance_run_result(
            db,
            task_key=task_key,
            status="success",
            duration_ms=duration_ms,
            error=None,
        )
        _log_scheduler(
            f"completed task={task_key} source={run_source} duration_ms={duration_ms} started_at={utc_iso(started_wall)}"
        )
        publish_maintenance_event(
            "maintenance_task_completed",
            {
                "task_key": task_key,
                "source": run_source,
                "duration_ms": duration_ms,
                "started_at": utc_iso(started_wall),
            },
        )
        return result
    except Exception as exc:
        duration_ms = int((time.perf_counter() - started_perf) * 1000)
        _record_maintenance_run_result(
            db,
            task_key=task_key,
            status="failed",
            duration_ms=duration_ms,
            error=str(exc),
        )
        _log_scheduler(
            f"failed task={task_key} source={run_source} duration_ms={duration_ms} error={exc}"
        )
        publish_maintenance_event(
            "maintenance_task_failed",
            {
                "task_key": task_key,
                "source": run_source,
                "duration_ms": duration_ms,
                "started_at": utc_iso(started_wall),
                "error": str(exc),
            },
        )
        raise
    finally:
        if owns_db:
            db.close()
        release_maintenance_task(task_key)


# ---------------------------------------------------------------------------
# Scheduler Loop
# ---------------------------------------------------------------------------

def _maintenance_scheduler_loop():
    while not _MAINTENANCE_SCHEDULER_STOP.is_set():
        db = SessionLocal()
        try:
            ensure_maintenance_schedules(db)
            now = now_utc()
            rows = (
                db.query(MaintenanceSchedule)
                .filter(MaintenanceSchedule.task_key.in_(_MAINTENANCE_TASK_KEYS), MaintenanceSchedule.enabled == 1)
                .order_by(MaintenanceSchedule.next_run_at.asc(), MaintenanceSchedule.task_key.asc())
                .all()
            )
            due_keys: list[str] = []
            for row in rows:
                next_run_at = coerce_utc(row.next_run_at)
                if not next_run_at:
                    try:
                        next_run_at = coerce_utc(compute_next_run_utc(row.cron_expression, after=now))
                        row.next_run_at = next_run_at
                        row.updated_at = coerce_utc(now)
                        db.commit()
                    except Exception:
                        row.next_run_at = None
                        row.last_status = "failed"
                        row.last_error = "Invalid cron expression"
                        row.updated_at = coerce_utc(now)
                        db.commit()
                        continue
                if next_run_at and next_run_at <= now:
                    due_keys.append(row.task_key)
        except Exception as exc:
            _log_scheduler(f"loop error: {exc}")
            due_keys = []
        finally:
            db.close()

        for task_key in due_keys:
            try:
                execute_maintenance_task(task_key, run_source="scheduler")
            except Exception:
                pass

        _MAINTENANCE_SCHEDULER_STOP.wait(_MAINTENANCE_SCHEDULER_POLL_SECONDS)


def start_maintenance_scheduler_if_needed():
    global _MAINTENANCE_SCHEDULER_THREAD
    with _MAINTENANCE_SCHEDULER_LOCK:
        if _MAINTENANCE_SCHEDULER_THREAD and _MAINTENANCE_SCHEDULER_THREAD.is_alive():
            return

        db = SessionLocal()
        try:
            ensure_maintenance_schedules(db)
            now = now_utc()
            defer_until = now + timedelta(seconds=_MAINTENANCE_STARTUP_DEFER_SECONDS)
            rows = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.task_key.in_(_MAINTENANCE_TASK_KEYS)).all()
            enabled_count = sum(1 for row in rows if bool(row.enabled))
            deferred_count = 0
            for row in rows:
                if not bool(row.enabled):
                    continue
                next_run = coerce_utc(row.next_run_at)
                if next_run is None or next_run <= defer_until:
                    try:
                        row.next_run_at = coerce_utc(compute_next_run_utc(row.cron_expression, after=defer_until))
                    except Exception:
                        row.next_run_at = defer_until
                    deferred_count += 1
            if deferred_count:
                db.commit()
            _log_scheduler(
                f"loaded schedules total={len(rows)} enabled={enabled_count}"
                + (f" deferred={deferred_count} (startup delay {_MAINTENANCE_STARTUP_DEFER_SECONDS}s)" if deferred_count else "")
            )
        finally:
            db.close()

        _MAINTENANCE_SCHEDULER_STOP.clear()
        _MAINTENANCE_SCHEDULER_THREAD = threading.Thread(target=_maintenance_scheduler_loop, daemon=True)
        _MAINTENANCE_SCHEDULER_THREAD.start()


def stop_maintenance_scheduler():
    """Signal the scheduler to stop (called on shutdown)."""
    _MAINTENANCE_SCHEDULER_STOP.set()
