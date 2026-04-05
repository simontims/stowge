import os
import time
import json
import asyncio
import re
from threading import Lock
from datetime import datetime, timezone
from typing import Any, Optional, Literal, List

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy import inspect, text, func
import jwt
from jwt import InvalidTokenError

from .db import engine, Base, get_db
from .models import User, Part, PartImage, LLMConfig, Location, Collection, ImageSettings
from .auth import hash_password, verify_password, create_token, current_user, require_admin, JWT_SECRET, JWT_ISSUER, _TIMING_DUMMY_HASH
from .images import process_and_store, process_for_identify, resolve_path, delete_stored_images, ImageConfig, DEFAULT_IMAGE_CONFIG
from .openai_id import identify as openai_identify
from .image_signing import sign as sign_image, verify as verify_image, ttl_seconds
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

UI_DIR = os.getenv("UI_DIR", "/app/ui")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").strip()
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

AI_PROVIDER_META: dict[str, dict[str, str]] = {
    "openai": {
        "label": "OpenAI",
        "api_base": "https://api.openai.com/v1",
    },
    "anthropic": {
        "label": "Anthropic",
        "api_base": "https://api.anthropic.com",
    },
    "gemini": {
        "label": "Google Gemini",
        "api_base": "https://generativelanguage.googleapis.com",
    },
    "azure": {
        "label": "Azure OpenAI",
        "api_base": "https://YOUR_RESOURCE_NAME.openai.azure.com",
    },
    "groq": {
        "label": "Groq",
        "api_base": "https://api.groq.com/openai/v1",
    },
    "mistral": {
        "label": "Mistral",
        "api_base": "https://api.mistral.ai/v1",
    },
    "xai": {
        "label": "xAI",
        "api_base": "https://api.x.ai/v1",
    },
    "openrouter": {
        "label": "OpenRouter",
        "api_base": "https://openrouter.ai/api/v1",
    },
}

AI_PROVIDER_FALLBACK_MODELS: dict[str, list[str]] = {
    "openai": ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "openai/gpt-4.1"],
    "anthropic": [
        "anthropic/claude-3-5-sonnet-latest",
        "anthropic/claude-3-5-haiku-latest",
        "anthropic/claude-3-opus-latest",
    ],
    "gemini": ["gemini/gemini-1.5-pro", "gemini/gemini-1.5-flash", "gemini/gemini-2.0-flash"],
    "azure": ["azure/YOUR_DEPLOYMENT_NAME", "azure/gpt-4o-mini", "azure/gpt-4.1-mini"],
    "groq": ["groq/llama-3.1-70b-versatile", "groq/llama-3.1-8b-instant", "groq/mixtral-8x7b-32768"],
    "mistral": ["mistral/mistral-large-latest", "mistral/mistral-small-latest", "mistral/open-mixtral-8x22b"],
    "xai": ["xai/grok-2-latest", "xai/grok-beta", "xai/grok-2-mini"],
    "openrouter": [
        "openrouter/openai/gpt-4o-mini",
        "openrouter/anthropic/claude-3.5-sonnet",
        "openrouter/google/gemini-1.5-pro",
    ],
}


def _is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value))


def _utc_iso(dt: datetime | None) -> str | None:
    """Return an ISO-8601 string always suffixed with 'Z' (UTC).
    SQLite drops timezone info on round-trip, so naive datetimes that
    originated from datetime.now(timezone.utc) are explicitly re-marked."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.username,
        "firstname": user.first_name or "",
        "lastname": user.last_name or "",
        "role": user.role,
        "theme": user.theme or "dark",
        "preferred_add_collection_id": user.preferred_add_collection_id,
        "last_open_collection": user.last_open_collection,
        "created_at": _utc_iso(user.created_at),
        "last_login_at": _utc_iso(user.last_login_at),
    }


def _location_photo_url(location_id: str) -> str:
    return f"/api/locations/{location_id}/photo"


def _serialize_location(location: Location, db: Session) -> dict:
    item_count = db.query(Part).filter(Part.location_id == location.id).count()
    return {
        "id": location.id,
        "name": location.name,
        "description": location.description,
        "item_count": item_count,
        "photo_url": (_location_photo_url(location.id) if location.photo_path else None),
        "created_at": _utc_iso(location.created_at),
        "updated_at": _utc_iso(location.updated_at),
    }


def _serialize_collection(collection: Collection, db: Session) -> dict:
    item_count = db.query(Part).filter(Part.collection == collection.name).count()
    return {
        "id": collection.id,
        "name": collection.name,
        "icon": collection.icon,
        "description": collection.description,
        "ai_hint": collection.ai_hint,
        "item_count": item_count,
        "created_at": _utc_iso(collection.created_at),
        "updated_at": _utc_iso(collection.updated_at),
    }


def _cleanup_asset_paths(paths: list[str]):
    assets_dir = os.getenv("ASSETS_DIR", "/assets")
    rel_dirs: set[str] = set()
    for rel in paths:
        if not rel:
            continue
        abs_path = os.path.join(assets_dir, rel)
        try:
            if os.path.exists(abs_path):
                os.remove(abs_path)
            rel_dir = os.path.dirname(rel)
            if rel_dir:
                rel_dirs.add(rel_dir)
        except Exception:
            # Best-effort cleanup only.
            pass

    for rel_dir in rel_dirs:
        abs_dir = os.path.join(assets_dir, rel_dir)
        try:
            if os.path.isdir(abs_dir) and not os.listdir(abs_dir):
                os.rmdir(abs_dir)
        except Exception:
            pass


def _mask_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}...{value[-4:]}"


def _serialize_llm_public(cfg: LLMConfig) -> dict:
    return {
        "id": cfg.id,
        "name": cfg.name,
        "provider": cfg.provider,
        "model": cfg.model,
        "api_base": cfg.api_base,
        "is_default": bool(cfg.is_default),
        "evidence_enabled": bool(cfg.evidence_enabled),
    }


def _serialize_llm_admin(cfg: LLMConfig) -> dict:
    data = _serialize_llm_public(cfg)
    data["api_key_masked"] = _mask_key(cfg.api_key)
    data["created_at"] = _utc_iso(cfg.created_at)
    data["updated_at"] = _utc_iso(cfg.updated_at)
    return data


def _normalize_provider(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def _normalize_model(value: str) -> str:
    return value.strip()


def _default_api_base_for_provider(provider: str) -> str | None:
    return AI_PROVIDER_META.get(provider, {}).get("api_base")


def _litellm_models_by_provider() -> dict[str, list[str]]:
    providers = {k: set() for k in AI_PROVIDER_META.keys()}
    try:
        import litellm

        model_cost = getattr(litellm, "model_cost", {}) or {}
        for model_name, metadata in model_cost.items():
            if not isinstance(model_name, str) or not isinstance(metadata, dict):
                continue

            provider = str(metadata.get("litellm_provider") or "").strip().lower()
            if provider in providers:
                providers[provider].add(model_name)
    except Exception:
        pass

    output: dict[str, list[str]] = {}
    for provider in AI_PROVIDER_META.keys():
        models = sorted(providers.get(provider) or set())
        if not models:
            models = sorted(set(AI_PROVIDER_FALLBACK_MODELS.get(provider, [])))
        output[provider] = models
    return output


def _resolve_llm_config(db: Session, selected_id: str | None = None) -> LLMConfig | None:
    if selected_id:
        return db.query(LLMConfig).filter(LLMConfig.id == selected_id).first()

    default_cfg = db.query(LLMConfig).filter(LLMConfig.is_default == 1).first()
    if default_cfg:
        return default_cfg

    return db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).first()


def _run_startup_migrations():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        # Rename legacy categories table in-place.
        if "categories" in tables and "collections" not in tables:
            conn.execute(text("ALTER TABLE categories RENAME TO collections"))

        # Rename legacy parts.category column to parts.collection.
        parts_columns = set()
        if "parts" in set(inspect(engine).get_table_names()):
            parts_columns = {c["name"] for c in inspect(engine).get_columns("parts")}
            if "category" in parts_columns and "collection" not in parts_columns:
                conn.execute(text("ALTER TABLE parts RENAME COLUMN category TO collection"))
                parts_columns = {c["name"] for c in inspect(engine).get_columns("parts")}
            if "location_id" not in parts_columns:
                conn.execute(text("ALTER TABLE parts ADD COLUMN location_id VARCHAR NULL"))

        if "users" in set(inspect(engine).get_table_names()):
            user_columns = {c["name"] for c in inspect(engine).get_columns("users")}
            if "first_name" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN first_name VARCHAR NOT NULL DEFAULT ''"))
            if "last_name" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN last_name VARCHAR NOT NULL DEFAULT ''"))
            if "theme" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN theme VARCHAR NOT NULL DEFAULT 'dark'"))

            if "preferred_add_category_id" in user_columns and "preferred_add_collection_id" not in user_columns:
                conn.execute(text("ALTER TABLE users RENAME COLUMN preferred_add_category_id TO preferred_add_collection_id"))
                user_columns = {c["name"] for c in inspect(engine).get_columns("users")}

            if "preferred_add_collection_id" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN preferred_add_collection_id VARCHAR NULL"))
            user_columns = {c["name"] for c in inspect(engine).get_columns("users")}
            if "last_open_collection" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN last_open_collection VARCHAR NULL"))

    tables = set(inspect(engine).get_table_names())

    if "users" not in tables:
        return

    if "llm_configs" in tables:
        llm_columns = {c["name"] for c in inspect(engine).get_columns("llm_configs")}
        with engine.begin() as conn:
            if "api_base" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN api_base VARCHAR NULL"))
            if "is_default" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0"))
            if "evidence_enabled" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN evidence_enabled INTEGER NOT NULL DEFAULT 0"))

        # Backfill legacy configs so API base is always present.
        with Session(bind=engine) as db:
            configs = db.query(LLMConfig).all()
            changed = False
            for cfg in configs:
                if (cfg.api_base or "").strip():
                    continue
                fallback = _default_api_base_for_provider((cfg.provider or "").strip().lower())
                if fallback:
                    cfg.api_base = fallback
                    cfg.updated_at = datetime.now(timezone.utc)
                    changed = True
            if changed:
                db.commit()

    # Backward compatibility: if legacy OPENAI env vars are present and no model
    # is configured yet, create a default LiteLLM model entry automatically.
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    openai_model = os.getenv("OPENAI_MODEL", "openai/gpt-4o-mini").strip()
    if openai_key and "llm_configs" in tables:
        with Session(bind=engine) as db:
            existing = db.query(LLMConfig).count()
            if existing == 0:
                if "/" not in openai_model:
                    openai_model = f"openai/{openai_model}"
                cfg = LLMConfig(
                    name="OpenAI (legacy env)",
                    provider="openai",
                    model=openai_model,
                    api_key=openai_key,
                    api_base="https://api.openai.com/v1",
                    is_default=1,
                    evidence_enabled=0,
                )
                db.add(cfg)
                db.commit()


def init_db():
    Base.metadata.create_all(bind=engine)
    _run_startup_migrations()

init_db()

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Stowge", version=APP_VERSION)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_PARTS_EVENTS_LOCK = Lock()
_PARTS_EVENTS_SEQ = 0
_PARTS_EVENTS_LOG: list[dict] = []
_PARTS_EVENTS_MAX = 256

# Serve Vite-built hashed bundles from /app/ui/assets.
app.mount(
    "/assets",
    StaticFiles(directory=os.path.join(UI_DIR, "assets"), check_dir=False),
    name="assets",
)

if CORS_ORIGINS:
    origins = [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self)"
    return response

# ---------------- helpers ----------------

def _signed_image_url(image_id: str, variant: str) -> str:
    exp = int(time.time()) + ttl_seconds()
    sig = sign_image(image_id, variant, exp)
    return f"/api/images/{image_id}?variant={variant}&exp={exp}&sig={sig}"

def _variant_rel(img: PartImage, variant: str) -> str:
    if variant == "thumb":
        return img.path_thumb
    if variant == "display":
        return img.path_display
    if variant == "original":
        if not img.path_original:
            raise HTTPException(status_code=404, detail="Original not stored")
        return img.path_original
    raise HTTPException(status_code=400, detail="Invalid variant")

def _publish_parts_event(event_type: str, payload: dict):
    global _PARTS_EVENTS_SEQ
    with _PARTS_EVENTS_LOCK:
        _PARTS_EVENTS_SEQ += 1
        event = {
            "seq": _PARTS_EVENTS_SEQ,
            "type": event_type,
            "ts": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        _PARTS_EVENTS_LOG.append(event)
        if len(_PARTS_EVENTS_LOG) > _PARTS_EVENTS_MAX:
            del _PARTS_EVENTS_LOG[0 : len(_PARTS_EVENTS_LOG) - _PARTS_EVENTS_MAX]


def _publish_inventory_change(action: str, part_id: str):
    # Emit both legacy and new event names so old and new clients keep working.
    _publish_parts_event("parts_changed", {"action": action, "part_id": part_id})
    _publish_parts_event("items_changed", {"action": action, "item_id": part_id, "part_id": part_id})

def _parts_events_since(last_seq: int) -> list[dict]:
    with _PARTS_EVENTS_LOCK:
        return [e for e in _PARTS_EVENTS_LOG if int(e.get("seq", 0)) > last_seq]

def _user_from_query_token(token: str, db: Session) -> User:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER)
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------------- UI (PWA) ----------------
@app.get("/", response_class=HTMLResponse)
def index():
    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    return FileResponse(os.path.join(UI_DIR, "index.html"), media_type="text/html", headers=headers)

@app.get("/manifest.webmanifest")
def manifest():
    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    path = os.path.join(UI_DIR, "manifest.webmanifest")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="application/manifest+json", headers=headers)

@app.get("/sw.js")
def sw():
    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    path = os.path.join(UI_DIR, "sw.js")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="application/javascript", headers=headers)

@app.get("/favicon.svg")
def favicon_svg():
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    path = os.path.join(UI_DIR, "favicon.svg")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/svg+xml", headers=headers)

@app.get("/favicon.ico")
def favicon_ico():
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    path = os.path.join(UI_DIR, "favicon.ico")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/x-icon", headers=headers)

@app.get("/stowgeLogoOptimized.webp")
def logo_webp():
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    path = os.path.join(UI_DIR, "stowgeLogoOptimized.webp")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/webp", headers=headers)

# ---------------- Health / Status / Setup ----------------
@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"status": "ok"}

@app.get("/api/version")
def version():
    return {"version": APP_VERSION}

@app.get("/api/ping")
def ping(me: User = Depends(current_user)):
    return {"ok": True}

@app.get("/api/status")
def status(db: Session = Depends(get_db)):
    return {"needs_setup": db.query(User).count() == 0}


@app.get("/api/status/collections")
def status_collections(db: Session = Depends(get_db), me: User = Depends(current_user)):
    collections = db.query(Collection).order_by(Collection.name.asc()).all()

    item_count_rows = (
        db.query(Part.collection, func.count(Part.id))
        .filter(Part.collection.isnot(None))
        .group_by(Part.collection)
        .all()
    )
    item_counts = {
        str(collection_name): int(count)
        for collection_name, count in item_count_rows
        if collection_name
    }

    asset_count_rows = (
        db.query(Part.collection, func.count(PartImage.id))
        .join(Part, Part.id == PartImage.part_id)
        .filter(Part.collection.isnot(None))
        .group_by(Part.collection)
        .all()
    )
    asset_counts = {
        str(collection_name): int(count)
        for collection_name, count in asset_count_rows
        if collection_name
    }

    asset_size_rows = (
        db.query(Part.collection, PartImage.path_thumb, PartImage.path_display, PartImage.path_original)
        .join(Part, Part.id == PartImage.part_id)
        .filter(Part.collection.isnot(None))
        .all()
    )
    assets_dir = os.getenv("ASSETS_DIR", "/assets")
    disk_bytes: dict[str, int] = {}
    seen_paths: dict[str, set[str]] = {}
    for collection_name, path_thumb, path_display, path_original in asset_size_rows:
        if not collection_name:
            continue

        key = str(collection_name)
        if key not in seen_paths:
            seen_paths[key] = set()

        for rel_path in (path_thumb, path_display, path_original):
            if not rel_path:
                continue

            rel_key = str(rel_path)
            if rel_key in seen_paths[key]:
                continue

            seen_paths[key].add(rel_key)
            abs_path = os.path.join(assets_dir, rel_key)
            try:
                size = os.path.getsize(abs_path)
            except OSError:
                size = 0
            disk_bytes[key] = disk_bytes.get(key, 0) + int(size)

    rows = []
    total_items = 0
    total_assets = 0
    total_disk_bytes = 0

    for collection in collections:
        name = collection.name
        item_count = int(item_counts.get(name, 0))
        asset_count = int(asset_counts.get(name, 0))
        collection_bytes = int(disk_bytes.get(name, 0))

        total_items += item_count
        total_assets += asset_count
        total_disk_bytes += collection_bytes

        rows.append(
            {
                "id": collection.id,
                "name": name,
                "item_count": item_count,
                "asset_count": asset_count,
                "disk_bytes": collection_bytes,
            }
        )

    return {
        "server": "ok",
        "collections": rows,
        "totals": {
            "item_count": total_items,
            "asset_count": total_assets,
            "disk_bytes": total_disk_bytes,
        },
    }

@app.post("/api/setup/first-admin")
@limiter.limit("5/minute")
def setup_first_admin(request: Request, payload: dict, db: Session = Depends(get_db)):
    if db.query(User).count() != 0:
        raise HTTPException(status_code=404, detail="Setup disabled")

    username = (payload.get("username") or payload.get("email") or "").strip().lower()
    first_name = (payload.get("firstname") or payload.get("first_name") or "").strip()
    last_name = (payload.get("lastname") or payload.get("last_name") or payload.get("surname") or "").strip()
    password = payload.get("password") or ""
    if not (_is_valid_email(username) or len(username) >= 3):
        raise HTTPException(status_code=400, detail="Email or username >= 3 chars required")
    if not password:
        raise HTTPException(status_code=400, detail="Password required")

    user = User(
        username=username,
        first_name=first_name,
        last_name=last_name,
        password_hash=hash_password(password),
        role="admin",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"access_token": create_token(user), "token_type": "bearer"}

@app.post("/api/login")
@limiter.limit("10/minute")
def login(request: Request, payload: dict, db: Session = Depends(get_db)):
    username = (payload.get("username") or payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    user = db.query(User).filter(User.username == username).first()
    # Always call verify_password regardless of whether the user was found so
    # response time is constant, preventing email enumeration via timing.
    check_hash = user.password_hash if user else _TIMING_DUMMY_HASH
    if not verify_password(password, check_hash) or not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return {"access_token": create_token(user), "token_type": "bearer"}

# ---------------- Current user (self) ----------------
@app.get("/api/me")
def get_me(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return _serialize_user(me)

@app.patch("/api/me")
def update_me(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    u = db.query(User).filter(User.id == me.id).first()
    if not u:
        raise HTTPException(status_code=401, detail="User not found")
    if "theme" in payload:
        theme = str(payload["theme"]).strip()
        if theme not in ("dark", "light"):
            raise HTTPException(status_code=400, detail="theme must be dark|light")
        u.theme = theme
    if "preferred_add_collection_id" in payload:
        raw_collection_id = payload.get("preferred_add_collection_id")
        collection_id = (str(raw_collection_id).strip() if raw_collection_id is not None else "")
        if not collection_id:
            u.preferred_add_collection_id = None
        else:
            exists = db.query(Collection.id).filter(Collection.id == collection_id).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid preferred_add_collection_id")
            u.preferred_add_collection_id = collection_id
    if "last_open_collection" in payload:
        val = payload.get("last_open_collection")
        u.last_open_collection = str(val).strip() if val else None
    db.commit()
    db.refresh(u)
    return _serialize_user(u)

# ---------------- Users (admin) ----------------
@app.post("/api/users")
def create_user(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    username = (payload.get("email") or payload.get("username") or "").strip().lower()
    first_name = (payload.get("firstname") or payload.get("first_name") or "").strip()
    last_name = (payload.get("lastname") or payload.get("last_name") or payload.get("surname") or "").strip()
    password = payload.get("password") or ""
    role = (payload.get("role") or "user").strip()

    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="role must be admin|user")
    if not _is_valid_email(username):
        raise HTTPException(status_code=400, detail="Valid email required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password >= 8 chars")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Email already exists")

    u = User(
        username=username,
        first_name=first_name,
        last_name=last_name,
        password_hash=hash_password(password),
        role=role,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return _serialize_user(u)


@app.get("/api/users")
def list_users(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    return [_serialize_user(u) for u in users]


@app.patch("/api/users/{user_id}")
def update_user(user_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    email = payload.get("email")
    if email is not None:
        next_email = str(email).strip().lower()
        if not _is_valid_email(next_email):
            raise HTTPException(status_code=400, detail="Valid email required")
        exists = db.query(User).filter(User.username == next_email, User.id != user_id).first()
        if exists:
            raise HTTPException(status_code=400, detail="Email already exists")
        u.username = next_email

    if "firstname" in payload or "first_name" in payload:
        u.first_name = str(payload.get("firstname") or payload.get("first_name") or "").strip()

    if "lastname" in payload or "surname" in payload or "last_name" in payload:
        u.last_name = str(payload.get("lastname") or payload.get("last_name") or payload.get("surname") or "").strip()

    if "role" in payload:
        role = str(payload.get("role") or "").strip()
        if role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="role must be admin|user")
        if u.id == me.id and role != "admin":
            raise HTTPException(status_code=400, detail="Cannot remove your own admin role")
        if u.role == "admin" and role != "admin":
            admins = db.query(User).filter(User.role == "admin").count()
            if admins <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        u.role = role

    if "password" in payload:
        password = str(payload.get("password") or "")
        if password and len(password) < 8:
            raise HTTPException(status_code=400, detail="Password >= 8 chars")
        if password:
            u.password_hash = hash_password(password)

    db.commit()
    db.refresh(u)
    return _serialize_user(u)

@app.delete("/api/users/{user_id}")
def delete_user(user_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    if u.id == me.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    if u.role == "admin":
        admins = db.query(User).filter(User.role == "admin").count()
        if admins <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")

    db.delete(u)
    db.commit()
    return {"ok": True}


# ---------------- Locations ----------------
@app.post("/api/locations/photo")
def upload_location_photo(
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    stored = process_and_store([photo], _get_image_config(db))
    if not stored:
        raise HTTPException(status_code=400, detail="No photo uploaded")
    payload = stored[0]
    return {
        "photo_path": payload["path_display"],
        "stored": payload,
    }


@app.get("/api/locations")
def list_locations(db: Session = Depends(get_db), me: User = Depends(current_user)):
    locations = db.query(Location).order_by(Location.created_at.asc()).all()
    if not locations:
        return []
    counts: dict[str, int] = dict(
        db.query(Part.location_id, func.count(Part.id))
        .filter(Part.location_id.in_([loc.id for loc in locations]))
        .group_by(Part.location_id)
        .all()
    )
    return [
        {
            "id": loc.id,
            "name": loc.name,
            "description": loc.description,
            "item_count": int(counts.get(loc.id, 0)),
            "photo_url": (_location_photo_url(loc.id) if loc.photo_path else None),
            "created_at": _utc_iso(loc.created_at),
            "updated_at": _utc_iso(loc.updated_at),
        }
        for loc in locations
    ]


@app.post("/api/locations")
def create_location(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = str(payload.get("name") or "").strip()
    description = str(payload.get("description") or "").strip() or None
    photo_path = str(payload.get("photo_path") or "").strip() or None

    if len(name) < 2:
        raise HTTPException(status_code=400, detail="name required (>= 2 chars)")

    existing = db.query(Location).filter(Location.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Location name already exists")

    location = Location(
        name=name,
        description=description,
        photo_path=photo_path,
    )
    db.add(location)
    db.commit()
    db.refresh(location)
    return _serialize_location(location, db)


@app.patch("/api/locations/{location_id}")
def update_location(location_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    old_photo_path = location.photo_path

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="name required (>= 2 chars)")
        existing = (
            db.query(Location)
            .filter(Location.name == name, Location.id != location_id)
            .first()
        )
        if existing:
            raise HTTPException(status_code=400, detail="Location name already exists")
        location.name = name

    if "description" in payload:
        location.description = str(payload.get("description") or "").strip() or None

    if "photo_path" in payload:
        next_photo_path = str(payload.get("photo_path") or "").strip() or None
        location.photo_path = next_photo_path

    location.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(location)

    if "photo_path" in payload and old_photo_path and old_photo_path != location.photo_path:
        old_thumb = old_photo_path.replace("/display.", "/thumb.")
        old_original = old_photo_path.replace("/display.", "/original.")
        _cleanup_asset_paths([old_photo_path, old_thumb, old_original])

    return _serialize_location(location, db)


@app.delete("/api/locations/{location_id}")
def delete_location(location_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    photo_path = location.photo_path
    db.query(Part).filter(Part.location_id == location_id).update({"location_id": None})
    db.delete(location)
    db.commit()

    if photo_path:
        old_thumb = photo_path.replace("/display.", "/thumb.")
        old_original = photo_path.replace("/display.", "/original.")
        _cleanup_asset_paths([photo_path, old_thumb, old_original])

    return {"ok": True}


@app.get("/api/locations/{location_id}/photo")
def get_location_photo(location_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    if not location.photo_path:
        raise HTTPException(status_code=404, detail="Location photo not found")
    abs_path = resolve_path(location.photo_path)
    return FileResponse(abs_path)


# ---------------- Collections ----------------
@app.get("/api/collections")
def list_collections(db: Session = Depends(get_db), me: User = Depends(current_user)):
    collections = db.query(Collection).order_by(Collection.created_at.asc()).all()
    if not collections:
        return []
    counts: dict[str, int] = dict(
        db.query(Part.collection, func.count(Part.id))
        .filter(Part.collection.in_([col.name for col in collections]))
        .group_by(Part.collection)
        .all()
    )
    return [
        {
            "id": col.id,
            "name": col.name,
            "icon": col.icon,
            "description": col.description,
            "ai_hint": col.ai_hint,
            "item_count": int(counts.get(col.name, 0)),
            "created_at": _utc_iso(col.created_at),
            "updated_at": _utc_iso(col.updated_at),
        }
        for col in collections
    ]


@app.post("/api/collections")
def create_collection(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = str(payload.get("name") or "").strip()
    icon = str(payload.get("icon") or "").strip() or None
    description = str(payload.get("description") or "").strip() or None
    ai_hint = str(payload.get("ai_hint") or "").strip() or None

    if len(name) < 2:
        raise HTTPException(status_code=400, detail="name required (>= 2 chars)")

    existing = db.query(Collection).filter(Collection.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Collection name already exists")

    collection = Collection(name=name, icon=icon, description=description, ai_hint=ai_hint)
    db.add(collection)
    db.commit()
    db.refresh(collection)
    return _serialize_collection(collection, db)


@app.patch("/api/collections/{collection_id}")
def update_collection(collection_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    collection = db.query(Collection).filter(Collection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="name required (>= 2 chars)")
        existing = db.query(Collection).filter(Collection.name == name, Collection.id != collection_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Collection name already exists")
        collection.name = name

    if "icon" in payload:
        collection.icon = str(payload.get("icon") or "").strip() or None

    if "description" in payload:
        collection.description = str(payload.get("description") or "").strip() or None

    if "ai_hint" in payload:
        collection.ai_hint = str(payload.get("ai_hint") or "").strip() or None

    collection.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(collection)
    return _serialize_collection(collection, db)


@app.delete("/api/collections/{collection_id}")
def delete_collection(collection_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    collection = db.query(Collection).filter(Collection.id == collection_id).first()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    db.delete(collection)
    db.commit()
    return {"ok": True}


# ---------------- AI Settings (LLM configs) ----------------
@app.get("/api/settings/ai")
def list_ai_settings(db: Session = Depends(get_db), me: User = Depends(current_user)):
    configs = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).all()
    active = _resolve_llm_config(db)
    return {
        "default_llm_id": active.id if active else None,
        "configs": [_serialize_llm_public(c) for c in configs],
    }


@app.get("/api/admin/settings/ai")
def list_ai_settings_admin(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    configs = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).all()
    active = _resolve_llm_config(db)
    return {
        "default_llm_id": active.id if active else None,
        "configs": [_serialize_llm_admin(c) for c in configs],
    }


@app.get("/api/admin/settings/ai/providers")
def list_ai_providers_catalog(me: User = Depends(require_admin)):
    models_by_provider = _litellm_models_by_provider()
    providers = []
    for provider, meta in AI_PROVIDER_META.items():
        providers.append(
            {
                "value": provider,
                "label": meta["label"],
                "api_base": meta["api_base"],
                "models": models_by_provider.get(provider, []),
            }
        )
    return {"providers": providers}


@app.post("/api/admin/settings/ai")
def create_ai_setting(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    name = str(payload.get("name") or "").strip()
    provider = _normalize_provider(str(payload.get("provider") or ""))
    model = _normalize_model(str(payload.get("model") or ""))
    api_key = str(payload.get("api_key") or "").strip()
    api_base = str(payload.get("api_base") or "").strip()
    is_default = bool(payload.get("is_default", False))
    evidence_enabled = bool(payload.get("evidence_enabled", False))

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    if not model:
        raise HTTPException(status_code=400, detail="model is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
    if not api_base:
        api_base = _default_api_base_for_provider(provider) or ""
    if not api_base:
        raise HTTPException(status_code=400, detail="api_base is required")

    cfg = LLMConfig(
        name=name,
        provider=provider,
        model=model,
        api_key=api_key,
        api_base=api_base,
        is_default=1 if is_default else 0,
        evidence_enabled=1 if evidence_enabled else 0,
        updated_at=datetime.now(timezone.utc),
    )
    db.add(cfg)
    db.flush()

    total = db.query(LLMConfig).count()
    if total == 1:
        cfg.is_default = 1
    elif cfg.is_default:
        db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})

    db.commit()
    db.refresh(cfg)
    return _serialize_llm_admin(cfg)


@app.patch("/api/admin/settings/ai/{config_id}")
def update_ai_setting(config_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    if "name" in payload:
        next_name = str(payload.get("name") or "").strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="name is required")
        cfg.name = next_name

    provider_updated = False
    if "provider" in payload:
        next_provider = _normalize_provider(str(payload.get("provider") or ""))
        if not next_provider:
            raise HTTPException(status_code=400, detail="provider is required")
        cfg.provider = next_provider
        provider_updated = True

    if "model" in payload:
        next_model = _normalize_model(str(payload.get("model") or ""))
        if not next_model:
            raise HTTPException(status_code=400, detail="model is required")
        cfg.model = next_model

    if "api_key" in payload:
        next_key = str(payload.get("api_key") or "").strip()
        if next_key:
            cfg.api_key = next_key

    if "api_base" in payload:
        cfg.api_base = str(payload.get("api_base") or "").strip() or None

    if provider_updated and not (cfg.api_base or "").strip():
        cfg.api_base = _default_api_base_for_provider(cfg.provider)

    if not (cfg.api_base or "").strip():
        raise HTTPException(status_code=400, detail="api_base is required")

    if bool(payload.get("is_default", False)):
        db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})
        cfg.is_default = 1

    if "evidence_enabled" in payload:
        cfg.evidence_enabled = 1 if bool(payload.get("evidence_enabled")) else 0

    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cfg)
    return _serialize_llm_admin(cfg)


@app.post("/api/admin/settings/ai/{config_id}/default")
def set_default_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})
    cfg.is_default = 1
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cfg)
    return _serialize_llm_admin(cfg)


@app.post("/api/admin/settings/ai/{config_id}/validate")
def validate_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    try:
        from litellm import completion

        resp = completion(
            model=cfg.model,
            messages=[
                {
                    "role": "user",
                    "content": "Reply with exactly OK.",
                }
            ],
            max_tokens=8,
            temperature=0,
            timeout=20,
            api_key=cfg.api_key,
            api_base=cfg.api_base,
        )
        preview = ""
        try:
            preview = str(resp.choices[0].message.content or "").strip()
        except Exception:
            preview = ""

        return {
            "ok": True,
            "provider": cfg.provider,
            "model": cfg.model,
            "response_preview": preview[:160],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Validation failed: {e}")


@app.delete("/api/admin/settings/ai/{config_id}")
def delete_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    was_default = bool(cfg.is_default)
    db.delete(cfg)
    db.flush()

    if was_default:
        replacement = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).first()
        if replacement:
            replacement.is_default = 1
            replacement.updated_at = datetime.now(timezone.utc)

    db.commit()
    return {"ok": True}


# ---------------- Image Processing Settings ----------------
_image_config_cache: ImageConfig | None = None

def _get_image_config(db: Session) -> ImageConfig:
    global _image_config_cache
    if _image_config_cache is not None:
        return _image_config_cache
    row = db.query(ImageSettings).filter(ImageSettings.id == "singleton").first()
    if not row:
        _image_config_cache = DEFAULT_IMAGE_CONFIG
    else:
        _image_config_cache = ImageConfig(
            store_original=bool(row.store_original),
            output_format=row.output_format or "webp",
            display_max_edge=row.display_max_edge or 2048,
            display_quality=row.display_quality or 82,
            thumb_max_edge=row.thumb_max_edge or 360,
            thumb_quality=row.thumb_quality or 70,
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


@app.get("/api/admin/settings/images")
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


@app.patch("/api/admin/settings/images")
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
        v = int(payload["display_quality"])
        if not (1 <= v <= 100):
            raise HTTPException(status_code=400, detail="display_quality must be 1-100")
        row.display_quality = v
    if "thumb_max_edge" in payload:
        v = int(payload["thumb_max_edge"])
        if not (64 <= v <= 1024):
            raise HTTPException(status_code=400, detail="thumb_max_edge must be 64-1024")
        row.thumb_max_edge = v
    if "thumb_quality" in payload:
        v = int(payload["thumb_quality"])
        if not (1 <= v <= 100):
            raise HTTPException(status_code=400, detail="thumb_quality must be 1-100")
        row.thumb_quality = v

    row.updated_at = datetime.now(timezone.utc)
    _image_config_cache = None
    db.commit()
    db.refresh(row)
    return _serialize_image_settings(row)

# ---------------- Identify ----------------
@app.post("/api/images/store")
def store_images_only(
    images: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    stored = process_and_store(images, _get_image_config(db))
    return {
        "uploaded_images": [
            {"id": s["id"], "thumb_url": _signed_image_url(s["id"], "thumb")}
            for s in stored
        ],
        "stored_images": stored,
    }


@app.post("/api/images/discard")
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


@app.post("/api/identify")
def identify(
    mode: Literal["one", "three", "five"] = "one",
    llm_id: Optional[str] = Query(default=None),
    collection_id: Optional[str] = Query(default=None),
    images: List[UploadFile] = File(...),
    me: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    b64s = process_for_identify(images)
    cfg = _resolve_llm_config(db, llm_id)
    if not cfg:
        raise HTTPException(status_code=400, detail="No AI models configured. Add one under Settings / AI.")

    collection_context: Optional[str] = None
    if collection_id:
        selected_collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not selected_collection:
            raise HTTPException(status_code=400, detail="Invalid collection_id")

        context_parts = [f"Collection name: {selected_collection.name}"]
        if (selected_collection.ai_hint or "").strip():
            context_parts.append(f"Collection hint: {selected_collection.ai_hint.strip()}")
        collection_context = "\n".join(context_parts)

    # openai_id supports "one"/"three"/"five"
    ai_mode = mode if mode in ("one", "three", "five") else "one"
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
        "mode": mode,
        "llm": _serialize_llm_public(cfg),
        "ai": ai,
        "uploaded_images": [],
        "stored_images": [],
    }

# ---------------- Parts ----------------
@app.post("/api/parts")
@app.post("/api/items")
def create_part(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    collection = (payload.get("collection") or "").strip() or None
    location_id = payload.get("location_id")
    status = payload.get("status") or "draft"
    if status not in ("draft", "confirmed"):
        raise HTTPException(status_code=400, detail="status must be draft|confirmed")
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="name required")
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
        ai_primary=payload.get("ai_primary"),
        ai_alternatives=payload.get("ai_alternatives"),
        ai_chosen_index=payload.get("ai_chosen_index"),
    )
    db.add(p)
    db.flush()

    for s in stored_images:
        img = PartImage(
            id=s["id"],
            part_id=p.id,
            path_thumb=s["path_thumb"],
            path_display=s["path_display"],
            path_original=s.get("path_original"),
            mime=s.get("mime") or "image/webp",
            width=s.get("width"),
            height=s.get("height"),
        )
        db.add(img)

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)
    _publish_inventory_change("created", p.id)
    return {"id": p.id}

@app.get("/api/parts")
@app.get("/api/items")
def list_parts(q: Optional[str] = None, db: Session = Depends(get_db), me: User = Depends(current_user)):
    query = db.query(Part).order_by(Part.created_at.desc())
    if q:
        query = query.filter(Part.name.ilike(f"%{q.strip()}%"))
    parts = query.limit(200).all()

    location_ids = {p.location_id for p in parts if p.location_id}
    location_names: dict[str, str] = {}
    if location_ids:
        location_rows = db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        location_names = {loc_id: loc_name for loc_id, loc_name in location_rows}

    return [{
        "id": p.id,
        "name": p.name,
        "collection": p.collection,
        "location": (location_names.get(p.location_id) if p.location_id else None),
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "thumb": (_signed_image_url(p.images[0].id, "thumb") if p.images else None),
    } for p in parts]

@app.get("/api/parts/{part_id}")
@app.get("/api/items/{part_id}")
def get_part(part_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    location_name = None
    if p.location_id:
        location = db.query(Location.id, Location.name).filter(Location.id == p.location_id).first()
        if location:
            location_name = location.name

    return {
        "id": p.id,
        "name": p.name,
        "description": p.description,
        "collection": p.collection,
        "location_id": p.location_id,
        "location": location_name,
        "status": p.status,
        "created_at": p.created_at.isoformat(),
        "updated_at": p.updated_at.isoformat(),
        "images": [{
            "id": img.id,
            "thumb_url": _signed_image_url(img.id, "thumb"),
            "display_url": _signed_image_url(img.id, "display"),
            "original_url": (_signed_image_url(img.id, "original") if img.path_original else None),
        } for img in p.images],
        "ai_primary": p.ai_primary,
        "ai_alternatives": p.ai_alternatives,
        "ai_chosen_index": p.ai_chosen_index,
    }

@app.patch("/api/parts/{part_id}")
@app.patch("/api/items/{part_id}")
def update_part(part_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    for field in ("name", "description", "status"):
        if field in payload:
            setattr(p, field, payload[field])

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

    p.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}

@app.delete("/api/parts/{part_id}")
@app.delete("/api/items/{part_id}")
def delete_part(part_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    p = db.query(Part).filter(Part.id == part_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Not found")

    # Capture image paths before ORM delete so we can remove on-disk assets.
    image_paths = []
    image_dirs = set()
    for img in p.images:
        if img.path_thumb:
            image_paths.append(img.path_thumb)
            image_dirs.add(os.path.dirname(img.path_thumb))
        if img.path_display:
            image_paths.append(img.path_display)
            image_dirs.add(os.path.dirname(img.path_display))
        if img.path_original:
            image_paths.append(img.path_original)
            image_dirs.add(os.path.dirname(img.path_original))

    db.delete(p)
    db.commit()

    assets_dir = os.getenv("ASSETS_DIR", "/assets")
    for rel in image_paths:
        abs_path = os.path.join(assets_dir, rel)
        try:
            if os.path.exists(abs_path):
                os.remove(abs_path)
        except Exception:
            # Best-effort cleanup: DB delete has already completed.
            pass

    # Remove now-empty per-image directories if possible.
    for rel_dir in image_dirs:
        abs_dir = os.path.join(assets_dir, rel_dir)
        try:
            if os.path.isdir(abs_dir) and not os.listdir(abs_dir):
                os.rmdir(abs_dir)
        except Exception:
            pass

    _publish_inventory_change("deleted", part_id)
    return {"ok": True}

@app.get("/api/events/parts")
@app.get("/api/events/items")
async def parts_events(
    request: Request,
    token: Optional[str] = None,
    since: int = 0,
    db: Session = Depends(get_db),
):
    # SSE EventSource cannot set Authorization headers.
    # Prefer auth from a cookie to avoid JWT in URL/logs, but keep query fallback.
    auth_token = token or request.cookies.get("stowge_sse_token")
    if not auth_token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    _ = _user_from_query_token(auth_token, db)

    async def event_stream():
        last_seq = max(0, int(since))
        heartbeat = 0
        while True:
            if await request.is_disconnected():
                break

            events = _parts_events_since(last_seq)
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
                # Keep connection alive behind reverse proxies.
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

# ---------------- Images ----------------

@app.get("/api/images/{image_id}/signed")
def get_signed_image_url(
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    db: Session = Depends(get_db),
    me: User = Depends(current_user),
):
    # Validate image exists and variant exists (esp original)
    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")
    _ = _variant_rel(img, variant)  # raises if original missing
    return {"url": _signed_image_url(image_id, variant)}

@app.get("/api/images/{image_id}")
def get_image(
    request: Request,
    image_id: str,
    variant: Literal["thumb", "display", "original"] = "display",
    exp: Optional[int] = Query(default=None),
    sig: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    # If Authorization header is present, enforce bearer auth
    auth = request.headers.get("authorization")
    if auth:
        _ = current_user(Authorization=auth, db=db)
    else:
        # No bearer header: require a valid signed URL
        if exp is None or sig is None or not verify_image(image_id, variant, exp, sig):
            raise HTTPException(status_code=401, detail="Missing bearer token")

    img = db.query(PartImage).filter(PartImage.id == image_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Not found")

    rel = _variant_rel(img, variant)
    abs_path = resolve_path(rel)
    headers = {"Cache-Control": "public, max-age=604800, immutable"}
    return FileResponse(abs_path, media_type=img.mime, headers=headers)


# ---------------- SPA fallback ----------------
@app.get("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback(full_path: str):
    # API and docs routes are not part of client-side routing.
    if full_path.startswith("api/") or full_path in {"docs", "openapi.json", "redoc"}:
        raise HTTPException(status_code=404, detail="Not found")

    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    return FileResponse(os.path.join(UI_DIR, "index.html"), media_type="text/html", headers=headers)
