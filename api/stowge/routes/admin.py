"""Admin routes: maintenance schedules, orphan scan, vacuum."""

import asyncio
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..datetime_utils import coerce_utc, now_utc
from ..db import get_db
from ..helpers.events import maintenance_events_since, publish_maintenance_event
from ..helpers.maintenance import (MAINTENANCE_TASK_KEYS,
                                   build_tracked_paths, compute_next_run_utc,
                                   ensure_maintenance_schedules,
                                   execute_maintenance_task,
                                   serialize_maintenance_schedule)
from ..images import assets_dir
from ..models import MaintenanceSchedule, User

router = APIRouter()


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
