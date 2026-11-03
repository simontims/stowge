"""AI hint CRUD routes."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..ai_hints import ensure_default_hint, hint_by_name
from ..auth import current_user
from ..constraints import MIN_NAME_LENGTH, require_name
from ..db import get_db
from ..helpers.serializers import list_hints_payload, serialize_hint
from ..models import AiHint, User

router = APIRouter()


def _clean_text(value: object) -> str:
    return str(value or "").strip()


@router.get("/api/hints")
def list_hints(db: Session = Depends(get_db), me: User = Depends(current_user)):
    ensure_default_hint(db)
    return list_hints_payload(db)


@router.post("/api/hints")
def create_hint(payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
    ensure_default_hint(db)
    if hint_by_name(db, name):
        raise HTTPException(status_code=400, detail="Hint name already exists")

    hint = AiHint(name=name, text=_clean_text(payload.get("text")), is_default=0)
    db.add(hint)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request took the name between the check and the insert
        db.rollback()
        raise HTTPException(status_code=400, detail="Hint name already exists")
    db.refresh(hint)
    return serialize_hint(hint)


@router.patch("/api/hints/{hint_id}")
def update_hint(hint_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(current_user)):
    hint = db.query(AiHint).filter(AiHint.id == hint_id).first()
    if not hint:
        raise HTTPException(status_code=404, detail="Hint not found")

    if "name" in payload:
        name = require_name(payload.get("name"), min_length=MIN_NAME_LENGTH)
        if hint.is_default:
            if name != hint.name:
                raise HTTPException(status_code=400, detail="The Default hint cannot be renamed")
        else:
            other = hint_by_name(db, name)
            if other and other.id != hint.id:
                raise HTTPException(status_code=400, detail="Hint name already exists")
            hint.name = name

    if "text" in payload:
        hint.text = _clean_text(payload.get("text"))

    hint.updated_at = datetime.now(timezone.utc)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request took the name between the check and the update
        db.rollback()
        raise HTTPException(status_code=400, detail="Hint name already exists")
    db.refresh(hint)
    return serialize_hint(hint)


@router.delete("/api/hints/{hint_id}")
def delete_hint(hint_id: str, db: Session = Depends(get_db), me: User = Depends(current_user)):
    hint = db.query(AiHint).filter(AiHint.id == hint_id).first()
    if not hint:
        raise HTTPException(status_code=404, detail="Hint not found")
    if hint.is_default:
        raise HTTPException(status_code=400, detail="The Default hint cannot be deleted")

    reset = (
        db.query(User)
        .filter(User.preferred_add_hint_id == hint_id)
        .update({"preferred_add_hint_id": None}, synchronize_session=False)
    )
    db.delete(hint)
    db.commit()
    return {"ok": True, "users_reset": int(reset)}
