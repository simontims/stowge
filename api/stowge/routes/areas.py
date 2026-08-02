"""Area CRUD routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import list_areas_payload, serialize_area
from ..models import Area, Location, Site, User

router = APIRouter()


def _resolve_site_id(db: Session, payload: dict) -> str | None:
    if "site_id" in payload:
        raw = str(payload.get("site_id") or "").strip()
        if raw:
            site = db.query(Site).filter(Site.id == raw).first()
            if not site:
                raise HTTPException(status_code=400, detail="Invalid site")
            return site.id

    sites = db.query(Site).order_by(Site.created_at.asc()).all()
    if len(sites) == 1:
        return sites[0].id

    default = db.query(Site).filter(Site.name == "Home").first()
    return default.id if default else None


@router.get("/api/areas")
def list_areas(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_areas_payload(db)


@router.post("/api/areas")
def create_area(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None
    site_id = _resolve_site_id(db, payload)

    existing = db.query(Area).filter(Area.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Area name already exists")

    row = Area(name=name, description=description, site_id=site_id)
    db.add(row)
    db.commit()
    db.refresh(row)

    site_name = None
    if row.site_id:
        site_name = db.query(Site.name).filter(Site.id == row.site_id).scalar()
    return serialize_area(row, site_name=site_name)


@router.patch("/api/areas/{area_id}")
def update_area(area_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    row = db.query(Area).filter(Area.id == area_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Area not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = db.query(Area).filter(Area.name == name, Area.id != area_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Area name already exists")
        row.name = name

    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None

    if "site_id" in payload:
        raw = str(payload.get("site_id") or "").strip()
        if raw:
            site = db.query(Site).filter(Site.id == raw).first()
            if not site:
                raise HTTPException(status_code=400, detail="Invalid site")
            row.site_id = site.id
        else:
            row.site_id = _resolve_site_id(db, payload)

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    site_name = None
    if row.site_id:
        site_name = db.query(Site.name).filter(Site.id == row.site_id).scalar()
    return serialize_area(row, site_name=site_name)


@router.delete("/api/areas/{area_id}")
def delete_area(
    area_id: str,
    move_to_area_id: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    row = db.query(Area).filter(Area.id == area_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Area not found")

    location_count = db.query(Location).filter(Location.area_id == area_id).count()
    if location_count > 0 and not move_to_area_id:
        raise HTTPException(status_code=400, detail="Area has locations. Provide move_to_area_id before deleting.")

    target_area_id: str | None = None
    if move_to_area_id:
        target = db.query(Area).filter(Area.id == move_to_area_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target area not found")
        if target.id == row.id:
            raise HTTPException(status_code=400, detail="Cannot move locations to the same area")
        target_area_id = target.id

    db.query(Location).filter(Location.area_id == row.id).update({"area_id": target_area_id})
    db.delete(row)
    db.commit()

    return {"ok": True}
