"""Dedicated external API app for integrators.

This sub-application is mounted under a separate path from internal/admin
routes and serves its own OpenAPI schema + interactive docs.
"""

import os

from fastapi import FastAPI

from .routes.api_v1 import router as api_v1_router

EXTERNAL_OPENAPI_TAGS = [
    {"name": "items", "description": "Read, create, update, and delete inventory items"},
    {"name": "collections", "description": "Read, create, update, and delete collections"},
    {"name": "locations", "description": "Read, create, update, and delete locations"},
]


external_api_app = FastAPI(
    title="Stowge External API",
    version=os.getenv("APP_VERSION", "0.1.0"),
    openapi_tags=EXTERNAL_OPENAPI_TAGS,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

external_api_app.include_router(api_v1_router)
