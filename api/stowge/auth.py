import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from .db import get_db
from .models import User, UserSession

SESSION_COOKIE_NAME = "stowge_session"
SESSION_LIFETIME_MINUTES = int(os.getenv("SESSION_LIFETIME_MINUTES", "1440"))
# Minimum seconds between UserSession.last_seen_at writes (0 = write on every request).
SESSION_TOUCH_INTERVAL_SECONDS = int(os.getenv("SESSION_TOUCH_INTERVAL_SECONDS", "60"))
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"


def _pw_bytes(pw: str) -> bytes:
    # Fixed-length bytes so bcrypt never sees >72 bytes
    return hashlib.sha256(pw.encode("utf-8")).digest()


def hash_password(pw: str) -> str:
    hashed = bcrypt.hashpw(_pw_bytes(pw), bcrypt.gensalt())
    return hashed.decode("utf-8")


# Computed once at startup. Used in login so that an unknown email address takes
# the same bcrypt time as a wrong password, preventing email enumeration via timing.
_TIMING_DUMMY_HASH: str = hash_password("__stowge_timing_dummy__")


def verify_password(pw: str, pw_hash: str) -> bool:
    return bcrypt.checkpw(_pw_bytes(pw), pw_hash.encode("utf-8"))


def create_session(user: User, db: Session) -> str:
    """Create a new server-side session for *user* and return the opaque session ID."""
    session_id = secrets.token_hex(32)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=SESSION_LIFETIME_MINUTES)

    # Lazy cleanup: prune any expired sessions for this user on each new login.
    db.query(UserSession).filter(
        UserSession.user_id == user.id,
        UserSession.expires_at < now,
    ).delete(synchronize_session=False)

    sess = UserSession(
        id=session_id,
        user_id=user.id,
        created_at=now,
        last_seen_at=now,
        expires_at=expires,
    )
    db.add(sess)
    db.commit()
    return session_id


def delete_session(session_id: str, db: Session) -> None:
    """Delete a session row (used on logout)."""
    db.query(UserSession).filter(UserSession.id == session_id).delete(
        synchronize_session=False
    )
    db.commit()


def delete_all_sessions(db: Session) -> int:
    """Delete all active sessions and return the number removed."""
    deleted = db.query(UserSession).delete(synchronize_session=False)
    db.commit()
    return int(deleted or 0)


def current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        raise HTTPException(status_code=401, detail="Not authenticated")

    now = datetime.now(timezone.utc)
    # One round trip for session + owner (was two SELECTs).
    row = (
        db.query(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .filter(
            UserSession.id == session_id,
            UserSession.expires_at > now,
        )
        .first()
    )
    if row is None:
        # Distinguish "no live session" from "session without a user" (kept for identical 401 details).
        if db.query(UserSession.id).filter(UserSession.id == session_id, UserSession.expires_at > now).first():
            raise HTTPException(status_code=401, detail="User not found")
        raise HTTPException(status_code=401, detail="Session expired or invalid")
    sess, user = row

    # Refresh last_seen_at to track session activity. Throttled: a write + commit on every
    # request (page load fires several) costs a WAL transaction each; minute resolution is
    # plenty for "last seen".
    last_seen = sess.last_seen_at
    if last_seen is not None and last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)
    if last_seen is None or (now - last_seen).total_seconds() >= SESSION_TOUCH_INTERVAL_SECONDS:
        sess.last_seen_at = now
        try:
            db.commit()
        except StaleDataError:
            # Session row can be concurrently deleted (for example during restore apply
            # global logout). Treat this as an expired/invalid session instead of 500.
            db.rollback()
            raise HTTPException(status_code=401, detail="Session expired or invalid")

    return user


def require_admin(me: User = Depends(current_user)) -> User:
    if me.role != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return me
