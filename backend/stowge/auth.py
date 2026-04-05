import os
import base64
import hashlib
import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Header, HTTPException, Depends
import jwt
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from .models import User
from .db import get_db

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ISSUER = os.getenv("JWT_ISSUER", "stowge")
JWT_EXPIRES_MINUTES = int(os.getenv("JWT_EXPIRES_MINUTES", "1440"))

def _pw_bytes(pw: str) -> bytes:
    # Fixed-length bytes so bcrypt never sees >72 bytes
    return hashlib.sha256(pw.encode("utf-8")).digest()

def hash_password(pw: str) -> str:
    hashed = bcrypt.hashpw(_pw_bytes(pw), bcrypt.gensalt())
    return hashed.decode("utf-8")

# Computed once at startup. Used in login so that an unknown email address takes
# the same bcrypt time as a wrong password, preventing email enumeration.
_TIMING_DUMMY_HASH: str = hash_password("__stowge_timing_dummy__")

def verify_password(pw: str, pw_hash: str) -> bool:
    return bcrypt.checkpw(_pw_bytes(pw), pw_hash.encode("utf-8"))

def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "iss": JWT_ISSUER,
        "sub": user.id,
        "username": user.username,
        "first_name": user.first_name or "",
        "last_name": user.last_name or "",
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=JWT_EXPIRES_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")

def current_user(
    Authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not Authorization or not Authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = Authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER)
    except InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

def require_admin(me: User = Depends(current_user)) -> User:
    if me.role != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return me
