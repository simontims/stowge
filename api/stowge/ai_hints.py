"""AI hints: named blocks of text sent to the model with each Identify run."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from .datetime_utils import now_utc
from .models import AiHint

DEFAULT_HINT_NAME = "Default"
DEFAULT_HINT_TEXT = (
    "General household and workshop inventory. The item could be anything: tools,\n"
    "hardware, electronics, cables, spares, cleaning supplies, outdoor gear,\n"
    "camping equipment, tech, or everyday objects. Do not assume it is an\n"
    "electronic component.\n"
    "\n"
    "Name it the way someone would search for it, using brand and model when\n"
    "visible (e.g. \"Makita 18V Drill Driver\", \"USB-C to HDMI Cable 2m\"), not a\n"
    "technical description. If the photo shows several of the same item, name the\n"
    "item itself and don't count them. If you can't tell what it is, say so rather\n"
    "than guessing."
)


def ensure_default_hint(db: Session) -> AiHint:
    """The built-in Default hint. Created if it is missing (a database that skipped the migration)."""
    row = db.query(AiHint).filter(AiHint.is_default == 1).first()
    if row is None:
        row = AiHint(name=DEFAULT_HINT_NAME, text=DEFAULT_HINT_TEXT, is_default=1,
                     created_at=now_utc(), updated_at=now_utc())
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def hint_by_name(db: Session, name: str) -> AiHint | None:
    return db.query(AiHint).filter(func.lower(AiHint.name) == func.lower(name)).first()


def resolve_hint_context(db: Session, hint_id: str | None) -> str | None:
    """Text of the chosen hint for an Identify run. Blank/missing id = Default; unknown id = HTTP 400.

    Returns ``"Hint: <text>"`` for the model, or None when the text is blank (nothing is sent).
    """
    raw = str(hint_id or "").strip()
    if raw:
        hint = db.query(AiHint).filter(AiHint.id == raw).first()
        if hint is None:
            raise HTTPException(status_code=400, detail="Invalid hint_id")
    else:
        hint = ensure_default_hint(db)
    text = (hint.text or "").strip()
    return f"Hint: {text}" if text else None
