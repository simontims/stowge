"""Site CRUD routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import list_sites_payload, serialize_site
from ..models import Area, Site, User

router = APIRouter()


@router.get("/api/sites")
def list_sites(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_sites_payload(db)


@router.post("/api/sites")
def create_site(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None

    existing = db.query(Site).filter(Site.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Site name already exists")

    row = Site(name=name, description=description)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_site(row)


@router.patch("/api/sites/{site_id}")
def update_site(site_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    row = db.query(Site).filter(Site.id == site_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Site not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = db.query(Site).filter(Site.name == name, Site.id != site_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Site name already exists")
        row.name = name

    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return serialize_site(row)


@router.delete("/api/sites/{site_id}")
def delete_site(
    site_id: str,
    move_to_site_id: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    row = db.query(Site).filter(Site.id == site_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Site not found")

    area_count = db.query(Area).filter(Area.site_id == site_id).count()
    if area_count > 0 and not move_to_site_id:
        raise HTTPException(status_code=400, detail="Site has areas. Provide move_to_site_id before deleting.")

    if move_to_site_id:
        target = db.query(Site).filter(Site.id == move_to_site_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target site not found")
        if target.id == row.id:
            raise HTTPException(status_code=400, detail="Cannot move areas to the same site")
        db.query(Area).filter(Area.site_id == row.id).update({"site_id": target.id})

    db.delete(row)
    db.commit()

    return {"ok": True}
