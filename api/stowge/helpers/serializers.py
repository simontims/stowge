"""Serialization helpers for API response payloads."""

import json
import time

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..datetime_utils import utc_iso
from ..image_signing import sign as sign_image
from ..image_signing import ttl_seconds
from ..models import (Collection, ItemContentsEntry, LLMConfig, Location, Part,
                      PartImage, User)
from .ai_providers import resolve_llm_config


def signed_image_url(image_id: str, variant: str) -> str:
    exp = int(time.time()) + ttl_seconds()
    sig = sign_image(image_id, variant, exp)
    return f"/api/images/{image_id}?variant={variant}&exp={exp}&sig={sig}"


def variant_rel(img: PartImage, variant: str) -> str:
    if variant == "thumb":
        return img.path_thumb
    if variant == "display":
        return img.path_display
    if variant == "original":
        if not img.path_original:
            raise HTTPException(status_code=404, detail="Original not stored")
        return img.path_original
    raise HTTPException(status_code=400, detail="Invalid variant")


def mask_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def location_photo_url(location_id: str) -> str:
    return f"/api/locations/{location_id}/photo"


def serialize_user(user: User) -> dict:
    parsed_collection_nav_order: list[str] = []
    if user.collection_nav_order:
        try:
            raw_order = json.loads(user.collection_nav_order)
            if isinstance(raw_order, list):
                parsed_collection_nav_order = [str(item).strip() for item in raw_order if str(item).strip()]
        except Exception:
            parsed_collection_nav_order = []

    return {
        "id": user.id,
        "email": user.username,
        "firstname": user.first_name or "",
        "lastname": user.last_name or "",
        "role": user.role,
        "theme": user.theme or "dark",
        "preferred_add_collection_id": user.preferred_add_collection_id,
        "preferred_add_location_id": user.preferred_add_location_id,
        "last_open_collection": user.last_open_collection,
        "collection_nav_order": parsed_collection_nav_order,
        "created_at": utc_iso(user.created_at),
        "last_login_at": utc_iso(user.last_login_at),
    }


def serialize_location(location: Location, db: Session, item_count: int | None = None) -> dict:
    if item_count is None:
        item_count = db.query(Part).filter(Part.location_id == location.id, Part.is_deleted == 0).count()
    return {
        "id": location.id,
        "name": location.name,
        "description": location.description,
        "item_count": int(item_count),
        "photo_url": (location_photo_url(location.id) if location.photo_path else None),
        "created_at": utc_iso(location.created_at),
        "updated_at": utc_iso(location.updated_at),
    }


def serialize_collection(collection: Collection, db: Session, item_count: int | None = None) -> dict:
    if item_count is None:
        item_count = db.query(Part).filter(Part.collection == collection.name, Part.is_deleted == 0).count()
    return {
        "id": collection.id,
        "name": collection.name,
        "icon": collection.icon,
        "color": collection.color,
        "description": collection.description,
        "ai_hint": collection.ai_hint,
        "item_count": int(item_count),
        "created_at": utc_iso(collection.created_at),
        "updated_at": utc_iso(collection.updated_at),
    }


def list_locations_payload(db: Session) -> list[dict]:
    locations = db.query(Location).order_by(Location.created_at.asc()).all()
    if not locations:
        return []
    counts: dict[str, int] = dict(
        db.query(Part.location_id, func.count(Part.id))
        .filter(Part.location_id.in_([loc.id for loc in locations]))
        .filter(Part.is_deleted == 0)
        .group_by(Part.location_id)
        .all()
    )
    return [serialize_location(loc, db, item_count=int(counts.get(loc.id, 0))) for loc in locations]


def list_collections_payload(db: Session) -> list[dict]:
    collections = db.query(Collection).order_by(Collection.created_at.asc()).all()
    if not collections:
        return []
    counts: dict[str, int] = dict(
        db.query(Part.collection, func.count(Part.id))
        .filter(Part.collection.in_([col.name for col in collections]))
        .filter(Part.is_deleted == 0)
        .group_by(Part.collection)
        .all()
    )
    return [serialize_collection(col, db, item_count=int(counts.get(col.name, 0))) for col in collections]


def list_public_ai_settings_payload(db: Session) -> dict:
    configs = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).all()
    active = resolve_llm_config(db)
    return {
        "default_llm_id": active.id if active else None,
        "configs": [serialize_llm_public(c) for c in configs],
    }


def serialize_part_list(part: Part, location_name: str | None = None, contents_count: int = 0) -> dict:
    primary_image = next((img for img in part.images if img.is_primary), part.images[0]) if part.images else None
    return {
        "id": part.id,
        "name": part.name,
        "description": part.description,
        "collection": part.collection,
        "location": location_name,
        "status": part.status,
        "quantity": part.quantity if part.quantity is not None else 1,
        "contents_count": int(contents_count),
        "created_at": part.created_at.isoformat(),
        "thumb": (signed_image_url(primary_image.id, "thumb") if primary_image else None),
    }


def serialize_part_detail(part: Part, location_name: str | None = None) -> dict:
    return {
        "id": part.id,
        "is_deleted": bool(part.is_deleted),
        "name": part.name,
        "description": part.description,
        "collection": part.collection,
        "location_id": part.location_id,
        "location": location_name,
        "status": part.status,
        "quantity": part.quantity if part.quantity is not None else 1,
        "created_at": part.created_at.isoformat(),
        "updated_at": part.updated_at.isoformat(),
        "images": [{
            "id": img.id,
            "thumb_url": signed_image_url(img.id, "thumb"),
            "display_url": signed_image_url(img.id, "display"),
            "original_url": (signed_image_url(img.id, "original") if img.path_original else None),
            "is_primary": bool(img.is_primary),
        } for img in part.images],
        "contents": [{
            "id": entry.id,
            "name": entry.name,
            "quantity": entry.quantity if entry.quantity is not None else 1,
            "note": entry.note,
        } for entry in part.contents],
        "ai_primary": part.ai_primary,
        "ai_alternatives": part.ai_alternatives,
        "ai_chosen_index": part.ai_chosen_index,
    }


def contents_count_by_item_id(db: Session, item_ids: list[str]) -> dict[str, int]:
    if not item_ids:
        return {}
    rows = (
        db.query(ItemContentsEntry.item_id, func.count(ItemContentsEntry.id))
        .filter(ItemContentsEntry.item_id.in_(item_ids))
        .group_by(ItemContentsEntry.item_id)
        .all()
    )
    return {str(item_id): int(count) for item_id, count in rows}


def serialize_llm_public(cfg: LLMConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "provider": cfg.provider,
        "model": cfg.model,
        "api_base": cfg.api_base,
        "is_default": bool(cfg.is_default),
        "is_validated": bool(cfg.validated_at),
        "validated_at": utc_iso(cfg.validated_at),
        "evidence_enabled": bool(cfg.evidence_enabled),
        "ai_max_edge": cfg.ai_max_edge if cfg.ai_max_edge is not None else 1600,
        "ai_quality": cfg.ai_quality if cfg.ai_quality is not None else 85,
    }


def serialize_llm_admin(cfg: LLMConfig) -> dict:
    data = serialize_llm_public(cfg)
    data["api_key_masked"] = mask_key(cfg.api_key)
    data["created_at"] = utc_iso(cfg.created_at)
    data["updated_at"] = utc_iso(cfg.updated_at)
    return data
