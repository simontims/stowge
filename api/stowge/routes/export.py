"""CSV export endpoint for items/inventory data."""

import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from ..auth import require_admin
from ..db import get_db
from ..models import ItemContentsEntry, Location, Part, User

router = APIRouter()

CSV_COLUMNS = [
    "name",
    "description",
    "collection",
    "location",
    "status",
    "quantity",
    "contents",
    "created_at",
    "updated_at",
]


def _format_contents(entries: list[ItemContentsEntry]) -> str:
    """Format contents entries as semicolon-separated string."""
    parts = []
    for entry in sorted(entries, key=lambda e: e.sort_order):
        s = f"{entry.name} (x{entry.quantity})"
        if entry.note:
            s += f" [{entry.note}]"
        parts.append(s)
    return "; ".join(parts)


def _generate_csv(items: list, location_map: dict[str, str]):
    """Generator that yields CSV rows for streaming."""
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_ALL)

    # Header row
    writer.writerow(CSV_COLUMNS)
    yield buf.getvalue()
    buf.seek(0)
    buf.truncate(0)

    for item in items:
        loc_name = location_map.get(item.location_id, "") if item.location_id else ""
        row = [
            item.name or "",
            item.description or "",
            item.collection or "",
            loc_name,
            item.status or "",
            item.quantity if item.quantity is not None else 1,
            _format_contents(item.contents),
            item.created_at.isoformat() if item.created_at else "",
            item.updated_at.isoformat() if item.updated_at else "",
        ]
        writer.writerow(row)
        yield buf.getvalue()
        buf.seek(0)
        buf.truncate(0)


@router.get("/api/export/csv")
def export_csv(
    scope: str = Query("active", pattern="^(active|deleted|all)$"),
    collection: Optional[str] = None,
    location: Optional[str] = None,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    query = (
        db.query(Part)
        .outerjoin(Location, Part.location_id == Location.id)
        .options(joinedload(Part.contents))
    )

    # Scope filter
    if scope == "active":
        query = query.filter(Part.is_deleted == 0)
    elif scope == "deleted":
        query = query.filter(Part.is_deleted == 1)
    # "all" → no is_deleted filter

    # Collection filter
    if collection:
        query = query.filter(Part.collection.ilike(collection))

    # Location filter (by name)
    if location:
        query = query.filter(Location.name.ilike(location))

    query = query.order_by(Part.name.asc())
    items = query.all()

    # Build location name lookup
    location_ids = {p.location_id for p in items if p.location_id}
    location_map: dict[str, str] = {}
    if location_ids:
        rows = db.query(Location.id, Location.name).filter(Location.id.in_(location_ids)).all()
        location_map = {lid: lname for lid, lname in rows}

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    filename = f"stowge-export-{today}.csv"

    return StreamingResponse(
        _generate_csv(items, location_map),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
