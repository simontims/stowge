"""Stowge API — Application entry point.

Creates the FastAPI app, registers middleware, mounts static files,
includes all route modules, and manages startup/shutdown lifecycle.
"""

import logging
import os
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from slowapi.errors import RateLimitExceeded
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from .db import Base, SessionLocal, engine, get_db
from .helpers.ai_providers import default_api_base_for_provider
from .helpers.maintenance import (MAINTENANCE_TASK_KEYS,
                                  start_maintenance_scheduler_if_needed,
                                  stop_maintenance_scheduler)
from .models import AppMeta, LLMConfig, MaintenanceSchedule
from .rate_limit import limiter

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

UI_DIR = os.getenv("UI_DIR", "/app/ui")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "").strip()
APP_VERSION = os.getenv("APP_VERSION", "0.1.0")

_MAINTENANCE_DEFAULTS_SEED_KEY = "maintenance_defaults_seeded_v1"
_MAINTENANCE_TASK_DEFAULTS: dict[str, dict[str, str]] = {
    "vacuum": {"cron": "0 3 * * 0"},
    "orphaned_images_cleanup": {"cron": "0 4 * * 0"},
    "backup": {"cron": "0 2 * * *"},
}


# ---------------------------------------------------------------------------
# Rate Limit Handler
# ---------------------------------------------------------------------------

def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    return HTMLResponse(
        content='{"detail":"Rate limit exceeded"}',
        status_code=429,
        headers={"Content-Type": "application/json", "Retry-After": str(exc.detail)},
    )


# ---------------------------------------------------------------------------
# Startup Migrations
# ---------------------------------------------------------------------------

def _default_api_base_for_provider_local(provider: str) -> str | None:
    return default_api_base_for_provider(provider)


def _run_startup_migrations():
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        if "categories" in tables and "collections" not in tables:
            conn.execute(text("ALTER TABLE categories RENAME TO collections"))

        if "collections" in set(inspect(engine).get_table_names()):
            coll_columns = {c["name"] for c in inspect(engine).get_columns("collections")}
            if "color" not in coll_columns:
                conn.execute(text("ALTER TABLE collections ADD COLUMN color VARCHAR NULL"))

        parts_columns = set()
        if "parts" in set(inspect(engine).get_table_names()):
            parts_columns = {c["name"] for c in inspect(engine).get_columns("parts")}
            if "category" in parts_columns and "collection" not in parts_columns:
                conn.execute(text("ALTER TABLE parts RENAME COLUMN category TO collection"))
                parts_columns = {c["name"] for c in inspect(engine).get_columns("parts")}
            if "location_id" not in parts_columns:
                conn.execute(text("ALTER TABLE parts ADD COLUMN location_id VARCHAR NULL"))
            if "quantity" not in parts_columns:
                conn.execute(text("ALTER TABLE parts ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1"))
            if "is_deleted" not in parts_columns:
                conn.execute(text("ALTER TABLE parts ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0"))

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
            if "preferred_add_location_id" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN preferred_add_location_id VARCHAR NULL"))
            user_columns = {c["name"] for c in inspect(engine).get_columns("users")}
            if "collection_nav_order" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN collection_nav_order TEXT NULL"))

    tables = set(inspect(engine).get_table_names())

    if "users" not in tables:
        return

    if "app_meta" not in tables:
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE IF NOT EXISTS app_meta (key VARCHAR PRIMARY KEY, value TEXT NOT NULL)"))
        tables.add("app_meta")

    if "images" in tables:
        image_columns = {c["name"] for c in inspect(engine).get_columns("images")}
        with engine.begin() as conn:
            if "is_primary" not in image_columns:
                conn.execute(text("ALTER TABLE images ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0"))
                conn.execute(text("""
                    UPDATE images SET is_primary = 1
                    WHERE id IN (
                        SELECT id FROM images AS i1
                        WHERE i1.created_at = (
                            SELECT MIN(i2.created_at) FROM images AS i2
                            WHERE i2.part_id = i1.part_id
                        )
                    )
                """))

    if "llm_configs" in tables:
        llm_columns = {c["name"] for c in inspect(engine).get_columns("llm_configs")}
        with engine.begin() as conn:
            if "api_base" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN api_base VARCHAR NULL"))
            if "is_default" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0"))
            if "evidence_enabled" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN evidence_enabled INTEGER NOT NULL DEFAULT 0"))
            if "ai_max_edge" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN ai_max_edge INTEGER NOT NULL DEFAULT 1600"))
            if "ai_quality" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN ai_quality INTEGER NOT NULL DEFAULT 85"))
            if "validated_at" not in llm_columns:
                conn.execute(text("ALTER TABLE llm_configs ADD COLUMN validated_at DATETIME NULL"))

        with Session(bind=engine) as db:
            configs = db.query(LLMConfig).all()
            changed = False
            for cfg in configs:
                if (cfg.api_base or "").strip():
                    continue
                fallback = _default_api_base_for_provider_local((cfg.provider or "").strip().lower())
                if fallback:
                    cfg.api_base = fallback
                    cfg.updated_at = datetime.now(timezone.utc)
                    changed = True
            if changed:
                db.commit()

    if "maintenance_schedules" in tables:
        maintenance_columns = {c["name"] for c in inspect(engine).get_columns("maintenance_schedules")}
        with engine.begin() as conn:
            if "backup_retention_enabled" not in maintenance_columns:
                conn.execute(text("ALTER TABLE maintenance_schedules ADD COLUMN backup_retention_enabled INTEGER NOT NULL DEFAULT 0"))
            if "backup_retention_days" not in maintenance_columns:
                conn.execute(text("ALTER TABLE maintenance_schedules ADD COLUMN backup_retention_days INTEGER NOT NULL DEFAULT 30"))
            if "backup_include_assets" not in maintenance_columns:
                conn.execute(text("ALTER TABLE maintenance_schedules ADD COLUMN backup_include_assets INTEGER NOT NULL DEFAULT 1"))

        def local_cron_to_utc(cron_expression: str) -> str:
            parts = str(cron_expression or "").strip().split()
            if len(parts) != 5:
                return cron_expression

            minute_raw, hour_raw, day_of_month, month, day_of_week = parts
            if not minute_raw.isdigit() or not hour_raw.isdigit():
                return cron_expression

            local_minute = int(minute_raw)
            local_hour = int(hour_raw)
            if local_minute < 0 or local_minute > 59 or local_hour < 0 or local_hour > 23:
                return cron_expression

            local_now = datetime.now().astimezone()
            probe = local_now.replace(hour=local_hour, minute=local_minute, second=0, microsecond=0)
            utc_probe = probe.astimezone(timezone.utc)

            day_shift = utc_probe.weekday() - probe.weekday()
            if day_shift > 3:
                day_shift -= 7
            if day_shift < -3:
                day_shift += 7

            new_day_of_week = day_of_week
            new_day_of_month = day_of_month
            if day_shift and day_of_week.isdigit() and 0 <= int(day_of_week) <= 6:
                new_day_of_week = str((int(day_of_week) + day_shift) % 7)
            if day_shift and day_of_month.isdigit():
                new_day_of_month = str(max(1, min(31, int(day_of_month) + day_shift)))

            return f"{utc_probe.minute} {utc_probe.hour} {new_day_of_month} {month} {new_day_of_week}"

        with Session(bind=engine) as db:
            seeded = db.query(AppMeta).filter(AppMeta.key == _MAINTENANCE_DEFAULTS_SEED_KEY).first()
            if not seeded:
                now = datetime.now(timezone.utc)
                existing = {
                    row.task_key: row
                    for row in db.query(MaintenanceSchedule)
                    .filter(MaintenanceSchedule.task_key.in_(MAINTENANCE_TASK_KEYS))
                    .all()
                }
                for task_key in MAINTENANCE_TASK_KEYS:
                    default_cron = local_cron_to_utc(_MAINTENANCE_TASK_DEFAULTS[task_key]["cron"])
                    row = existing.get(task_key)
                    if row is None:
                        db.add(
                            MaintenanceSchedule(
                                task_key=task_key,
                                enabled=0,
                                cron_expression=default_cron,
                                backup_include_assets=1 if task_key == "backup" else 0,
                                next_run_at=None,
                                updated_at=now,
                            )
                        )
                    else:
                        row.enabled = 0
                        row.cron_expression = default_cron
                        if task_key == "backup":
                            row.backup_include_assets = 1
                        row.next_run_at = None
                        row.updated_at = now
                db.add(AppMeta(key=_MAINTENANCE_DEFAULTS_SEED_KEY, value=APP_VERSION))
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


# ---------------------------------------------------------------------------
# Database Init
# ---------------------------------------------------------------------------

def init_db():
    Base.metadata.create_all(bind=engine)
    _run_startup_migrations()

init_db()


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = FastAPI(title="Stowge", version=APP_VERSION)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

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


# ---------------------------------------------------------------------------
# Route Registration
# ---------------------------------------------------------------------------

from .routes.admin import router as admin_router
from .routes.ai_settings import router as ai_settings_router
from .routes.auth import router as auth_router
from .routes.collections import router as collections_router
from .routes.health import router as health_router
from .routes.images import router as images_router
from .routes.items import router as items_router
from .routes.locations import router as locations_router

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(locations_router)
app.include_router(collections_router)
app.include_router(items_router)
app.include_router(images_router)
app.include_router(ai_settings_router)
app.include_router(admin_router)


# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

@app.on_event("startup")
def startup_maintenance_scheduler():
    start_maintenance_scheduler_if_needed()


@app.on_event("shutdown")
def shutdown_maintenance_scheduler():
    stop_maintenance_scheduler()


# ---------------------------------------------------------------------------
# Static UI Routes
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# SPA Catch-All (must be last)
# ---------------------------------------------------------------------------

@app.get("/{full_path:path}", response_class=HTMLResponse)
def spa_fallback(full_path: str):
    if full_path.startswith("api/") or full_path in {"docs", "openapi.json", "redoc"}:
        raise HTTPException(status_code=404, detail="Not found")

    headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
    return FileResponse(os.path.join(UI_DIR, "index.html"), media_type="text/html", headers=headers)
