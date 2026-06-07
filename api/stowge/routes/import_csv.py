"""CSV import endpoint for items/inventory data."""

import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..constraints import MIN_NAME_LENGTH
from ..db import get_db
from ..helpers.events import publish_inventory_change
from ..models import Collection, Location, Part, User

router = APIRouter()

REQUIRED_COLUMNS = {"name"}
SUPPORTED_COLUMNS = {"name", "description", "collection", "location", "status", "quantity"}
VALID_STATUSES = {"draft", "confirmed"}


def _parse_csv(content: str) -> tuple[list[dict], list[str]]:
    """Parse CSV content and return (rows, errors)."""
    errors: list[str] = []
    rows: list[dict] = []

    try:
        reader = csv.DictReader(io.StringIO(content))
    except Exception as e:
        return [], [f"Failed to parse CSV: {e}"]

    if not reader.fieldnames:
        return [], ["CSV file has no header row"]

    # Normalize header names to lowercase
    normalized_fields = {f.strip().lower(): f for f in reader.fieldnames}

    # Check required columns
    if "name" not in normalized_fields:
        return [], ["CSV is missing required column: name"]

    for i, raw_row in enumerate(reader, start=2):  # start=2 because row 1 is header
        # Map to normalized keys
        row: dict = {}
        for norm_key, orig_key in normalized_fields.items():
            if norm_key in SUPPORTED_COLUMNS:
                row[norm_key] = (raw_row.get(orig_key) or "").strip()

        name = row.get("name", "").strip()
        if not name:
            errors.append(f"Row {i}: name is empty, skipping")
            continue
        if len(name) < MIN_NAME_LENGTH:
            errors.append(f"Row {i}: name '{name}' is too short (minimum {MIN_NAME_LENGTH} characters)")
            continue

        # Validate status
        status = row.get("status", "").strip().lower()
        if status and status not in VALID_STATUSES:
            errors.append(f"Row {i}: invalid status '{row.get('status')}', using 'draft'")
            status = "draft"
        if not status:
            status = "draft"

        # Validate quantity
        quantity_str = row.get("quantity", "").strip()
        quantity = 1
        if quantity_str:
            try:
                quantity = max(0, int(quantity_str))
            except ValueError:
                errors.append(f"Row {i}: invalid quantity '{quantity_str}', using 1")
                quantity = 1

        rows.append({
            "name": name,
            "description": row.get("description", "").strip() or None,
            "collection": row.get("collection", "").strip() or None,
            "location": row.get("location", "").strip() or None,
            "status": status,
            "quantity": quantity,
        })

    return rows, errors


@router.post("/api/import/csv/preview")
def preview_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    """Parse CSV and return preview with missing collections/locations."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    content = file.file.read()
    try:
        text = content.decode("utf-8-sig")  # utf-8-sig handles BOM from Excel
    except UnicodeDecodeError:
        try:
            text = content.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Unable to decode file. Please use UTF-8 encoding.")

    rows, parse_errors = _parse_csv(text)

    if not rows and parse_errors:
        raise HTTPException(status_code=400, detail=parse_errors[0])

    # Gather unique collections and locations from the CSV
    csv_collections = {r["collection"] for r in rows if r["collection"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    # Check which exist (case-insensitive)
    existing_collections: set[str] = set()
    if csv_collections:
        db_collections = db.query(Collection.name).all()
        existing_collections = {c.name.lower() for c in db_collections}

    existing_locations: set[str] = set()
    if csv_locations:
        db_locations = db.query(Location.name).all()
        existing_locations = {l.name.lower() for l in db_locations}

    missing_collections = sorted(
        [c for c in csv_collections if c.lower() not in existing_collections]
    )
    missing_locations = sorted(
        [l for l in csv_locations if l.lower() not in existing_locations]
    )

    return {
        "item_count": len(rows),
        "parse_errors": parse_errors,
        "missing_collections": missing_collections,
        "missing_locations": missing_locations,
    }


@router.post("/api/import/csv/confirm")
def confirm_import(
    file: UploadFile = File(...),
    create_collections: bool = False,
    create_locations: bool = False,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    """Import items from CSV, optionally creating missing collections/locations."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv file")

    content = file.file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("latin-1")
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail="Unable to decode file. Please use UTF-8 encoding.")

    rows, parse_errors = _parse_csv(text)

    if not rows:
        raise HTTPException(status_code=400, detail="No valid items found in CSV")

    # Build lookup maps for existing collections and locations (case-insensitive)
    db_collections = db.query(Collection).all()
    collection_map: dict[str, Collection] = {c.name.lower(): c for c in db_collections}

    db_locations = db.query(Location).all()
    location_map: dict[str, Location] = {l.name.lower(): l for l in db_locations}

    # Determine what needs to be created
    csv_collections = {r["collection"] for r in rows if r["collection"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    missing_collections = [c for c in csv_collections if c.lower() not in collection_map]
    missing_locations = [l for l in csv_locations if l.lower() not in location_map]

    if missing_collections and not create_collections:
        raise HTTPException(
            status_code=400,
            detail=f"Missing collections: {', '.join(sorted(missing_collections))}. "
                   "Set create_collections=true to create them.",
        )

    if missing_locations and not create_locations:
        raise HTTPException(
            status_code=400,
            detail=f"Missing locations: {', '.join(sorted(missing_locations))}. "
                   "Set create_locations=true to create them.",
        )

    # Create missing collections
    for coll_name in missing_collections:
        new_coll = Collection(name=coll_name)
        db.add(new_coll)
        db.flush()
        collection_map[coll_name.lower()] = new_coll

    # Create missing locations
    for loc_name in missing_locations:
        new_loc = Location(name=loc_name)
        db.add(new_loc)
        db.flush()
        location_map[loc_name.lower()] = new_loc

    # Import items
    now = datetime.now(timezone.utc)
    created_ids: list[str] = []

    for row in rows:
        # Resolve location to ID
        location_id: Optional[str] = None
        if row["location"]:
            loc = location_map.get(row["location"].lower())
            if loc:
                location_id = loc.id

        # Resolve collection name (use the existing name's casing)
        collection_name: Optional[str] = None
        if row["collection"]:
            coll = collection_map.get(row["collection"].lower())
            if coll:
                collection_name = coll.name

        part = Part(
            name=row["name"],
            description=row["description"],
            collection=collection_name,
            location_id=location_id,
            status=row["status"],
            quantity=row["quantity"],
            created_at=now,
            updated_at=now,
        )
        db.add(part)
        db.flush()
        created_ids.append(part.id)

    db.commit()

    # Publish events
    for part_id in created_ids:
        publish_inventory_change("created", part_id)

    return {
        "imported": len(created_ids),
        "parse_errors": parse_errors,
        "collections_created": len(missing_collections),
        "locations_created": len(missing_locations),
    }
