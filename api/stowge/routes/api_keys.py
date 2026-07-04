"""Admin-managed API key routes."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..api_key_auth import (generate_api_key_secret, key_prefix,
                            normalize_api_key_type, normalize_scopes,
                            parse_optional_datetime, scopes_to_json,
                            hash_api_key)
from ..auth import require_admin
from ..datetime_utils import now_utc
from ..db import get_db
from ..helpers.serializers import serialize_api_key
from ..models import ApiKey, User

router = APIRouter()


@router.get("/api/api-keys")
def list_api_keys(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    rows = db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()

    user_ids: set[str] = set()
    for row in rows:
        if row.user_id:
            user_ids.add(row.user_id)
        if row.created_by_user_id:
            user_ids.add(row.created_by_user_id)
        if row.revoked_by_user_id:
            user_ids.add(row.revoked_by_user_id)

    users_by_id: dict[str, str] = {}
    if user_ids:
        users = db.query(User.id, User.username).filter(User.id.in_(list(user_ids))).all()
        users_by_id = {user_id: email for user_id, email in users}

    return [
        serialize_api_key(
            row,
            owner_email=users_by_id.get(row.user_id) if row.user_id else None,
            created_by_email=users_by_id.get(row.created_by_user_id),
            revoked_by_email=users_by_id.get(row.revoked_by_user_id) if row.revoked_by_user_id else None,
        )
        for row in rows
    ]


@router.post("/api/api-keys")
def create_api_key(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    try:
        key_type = normalize_api_key_type(payload.get("key_type"))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex

    owner_user_id_raw = payload.get("user_id")
    owner_user_id = str(owner_user_id_raw).strip() if owner_user_id_raw is not None else ""
    owner_user_id = owner_user_id or None

    if key_type == "user" and not owner_user_id:
        raise HTTPException(status_code=400, detail="user_id is required for user key_type")
    if key_type == "system":
        owner_user_id = None

    if owner_user_id:
        owner = db.query(User.id).filter(User.id == owner_user_id).first()
        if not owner:
            raise HTTPException(status_code=400, detail="user_id does not exist")

    try:
        scopes = normalize_scopes(payload.get("scopes"))
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    if not scopes:
        raise HTTPException(status_code=400, detail="At least one scope is required")

    try:
        expires_at = parse_optional_datetime(payload.get("expires_at"), "expires_at")
    except ValueError as ex:
        raise HTTPException(status_code=400, detail=str(ex)) from ex
    if expires_at is not None and expires_at <= now_utc():
        raise HTTPException(status_code=400, detail="expires_at must be in the future")

    secret = generate_api_key_secret()
    row = ApiKey(
        user_id=owner_user_id,
        key_type=key_type,
        name=name,
        key_prefix=key_prefix(secret),
        key_hash=hash_api_key(secret),
        scopes_json=scopes_to_json(scopes),
        created_by_user_id=me.id,
        expires_at=expires_at,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError as ex:
        db.rollback()
        # Backward compatibility for instances whose legacy table still enforces
        # user_id NOT NULL before startup migration has been applied.
        if key_type == "system" and "NOT NULL constraint failed: api_keys.user_id" in str(ex):
            row.user_id = me.id
            db.add(row)
            db.commit()
        else:
            raise
    db.refresh(row)

    owner_email = None
    if owner_user_id:
        owner_email = db.query(User.username).filter(User.id == owner_user_id).scalar()

    return {
        "api_key": secret,
        "record": serialize_api_key(
            row,
            owner_email=owner_email,
            created_by_email=me.username,
        ),
    }


@router.patch("/api/api-keys/{api_key_id}")
def update_api_key(api_key_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    row = db.query(ApiKey).filter(ApiKey.id == api_key_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")

    if "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="name cannot be empty")
        row.name = name

    if "scopes" in payload:
        try:
            scopes = normalize_scopes(payload.get("scopes"))
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex
        if not scopes:
            raise HTTPException(status_code=400, detail="At least one scope is required")
        row.scopes_json = scopes_to_json(scopes)

    if "expires_at" in payload:
        try:
            expires_at = parse_optional_datetime(payload.get("expires_at"), "expires_at")
        except ValueError as ex:
            raise HTTPException(status_code=400, detail=str(ex)) from ex
        if expires_at is not None and expires_at <= now_utc():
            raise HTTPException(status_code=400, detail="expires_at must be in the future")
        row.expires_at = expires_at

    db.commit()
    db.refresh(row)

    users = db.query(User.id, User.username).filter(
        User.id.in_(
            [
                key_id
                for key_id in [row.user_id, row.created_by_user_id, row.revoked_by_user_id]
                if key_id
            ]
        )
    ).all()
    users_by_id = {user_id: username for user_id, username in users}

    return serialize_api_key(
        row,
        owner_email=users_by_id.get(row.user_id) if row.user_id else None,
        created_by_email=users_by_id.get(row.created_by_user_id),
        revoked_by_email=users_by_id.get(row.revoked_by_user_id) if row.revoked_by_user_id else None,
    )


@router.post("/api/api-keys/{api_key_id}/revoke")
def revoke_api_key(api_key_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    row = db.query(ApiKey).filter(ApiKey.id == api_key_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")

    if row.revoked_at is None:
        row.revoked_at = now_utc()
        row.revoked_by_user_id = me.id
        row.revoked_reason = str(payload.get("reason") or "").strip() or None
        db.commit()
        db.refresh(row)

    users = db.query(User.id, User.username).filter(
        User.id.in_(
            [
                key_id
                for key_id in [row.user_id, row.created_by_user_id, row.revoked_by_user_id]
                if key_id
            ]
        )
    ).all()
    users_by_id = {user_id: username for user_id, username in users}

    return serialize_api_key(
        row,
        owner_email=users_by_id.get(row.user_id) if row.user_id else None,
        created_by_email=users_by_id.get(row.created_by_user_id),
        revoked_by_email=users_by_id.get(row.revoked_by_user_id) if row.revoked_by_user_id else None,
    )


@router.delete("/api/api-keys/{api_key_id}")
def delete_api_key(api_key_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    row = db.query(ApiKey).filter(ApiKey.id == api_key_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="API key not found")

    if row.revoked_at is None:
        raise HTTPException(status_code=400, detail="API key must be revoked before deletion")

    db.delete(row)
    db.commit()
    return {"ok": True}
