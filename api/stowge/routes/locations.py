"""Location CRUD routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..asset_paths import location_image_variant_paths, location_photo_variant_paths
from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import (list_locations_payload, serialize_location)
from ..images import cleanup_asset_paths, process_and_store, resolve_path
from ..models import Area, Location, Part, User
from .images import get_image_config

router = APIRouter()


def _default_area_id(db: Session) -> str | None:
    default = db.query(Area).filter(Area.name == "General").first()
    if default:
        return default.id
    only = db.query(Area).order_by(Area.created_at.asc()).all()
    if len(only) == 1:
        return only[0].id
    return only[0].id if only else None


def _resolve_area_id(db: Session, payload: dict) -> str | None:
    if "area_id" in payload:
        raw = str(payload.get("area_id") or "").strip()
        if raw:
            area = db.query(Area).filter(Area.id == raw).first()
            if not area:
                raise HTTPException(status_code=400, detail="Invalid area")
            return area.id
    return _default_area_id(db)


@router.post("/api/locations/photo")
def upload_location_photo(
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    stored = process_and_store([photo], get_image_config(db))
    if not stored:
        raise HTTPException(status_code=400, detail="No photo uploaded")
    payload = stored[0]
    return {
        "photo_path": payload["path_display"],
        "stored": payload,
    }


@router.post("/api/locations/icon")
def upload_location_icon(
    icon: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    stored = process_and_store([icon], get_image_config(db))
    if not stored:
        raise HTTPException(status_code=400, detail="No icon uploaded")
    payload = stored[0]
    return {
        "icon_path": payload["path_display"],
        "stored": payload,
    }


@router.get("/api/locations")
def list_locations(
    area_id: str | None = None,
    site_id: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    if not area_id and not site_id:
        return list_locations_payload(db)

    query = db.query(Location)
    if area_id:
        query = query.filter(Location.area_id == area_id)
    elif site_id:
        area_ids = [row.id for row in db.query(Area.id).filter(Area.site_id == site_id).all()]
        if not area_ids:
            return []
        query = query.filter(Location.area_id.in_(area_ids))

    rows = query.order_by(Location.created_at.asc()).all()
    return [serialize_location(location, db) for location in rows]


@router.post("/api/locations")
def create_location(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None
    icon = str(payload.get("icon") or "").strip() or None
    color = str(payload.get("color") or "").strip() or None
    photo_path = str(payload.get("photo_path") or "").strip() or None
    icon_path = str(payload.get("icon_path") or "").strip() or None
    area_id = _resolve_area_id(db, payload)

    existing = db.query(Location).filter(Location.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")

    location = Location(
        name=name,
        description=description,
        area_id=area_id,
        icon=icon,
        color=color,
        photo_path=photo_path,
        icon_path=icon_path,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return serialize_location(location, db)


@router.patch("/api/locations/{location_id}")
def update_location(location_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    old_photo_path = location.photo_path
    old_icon_path = location.icon_path

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = (
            db.query(Location)
            .filter(Location.name == name, Location.id != location_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Location name already exists")
        location.name = name

    if "description" in payload:
        location.description = str(payload.get("description") or "").strip() or None

    if "area_id" in payload:
        location.area_id = _resolve_area_id(db, payload)

    if "icon" in payload:
        location.icon = str(payload.get("icon") or "").strip() or None

    if "color" in payload:
        location.color = str(payload.get("color") or "").strip() or None

    if "photo_path" in payload:
        next_photo_path = str(payload.get("photo_path") or "").strip() or None
        location.photo_path = next_photo_path

    if "icon_path" in payload:
        next_icon_path = str(payload.get("icon_path") or "").strip() or None
        location.icon_path = next_icon_path

    location.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(location)

    if "photo_path" in payload and old_photo_path and old_photo_path != location.photo_path:
        cleanup_asset_paths(list(location_photo_variant_paths(old_photo_path)))

    if "icon_path" in payload and old_icon_path and old_icon_path != location.icon_path:
        cleanup_asset_paths(list(location_image_variant_paths(old_icon_path)))

    return serialize_location(location, db)


@router.delete("/api/locations/{location_id}")
def delete_location(
    location_id: str,
    move_to_location_id: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    target_location_id: str | None = None
    if move_to_location_id:
        target = db.query(Location).filter(Location.id == move_to_location_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target location not found")
        if target.id == location.id:
            raise HTTPException(status_code=400, detail="Cannot move items to the same location")
        target_location_id = target.id

    photo_path = location.photo_path
    icon_path = location.icon_path
    db.query(Part).filter(Part.location_id == location_id).update({"location_id": target_location_id})
    db.delete(location)
    db.commit()

    if photo_path:
        cleanup_asset_paths(list(location_photo_variant_paths(photo_path)))
    if icon_path:
        cleanup_asset_paths(list(location_image_variant_paths(icon_path)))

    return {"ok": True}


@router.get("/api/locations/{location_id}/photo")
def get_location_photo(location_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    if not location.photo_path:
        raise HTTPException(status_code=404, detail="Location photo not found")
    abs_path = resolve_path(location.photo_path)
    return FileResponse(abs_path)


@router.get("/api/locations/{location_id}/icon")
def get_location_icon(location_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    if not location.icon_path:
        raise HTTPException(status_code=404, detail="Location icon not found")
    abs_path = resolve_path(location.icon_path)
    return FileResponse(abs_path)
