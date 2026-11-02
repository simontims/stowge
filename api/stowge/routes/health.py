"""Health checks, version, status, and status/tags metrics."""

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..asset_paths import location_image_variant_paths, location_photo_variant_paths
from ..auth import current_user
from ..db import DATABASE_FILE, get_db
from ..images import assets_dir
from ..models import ItemTag, Location, Part, PartImage, Tag, User

APP_VERSION = os.getenv("APP_VERSION", "0.1.0")

router = APIRouter()


@router.get("/healthz", include_in_schema=False)
def healthz():
    """Liveness: returns 200 iff the process is alive and serving HTTP."""
    return {"status": "ok"}


@router.get("/readyz", include_in_schema=False)
def readyz(db: Session = Depends(get_db)):
    """Readiness: returns 200 only when essential dependencies are available."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="database unavailable")
    return {"status": "ok"}


@router.get("/health", include_in_schema=False)
def health(db: Session = Depends(get_db)):
    """Human/debug: always returns 200 with a structured diagnostic summary."""
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"
    return {
        "status": "ok" if db_status == "ok" else "degraded",
        "version": APP_VERSION,
        "database": db_status,
    }


@router.get("/api/version")
def version():
    return {"version": APP_VERSION}


@router.get("/api/ping")
def ping(me: User = Depends(current_user)):
    return {"ok": True}


@router.get("/api/status")
def status(db: Session = Depends(get_db)):
    return {"needs_setup": db.query(User).count() == 0}


def status_tags(db: Session = Depends(get_db), me: User = Depends(current_user)):
    """Per-tag item/image/disk metrics.

    An item with several tags counts once per tag; items with no tag are grouped as "No tag".
    The totals count every item (and file) once.
    """
    tags = db.query(Tag).order_by(Tag.name.asc()).all()

    tag_ids_by_item: dict[str, list[str]] = {}
    for item_id, tag_id in (
        db.query(ItemTag.item_id, ItemTag.tag_id)
        .join(Part, Part.id == ItemTag.item_id)
        .filter(Part.is_deleted == 0)
        .all()
    ):
        tag_ids_by_item.setdefault(str(item_id), []).append(str(tag_id))

    active_item_ids = {str(item_id) for (item_id,) in db.query(Part.id).filter(Part.is_deleted == 0).all()}

    asset_rows = (
        db.query(Part.id, Part.is_deleted, PartImage.path_thumb, PartImage.path_display, PartImage.path_original)
        .join(Part, Part.id == PartImage.part_id)
        .all()
    )
    base_assets_dir = assets_dir()
    item_asset_count: dict[str, int] = {}
    item_bytes: dict[str, int] = {}
    recycle_bin_bytes = 0
    recycle_bin_asset_count = 0
    seen_paths: set[str] = set()
    for item_id, is_deleted, path_thumb, path_display, path_original in asset_rows:
        item_id = str(item_id)
        deleted = int(is_deleted or 0) == 1
        if deleted:
            recycle_bin_asset_count += 1
        else:
            item_asset_count[item_id] = item_asset_count.get(item_id, 0) + 1
        for rel_path in (path_thumb, path_display, path_original):
            if not rel_path:
                continue

            rel_key = str(rel_path)
            if rel_key in seen_paths:
                continue

            seen_paths.add(rel_key)
            abs_path = os.path.join(base_assets_dir, rel_key)
            try:
                size = int(os.path.getsize(abs_path))
            except OSError:
                size = 0

            if deleted:
                recycle_bin_bytes += size
            else:
                item_bytes[item_id] = item_bytes.get(item_id, 0) + size

    location_photo_bytes = 0
    location_photo_paths = db.query(Location.photo_path).filter(Location.photo_path.isnot(None)).all()
    for (photo_path,) in location_photo_paths:
        for rel_path in location_photo_variant_paths(photo_path):
            abs_path = os.path.join(base_assets_dir, rel_path)
            try:
                location_photo_bytes += os.path.getsize(abs_path)
            except OSError:
                pass

    location_icon_bytes = 0
    location_icon_paths = db.query(Location.icon_path).filter(Location.icon_path.isnot(None)).all()
    for (icon_path,) in location_icon_paths:
        for rel_path in location_image_variant_paths(icon_path):
            abs_path = os.path.join(base_assets_dir, rel_path)
            try:
                location_icon_bytes += os.path.getsize(abs_path)
            except OSError:
                pass

    per_tag: dict[str, dict[str, int]] = {tag.id: {"item_count": 0, "asset_count": 0, "disk_bytes": 0} for tag in tags}
    untagged = {"item_count": 0, "asset_count": 0, "disk_bytes": 0}
    for item_id in active_item_ids:
        buckets = [per_tag[t] for t in tag_ids_by_item.get(item_id, []) if t in per_tag] or [untagged]
        for bucket in buckets:
            bucket["item_count"] += 1
            bucket["asset_count"] += item_asset_count.get(item_id, 0)
            bucket["disk_bytes"] += item_bytes.get(item_id, 0)

    rows = [
        {
            "id": tag.id,
            "name": tag.name,
            "icon": tag.icon,
            "color": tag.color,
            **per_tag[tag.id],
        }
        for tag in tags
    ]

    recycle_bin_item_count = int(
        db.query(func.count(Part.id)).filter(Part.is_deleted == 1).scalar() or 0
    )

    db_bytes = os.path.getsize(DATABASE_FILE) if DATABASE_FILE and os.path.isfile(DATABASE_FILE) else 0

    return {
        "server": "ok",
        "tags": rows,
        "recycle_bin": {
            "item_count": recycle_bin_item_count,
            "asset_count": recycle_bin_asset_count,
            "disk_bytes": recycle_bin_bytes,
        },
        "untagged": {"name": "No tag", **untagged},
        "totals": {
            "item_count": len(active_item_ids) + recycle_bin_item_count,
            "asset_count": sum(item_asset_count.values()) + recycle_bin_asset_count,
            "disk_bytes": sum(item_bytes.values()) + location_photo_bytes + location_icon_bytes + recycle_bin_bytes,
            "db_bytes": db_bytes,
        },
    }


router.add_api_route("/api/status/tags", status_tags, methods=["GET"])
# Hidden path kept so a cached UI bundle keeps loading the dashboard; the payload is the per-tag one.
router.add_api_route("/api/status/collections", status_tags, methods=["GET"], include_in_schema=False)
