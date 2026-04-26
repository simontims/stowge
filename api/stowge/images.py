import base64
import io
import os
import uuid
from dataclasses import dataclass
from typing import Tuple, List, Dict

from fastapi import UploadFile, HTTPException
from PIL import Image
from .image_defaults import (
    IMAGE_DISPLAY_MAX_EDGE_DEFAULT,
    IMAGE_DISPLAY_QUALITY_DEFAULT,
    IMAGE_OUTPUT_FORMAT_DEFAULT,
    IMAGE_STORE_ORIGINAL_DEFAULT,
    IMAGE_THUMB_MAX_EDGE_DEFAULT,
    IMAGE_THUMB_QUALITY_DEFAULT,
)

def assets_dir() -> str:
    return os.getenv("ASSETS_DIR", "/assets")

# AI identify settings — fixed, optimised for token efficiency.
# Always JPEG; sized to match client-side pre-resize so the backend
# pass is usually a no-op but acts as a safety net.
_AI_MAX_EDGE = 1600
_AI_QUALITY  = 85


@dataclass
class ImageConfig:
    """Settings that control how uploaded photos are stored. Sourced from the
    image_settings DB table at request time (see main._get_image_config)."""
    store_original: bool = IMAGE_STORE_ORIGINAL_DEFAULT
    output_format: str = IMAGE_OUTPUT_FORMAT_DEFAULT    # webp | jpg
    display_max_edge: int = IMAGE_DISPLAY_MAX_EDGE_DEFAULT
    display_quality: int = IMAGE_DISPLAY_QUALITY_DEFAULT
    thumb_max_edge: int = IMAGE_THUMB_MAX_EDGE_DEFAULT
    thumb_quality: int = IMAGE_THUMB_QUALITY_DEFAULT


DEFAULT_IMAGE_CONFIG = ImageConfig()

def ensure_assets_dir():
    os.makedirs(assets_dir(), exist_ok=True)

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
    abs_path = os.path.join(assets_dir(), rel_path)
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


def process_for_identify(files: List[UploadFile], max_edge: int = _AI_MAX_EDGE, quality: int = _AI_QUALITY) -> List[str]:
    """Produce AI-optimised JPEG base64 strings. Uses per-model AI constants
    (defaults match _AI_MAX_EDGE/_AI_QUALITY) to minimise token usage."""
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
        img2.thumbnail((max_edge, max_edge))
        if img2.mode in ("RGBA", "P"):
            img2 = img2.convert("RGB")

        out = io.BytesIO()
        img2.save(out, format="JPEG", quality=quality, optimize=True)
        out.seek(0)
        b64_images.append(base64.b64encode(out.read()).decode("ascii"))

    if not b64_images:
        raise HTTPException(status_code=400, detail="No images provided")

    return b64_images

def resolve_path(rel_path: str) -> str:
    abs_path = os.path.join(assets_dir(), rel_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return abs_path


def cleanup_asset_paths(paths: List[str]) -> int:
    """Best-effort cleanup for stored asset files and empty parent dirs.

    Returns the number of files deleted.
    """
    ensure_assets_dir()
    base_assets_dir = assets_dir()
    deleted_files = 0
    rel_dirs = set()

    for rel in paths:
        if not rel:
            continue

        rel_path = str(rel)
        abs_path = os.path.join(base_assets_dir, rel_path)
        rel_dir = os.path.dirname(rel_path)
        if rel_dir:
            rel_dirs.add(rel_dir)

        try:
            if os.path.exists(abs_path):
                os.remove(abs_path)
                deleted_files += 1
        except Exception:
            # Best-effort cleanup only.
            pass

    for rel_dir in rel_dirs:
        abs_dir = os.path.join(base_assets_dir, rel_dir)
        try:
            if os.path.isdir(abs_dir) and not os.listdir(abs_dir):
                os.rmdir(abs_dir)
        except Exception:
            pass

    return deleted_files


def delete_stored_images(image_ids: List[str]) -> int:
    ensure_assets_dir()
    base_assets_dir = assets_dir()
    deleted = 0

    for image_id in set(image_ids):
        folder = os.path.join(base_assets_dir, image_id)
        if not os.path.isdir(folder):
            continue

        rel_paths: List[str] = []
        for root, _dirs, files in os.walk(folder):
            for fname in files:
                abs_path = os.path.join(root, fname)
                rel_path = os.path.relpath(abs_path, base_assets_dir).replace("\\", "/")
                rel_paths.append(rel_path)

        cleanup_asset_paths(rel_paths)

        try:
            if os.path.isdir(folder) and not os.listdir(folder):
                os.rmdir(folder)
        except Exception:
            pass

        deleted += 1

    return deleted
