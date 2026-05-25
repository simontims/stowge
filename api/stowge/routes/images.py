"""Image serving, upload, deletion, and image processing settings.

Also provides shared helpers used by other route modules:
- get_image_config(db) - cached image processing configuration
"""

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import (APIRouter, Depends, File, HTTPException, Query, Request,
                     UploadFile)
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_db
from ..helpers.events import publish_inventory_change
from ..helpers.serializers import signed_image_url, variant_rel
from ..image_signing import verify as verify_image
from ..images import (DEFAULT_IMAGE_CONFIG, ImageConfig, cleanup_asset_paths,
                      delete_stored_images, process_and_store, resolve_path)
from ..models import ImageSettings, Part, PartImage, User

router = APIRouter()

# ---------------------------------------------------------------------------
# Image config cache (shared with other route modules)
# ---------------------------------------------------------------------------

_image_config_cache: ImageConfig | None = None


def get_image_config(db: Session) -> ImageConfig:
    global _image_config_cache
    if _image_config_cache is not None:
        return _image_config_cache
    row = db.query(ImageSettings).filter(ImageSettings.id == "singleton").first()
    if not row:
        _image_config_cache = DEFAULT_IMAGE_CONFIG
    else:
        _image_config_cache = ImageConfig(
            store_original=bool(row.store_original),
            output_format=row.output_format or DEFAULT_IMAGE_CONFIG.output_format,
            display_max_edge=row.display_max_edge or DEFAULT_IMAGE_CONFIG.display_max_edge,
            display_quality=row.display_quality or DEFAULT_IMAGE_CONFIG.display_quality,
            thumb_max_edge=row.thumb_max_edge or DEFAULT_IMAGE_CONFIG.thumb_max_edge,
            thumb_quality=row.thumb_quality or DEFAULT_IMAGE_CONFIG.thumb_quality,
        )
    return _image_config_cache


def _serialize_image_settings(row: ImageSettings) -> dict:
    return {
        "store_original": bool(row.store_original),
        "output_format": row.output_format,
        "display_max_edge": row.display_max_edge,
        "display_quality": row.display_quality,
        "thumb_max_edge": row.thumb_max_edge,
        "thumb_quality": row.thumb_quality,
    }


# ---------------------------------------------------------------------------
# Image Settings Admin
# ---------------------------------------------------------------------------

@router.get("/api/admin/settings/images")
def get_image_settings(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    row = db.query(ImageSettings).filter(ImageSettings.id == "singleton").first()
    if not row:
        cfg = DEFAULT_IMAGE_CONFIG
        return {
            "store_original": cfg.store_original,
            "output_format": cfg.output_format,
            "display_max_edge": cfg.display_max_edge,
            "display_quality": cfg.display_quality,
            "thumb_max_edge": cfg.thumb_max_edge,
            "thumb_quality": cfg.thumb_quality,
        }
    return _serialize_image_settings(row)


@router.patch("/api/admin/settings/images")
def update_image_settings(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    global _image_config_cache
    row = db.query(ImageSettings).filter(ImageSettings.id == "singleton").first()
    if not row:
        row = ImageSettings(id="singleton")
        db.add(row)

    if "store_original" in payload:
        row.store_original = 1 if payload["store_original"] else 0
    if "output_format" in payload:
        fmt = str(payload["output_format"]).lower()
        if fmt not in ("webp", "jpg"):
            raise HTTPException(status_code=400, detail="output_format must be webp or jpg")
        row.output_format = fmt
    if "display_max_edge" in payload:
        v = int(payload["display_max_edge"])
        if not (256 <= v <= 8192):
            raise HTTPException(status_code=400, detail="display_max_edge must be 256-8192")
        row.display_max_edge = v
    if "display_quality" in payload:
        try:
            raw = payload["display_quality"]
            v = int(raw) if raw is not None and str(raw).strip() != "" else 1
        except (TypeError, ValueError):
            v = 1
        v = max(1, v)
        if v > 100:
            raise HTTPException(status_code=400, detail="display_quality must be 1-100")
        row.display_quality = v
    if "thumb_max_edge" in payload:
        v = int(payload["thumb_max_edge"])
        if not (64 <= v <= 1024):
            raise HTTPException(status_code=400, detail="thumb_max_edge must be 64-1024")
        row.thumb_max_edge = v
    if "thumb_quality" in payload:
        try:
            raw = payload["thumb_quality"]
            v = int(raw) if raw is not None and str(raw).strip() != "" else 1
        except (TypeError, ValueError):
            v = 1
        v = max(1, v)
        if v > 100:
            raise HTTPException(status_code=400, detail="thumb_quality must be 1-100")
        row.thumb_quality = v

    row.updated_at = datetime.now(timezone.utc)
    _image_config_cache = None
    db.commit()
    db.refresh(row)
    return _serialize_image_settings(row)


# ---------------------------------------------------------------------------
# Image Store / Discard (pre-attach to items)
# ---------------------------------------------------------------------------

@router.post("/api/images/store")
def store_images_only(
    images: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    stored = process_and_store(images, get_image_config(db))
    return {
        "uploaded_images": [
            {"id": s["id"], "thumb_url": signed_image_url(s["id"], "thumb")}
            for s in stored
        ],
        "stored_images": stored,
    }


@router.post("/api/images/discard")
def discard_images(
    payload: dict,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    raw_ids = payload.get("image_ids") or []
    image_ids = [str(i).strip() for i in raw_ids if str(i).strip()]
    if not image_ids:
        return {"requested": 0, "deleted": 0, "skipped_linked": 0}

    linked_rows = db.query(PartImage.id).filter(PartImage.id.in_(image_ids)).all()
    linked_ids = {row[0] for row in linked_rows}
    deletable_ids = [image_id for image_id in image_ids if image_id not in linked_ids]

    deleted = delete_stored_images(deletable_ids)
    return {
        "requested": len(image_ids),
        "deleted": deleted,
        "skipped_linked": len(linked_ids),
    }


# ---------------------------------------------------------------------------
# Image CRUD on Items
# ---------------------------------------------------------------------------

@router.post("/api/parts/{part_id}/images")
@router.post("/api/items/{part_id}/images")
def add_images_to_part(
    part_id: str,
    images: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    p = db.query(Part).filter(Part.id == part_id, Part.is_deleted == 0).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    stored = process_and_store(images, get_image_config(db))
    existing_count = db.query(PartImage).filter(PartImage.part_id == part_id).count()

    for idx, s in enumerate(stored):
        img = PartImage(
            id=s["id"],
            part_id=part_id,
            path_thumb=s["path_thumb"],
            path_display=s["path_display"],
            path_original=s.get("path_original"),
            mime=s.get("mime") or "image/webp",
            width=s.get("width"),
            height=s.get("height"),
            is_primary=1 if existing_count == 0 and idx == 0 else 0,
        )
        db.add(img)

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    publish_inventory_change("updated", part_id)

    return {
        "added": len(stored),
        "images": [{
            "id": s["id"],
            "thumb_url": signed_image_url(s["id"], "thumb"),
            "display_url": signed_image_url(s["id"], "display"),
            "original_url": (signed_image_url(s["id"], "original") if s.get("path_original") else None),
            "is_primary": existing_count == 0 and i == 0,
        } for i, s in enumerate(stored)],
    }


@router.post("/api/images/{image_id}/set-primary")
def set_primary_image(
    image_id: str,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")
    db.query(PartImage).filter(PartImage.part_id == img.part_id).update({"is_primary": 0})
    img.is_primary = 1
    db.commit()
    publish_inventory_change("updated", img.part_id)
    return {"ok": True}


@router.delete("/api/images/{image_id}")
def delete_image(
    image_id: str,
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")

    part_id = img.part_id
    was_primary = bool(img.is_primary)

    paths = [p for p in [img.path_thumb, img.path_display, img.path_original] if p]
    db.delete(img)
    db.flush()

    if was_primary:
        remaining = db.query(PartImage).filter(PartImage.part_id == part_id).order_by(PartImage.created_at.asc()).first()
        if remaining:
            remaining.is_primary = 1

    db.commit()
    cleanup_asset_paths(paths)
    publish_inventory_change("updated", part_id)
    return {"ok": True}


@router.get("/api/images/{image_id}/signed")
def get_signed_image_url(
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")
    _ = variant_rel(img, variant)
    return {"url": signed_image_url(image_id, variant)}


@router.get("/api/images/{image_id}")
def get_image(
    request: Request,
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    exp: Optional[int] = Query(default=None),
    sig: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    auth = request.headers.get("authorization")
    if auth:
        _ = current_user(Authorization=auth, db=db)
    else:
        if exp is None or sig is None or not verify_image(image_id, variant, exp, sig):
            raise HTTPException(status_code=401, detail="Missing bearer token")

    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")

    rel = variant_rel(img, variant)
    abs_path = resolve_path(rel)
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    return FileResponse(abs_path, media_type=img.mime, headers=headers)
