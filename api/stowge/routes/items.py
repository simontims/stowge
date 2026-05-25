"""Items/parts CRUD, recycle bin, rescan, and SSE event stream."""

import asyncio
import json
from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Request,
                     UploadFile)
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.events import parts_events_since, publish_inventory_change
from ..helpers.serializers import (contents_count_by_item_id, serialize_part_detail,
                                   serialize_part_list, signed_image_url)
from ..images import (b64_from_stored_paths, cleanup_asset_paths,
                      process_and_store)
from ..models import (Collection, ItemContentsEntry, Location, Part,
                      PartImage, User)
from ..openai_id import identify as openai_identify
from .ai_settings import get_image_config, resolve_llm_config_for_request

router = APIRouter()


@router.post("/api/parts")
@router.post("/api/items")
def create_part(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    description = (payload.get("description") or "").strip()
    collection = (payload.get("collection") or "").strip() or None
    location_id = payload.get("location_id")
    status = payload.get("status") or "draft"
    if status not in ("draft", "confirmed"):
        raise HTTPException(status_code=400, detail="status must be draft|confirmed")
    if collection:
        exists = db.query(Collection.id).filter(Collection.name == collection).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Invalid collection")

    normalized_location_id: Optional[str] = None
    if location_id is not None and str(location_id).strip() != "":
        normalized_location_id = str(location_id).strip()
        exists = db.query(Location.id).filter(Location.id == normalized_location_id).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Invalid location.")

    stored_images = payload.get("stored_images") or []

    p = Part(
        name=name,
        description=description or None,
        collection=collection,
        location_id=normalized_location_id,
        status=status,
        quantity=max(0, int(payload.get("quantity") or 0)),
        ai_primary=payload.get("ai_primary"),
        ai_alternatives=payload.get("ai_alternatives"),
        ai_chosen_index=payload.get("ai_chosen_index"),
    )
    db.add(p)
    db.flush()

    for idx, s in enumerate(stored_images):
        img = PartImage(
            id=s["id"],
            part_id=p.id,
            path_thumb=s["path_thumb"],
            path_display=s["path_display"],
            path_original=s.get("path_original"),
            mime=s.get("mime") or "image/webp",
            width=s.get("width"),
            height=s.get("height"),
            is_primary=1 if idx == 0 else 0,
        )
        db.add(img)

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    publish_inventory_change("created", p.id)
    return {"id": p.id}


@router.get("/api/parts")
@router.get("/api/items")
def list_parts(
    q: Optional[str] = None,
    collection: Optional[str] = None,
    location: Optional[str] = None,
    status: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
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

    if collection == "__none":
        query = query.filter(Part.collection.is_(None))
    elif collection:
        query = query.filter(Part.collection.ilike(collection))

    if location:
        query = query.filter(Location.name.ilike(location))

    if status:
        query = query.filter(Part.status == status)

    _valid_sort_keys = {"name", "collection", "location", "status"}
    sort_key = sort_by if sort_by in _valid_sort_keys else "name"
    descending = sort_dir == "desc"

    if sort_key == "name":
        sort_col = Part.name
    elif sort_key == "collection":
        sort_col = Part.collection
    elif sort_key == "location":
        sort_col = Location.name
    else:  # status
        sort_col = Part.status

    query = query.order_by(sort_col.desc() if descending else sort_col.asc())

    parts = query.limit(200).all()

    location_ids = {p.location_id for p in parts if p.location_id}
    location_names: dict[str, str] = {}
    if location_ids:
        location_rows = db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        location_names = {loc_id: loc_name for loc_id, loc_name in location_rows}

    contents_counts = contents_count_by_item_id(db, [p.id for p in parts])
    return [
        serialize_part_list(
            p,
            location_name=(location_names.get(p.location_id) if p.location_id else None),
            contents_count=contents_counts.get(p.id, 0),
        )
        for p in parts
    ]


@router.get("/api/items/deleted")
def list_deleted_items(
    q: Optional[str] = None,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    query = db.query(Part).outerjoin(Location, Part.location_id == Location.id).filter(Part.is_deleted == 1)

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

    parts = query.order_by(Part.updated_at.desc()).limit(500).all()

    location_ids = {p.location_id for p in parts if p.location_id}
    location_names: dict[str, str] = {}
    if location_ids:
        location_rows = db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        location_names = {loc_id: loc_name for loc_id, loc_name in location_rows}

    contents_counts = contents_count_by_item_id(db, [p.id for p in parts])
    return [
        serialize_part_list(
            p,
            location_name=(location_names.get(p.location_id) if p.location_id else None),
            contents_count=contents_counts.get(p.id, 0),
        )
        for p in parts
    ]


@router.post("/api/items/deleted/purge")
def purge_deleted_items(
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    deleted_parts = db.query(Part).filter(Part.is_deleted == 1).all()
    if not deleted_parts:
        return {"deleted": 0}

    cleanup_paths: set[str] = set()
    for part in deleted_parts:
        for img in part.images:
            if img.path_thumb:
                cleanup_paths.add(str(img.path_thumb))
            if img.path_display:
                cleanup_paths.add(str(img.path_display))
            if img.path_original:
                cleanup_paths.add(str(img.path_original))

    deleted_count = len(deleted_parts)
    for part in deleted_parts:
        db.delete(part)

    db.commit()
    if cleanup_paths:
        cleanup_asset_paths(list(cleanup_paths))

    return {"deleted": deleted_count}


@router.get("/api/parts/{part_id}")
@router.get("/api/items/{part_id}")
def get_part(
    part_id: str,
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    query = db.query(Part).filter(Part.id == part_id)
    if not include_deleted:
        query = query.filter(Part.is_deleted == 0)
    p = query.first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    location_name = None
    if p.location_id:
        location = db.query(Location.id, Location.name).filter(Location.id == p.location_id).first()
        if location:
            location_name = location.name

    return serialize_part_detail(p, location_name=location_name)


@router.patch("/api/parts/{part_id}")
@router.patch("/api/items/{part_id}")
def update_part(part_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id, Part.is_deleted == 0).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    if "name" in payload:
        p.name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)

    for field in ("description", "status"):
        if field in payload:
            setattr(p, field, payload[field])

    if "quantity" in payload:
        try:
            p.quantity = max(0, int(payload["quantity"]))
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="quantity must be a non-negative integer")

    if "collection" in payload:
        raw_collection = payload.get("collection")
        collection = (str(raw_collection).strip() if raw_collection is not None else "")
        if not collection:
            p.collection = None
        else:
            exists = db.query(Collection.id).filter(Collection.name == collection).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid collection")
            p.collection = collection

    if "location_id" in payload:
        location_id = payload.get("location_id")
        if location_id is None or str(location_id).strip() == "":
            p.location_id = None
        else:
            exists = db.query(Location.id).filter(Location.id == str(location_id)).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid location.")
            p.location_id = str(location_id)

    if "contents" in payload:
        raw_contents = payload.get("contents")
        if raw_contents is None:
            raw_contents = []
        if not isinstance(raw_contents, list):
            raise HTTPException(status_code=400, detail="contents must be a list")

        db.query(ItemContentsEntry).filter(ItemContentsEntry.item_id == p.id).delete()

        for index, row in enumerate(raw_contents):
            if not isinstance(row, dict):
                raise HTTPException(status_code=400, detail="each contents entry must be an object")
            name = str(row.get("name") or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="contents entry name is required")

            try:
                quantity = max(1, int(row.get("quantity") or 1))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="contents entry quantity must be a positive integer")

            note_raw = row.get("note")
            note = str(note_raw).strip() if note_raw is not None else ""

            db.add(
                ItemContentsEntry(
                    item_id=p.id,
                    name=name,
                    quantity=quantity,
                    note=note or None,
                    sort_order=index,
                )
            )

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.delete("/api/parts/{part_id}")
@router.delete("/api/items/{part_id}")
def delete_part(part_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id, Part.is_deleted == 0).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    p.is_deleted = 1
    p.updated_at = datetime.now(timezone.utc)
    db.commit()

    publish_inventory_change("deleted", part_id)
    return {"ok": True}


@router.post("/api/parts/{part_id}/restore")
@router.post("/api/items/{part_id}/restore")
def restore_part(part_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id, Part.is_deleted == 1).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    p.is_deleted = 0
    p.updated_at = datetime.now(timezone.utc)
    db.commit()

    location_name = None
    if p.location_id:
        location = db.query(Location.id, Location.name).filter(Location.id == p.location_id).first()
        if location:
            _loc_id, location_name = location

    publish_inventory_change("created", part_id)
    contents_count = contents_count_by_item_id(db, [p.id]).get(p.id, 0)
    return {"ok": True, "item": serialize_part_list(p, location_name=location_name, contents_count=contents_count)}


@router.post("/api/parts/{part_id}/rescan")
@router.post("/api/items/{part_id}/rescan")
def rescan_part(
    part_id: str,
    mode: Literal["one", "three", "five"] = "three",
    llm_id: Optional[str] = Query(default=None),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    """Re-identify an existing item using its currently stored images."""
    query = db.query(Part).filter(Part.id == part_id)
    if not include_deleted:
        query = query.filter(Part.is_deleted == 0)
    p = query.first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    if not p.images:
        raise HTTPException(status_code=400, detail="Item has no images to scan")

    cfg = resolve_llm_config_for_request(db, llm_id)
    if not cfg:
        raise HTTPException(status_code=400, detail="No AI models configured. Add one under Settings / AI.")

    rel_paths = [img.path_display or img.path_thumb for img in p.images if img.path_display or img.path_thumb]
    max_edge = cfg.ai_max_edge if cfg.ai_max_edge is not None else 1600
    quality = cfg.ai_quality if cfg.ai_quality is not None else 85

    b64s = b64_from_stored_paths(rel_paths, max_edge=max_edge, quality=quality)
    if not b64s:
        raise HTTPException(status_code=400, detail="Could not read item images")

    collection_context: Optional[str] = None
    if p.collection:
        coll = db.query(Collection).filter(Collection.name == p.collection).first()
        if coll:
            context_parts = [f"Collection name: {coll.name}"]
            if (coll.ai_hint or "").strip():
                context_parts.append(f"Collection hint: {coll.ai_hint.strip()}")
            collection_context = "\n".join(context_parts)

    ai_mode = mode if mode in ("one", "three", "five") else "three"
    ai = openai_identify(
        b64s,
        llm_config={
            "model": cfg.model,
            "api_key": cfg.api_key,
            "api_base": cfg.api_base,
        },
        mode=ai_mode,
        include_evidence=bool(cfg.evidence_enabled),
        collection_context=collection_context,
    )

    return {
        "mode": ai_mode,
        "ai": ai,
    }


@router.get("/api/events/parts")
@router.get("/api/events/items")
async def parts_events(
    request: Request,
    since: int = 0,
    db: Session = Depends(get_db),
    _me: User = Depends(current_user),
):
    async def event_stream():
        last_seq = max(0, int(since))
        heartbeat = 0
        while True:
            if await request.is_disconnected():
                break

            events = parts_events_since(last_seq)
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

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
