import base64
import io
import os
import shutil
import uuid
from dataclasses import dataclass
from typing import Tuple, List, Dict

from fastapi import UploadFile, HTTPException
from PIL import Image

ASSETS_DIR = os.getenv("ASSETS_DIR", "/assets")

# AI identify settings — fixed, optimised for token efficiency.
# Always JPEG; sized to match client-side pre-resize so the backend
# pass is usually a no-op but acts as a safety net.
_AI_MAX_EDGE = 1600
_AI_QUALITY  = 85


@dataclass
class ImageConfig:
    """Settings that control how uploaded photos are stored. Sourced from the
    image_settings DB table at request time (see main._get_image_config)."""
    store_original: bool = False
    output_format: str = "webp"    # webp | jpg
    display_max_edge: int = 2048
    display_quality: int = 82
    thumb_max_edge: int = 360
    thumb_quality: int = 70


DEFAULT_IMAGE_CONFIG = ImageConfig()

def ensure_assets_dir():
    os.makedirs(ASSETS_DIR, exist_ok=True)

def _mime_ext(output_format: str) -> Tuple[str, str]:
    if output_format == "webp":
        return "image/webp", "webp"
    return "image/jpeg", "jpg"

def _save_variant(img: Image.Image, max_edge: int, quality: int, folder: str, filename: str, output_format: str) -> Tuple[str, str, int, int]:
    img2 = img.copy()
    img2.thumbnail((max_edge, max_edge))

    out = io.BytesIO()
    mime, ext = _mime_ext(output_format)

    if ext == "webp":
        img2.save(out, format="WEBP", quality=quality, method=6)
    else:
        if img2.mode in ("RGBA", "P"):
            img2 = img2.convert("RGB")
        img2.save(out, format="JPEG", quality=quality, optimize=True)

    out.seek(0)
    rel_path = os.path.join(folder, f"{filename}.{ext}")
    abs_path = os.path.join(ASSETS_DIR, rel_path)
    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    with open(abs_path, "wb") as f:
        f.write(out.read())

    return rel_path, mime, img2.size[0], img2.size[1]

def process_and_store(files: List[UploadFile], config: ImageConfig = DEFAULT_IMAGE_CONFIG) -> List[Dict]:
    ensure_assets_dir()
    stored: List[Dict] = []

    for f in files:
        raw = f.file.read()
        if not raw:
            continue

        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid image: {f.filename}")

        image_id = str(uuid.uuid4())
        folder = image_id

        display_rel, mime, w, h = _save_variant(img, config.display_max_edge, config.display_quality, folder, "display", config.output_format)
        thumb_rel, _, _, _ = _save_variant(img, config.thumb_max_edge, config.thumb_quality, folder, "thumb", config.output_format)

        original_rel = None
        if config.store_original:
            # Full-res variant in configured format (not byte-identical original).
            original_rel, _, _, _ = _save_variant(img, max(img.size), 95, folder, "original", config.output_format)

        stored.append({
            "id": image_id,
            "path_thumb": thumb_rel,
            "path_display": display_rel,
            "path_original": original_rel,
            "mime": mime,
            "width": w,
            "height": h,
        })

    if not stored:
        raise HTTPException(status_code=400, detail="No images provided")

    return stored


def process_for_identify(files: List[UploadFile]) -> List[str]:
    """Produce AI-optimised JPEG base64 strings. Always uses fixed AI constants
    regardless of storage quality settings, to minimise token usage."""
    b64_images: List[str] = []

    for f in files:
        raw = f.file.read()
        if not raw:
            continue

        try:
            img = Image.open(io.BytesIO(raw))
            img.load()
        except Exception:
            raise HTTPException(status_code=400, detail=f"Invalid image: {f.filename}")

        img2 = img.copy()
        img2.thumbnail((_AI_MAX_EDGE, _AI_MAX_EDGE))
        if img2.mode in ("RGBA", "P"):
            img2 = img2.convert("RGB")

        out = io.BytesIO()
        img2.save(out, format="JPEG", quality=_AI_QUALITY, optimize=True)
        out.seek(0)
        b64_images.append(base64.b64encode(out.read()).decode("ascii"))

    if not b64_images:
        raise HTTPException(status_code=400, detail="No images provided")

    return b64_images

def resolve_path(rel_path: str) -> str:
    abs_path = os.path.join(ASSETS_DIR, rel_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return abs_path


def delete_stored_images(image_ids: List[str]) -> int:
    ensure_assets_dir()
    deleted = 0

    for image_id in set(image_ids):
        folder = os.path.join(ASSETS_DIR, image_id)
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
            deleted += 1

    return deleted
