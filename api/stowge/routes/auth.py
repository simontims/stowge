"""Authentication, user management, and profile routes."""

import json
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..rate_limit import limiter
from ..auth import (SESSION_COOKIE_NAME, SESSION_COOKIE_SECURE,
                    SESSION_LIFETIME_MINUTES, _TIMING_DUMMY_HASH,
                    create_session, current_user, delete_session,
                    hash_password, require_admin, verify_password)
from ..db import get_db
from ..helpers.serializers import serialize_user
from ..models import Collection, Location, User

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _is_valid_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value))


@router.post("/api/setup/first-admin")
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

    session_id = create_session(user, db)
    response = JSONResponse(content=serialize_user(user))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        httponly=True,
        samesite="lax",
        secure=SESSION_COOKIE_SECURE,
        path="/",
        max_age=SESSION_LIFETIME_MINUTES * 60,
    )
    return response


@router.post("/api/login")
@limiter.limit("10/minute")
def login(request: Request, payload: dict, db: Session = Depends(get_db)):
    username = (payload.get("username") or payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    user = db.query(User).filter(User.username == username).first()
    check_hash = user.password_hash if user else _TIMING_DUMMY_HASH
    if not verify_password(password, check_hash) or not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    session_id = create_session(user, db)
    response = JSONResponse(content=serialize_user(user))
    response.set_cookie(
        SESSION_COOKIE_NAME,
        session_id,
        httponly=True,
        samesite="lax",
        secure=SESSION_COOKIE_SECURE,
        path="/",
        max_age=SESSION_LIFETIME_MINUTES * 60,
    )
    return response


@router.post("/api/logout")
def logout(request: Request, db: Session = Depends(get_db)):
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if session_id:
        delete_session(session_id, db)
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return response


# ---------------- Current user (self) ----------------

@router.get("/api/me")
def get_me(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return serialize_user(me)


@router.patch("/api/me")
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
    if "preferred_add_location_id" in payload:
        raw_loc_id = payload.get("preferred_add_location_id")
        loc_id = (str(raw_loc_id).strip() if raw_loc_id is not None else "")
        if not loc_id:
            u.preferred_add_location_id = None
        else:
            exists = db.query(Location.id).filter(Location.id == loc_id).first()
            if not exists:
                raise HTTPException(status_code=400, detail="Invalid preferred_add_location_id")
            u.preferred_add_location_id = loc_id
    if "last_open_collection" in payload:
        val = payload.get("last_open_collection")
        u.last_open_collection = str(val).strip() if val else None
    if "collection_nav_order" in payload:
        raw_order = payload.get("collection_nav_order")
        if raw_order is None:
            u.collection_nav_order = None
        elif isinstance(raw_order, list):
            seen: set[str] = set()
            normalized: list[str] = []
            for entry in raw_order:
                value = str(entry).strip()
                if not value or value in seen:
                    continue
                seen.add(value)
                normalized.append(value)
            u.collection_nav_order = json.dumps(normalized) if normalized else None
        else:
            raise HTTPException(status_code=400, detail="collection_nav_order must be an array of collection ids or null")
    db.commit()
    db.refresh(u)
    return serialize_user(u)


# ---------------- Users (admin) ----------------

@router.post("/api/users")
def create_user(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    username = (payload.get("email") or payload.get("username") or "").strip().lower()
    first_name = (payload.get("firstname") or payload.get("first_name") or "").strip()
    last_name = (payload.get("lastname") or payload.get("last_name") or payload.get("surname") or "").strip()
    password = payload.get("password") or ""
    role = str(payload.get("role") or "").strip().lower() or "user"

    if not _is_valid_email(username):
        raise HTTPException(status_code=400, detail="Valid email required")
    if password == "":
        raise HTTPException(status_code=400, detail="Password required")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")
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
    return serialize_user(u)


@router.get("/api/users")
def list_users(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    users = db.query(User).order_by(User.created_at.asc()).all()
    return [serialize_user(u) for u in users]


@router.patch("/api/users/{user_id}")
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
        new_role = str(payload.get("role") or "").strip().lower()
        if new_role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")

        if u.id == me.id and u.role == "admin" and new_role == "user":
            raise HTTPException(status_code=400, detail="You cannot demote your own admin role")

        if u.role == "admin" and new_role == "user":
            remaining_admins = db.query(User).filter(User.role == "admin", User.id != user_id).count()
            if remaining_admins == 0:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")

        u.role = new_role

    if "password" in payload:
        password = str(payload.get("password") or "")
        if password:
            u.password_hash = hash_password(password)

    db.commit()
    db.refresh(u)
    return serialize_user(u)


@router.delete("/api/users/{user_id}")
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
