"""Tag CRUD routes + items bootstrap."""

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..ai_hints import ensure_default_hint
from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import (list_areas_payload, list_hints_payload,
                                   list_locations_payload,
                                   list_public_ai_settings_payload,
                                   list_sites_payload, list_tags_payload,
                                   parse_preferred_tag_ids, serialize_tag,
                                   tag_item_counts)
from ..models import ItemTag, Part, Tag, User

router = APIRouter()


def require_tag_name(raw: object) -> str:
    """Validated tag name. ';' is the separator in CSV import/export, so it cannot be part of a name."""
    name = require_name(raw, min_length=MIN_NAME_LENGTH)
    if ";" in name:
        raise HTTPException(status_code=400, detail="Tag names cannot contain ';'")
    return name


def find_tag_by_name(db: Session, name: str, exclude_id: str | None = None) -> Tag | None:
    """Case-insensitive lookup (same folding as the unique index on lower(name))."""
    query = db.query(Tag).filter(func.lower(Tag.name) == func.lower(name))
    if exclude_id:
        query = query.filter(Tag.id != exclude_id)
    return query.first()


def _users_with_last_open_tag(db: Session, name: str) -> list[User]:
    # Fold both sides in SQLite (like the unique index on lower(name)): Python's lower() also
    # folds non-ASCII letters, SQLite's does not, so 'Écran' would never match.
    return db.query(User).filter(func.lower(User.last_open_tag) == func.lower(name)).all()


def rename_tag_references(db: Session, old_name: str, new_name: str) -> None:
    """last_open_tag holds the tag NAME: follow a rename so the post-login route still works."""
    for user in _users_with_last_open_tag(db, old_name):
        user.last_open_tag = new_name


def clear_last_open_tag(db: Session, name: str) -> None:
    """Forget a deleted tag's name as every user's last opened tag."""
    for user in _users_with_last_open_tag(db, name):
        user.last_open_tag = None


def forget_tag_for_users(db: Session, tag_id: str) -> None:
    """Remove a deleted tag from every user's sticky tags and delete the pinned filters that point at it."""
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if tag:
        clear_last_open_tag(db, tag.name)
    for user in db.query(User).filter((User.preferred_add_tag_ids.isnot(None)) | (User.shortcut_filters.isnot(None))).all():
        if user.preferred_add_tag_ids:
            kept = [t for t in parse_preferred_tag_ids(user.preferred_add_tag_ids) if t != tag_id]
            user.preferred_add_tag_ids = json.dumps(kept) if kept else None
        if user.shortcut_filters:
            try:
                filters = json.loads(user.shortcut_filters)
            except Exception:
                filters = None
            if isinstance(filters, list):
                kept_filters = [f for f in filters if not (isinstance(f, dict) and f.get("tag_id") == tag_id)]
                if len(kept_filters) != len(filters):
                    user.shortcut_filters = json.dumps(kept_filters) if kept_filters else None


def delete_tag_and_references(db: Session, tag: Tag) -> int:
    """Delete a tag, its item links, and every user reference to it. Returns how many active items lost it."""
    items_untagged = tag_item_counts(db, [tag.id]).get(tag.id, 0)
    db.query(ItemTag).filter(ItemTag.tag_id == tag.id).delete(synchronize_session=False)
    forget_tag_for_users(db, tag.id)
    db.delete(tag)
    db.commit()
    return int(items_untagged)


@router.get("/api/tags")
def list_tags(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_tags_payload(db)


@router.get("/api/items/bootstrap")
def get_items_bootstrap(db: Session = Depends(get_db), me: User = Depends(current_user)):
    status_rows = (
        db.query(Part.status)
        .filter(Part.is_deleted == 0)
        .filter(Part.status.isnot(None))
        .distinct()
        .order_by(Part.status.asc())
        .all()
    )
    statuses = [str(status).strip() for (status,) in status_rows if str(status or "").strip()]
    ensure_default_hint(db)

    return {
        "tags": list_tags_payload(db),
        "hints": list_hints_payload(db),
        "sites": list_sites_payload(db),
        "areas": list_areas_payload(db),
        "locations": list_locations_payload(db),
        "statuses": statuses,
        "ai_settings": list_public_ai_settings_payload(db),
    }


@router.post("/api/tags")
def create_tag(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_tag_name(payload.get("name"))
    icon = str(payload.get("icon") or "").strip() or None
    color = str(payload.get("color") or "").strip() or None
    description = str(payload.get("description") or "").strip() or None

    if find_tag_by_name(db, name):
        raise HTTPException(status_code=400, detail="Tag name already exists")

    tag = Tag(name=name, icon=icon, color=color, description=description)
    db.add(tag)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request took the name between the check and the insert
        db.rollback()
        raise HTTPException(status_code=400, detail="Tag name already exists")
    db.refresh(tag)
    return serialize_tag(tag, 0)


@router.patch("/api/tags/{tag_id}")
def update_tag(tag_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    if "name" in payload:
        name = require_tag_name(payload.get("name"))
        if find_tag_by_name(db, name, exclude_id=tag_id):
            raise HTTPException(status_code=400, detail="Tag name already exists")
        old_name = tag.name
        tag.name = name
        if old_name != name:
            rename_tag_references(db, old_name, name)

    if "icon" in payload:
        tag.icon = str(payload.get("icon") or "").strip() or None

    if "color" in payload:
        tag.color = str(payload.get("color") or "").strip() or None

    if "description" in payload:
        tag.description = str(payload.get("description") or "").strip() or None

    tag.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request took the name between the check and the update
        db.rollback()
        raise HTTPException(status_code=400, detail="Tag name already exists")
    db.refresh(tag)
    return serialize_tag(tag, tag_item_counts(db, [tag.id]).get(tag.id, 0))


@router.delete("/api/tags/{tag_id}")
def delete_tag(tag_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    return {"ok": True, "items_untagged": delete_tag_and_references(db, tag)}
