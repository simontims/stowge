"""Health checks, version, status, and status/collections metrics."""

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..asset_paths import location_photo_variant_paths
from ..auth import current_user
from ..db import get_db
from ..images import assets_dir
from ..models import Collection, Location, Part, PartImage, User

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


@router.get("/api/status/collections")
def status_collections(db: Session = Depends(get_db), me: User = Depends(current_user)):
    collections = db.query(Collection).order_by(Collection.name.asc()).all()

    item_count_rows = (
        db.query(Part.collection, func.count(Part.id))
        .filter(Part.collection.isnot(None))
        .filter(Part.is_deleted == 0)
        .group_by(Part.collection)
        .all()
    )
    item_counts = {
        str(collection_name): int(count)
        for collection_name, count in item_count_rows
        if collection_name
    }

    asset_count_rows = (
        db.query(Part.collection, func.count(PartImage.id))
        .join(Part, Part.id == PartImage.part_id)
        .filter(Part.collection.isnot(None))
        .filter(Part.is_deleted == 0)
        .group_by(Part.collection)
        .all()
    )
    asset_counts = {
        str(collection_name): int(count)
        for collection_name, count in asset_count_rows
        if collection_name
    }

    asset_size_rows = (
        db.query(Part.collection, Part.is_deleted, PartImage.path_thumb, PartImage.path_display, PartImage.path_original)
        .join(Part, Part.id == PartImage.part_id)
        .all()
    )
    base_assets_dir = assets_dir()
    disk_bytes: dict[str, int] = {}
    uncollected_bytes = 0
    recycle_bin_bytes = 0
    seen_paths: set[str] = set()
    for collection_name, is_deleted, path_thumb, path_display, path_original in asset_size_rows:
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

            if int(is_deleted or 0) == 1:
                recycle_bin_bytes += size
                continue

            if collection_name:
                key = str(collection_name)
                disk_bytes[key] = disk_bytes.get(key, 0) + size
            else:
                uncollected_bytes += size

    location_photo_bytes = 0
    location_photo_paths = db.query(Location.photo_path).filter(Location.photo_path.isnot(None)).all()
    for (photo_path,) in location_photo_paths:
        for rel_path in location_photo_variant_paths(photo_path):
            abs_path = os.path.join(base_assets_dir, rel_path)
            try:
                location_photo_bytes += os.path.getsize(abs_path)
            except OSError:
                pass

    rows = []
    total_items = 0
    total_assets = 0
    total_disk_bytes = location_photo_bytes + uncollected_bytes + recycle_bin_bytes

    for collection in collections:
        name = collection.name
        item_count = int(item_counts.get(name, 0))
        asset_count = int(asset_counts.get(name, 0))
        collection_bytes = int(disk_bytes.get(name, 0))

        total_items += item_count
        total_assets += asset_count
        total_disk_bytes += collection_bytes

        rows.append(
            {
                "id": collection.id,
                "name": name,
                "icon": collection.icon,
                "color": collection.color,
                "item_count": item_count,
                "asset_count": asset_count,
                "disk_bytes": collection_bytes,
            }
        )

    uncollected_item_count = int(
        db.query(func.count(Part.id))
        .filter(Part.collection.is_(None))
        .filter(Part.is_deleted == 0)
        .scalar() or 0
    )
    uncollected_asset_count = int(
        db.query(func.count(PartImage.id))
        .join(Part, Part.id == PartImage.part_id)
        .filter(Part.collection.is_(None))
        .filter(Part.is_deleted == 0)
        .scalar() or 0
    )

    recycle_bin_item_count = int(
        db.query(func.count(Part.id)).filter(Part.is_deleted == 1).scalar() or 0
    )
    recycle_bin_asset_count = int(
        db.query(func.count(PartImage.id))
        .join(Part, Part.id == PartImage.part_id)
        .filter(Part.is_deleted == 1)
        .scalar() or 0
    )

    return {
        "server": "ok",
        "collections": rows,
        "recycle_bin": {
            "item_count": recycle_bin_item_count,
            "asset_count": recycle_bin_asset_count,
            "disk_bytes": recycle_bin_bytes,
        },
        "uncollected": {
            "item_count": uncollected_item_count,
            "asset_count": uncollected_asset_count,
            "disk_bytes": uncollected_bytes,
        },
        "totals": {
            "item_count": total_items + uncollected_item_count + recycle_bin_item_count,
            "asset_count": total_assets + uncollected_asset_count + recycle_bin_asset_count,
            "disk_bytes": total_disk_bytes,
        },
    }
