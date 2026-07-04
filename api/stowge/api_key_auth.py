"""API key authentication and scope authorization helpers."""

import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .datetime_utils import now_utc
from .db import get_db
from .models import ApiKey, User

API_KEY_PREFIX = "stgk_"
ALLOWED_API_KEY_TYPES = {"user", "system"}
ALLOWED_API_KEY_SCOPES = {
    "items.read",
    "items.write",
    "items.delete",
    "collections.read",
    "collections.write",
    "collections.delete",
    "locations.read",
    "locations.write",
    "locations.delete",
}
ACTIVE_API_KEY_SCOPES = {
    "items.read",
    "items.write",
    "items.delete",
    "collections.read",
    "collections.write",
    "collections.delete",
    "locations.read",
    "locations.write",
    "locations.delete",
}


@dataclass
class ApiKeyAuthContext:
    api_key: ApiKey
    scopes: set[str]
    owner_user: User | None


def generate_api_key_secret() -> str:
    # 32 random bytes encoded as 64 hex chars, with a stable prefix for operator clarity.
    return f"{API_KEY_PREFIX}{secrets.token_hex(32)}"


def hash_api_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def key_prefix(value: str) -> str:
    return value[:8]


def normalize_api_key_type(value: str | None) -> str:
    normalized = (value or "user").strip().lower()
    if normalized not in ALLOWED_API_KEY_TYPES:
        raise ValueError("key_type must be user|system")
    return normalized


def normalize_scopes(value: object) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("scopes must be an array")

    out: list[str] = []
    seen: set[str] = set()
    for raw in value:
        scope = str(raw).strip()
        if not scope or scope in seen:
            continue
        if scope not in ALLOWED_API_KEY_SCOPES:
            raise ValueError(f"Unsupported scope: {scope}")
        if scope not in ACTIVE_API_KEY_SCOPES:
            raise ValueError(f"Scope not available yet: {scope}")
        seen.add(scope)
        out.append(scope)
    return out


def scopes_to_json(scopes: list[str]) -> str:
    return json.dumps(scopes)


def scopes_from_json(value: str | None) -> set[str]:
    if not value:
        return set()
    try:
        parsed = json.loads(value)
    except Exception:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item).strip() for item in parsed if str(item).strip()}


def parse_optional_datetime(value: object, field_name: str) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    try:
        candidate = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(candidate)
    except ValueError as ex:
        raise ValueError(f"{field_name} must be a valid ISO-8601 datetime") from ex

    if dt.tzinfo is None:
        raise ValueError(f"{field_name} must include timezone")

    return dt.astimezone(now_utc().tzinfo)


bearer_scheme = HTTPBearer(
    auto_error=False,
    scheme_name="API Key",
    description="Paste the Stowge API key value.",
)


def _active_api_key_for_token(token: str, db: Session) -> ApiKey:
    token_hash = hash_api_key(token)
    key = db.query(ApiKey).filter(ApiKey.key_hash == token_hash).first()
    if not key:
        raise HTTPException(status_code=401, detail="Invalid API key")

    # Compare hash strings in constant time to reduce subtle timing differences.
    if not hmac.compare_digest(token_hash, key.key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")

    now = now_utc()
    if key.revoked_at is not None:
        raise HTTPException(status_code=401, detail="API key revoked")
    if key.expires_at is not None and key.expires_at <= now:
        raise HTTPException(status_code=401, detail="API key expired")

    return key


def require_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> ApiKeyAuthContext:
    if credentials is None or not credentials.credentials.strip():
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = credentials.credentials.strip()
    key = _active_api_key_for_token(token, db)

    owner_user: User | None = None
    if key.key_type == "user":
        if not key.user_id:
            raise HTTPException(status_code=401, detail="API key owner missing")
        owner_user = db.query(User).filter(User.id == key.user_id).first()
        if not owner_user:
            raise HTTPException(status_code=401, detail="API key owner missing")

    key.last_used_at = now_utc()
    db.commit()

    return ApiKeyAuthContext(
        api_key=key,
        scopes=scopes_from_json(key.scopes_json),
        owner_user=owner_user,
    )


def require_api_key_scopes(required_scopes: list[str]) -> Callable[[ApiKeyAuthContext], ApiKeyAuthContext]:
    required = {scope.strip() for scope in required_scopes if scope and scope.strip()}

    def dependency(ctx: ApiKeyAuthContext = Depends(require_api_key)) -> ApiKeyAuthContext:
        missing = sorted(scope for scope in required if scope not in ctx.scopes)
        if missing:
            raise HTTPException(
                status_code=403,
                detail={
                    "message": "API key lacks required permissions",
                    "missing_scopes": missing,
                },
            )
        return ctx

    return dependency
