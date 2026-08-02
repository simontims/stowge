"""CSV import endpoint for items/inventory data."""

import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..constraints import MIN_NAME_LENGTH
from ..db import get_db
from ..helpers.events import publish_inventory_change
from ..models import Area, Collection, Location, Part, Site, User

router = APIRouter()

REQUIRED_COLUMNS = {"name"}
SUPPORTED_COLUMNS = {"name", "description", "collection", "site", "area", "location", "status", "quantity"}
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
            "site": row.get("site", "").strip() or None,
            "area": row.get("area", "").strip() or None,
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

    # Gather unique collections and hierarchy values from the CSV
    csv_collections = {r["collection"] for r in rows if r["collection"]}
    csv_sites = {r["site"] for r in rows if r["site"]}
    csv_areas = {r["area"] for r in rows if r["area"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    # Check which exist (case-insensitive)
    existing_collections: set[str] = set()
    if csv_collections:
        db_collections = db.query(Collection.name).all()
        existing_collections = {c.name.lower() for c in db_collections}

    existing_sites: set[str] = set()
    if csv_sites:
        db_sites = db.query(Site.name).all()
        existing_sites = {site.name.lower() for site in db_sites}

    existing_areas: set[str] = set()
    if csv_areas:
        db_areas = db.query(Area.name).all()
        existing_areas = {area.name.lower() for area in db_areas}

    existing_locations: set[str] = set()
    if csv_locations:
        db_locations = db.query(Location.name).all()
        existing_locations = {loc.name.lower() for loc in db_locations}

    missing_collections = sorted(
        [c for c in csv_collections if c.lower() not in existing_collections]
    )
    missing_sites = sorted(
        [s for s in csv_sites if s.lower() not in existing_sites]
    )
    missing_areas = sorted(
        [a for a in csv_areas if a.lower() not in existing_areas]
    )
    missing_locations = sorted(
        [loc for loc in csv_locations if loc.lower() not in existing_locations]
    )

    return {
        "item_count": len(rows),
        "parse_errors": parse_errors,
        "missing_collections": missing_collections,
        "missing_sites": missing_sites,
        "missing_areas": missing_areas,
        "missing_locations": missing_locations,
    }


@router.post("/api/import/csv/confirm")
def confirm_import(
    file: UploadFile = File(...),
    create_collections: bool = False,
    create_sites: bool = False,
    create_areas: bool = False,
    create_locations: bool = False,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    """Import items from CSV, optionally creating missing collections/sites/areas/locations."""
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

    db_sites = db.query(Site).all()
    site_map: dict[str, Site] = {site.name.lower(): site for site in db_sites}

    db_areas = db.query(Area).all()
    area_map: dict[str, Area] = {area.name.lower(): area for area in db_areas}

    db_locations = db.query(Location).all()
    location_map: dict[str, Location] = {loc.name.lower(): loc for loc in db_locations}

    # Determine what needs to be created
    csv_collections = {r["collection"] for r in rows if r["collection"]}
    csv_sites = {r["site"] for r in rows if r["site"]}
    csv_areas = {r["area"] for r in rows if r["area"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    missing_collections = [c for c in csv_collections if c.lower() not in collection_map]
    missing_sites = [s for s in csv_sites if s.lower() not in site_map]
    missing_areas = [a for a in csv_areas if a.lower() not in area_map]
    missing_locations = [loc for loc in csv_locations if loc.lower() not in location_map]

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

    if missing_sites and not create_sites:
        raise HTTPException(
            status_code=400,
            detail=f"Missing sites: {', '.join(sorted(missing_sites))}. "
                   "Set create_sites=true to create them.",
        )

    if missing_areas and not create_areas:
        raise HTTPException(
            status_code=400,
            detail=f"Missing areas: {', '.join(sorted(missing_areas))}. "
                   "Set create_areas=true to create them.",
        )

    # Create missing collections
    for coll_name in missing_collections:
        new_coll = Collection(name=coll_name)
        db.add(new_coll)
        db.flush()
        collection_map[coll_name.lower()] = new_coll

    # Create missing sites
    for site_name in missing_sites:
        new_site = Site(name=site_name)
        db.add(new_site)
        db.flush()
        site_map[site_name.lower()] = new_site

    default_site = site_map.get("home")
    if default_site is None:
        default_site = db.query(Site).order_by(Site.created_at.asc()).first()

    # Create missing areas
    for area_name in missing_areas:
        related_site_name = None
        for row in rows:
            if (row.get("area") or "").strip().lower() == area_name.lower():
                related_site_name = (row.get("site") or "").strip() or None
                if related_site_name:
                    break
        site_for_area = site_map.get(related_site_name.lower()) if related_site_name else default_site
        new_area = Area(name=area_name, site_id=(site_for_area.id if site_for_area else None))
        db.add(new_area)
        db.flush()
        area_map[area_name.lower()] = new_area

    # Create missing locations
    for loc_name in missing_locations:
        related_area_name = None
        for row in rows:
            if (row.get("location") or "").strip().lower() == loc_name.lower():
                related_area_name = (row.get("area") or "").strip() or None
                if related_area_name:
                    break

        area_for_location = area_map.get(related_area_name.lower()) if related_area_name else None
        if area_for_location is None:
            area_for_location = area_map.get("general") or db.query(Area).order_by(Area.created_at.asc()).first()

        new_loc = Location(name=loc_name, area_id=(area_for_location.id if area_for_location else None))
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
        "sites_created": len(missing_sites),
        "areas_created": len(missing_areas),
        "locations_created": len(missing_locations),
    }
