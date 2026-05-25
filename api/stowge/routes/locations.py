"""Location CRUD routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..asset_paths import location_photo_variant_paths
from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import (list_locations_payload, serialize_location)
from ..images import cleanup_asset_paths, process_and_store, resolve_path
from ..models import Location, Part, User
from .images import get_image_config

router = APIRouter()


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


@router.get("/api/locations")
def list_locations(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_locations_payload(db)


@router.post("/api/locations")
def create_location(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None
    photo_path = str(payload.get("photo_path") or "").strip() or None

    existing = db.query(Location).filter(Location.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")

    location = Location(
        name=name,
        description=description,
        photo_path=photo_path,
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

    if "photo_path" in payload:
        next_photo_path = str(payload.get("photo_path") or "").strip() or None
        location.photo_path = next_photo_path

    location.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(location)

    if "photo_path" in payload and old_photo_path and old_photo_path != location.photo_path:
        cleanup_asset_paths(list(location_photo_variant_paths(old_photo_path)))

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
    db.query(Part).filter(Part.location_id == location_id).update({"location_id": target_location_id})
    db.delete(location)
    db.commit()

    if photo_path:
        cleanup_asset_paths(list(location_photo_variant_paths(photo_path)))

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
