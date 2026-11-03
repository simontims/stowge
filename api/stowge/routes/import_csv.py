"""CSV import endpoint for items/inventory data."""

import csv
import io
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import require_admin
from ..constraints import MIN_NAME_LENGTH
from ..db import get_db
from ..helpers.events import publish_inventory_change
from ..models import Area, ItemTag, Location, Part, Site, Tag, User
from .tags import require_tag_name

router = APIRouter()

REQUIRED_COLUMNS = {"name"}
# "collection" is only read from old export files; it is treated as one tag.
SUPPORTED_COLUMNS = {"name", "description", "tags", "collection", "site", "area", "location", "status", "quantity"}
VALID_STATUSES = {"draft", "confirmed"}


def _split_tags(tags_value: str, legacy_collection: str) -> list[str]:
    """Tag names from a ``tags`` cell (split on ';' only, so names may contain commas) plus a legacy ``collection`` cell (one tag).

    Names are trimmed and de-duplicated case-insensitively (first spelling wins).
    """
    names: list[str] = []
    seen: set[str] = set()
    candidates = tags_value.split(";")
    if legacy_collection.strip():
        candidates.append(legacy_collection)
    for candidate in candidates:
        name = candidate.strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            names.append(name)
    return names


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
            "tags": _split_tags(row.get("tags", ""), row.get("collection", "")),
            "site": row.get("site", "").strip() or None,
            "area": row.get("area", "").strip() or None,
            "location": row.get("location", "").strip() or None,
            "status": status,
            "quantity": quantity,
        })

    return rows, errors


def _unique_tag_names(rows: list[dict]) -> list[str]:
    """Distinct tag names across all rows, case-insensitively (first spelling wins), in file order."""
    names: dict[str, str] = {}
    for row in rows:
        for name in row["tags"]:
            names.setdefault(name.lower(), name)
    return list(names.values())


def _is_valid_tag_name(name: str) -> bool:
    """Same rules as creating a tag by hand (minimum length, no ';')."""
    try:
        require_tag_name(name)
    except HTTPException:
        return False
    return True


@router.post("/api/import/csv/preview")
def preview_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    """Parse CSV and return preview with missing tags/locations."""
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

    # Gather unique tags and hierarchy values from the CSV
    csv_tags = _unique_tag_names(rows)
    csv_sites = {r["site"] for r in rows if r["site"]}
    csv_areas = {r["area"] for r in rows if r["area"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    # Check which exist (case-insensitive)
    existing_tags: set[str] = set()
    if csv_tags:
        existing_tags = {name.lower() for (name,) in db.query(Tag.name).all()}

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

    new_tags = [t for t in csv_tags if t.lower() not in existing_tags]
    missing_tags = sorted(t for t in new_tags if _is_valid_tag_name(t))
    invalid_tags = sorted(t for t in new_tags if not _is_valid_tag_name(t))
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
        "missing_tags": missing_tags,
        "invalid_tags": invalid_tags,
        "missing_sites": missing_sites,
        "missing_areas": missing_areas,
        "missing_locations": missing_locations,
    }


@router.post("/api/import/csv/confirm")
def confirm_import(
    file: UploadFile = File(...),
    create_tags: bool = False,
    create_sites: bool = False,
    create_areas: bool = False,
    create_locations: bool = False,
    db: Session = Depends(get_db),
    me: User = Depends(require_admin),
):
    """Import items from CSV, optionally creating missing tags/sites/areas/locations."""
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

    # Build lookup maps for existing tags and locations (case-insensitive)
    db_tags = db.query(Tag).all()
    tag_map: dict[str, Tag] = {t.name.lower(): t for t in db_tags}

    db_sites = db.query(Site).all()
    site_map: dict[str, Site] = {site.name.lower(): site for site in db_sites}

    db_areas = db.query(Area).all()
    area_map: dict[str, Area] = {area.name.lower(): area for area in db_areas}

    db_locations = db.query(Location).all()
    location_map: dict[str, Location] = {loc.name.lower(): loc for loc in db_locations}

    # Determine what needs to be created
    csv_tags = _unique_tag_names(rows)
    csv_sites = {r["site"] for r in rows if r["site"]}
    csv_areas = {r["area"] for r in rows if r["area"]}
    csv_locations = {r["location"] for r in rows if r["location"]}

    missing_tags = [t for t in csv_tags if t.lower() not in tag_map]
    missing_sites = [s for s in csv_sites if s.lower() not in site_map]
    missing_areas = [a for a in csv_areas if a.lower() not in area_map]
    missing_locations = [loc for loc in csv_locations if loc.lower() not in location_map]

    invalid_tags = [t for t in missing_tags if not _is_valid_tag_name(t)]
    if invalid_tags:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid tag names: {', '.join(sorted(invalid_tags))}. "
                   f"Tag names need at least {MIN_NAME_LENGTH} characters and cannot contain ';'.",
        )

    if missing_tags and not create_tags:
        raise HTTPException(
            status_code=400,
            detail=f"Missing tags: {', '.join(sorted(missing_tags))}. "
                   "Set create_tags=true to create them.",
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

    # Create missing tags
    for tag_name in missing_tags:
        new_tag = Tag(name=tag_name)
        db.add(new_tag)
        try:
            db.flush()
        except IntegrityError:  # a concurrent request created the same name after the lookup
            db.rollback()
            raise HTTPException(status_code=400, detail=f"Tag name already exists: {tag_name}")
        tag_map[tag_name.lower()] = new_tag

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

        part = Part(
            name=row["name"],
            description=row["description"],
            location_id=location_id,
            status=row["status"],
            quantity=row["quantity"],
            created_at=now,
            updated_at=now,
        )
        db.add(part)
        db.flush()
        for tag_name in row["tags"]:
            tag = tag_map.get(tag_name.lower())
            if tag is not None:
                db.add(ItemTag(item_id=part.id, tag_id=tag.id))
        created_ids.append(part.id)

    db.commit()

    # Publish events
    for part_id in created_ids:
        publish_inventory_change("created", part_id)

    return {
        "imported": len(created_ids),
        "parse_errors": parse_errors,
        "tags_created": len(missing_tags),
        "sites_created": len(missing_sites),
        "areas_created": len(missing_areas),
        "locations_created": len(missing_locations),
    }
