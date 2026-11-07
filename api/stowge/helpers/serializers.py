"""Serialization helpers for API response payloads."""

import json
import time

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, object_session

from ..datetime_utils import utc_iso
from ..image_signing import sign as sign_image
from ..image_signing import ttl_seconds
from ..datetime_utils import now_utc
from ..whats_new import whats_new_for_user
from ..models import (AiHint, ApiKey, Area, ItemContentsEntry, ItemTag,
                      LLMConfig, Location, Part, PartImage, Site, Tag, User)
from ..tags_migration import migration_summary
from .ai_providers import resolve_llm_config
from .shortcut_style import lenient_color, lenient_icon


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


def location_icon_url(location_id: str) -> str:
    return f"/api/locations/{location_id}/icon"


def parse_preferred_tag_ids(raw: str | None) -> list[str]:
    """Stored JSON list of sticky tag ids -> clean list (blank entries and duplicates dropped)."""
    out: list[str] = []
    if not raw:
        return out
    try:
        parsed = json.loads(raw)
    except Exception:
        return out
    if not isinstance(parsed, list):
        return out
    for entry in parsed:
        value = str(entry).strip()
        if value and value not in out:
            out.append(value)
    return out


def serialize_user(user: User) -> dict:
    parsed_shortcut_filters: list[dict] = []

    def _optional_non_negative_int(value: object) -> int | None:
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            parsed = int(text)
        except Exception:
            return None
        return parsed if parsed >= 0 else None

    def _normalize_status(value: object) -> str | None:
        normalized = str(value or "").strip()
        return normalized or None

    if user.shortcut_filters:
        try:
            raw_shortcuts = json.loads(user.shortcut_filters)
            if isinstance(raw_shortcuts, list):
                for entry in raw_shortcuts:
                    if not isinstance(entry, dict):
                        continue
                    entry_id = str(entry.get("id") or "").strip()
                    entry_name = str(entry.get("name") or "").strip()
                    if not entry_id or not entry_name:
                        continue
                    entry_query = str(entry.get("query") or "").strip()
                    # Old stored "collection" keys are dropped on read; only tag_id survives.
                    entry_tag_id = str(entry.get("tag_id") or "").strip() or None
                    entry_statuses: list[str] = []
                    raw_statuses = entry.get("statuses")
                    if isinstance(raw_statuses, list):
                        seen_statuses: set[str] = set()
                        for status_entry in raw_statuses:
                            normalized_status = _normalize_status(status_entry)
                            if not normalized_status or normalized_status in seen_statuses:
                                continue
                            seen_statuses.add(normalized_status)
                            entry_statuses.append(normalized_status)

                    entry_status = _normalize_status(entry.get("status"))
                    if not entry_statuses and entry_status:
                        entry_statuses = [entry_status]
                    entry_site_id = str(entry.get("site_id") or "").strip() or None
                    entry_area_id = str(entry.get("area_id") or "").strip() or None
                    entry_location_id = str(entry.get("location_id") or "").strip() or None
                    entry_quantity_min = _optional_non_negative_int(entry.get("quantity_min"))
                    entry_quantity_max = _optional_non_negative_int(entry.get("quantity_max"))
                    if (
                        entry_quantity_min is not None
                        and entry_quantity_max is not None
                        and entry_quantity_min > entry_quantity_max
                    ):
                        entry_quantity_min, entry_quantity_max = entry_quantity_max, entry_quantity_min

                    parsed_shortcut_filters.append({
                        "id": entry_id,
                        "name": entry_name,
                        "query": entry_query,
                        "tag_id": entry_tag_id,
                        "statuses": entry_statuses,
                        "status": entry_statuses[0] if len(entry_statuses) == 1 else None,
                        "site_id": entry_site_id,
                        "area_id": entry_area_id,
                        "location_id": entry_location_id,
                        "quantity_min": entry_quantity_min,
                        "quantity_max": entry_quantity_max,
                        "pinned": bool(entry.get("pinned")),
                        "icon": lenient_icon(entry.get("icon")),
                        "color": lenient_color(entry.get("color")),
                    })
        except Exception:
            parsed_shortcut_filters = []

    whats_new = whats_new_for_user(user.last_seen_note or 0, user.welcome_seen_version or 0)
    session = object_session(user)
    whats_new["tags_migration"] = (
        migration_summary(session) if session is not None else {"collections_converted": 0, "filters_skipped": 0}
    )

    return {
        "id": user.id,
        "email": user.username,
        "firstname": user.first_name or "",
        "lastname": user.last_name or "",
        "role": user.role,
        "theme": user.theme or "dark",
        "preferred_add_hint_id": user.preferred_add_hint_id,
        "preferred_add_tag_ids": parse_preferred_tag_ids(user.preferred_add_tag_ids),
        "preferred_add_location_id": user.preferred_add_location_id,
        "last_open_tag": user.last_open_tag,
        "shortcut_filters": parsed_shortcut_filters,
        "whats_new": whats_new,
        "created_at": utc_iso(user.created_at),
        "last_login_at": utc_iso(user.last_login_at),
    }


def serialize_location(location: Location, db: Session, item_count: int | None = None) -> dict:
    if item_count is None:
        item_count = db.query(Part).filter(Part.location_id == location.id, Part.is_deleted == 0).count()
    area_name: str | None = None
    site_id: str | None = None
    site_name: str | None = None
    if location.area_id:
        area = db.query(Area).filter(Area.id == location.area_id).first()
        if area:
            area_name = area.name
            site_id = area.site_id
            if site_id:
                site = db.query(Site).filter(Site.id == site_id).first()
                site_name = site.name if site else None
    return {
        "id": location.id,
        "name": location.name,
        "description": location.description,
        "area_id": location.area_id,
        "area_name": area_name,
        "site_id": site_id,
        "site_name": site_name,
        "icon": location.icon,
        "color": location.color,
        "item_count": int(item_count),
        "photo_url": (location_photo_url(location.id) if location.photo_path else None),
        "icon_url": (location_icon_url(location.id) if location.icon_path else None),
        "created_at": utc_iso(location.created_at),
        "updated_at": utc_iso(location.updated_at),
    }


def serialize_site(site: Site) -> dict:
    return {
        "id": site.id,
        "name": site.name,
        "description": site.description,
        "created_at": utc_iso(site.created_at),
        "updated_at": utc_iso(site.updated_at),
    }


def serialize_area(area: Area, site_name: str | None = None) -> dict:
    return {
        "id": area.id,
        "name": area.name,
        "description": area.description,
        "site_id": area.site_id,
        "site_name": site_name,
        "created_at": utc_iso(area.created_at),
        "updated_at": utc_iso(area.updated_at),
    }


def serialize_tag(tag: Tag, item_count: int = 0) -> dict:
    return {
        "id": tag.id,
        "name": tag.name,
        "icon": tag.icon,
        "color": tag.color,
        "description": tag.description,
        "item_count": int(item_count),
    }


def tag_item_counts(db: Session, tag_ids: list[str] | None = None) -> dict[str, int]:
    """Active (not soft-deleted) item count per tag id."""
    query = (
        db.query(ItemTag.tag_id, func.count(ItemTag.item_id))
        .join(Part, Part.id == ItemTag.item_id)
        .filter(Part.is_deleted == 0)
    )
    if tag_ids is not None:
        query = query.filter(ItemTag.tag_id.in_(tag_ids))
    return {str(tag_id): int(count) for tag_id, count in query.group_by(ItemTag.tag_id).all()}


def serialize_hint(hint: AiHint) -> dict:
    return {
        "id": hint.id,
        "name": hint.name,
        "text": hint.text or "",
        "is_default": bool(hint.is_default),
    }


def list_hints_payload(db: Session) -> list[dict]:
    """Default first, then the rest by name (case-insensitive)."""
    hints = db.query(AiHint).order_by(AiHint.is_default.desc(), func.lower(AiHint.name).asc()).all()
    return [serialize_hint(h) for h in hints]


def tags_by_item_id(db: Session, item_ids: list[str]) -> dict[str, list[dict]]:
    """``{item_id: [{id, name, icon, color}, ...]}`` ordered by tag name (case-insensitive)."""
    out: dict[str, list[dict]] = {}
    if not item_ids:
        return out
    # Chunked to stay clear of SQLite's bound-parameter limit.
    for start in range(0, len(item_ids), 500):
        chunk = item_ids[start:start + 500]
        rows = (
            db.query(ItemTag.item_id, Tag.id, Tag.name, Tag.icon, Tag.color)
            .join(Tag, Tag.id == ItemTag.tag_id)
            .filter(ItemTag.item_id.in_(chunk))
            .all()
        )
        for item_id, tag_id, name, icon, color in rows:
            out.setdefault(str(item_id), []).append({"id": tag_id, "name": name, "icon": icon, "color": color})
    for tags in out.values():
        tags.sort(key=lambda t: (str(t["name"]).lower(), str(t["name"])))
    return out


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


def list_sites_payload(db: Session) -> list[dict]:
    sites = db.query(Site).order_by(Site.created_at.asc()).all()
    return [serialize_site(site) for site in sites]


def list_areas_payload(db: Session) -> list[dict]:
    areas = db.query(Area).order_by(Area.created_at.asc()).all()
    if not areas:
        return []
    site_ids = [area.site_id for area in areas if area.site_id]
    site_names_by_id: dict[str, str] = {}
    if site_ids:
        sites = db.query(Site.id, Site.name).filter(Site.id.in_(site_ids)).all()
        site_names_by_id = {site_id: site_name for site_id, site_name in sites}
    return [serialize_area(area, site_names_by_id.get(area.site_id or "")) for area in areas]


def list_tags_payload(db: Session) -> list[dict]:
    tags = db.query(Tag).order_by(Tag.created_at.asc(), Tag.name.asc()).all()
    if not tags:
        return []
    counts = tag_item_counts(db)
    return [serialize_tag(tag, item_count=counts.get(tag.id, 0)) for tag in tags]


def list_public_ai_settings_payload(db: Session) -> dict:
    configs = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).all()
    active = resolve_llm_config(db)
    return {
        "default_llm_id": active.id if active else None,
        "configs": [serialize_llm_public(c) for c in configs],
    }


def _tags_for_part(part: Part, tags: list | None) -> list:
    if tags is not None:
        return tags
    session = object_session(part)
    return tags_by_item_id(session, [part.id]).get(part.id, []) if session is not None else []


def serialize_part_list(
    part: Part,
    location_name: str | None = None,
    contents_count: int = 0,
    tags: list | None = None,
) -> dict:
    primary_image = next((img for img in part.images if img.is_primary), part.images[0]) if part.images else None
    return {
        "id": part.id,
        "name": part.name,
        "description": part.description,
        "tags": _tags_for_part(part, tags),
        "location": location_name,
        "status": part.status,
        "quantity": part.quantity if part.quantity is not None else 1,
        "contents_count": int(contents_count),
        "created_at": part.created_at.isoformat(),
        "thumb": (signed_image_url(primary_image.id, "thumb") if primary_image else None),
    }


def serialize_part_detail(part: Part, location_name: str | None = None, tags: list | None = None) -> dict:
    return {
        "id": part.id,
        "is_deleted": bool(part.is_deleted),
        "name": part.name,
        "description": part.description,
        "tags": _tags_for_part(part, tags),
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


def parse_scopes_json(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except Exception:
        return []
    if not isinstance(parsed, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for raw in parsed:
        scope = str(raw).strip()
        if not scope or scope in seen:
            continue
        seen.add(scope)
        out.append(scope)
    return out


def serialize_api_key(
    api_key: ApiKey,
    *,
    owner_email: str | None = None,
    created_by_email: str | None = None,
    revoked_by_email: str | None = None,
) -> dict:
    now = now_utc()
    status = "active"
    if api_key.revoked_at is not None:
        status = "revoked"
    elif api_key.expires_at is not None and api_key.expires_at <= now:
        status = "expired"

    return {
        "id": api_key.id,
        "key_type": api_key.key_type,
        "name": api_key.name,
        "key_prefix": api_key.key_prefix,
        "owner_user_id": api_key.user_id,
        "owner_email": owner_email,
        "scopes": parse_scopes_json(api_key.scopes_json),
        "status": status,
        "created_by_user_id": api_key.created_by_user_id,
        "created_by_email": created_by_email,
        "created_at": utc_iso(api_key.created_at),
        "last_used_at": utc_iso(api_key.last_used_at),
        "expires_at": utc_iso(api_key.expires_at),
        "revoked_at": utc_iso(api_key.revoked_at),
        "revoked_by_user_id": api_key.revoked_by_user_id,
        "revoked_by_email": revoked_by_email,
        "revoked_reason": api_key.revoked_reason,
    }
