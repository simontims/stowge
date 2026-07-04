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
    serialize_collection,
    serialize_location,
    serialize_part_detail,
    serialize_part_list,
)
from ..models import Collection, Location, Part

router = APIRouter()


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


@router.get("/v1/locations", tags=["locations"], summary="List locations")
def v1_list_locations(
    limit: int = Query(default=200, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _ctx: ApiKeyAuthContext = Depends(require_api_key_scopes(["locations.read"])),
):
    rows = db.query(Location).order_by(Location.created_at.asc()).offset(offset).limit(limit).all()
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

    existing = db.query(Location).filter(Location.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")

    row = Location(name=name, description=description, icon=icon, color=color)
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
