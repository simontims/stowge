"""Collection CRUD routes + items bootstrap."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import (list_collections_payload,
                                   list_locations_payload,
                                   list_public_ai_settings_payload,
                                   serialize_collection)
from ..models import Collection, Part, User

router = APIRouter()


@router.get("/api/collections")
def list_collections(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_collections_payload(db)


@router.get("/api/items/bootstrap")
def get_items_bootstrap(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return {
        "collections": list_collections_payload(db),
        "locations": list_locations_payload(db),
        "ai_settings": list_public_ai_settings_payload(db),
    }


@router.post("/api/collections")
def create_collection(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    icon = str(payload.get("icon") or "").strip() or None
    color = str(payload.get("color") or "").strip() or None
    description = str(payload.get("description") or "").strip() or None
    ai_hint = str(payload.get("ai_hint") or "").strip() or None

    existing = db.query(Collection).filter(Collection.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists")

    collection = Collection(name=name, icon=icon, color=color, description=description, ai_hint=ai_hint)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return serialize_collection(collection, db)


@router.patch("/api/collections/{collection_id}")
def update_collection(collection_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    collection = db.query(Collection).filter(Collection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        existing = db.query(Collection).filter(Collection.name == name, Collection.id != collection_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Collection name already exists")
        collection.name = name

    if "icon" in payload:
        collection.icon = str(payload.get("icon") or "").strip() or None

    if "color" in payload:
        collection.color = str(payload.get("color") or "").strip() or None

    if "description" in payload:
        collection.description = str(payload.get("description") or "").strip() or None

    if "ai_hint" in payload:
        collection.ai_hint = str(payload.get("ai_hint") or "").strip() or None

    collection.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(collection)
    return serialize_collection(collection, db)


@router.delete("/api/collections/{collection_id}")
def delete_collection(
    collection_id: str,
    move_to_collection_id: str | None = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    collection = db.query(Collection).filter(Collection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    target_name: str | None = None
    if move_to_collection_id:
        target = db.query(Collection).filter(Collection.id == move_to_collection_id).first()
        if not target:
            raise HTTPException(status_code=404, detail="Target collection not found")
        if target.id == collection_id:
            raise HTTPException(status_code=400, detail="Cannot move items to the same collection")
        target_name = target.name

    db.query(Part).filter(Part.collection == collection.name).update(
        {"collection": target_name}, synchronize_session="fetch"
    )

    db.delete(collection)
    db.commit()

    items_moved = (
        db.query(func.count(Part.id))
        .filter(Part.collection == target_name if target_name else Part.collection.is_(None))
        .scalar() or 0
    )
    return {"ok": True, "items_moved": int(items_moved), "target_collection": target_name}
