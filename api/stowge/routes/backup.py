"""Backup and restore routes."""

import os
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..auth import delete_all_sessions, require_admin
from ..backup_restore import (BackupError, ensure_backups_dir, list_backups,
                              read_manifest_from_archive, remove_tmp_dir,
                              restore_from_validation, start_restore_validation)
from ..datetime_utils import utc_iso
from ..db import DATABASE_FILE, SessionLocal
from ..helpers.backup_state import (finish_backup_operation, get_backup_operation,
                                    new_backup_operation, store_restore_validation,
                                    pop_restore_validation, update_backup_operation)
from ..helpers.maintenance import (BackupVerificationFailed,
                                   purge_orphaned_images_once,
                                   release_maintenance_task, run_backup_once,
                                   try_claim_maintenance_task,
                                   _record_maintenance_run_result)
from ..images import assets_dir
from ..models import User

router = APIRouter()


def _resolve_backup_path(filename: str) -> str:
    safe_name = os.path.basename(filename)
    if safe_name != filename or not safe_name.endswith(".tar.gz"):
        raise HTTPException(status_code=400, detail="Invalid backup filename")
    path = os.path.join(ensure_backups_dir(assets_dir()), safe_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup not found")
    return path


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
