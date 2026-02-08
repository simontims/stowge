import base64
import io
import os
import uuid
from typing import Tuple, List, Dict

from fastapi import UploadFile, HTTPException
from PIL import Image

ASSETS_DIR = os.getenv("ASSETS_DIR", "/assets")
STORE_ORIGINAL = os.getenv("STORE_ORIGINAL", "false").lower() == "true"
OUTPUT_FORMAT = os.getenv("OUTPUT_FORMAT", "webp").lower()  # webp|jpg
DISPLAY_MAX_EDGE = int(os.getenv("DISPLAY_MAX_EDGE", "2048"))
DISPLAY_QUALITY = int(os.getenv("DISPLAY_QUALITY", "82"))
THUMB_MAX_EDGE = int(os.getenv("THUMB_MAX_EDGE", "360"))
THUMB_QUALITY = int(os.getenv("THUMB_QUALITY", "70"))

def ensure_assets_dir():
    os.makedirs(ASSETS_DIR, exist_ok=True)

def _mime_ext() -> Tuple[str, str]:
    if OUTPUT_FORMAT == "webp":
        return "image/webp", "webp"
    return "image/jpeg", "jpg"

def _save_variant(img: Image.Image, max_edge: int, quality: int, folder: str, filename: str) -> Tuple[str, str, int, int]:
    img2 = img.copy()
    img2.thumbnail((max_edge, max_edge))

    out = io.BytesIO()
    mime, ext = _mime_ext()

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

def process_and_store(files: List[UploadFile]) -> Tuple[List[Dict], List[str]]:
    ensure_assets_dir()
    stored: List[Dict] = []
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

        image_id = str(uuid.uuid4())
        folder = image_id

        display_rel, mime, w, h = _save_variant(img, DISPLAY_MAX_EDGE, DISPLAY_QUALITY, folder, "display")
        thumb_rel, _, _, _ = _save_variant(img, THUMB_MAX_EDGE, THUMB_QUALITY, folder, "thumb")

        original_rel = None
        if STORE_ORIGINAL:
            # Full-res variant in configured format (not byte-identical original).
            original_rel, _, _, _ = _save_variant(img, max(img.size), 95, folder, "original")

        # Base64 for OpenAI: use display variant (smaller + fast)
        display_abs = os.path.join(ASSETS_DIR, display_rel)
        with open(display_abs, "rb") as df:
            b64_images.append(base64.b64encode(df.read()).decode("ascii"))

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

    return stored, b64_images

def resolve_path(rel_path: str) -> str:
    abs_path = os.path.join(ASSETS_DIR, rel_path)
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="File missing")
    return abs_path
