"""Versioned external REST API for integration consumers."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..api_key_auth import ApiKeyAuthContext, require_api_key_scopes
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import (
    contents_count_by_item_id,
    serialize_area,
    serialize_collection,
    serialize_location,
    serialize_part_detail,
    serialize_part_list,
    serialize_site,
)
from ..models import Area, Collection, Location, Part, Site

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


def _resolve_site_id(db: Session, payload: dict) -> str | None:
    if "site_id" in payload:
        raw = str(payload.get("site_id") or "").strip()
        if raw:
            site = db.query(Site).filter(Site.id == raw).first()
            if not site:
                raise HTTPException(status_code=400, detail="Invalid site")
            return site.id

    default = db.query(Site).filter(Site.name == "Home").first()
    if default:
        return default.id

    only = db.query(Site).order_by(Site.created_at.asc()).all()
    if len(only) == 1:
        return only[0].id
    return only[0].id if only else None


def _list_items(
    db: Session,
    *,
    q: Optional[str] = None,
    collection_name: Optional[str] = None,
    location_name: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
):
    query = db.query(Part).outerjoin(Location, Part.location_id == Location.id).filter(Part.is_deleted == 0)

    if q:
        term = f"%{q.strip()}%"
        query = query.filter(
            or_(
                Part.name.ilike(term),
                Part.description.ilike(term),
                Part.collection.ilike(term),
                Location.name.ilike(term),
                Part.status.ilike(term),
            )
        )

    if collection_name == "__none":
        query = query.filter(Part.collection.is_(None))
    elif collection_name:
        query = query.filter(Part.collection.ilike(collection_name))

    if location_name:
        query = query.filter(Location.name.ilike(location_name))

    if status:
        query = query.filter(Part.status == status)

    query = query.order_by(Part.name.asc())

    page = query.offset(max(0, offset)).limit(max(1, min(limit, 200))).all()

    location_ids = {p.location_id for p in page if p.location_id}
    location_names: dict[str, str] = {}
    if location_ids:
        location_rows = db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        location_names = {location_id: name for location_id, name in location_rows}

    counts = contents_count_by_item_id(db, [p.id for p in page])
    return [
        serialize_part_list(
            p,
            location_name=(location_names.get(p.location_id) if p.location_id else None),
            contents_count=counts.get(p.id, 0),
        )
        for p in page
    ]


@router.get("/v1/items", tags=["items"], summary="List items")
def v1_list_items(
    q: Optional[str] = None,
    collection: Optional[str] = None,
    location: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.read"])),
):
    return _list_items(
        db,
        q=q,
        collection_name=collection,
        location_name=location,
        status=status,
        limit=limit,
        offset=offset,
    )


@router.get("/v1/items/{item_id}", tags=["items"], summary="Get item")
def v1_get_item(
    item_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.read"])),
):
    part = db.query(Part).filter(Part.id == item_id, Part.is_deleted == 0).first()
    if not part:
        raise HTTPException(status_code=404, detail="Not found")

    location_name = None
    if part.location_id:
        loc = db.query(Location.id, Location.name).filter(Location.id == part.location_id).first()
        if loc:
            location_name = loc.name
    return serialize_part_detail(part, location_name=location_name)


@router.post("/v1/items", tags=["items"], summary="Create item")
def v1_create_item(
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.write"])),
):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None
    collection = str(payload.get("collection") or "").strip() or None
    location_id = str(payload.get("location_id") or "").strip() or None
    status = payload.get("status") or "draft"
    if status not in ("draft", "confirmed"):
        raise HTTPException(status_code=400, detail="status must be draft|confirmed")

    quantity_raw = payload.get("quantity", 1)
    try:
        quantity = max(0, int(quantity_raw))
    except (TypeError, ValueError) as ex:
        raise HTTPException(status_code=400, detail="quantity must be an integer") from ex

    if collection:
        exists = db.query(Collection.id).filter(Collection.name == collection).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Invalid collection")

    if location_id:
        exists = db.query(Location.id).filter(Location.id == location_id).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Invalid location")

    part = Part(
        name=name,
        description=description,
        collection=collection,
        location_id=location_id,
        status=status,
        quantity=quantity,
    )
    db.add(part)
    db.commit()
    db.refresh(part)

    location_name = None
    if part.location_id:
        loc = db.query(Location.id, Location.name).filter(Location.id == part.location_id).first()
        if loc:
            location_name = loc.name
    return serialize_part_detail(part, location_name=location_name)


@router.patch("/v1/items/{item_id}", tags=["items"], summary="Update item")
def v1_update_item(
    item_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.write"])),
):
    part = db.query(Part).filter(Part.id == item_id, Part.is_deleted == 0).first()
    if not part:
        raise HTTPException(status_code=404, detail="Not found")

    if "name" in payload:
        part.name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)

    if "description" in payload:
        part.description = str(payload.get("description") or "").strip() or None

    if "collection" in payload:
        collection = str(payload.get("collection") or "").strip() or None
        if collection:
            exists = db.query(Collection.id).filter(Collection.name == collection).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid collection")
        part.collection = collection

    if "location_id" in payload:
        location_id = str(payload.get("location_id") or "").strip() or None
        if location_id:
            exists = db.query(Location.id).filter(Location.id == location_id).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid location")
        part.location_id = location_id

    if "status" in payload:
        status = str(payload.get("status") or "").strip()
        if status not in ("draft", "confirmed"):
            raise HTTPException(status_code=400, detail="status must be draft|confirmed")
        part.status = status

    if "quantity" in payload:
        try:
            part.quantity = max(0, int(payload.get("quantity")))
        except (TypeError, ValueError) as ex:
            raise HTTPException(status_code=400, detail="quantity must be an integer") from ex

    part.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(part)

    location_name = None
    if part.location_id:
        loc = db.query(Location.id, Location.name).filter(Location.id == part.location_id).first()
        if loc:
            location_name = loc.name
    return serialize_part_detail(part, location_name=location_name)


@router.delete("/v1/items/{item_id}", tags=["items"], summary="Delete item")
def v1_delete_item(
    item_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.delete"])),
):
    part = db.query(Part).filter(Part.id == item_id, Part.is_deleted == 0).first()
    if not part:
        raise HTTPException(status_code=404, detail="Not found")

    part.is_deleted = 1
    part.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.get("/v1/collections", tags=["collections"], summary="List collections")
def v1_list_collections(
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["collections.read"])),
):
    rows = db.query(Collection).order_by(Collection.created_at.asc()).offset(offset).limit(limit).all()
    if not rows:
        return []

    names = [col.name for col in rows]
    counts = dict(
        db.query(Part.collection, func.count(Part.id))
        .filter(Part.collection.in_(names), Part.is_deleted == 0)
        .group_by(Part.collection)
        .all()
    )

    return [serialize_collection(col, db, item_count=int(counts.get(col.name, 0))) for col in rows]


@router.get("/v1/collections/{collection_id}", tags=["collections"], summary="Get collection")
def v1_get_collection(
    collection_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["collections.read"])),
):
    row = db.query(Collection).filter(Collection.id == collection_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")
    return serialize_collection(row, db)


@router.post("/v1/collections", tags=["collections"], summary="Create collection")
def v1_create_collection(
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["collections.write"])),
):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    icon = str(payload.get("icon") or "").strip() or None
    color = str(payload.get("color") or "").strip() or None
    description = str(payload.get("description") or "").strip() or None
    ai_hint = str(payload.get("ai_hint") or "").strip() or None

    existing = db.query(Collection).filter(Collection.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists")

    row = Collection(name=name, icon=icon, color=color, description=description, ai_hint=ai_hint)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_collection(row, db)


@router.patch("/v1/collections/{collection_id}", tags=["collections"], summary="Update collection")
def v1_update_collection(
    collection_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["collections.write"])),
):
    row = db.query(Collection).filter(Collection.id == collection_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = db.query(Collection).filter(Collection.name == name, Collection.id != collection_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Collection name already exists")
        row.name = name

    if "icon" in payload:
        row.icon = str(payload.get("icon") or "").strip() or None

    if "color" in payload:
        row.color = str(payload.get("color") or "").strip() or None

    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None

    if "ai_hint" in payload:
        row.ai_hint = str(payload.get("ai_hint") or "").strip() or None

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return serialize_collection(row, db)


@router.delete("/v1/collections/{collection_id}", tags=["collections"], summary="Delete collection")
def v1_delete_collection(
    collection_id: str,
    move_to_collection_id: str | None = None,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["collections.delete"])),
):
    row = db.query(Collection).filter(Collection.id == collection_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Collection not found")

    target_name: str | None = None
    if move_to_collection_id:
        target = db.query(Collection).filter(Collection.id == move_to_collection_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target collection not found")
        if target.id == row.id:
            raise HTTPException(status_code=400, detail="Cannot move items to the same collection")
        target_name = target.name

    db.query(Part).filter(Part.collection == row.name).update({"collection": target_name}, synchronize_session="fetch")
    db.delete(row)
    db.commit()

    return {"ok": True, "target_collection": target_name}


@router.get("/v1/collections/{collection_id}/items", tags=["collections"], summary="List collection items")
def v1_list_collection_items(
    collection_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.read"])),
):
    collection = db.query(Collection).filter(Collection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    return _list_items(db, collection_name=collection.name, limit=limit, offset=offset)


@router.get("/v1/sites", tags=["locations"], summary="List sites")
def v1_list_sites(
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    rows = db.query(Site).order_by(Site.created_at.asc()).offset(offset).limit(limit).all()
    return [serialize_site(site) for site in rows]


@router.post("/v1/sites", tags=["locations"], summary="Create site")
def v1_create_site(
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
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


@router.get("/v1/sites/{site_id}", tags=["locations"], summary="Get site")
def v1_get_site(
    site_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    row = db.query(Site).filter(Site.id == site_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Site not found")
    return serialize_site(row)


@router.patch("/v1/sites/{site_id}", tags=["locations"], summary="Update site")
def v1_update_site(
    site_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
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


@router.delete("/v1/sites/{site_id}", tags=["locations"], summary="Delete site")
def v1_delete_site(
    site_id: str,
    move_to_site_id: str | None = None,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.delete"])),
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


@router.get("/v1/areas", tags=["locations"], summary="List areas")
def v1_list_areas(
    site_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    query = db.query(Area)
    if site_id:
        query = query.filter(Area.site_id == site_id)
    rows = query.order_by(Area.created_at.asc()).offset(offset).limit(limit).all()

    site_ids = [area.site_id for area in rows if area.site_id]
    site_names_by_id: dict[str, str] = {}
    if site_ids:
        sites = db.query(Site.id, Site.name).filter(Site.id.in_(site_ids)).all()
        site_names_by_id = {site_id_value: site_name for site_id_value, site_name in sites}

    return [serialize_area(area, site_name=site_names_by_id.get(area.site_id or "")) for area in rows]


@router.post("/v1/areas", tags=["locations"], summary="Create area")
def v1_create_area(
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
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

    site_name = db.query(Site.name).filter(Site.id == row.site_id).scalar() if row.site_id else None
    return serialize_area(row, site_name=site_name)


@router.get("/v1/areas/{area_id}", tags=["locations"], summary="Get area")
def v1_get_area(
    area_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    row = db.query(Area).filter(Area.id == area_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Area not found")
    site_name = db.query(Site.name).filter(Site.id == row.site_id).scalar() if row.site_id else None
    return serialize_area(row, site_name=site_name)


@router.patch("/v1/areas/{area_id}", tags=["locations"], summary="Update area")
def v1_update_area(
    area_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
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
        row.site_id = _resolve_site_id(db, payload)

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)

    site_name = db.query(Site.name).filter(Site.id == row.site_id).scalar() if row.site_id else None
    return serialize_area(row, site_name=site_name)


@router.delete("/v1/areas/{area_id}", tags=["locations"], summary="Delete area")
def v1_delete_area(
    area_id: str,
    move_to_area_id: str | None = None,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.delete"])),
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


@router.get("/v1/locations", tags=["locations"], summary="List locations")
def v1_list_locations(
    area_id: str | None = None,
    site_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    query = db.query(Location)
    if area_id:
        query = query.filter(Location.area_id == area_id)
    elif site_id:
        area_ids = [row.id for row in db.query(Area.id).filter(Area.site_id == site_id).all()]
        if not area_ids:
            return []
        query = query.filter(Location.area_id.in_(area_ids))

    rows = query.order_by(Location.created_at.asc()).offset(offset).limit(limit).all()
    if not rows:
        return []

    ids = [loc.id for loc in rows]
    counts = dict(
        db.query(Part.location_id, func.count(Part.id))
        .filter(Part.location_id.in_(ids), Part.is_deleted == 0)
        .group_by(Part.location_id)
        .all()
    )

    return [serialize_location(loc, db, item_count=int(counts.get(loc.id, 0))) for loc in rows]


@router.get("/v1/locations/{location_id}", tags=["locations"], summary="Get location")
def v1_get_location(
    location_id: str,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    row = db.query(Location).filter(Location.id == location_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Location not found")
    return serialize_location(row, db)


@router.post("/v1/locations", tags=["locations"], summary="Create location")
def v1_create_location(
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = str(payload.get("description") or "").strip() or None
    icon = str(payload.get("icon") or "").strip() or None
    color = str(payload.get("color") or "").strip() or None
    area_id = _resolve_area_id(db, payload)

    existing = db.query(Location).filter(Location.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")

    row = Location(name=name, description=description, area_id=area_id, icon=icon, color=color)
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize_location(row, db)


@router.patch("/v1/locations/{location_id}", tags=["locations"], summary="Update location")
def v1_update_location(
    location_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.write"])),
):
    row = db.query(Location).filter(Location.id == location_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Location not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = db.query(Location).filter(Location.name == name, Location.id != location_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Location name already exists")
        row.name = name

    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None

    if "area_id" in payload:
        row.area_id = _resolve_area_id(db, payload)

    if "icon" in payload:
        row.icon = str(payload.get("icon") or "").strip() or None

    if "color" in payload:
        row.color = str(payload.get("color") or "").strip() or None

    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return serialize_location(row, db)


@router.delete("/v1/locations/{location_id}", tags=["locations"], summary="Delete location")
def v1_delete_location(
    location_id: str,
    move_to_location_id: str | None = None,
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.delete"])),
):
    row = db.query(Location).filter(Location.id == location_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Location not found")

    target_location_id: str | None = None
    if move_to_location_id:
        target = db.query(Location).filter(Location.id == move_to_location_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target location not found")
        if target.id == row.id:
            raise HTTPException(status_code=400, detail="Cannot move items to the same location")
        target_location_id = target.id

    db.query(Part).filter(Part.location_id == location_id).update({"location_id": target_location_id})
    db.delete(row)
    db.commit()

    return {"ok": True}


@router.get("/v1/locations/{location_id}/items", tags=["locations"], summary="List location items")
def v1_list_location_items(
    location_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["items.read"])),
):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    return _list_items(db, location_name=location.name, limit=limit, offset=offset)
