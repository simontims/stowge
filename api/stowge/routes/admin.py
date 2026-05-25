"""Admin routes: backup/restore operations, maintenance schedules, orphan scan."""

import asyncio
import json
import os
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..auth import current_user, delete_all_sessions, require_admin
from ..backup_restore import (BackupError, ensure_backups_dir, list_backups,
                              read_manifest_from_archive, remove_tmp_dir,
                              restore_from_validation, start_restore_validation)
from ..datetime_utils import coerce_utc, utc_iso
from ..db import DATABASE_FILE, SessionLocal, get_db
from ..helpers.backup_state import (finish_backup_operation, get_backup_operation,
                                    new_backup_operation, store_restore_validation,
                                    pop_restore_validation, update_backup_operation)
from ..helpers.events import maintenance_events_since, publish_maintenance_event
from ..helpers.maintenance import (BackupVerificationFailed, MAINTENANCE_TASK_KEYS,
                                   build_tracked_paths, compute_next_run_utc,
                                   ensure_maintenance_schedules,
                                   execute_maintenance_task,
                                   is_maintenance_task_running,
                                   purge_orphaned_images_once,
                                   release_maintenance_task, run_backup_once,
                                   serialize_maintenance_schedule,
                                   try_claim_maintenance_task,
                                   _record_maintenance_run_result)
from ..datetime_utils import now_utc
from ..images import assets_dir
from ..models import MaintenanceSchedule, User

router = APIRouter()


def _resolve_backup_path(filename: str) -> str:
    safe_name = os.path.basename(filename)
    if safe_name != filename or not safe_name.endswith(".tar.gz"):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = os.path.join(ensure_backups_dir(assets_dir()), safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup not found")
    return path


# ---------------------------------------------------------------------------
# Maintenance Schedules
# ---------------------------------------------------------------------------

@router.get("/api/admin/maintenance/schedules")
def get_maintenance_schedules(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    ensure_maintenance_schedules(db)
    rows = (
        db.query(MaintenanceSchedule)
        .filter(MaintenanceSchedule.task_key.in_(MAINTENANCE_TASK_KEYS))
        .order_by(MaintenanceSchedule.task_key.asc())
        .all()
    )
    return {
        "schedules": [serialize_maintenance_schedule(row) for row in rows],
    }


@router.patch("/api/admin/maintenance/schedules/{task_key}")
def update_maintenance_schedule(task_key: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    if task_key not in MAINTENANCE_TASK_KEYS:
        raise HTTPException(status_code=404, detail="Unknown maintenance task")

    ensure_maintenance_schedules(db)
    row = db.query(MaintenanceSchedule).filter(MaintenanceSchedule.task_key == task_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    now = now_utc()
    if "cron_expression" in payload:
        cron_expression = str(payload.get("cron_expression") or "").strip()
        if not cron_expression:
            raise HTTPException(status_code=400, detail="cron_expression is required")
        try:
            compute_next_run_utc(cron_expression, after=now)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid cron expression: {exc}")
        row.cron_expression = cron_expression

    if "enabled" in payload:
        row.enabled = 1 if bool(payload.get("enabled")) else 0

    if "backup_retention_enabled" in payload:
        if task_key != "backup":
            raise HTTPException(status_code=400, detail="backup_retention_enabled is only valid for backup task")
        row.backup_retention_enabled = 1 if bool(payload.get("backup_retention_enabled")) else 0

    if "backup_retention_days" in payload:
        if task_key != "backup":
            raise HTTPException(status_code=400, detail="backup_retention_days is only valid for backup task")
        try:
            days = int(payload.get("backup_retention_days"))
        except Exception:
            raise HTTPException(status_code=400, detail="backup_retention_days must be an integer")
        if days < 1 or days > 3650:
            raise HTTPException(status_code=400, detail="backup_retention_days must be between 1 and 3650")
        row.backup_retention_days = days

    if "backup_include_assets" in payload:
        if task_key != "backup":
            raise HTTPException(status_code=400, detail="backup_include_assets is only valid for backup task")
        row.backup_include_assets = 1 if bool(payload.get("backup_include_assets")) else 0

    row.updated_at = coerce_utc(now)
    if bool(row.enabled):
        row.next_run_at = coerce_utc(compute_next_run_utc(row.cron_expression, after=now))
    else:
        row.next_run_at = None

    db.commit()
    db.refresh(row)
    publish_maintenance_event(
        "maintenance_schedule_updated",
        {
            "task_key": task_key,
            "source": "manual",
        },
    )
    return serialize_maintenance_schedule(row)


@router.get("/api/events/maintenance")
async def maintenance_events(
    request: Request,
    since: int = 0,
    _me: User = Depends(require_admin),
):
    async def event_stream():
        last_seq = max(0, int(since))
        heartbeat = 0
        try:
            while True:
                if await request.is_disconnected():
                    break

                events = maintenance_events_since(last_seq)
                if events:
                    for ev in events:
                        last_seq = int(ev.get("seq", last_seq))
                        yield (
                            f"id: {ev['seq']}\n"
                            f"event: {ev['type']}\n"
                            f"data: {json.dumps(ev)}\n\n"
                        )
                    heartbeat = 0
                else:
                    heartbeat += 1
                    if heartbeat >= 10:
                        yield ": keepalive\n\n"
                        heartbeat = 0

                await asyncio.sleep(1)
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/admin/maintenance/orphaned-images")
def scan_orphaned_images(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    """Scan the assets directory for files not referenced in the database (dry run)."""
    tracked = build_tracked_paths(db)
    base_assets_dir = assets_dir()
    file_count = 0
    disk_bytes = 0
    for root, _dirs, files in os.walk(base_assets_dir):
        if os.path.basename(root) == "backups":
            continue
        for fname in files:
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, base_assets_dir).replace("\\", "/")
            if rel_path.startswith("backups/"):
                continue
            if rel_path not in tracked:
                file_count += 1
                try:
                    disk_bytes += os.path.getsize(abs_path)
                except OSError:
                    pass
    return {"file_count": file_count, "disk_bytes": disk_bytes}


@router.delete("/api/admin/maintenance/orphaned-images")
def purge_orphaned_images(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    """Delete all asset files not referenced in the database."""
    try:
        return execute_maintenance_task("orphaned_images_cleanup", run_source="manual", db=db)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Orphan cleanup failed: {exc}")


@router.post("/api/admin/maintenance/vacuum")
def vacuum_database(me: User = Depends(require_admin)):
    """Run VACUUM, ANALYZE, and PRAGMA optimize on the SQLite database."""
    try:
        return execute_maintenance_task("vacuum", run_source="manual")
    except HTTPException:
        raise
    except Exception as exc:
        if "only supported for SQLite" in str(exc):
            raise HTTPException(status_code=400, detail=str(exc))
        raise HTTPException(status_code=500, detail=f"Vacuum failed: {exc}")


# ---------------------------------------------------------------------------
# Backups
# ---------------------------------------------------------------------------

@router.post("/api/admin/backups/create")
def create_backup(payload: dict, me: User = Depends(require_admin)):
    include_assets = bool(payload.get("include_assets", False))
    backup_name = str(payload.get("backup_name") or "").strip() or None
    if not try_claim_maintenance_task("backup"):
        raise HTTPException(status_code=409, detail="Maintenance task 'backup' is already running")

    try:
        op_id = new_backup_operation("backup-create")
    except Exception:
        release_maintenance_task("backup")
        raise

    def run_backup():
        db = SessionLocal()
        started_perf = time.perf_counter()
        try:
            result = run_backup_once(
                db,
                include_assets=include_assets,
                backup_name=backup_name,
                created_by_user=me.username,
                progress_callback=lambda **kwargs: update_backup_operation(op_id, **kwargs),
            )

            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            _record_maintenance_run_result(
                db,
                task_key="backup",
                status="success",
                duration_ms=duration_ms,
                error=None,
            )

            finish_backup_operation(
                op_id,
                status="completed",
                result={
                    "filename": result["filename"],
                    "archive_bytes": result["archive_bytes"],
                    "manifest": result["manifest"],
                },
            )
        except BackupVerificationFailed as exc:
            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            _record_maintenance_run_result(
                db,
                task_key="backup",
                status="failed",
                duration_ms=duration_ms,
                error=str(exc),
            )
            finish_backup_operation(op_id, status="failed", error=str(exc), result=exc.result)
        except Exception as exc:
            duration_ms = int((time.perf_counter() - started_perf) * 1000)
            _record_maintenance_run_result(
                db,
                task_key="backup",
                status="failed",
                duration_ms=duration_ms,
                error=str(exc),
            )
            finish_backup_operation(op_id, status="failed", error=str(exc))
        finally:
            db.close()
            release_maintenance_task("backup")

    thread = threading.Thread(target=run_backup, daemon=True)
    try:
        thread.start()
    except Exception as exc:
        finish_backup_operation(op_id, status="failed", error=str(exc))
        release_maintenance_task("backup")
        raise HTTPException(status_code=500, detail=f"Failed to start backup: {exc}")
    return {"operation_id": op_id}


@router.get("/api/admin/backups/operations/{operation_id}")
def get_backup_operation_route(operation_id: str, me: User = Depends(require_admin)):
    op = get_backup_operation(operation_id)
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    return op


@router.get("/api/admin/backups")
def get_backups(me: User = Depends(require_admin)):
    return {"backups": list_backups(assets_dir())}


@router.get("/api/admin/backups/{filename}")
def get_backup_details(filename: str, me: User = Depends(require_admin)):
    backup_path = _resolve_backup_path(filename)
    try:
        manifest = read_manifest_from_archive(backup_path)
    except BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    stat = os.stat(backup_path)
    return {
        "filename": filename,
        "size_bytes": int(stat.st_size),
        "modified_at": utc_iso(datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)),
        "manifest": manifest,
    }


@router.get("/api/admin/backups/{filename}/download")
def download_backup(filename: str, me: User = Depends(require_admin)):
    backup_path = _resolve_backup_path(filename)
    return FileResponse(backup_path, media_type="application/gzip", filename=filename)


@router.delete("/api/admin/backups/{filename}")
def delete_backup(filename: str, me: User = Depends(require_admin)):
    backup_path = _resolve_backup_path(filename)
    try:
        os.remove(backup_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete backup: {exc}")
    return {"ok": True}


@router.post("/api/admin/backups/{filename}/verify")
def verify_backup(filename: str, me: User = Depends(require_admin)):
    backup_path = _resolve_backup_path(filename)
    op_id = new_backup_operation("backup-verify")

    def run_verify():
        from ..backup_restore import set_backup_verification_metadata

        verification_error: str | None = None
        try:
            result = start_restore_validation(
                backup_path=backup_path,
                assets_root=assets_dir(),
                enforce_restore_space=False,
                progress_callback=lambda **kwargs: update_backup_operation(op_id, **kwargs),
            )
            remove_tmp_dir(str(result.get("tmp_dir") or ""))
        except Exception as exc:
            verification_error = str(exc)

        try:
            manifest = set_backup_verification_metadata(
                backup_path,
                verified=verification_error is None,
                error=verification_error,
            )
        except Exception as exc:
            finish_backup_operation(op_id, status="failed", error=str(exc))
            return

        if verification_error is not None:
            finish_backup_operation(
                op_id,
                status="failed",
                error=f"Backup verification failed: {verification_error}",
                result={
                    "filename": filename,
                    "manifest": manifest,
                },
            )
            return

        finish_backup_operation(
            op_id,
            status="completed",
            result={
                "filename": filename,
                "manifest": manifest,
            },
        )

    thread = threading.Thread(target=run_verify, daemon=True)
    thread.start()
    return {"operation_id": op_id}


@router.post("/api/admin/backups/{filename}/restore-test")
def restore_test_backup(filename: str, me: User = Depends(require_admin)):
    backup_path = _resolve_backup_path(filename)
    op_id = new_backup_operation("restore-test")

    def run_restore_test():
        tmp_dir: str | None = None
        try:
            result = start_restore_validation(
                backup_path=backup_path,
                assets_root=assets_dir(),
                progress_callback=lambda **kwargs: update_backup_operation(op_id, **kwargs),
            )
            tmp_dir = result["tmp_dir"]
            validation_id = str(uuid.uuid4())
            store_restore_validation(validation_id, {
                "tmp_dir": tmp_dir,
                "manifest": result["manifest"],
                "includes_assets": result["includes_assets"],
                "assets_count": result["assets_count"],
                "created_at": utc_iso(datetime.now(timezone.utc)),
            })
            finish_backup_operation(
                op_id,
                status="completed",
                result={
                    "validation_id": validation_id,
                    "manifest": result["manifest"],
                    "includes_assets": result["includes_assets"],
                    "assets_count": result["assets_count"],
                    "required_bytes_estimate": result["required_bytes_estimate"],
                    "free_bytes": result["free_bytes"],
                },
            )
        except BackupError as exc:
            if tmp_dir:
                remove_tmp_dir(tmp_dir)
            finish_backup_operation(
                op_id,
                status="failed",
                error=str(exc),
                result={
                    "preflight_failure": {
                        "code": getattr(exc, "code", "backup_error"),
                        "message": str(exc),
                    }
                },
            )
        except Exception as exc:
            if tmp_dir:
                remove_tmp_dir(tmp_dir)
            finish_backup_operation(
                op_id,
                status="failed",
                error=str(exc),
                result={
                    "preflight_failure": {
                        "code": "unexpected_error",
                        "message": str(exc),
                    }
                },
            )

    thread = threading.Thread(target=run_restore_test, daemon=True)
    thread.start()
    return {"operation_id": op_id}


@router.post("/api/admin/backups/restore/cancel")
def restore_cancel(payload: dict, me: User = Depends(require_admin)):
    validation_id = str(payload.get("validation_id") or "").strip()
    if not validation_id:
        raise HTTPException(status_code=400, detail="validation_id is required")
    ctx = pop_restore_validation(validation_id)
    if not ctx:
        raise HTTPException(status_code=404, detail="Restore validation not found")
    remove_tmp_dir(str(ctx.get("tmp_dir") or ""))
    return {"ok": True}


@router.post("/api/admin/backups/restore/apply")
def restore_apply(payload: dict, me: User = Depends(require_admin)):
    validation_id = str(payload.get("validation_id") or "").strip()
    if not validation_id:
        raise HTTPException(status_code=400, detail="validation_id is required")

    op_id = new_backup_operation("restore-apply")

    ctx = pop_restore_validation(validation_id)
    if not ctx:
        finish_backup_operation(op_id, status="failed", error="Restore validation not found")
        raise HTTPException(status_code=404, detail="Restore validation not found")

    def run_restore_apply():
        tmp_dir = str(ctx.get("tmp_dir") or "")
        try:
            restore_result = restore_from_validation(
                validation_tmp_dir=tmp_dir,
                db_file=DATABASE_FILE,
                assets_root=assets_dir(),
                includes_assets=bool(ctx.get("includes_assets")),
                progress_callback=lambda **kwargs: update_backup_operation(op_id, **kwargs),
            )

            db = SessionLocal()
            try:
                update_backup_operation(op_id, stage="cleanup_orphans", progress=96, message="Cleaning orphan asset files")
                orphan_cleanup = purge_orphaned_images_once(db)

                update_backup_operation(op_id, stage="logout", progress=99, message="Invalidating sessions")
                invalidated = delete_all_sessions(db)
            finally:
                db.close()

            finish_backup_operation(
                op_id,
                status="completed",
                result={
                    "manifest": restore_result.get("manifest"),
                    "orphan_cleanup": orphan_cleanup,
                    "sessions_invalidated": invalidated,
                    "logout_required": True,
                },
            )
        except Exception as exc:
            finish_backup_operation(op_id, status="failed", error=str(exc))
        finally:
            remove_tmp_dir(tmp_dir)

    thread = threading.Thread(target=run_restore_apply, daemon=True)
    thread.start()
    return {"operation_id": op_id}
