"""One-way startup migration: collections become tags, collection AI hints become AI hints.

Runs once (flag ``tags_migration_v1`` in ``app_meta``), in a single transaction, after ``create_all``
has made the new tables. The old ``collections`` table, ``parts.collection`` and the old ``users``
collection columns stay in the schema, unread and unwritten, for roll-back safety.

Every step is plain SQL on purpose: it must keep working when the ORM models move on, and it has to
cope with large tables without loading them through the ORM.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from .ai_hints import DEFAULT_HINT_NAME, DEFAULT_HINT_TEXT
from .helpers.shortcut_style import lenient_color, lenient_icon

logger = logging.getLogger("stowge.tags_migration")

MIGRATION_FLAG_KEY = "tags_migration_v1"
CONVERTED_KEY = "tags_migration_collections_converted"
SKIPPED_KEY = "tags_migration_filters_skipped"
MAX_SHORTCUT_FILTERS = 100
MAX_FILTER_NAME_LENGTH = 80
SCOPE_RENAMES = {
    "collections.read": "tags.read",
    "collections.write": "tags.write",
    "collections.delete": "tags.delete",
}
_REQUIRED_TABLES = {"app_meta", "tags", "item_tags", "ai_hints", "users", "parts"}


def _now_db() -> str:
    """Current UTC time in the text form SQLAlchemy stores for DateTime columns in SQLite."""
    return datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")


def _read_meta(conn, key: str) -> str | None:
    row = conn.execute(text("SELECT value FROM app_meta WHERE key = :k"), {"k": key}).first()
    return None if row is None else str(row[0])


def _write_meta(conn, key: str, value: str) -> None:
    conn.execute(text("INSERT OR REPLACE INTO app_meta (key, value) VALUES (:k, :v)"), {"k": key, "v": value})


def is_migrated(engine: Engine) -> bool:
    with engine.connect() as conn:
        try:
            return _read_meta(conn, MIGRATION_FLAG_KEY) is not None
        except Exception:
            return False


def pre_migration_copy(engine: Engine) -> str | None:
    """Write a consistent copy of the database next to the file (SQLite backup API). Raises on failure."""
    db_file = engine.url.database
    if not db_file or db_file == ":memory:":
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = f"{db_file}.pre-tags-{stamp}"
    n = 1
    while os.path.exists(dest):  # two migrations in the same second (restore right after a start)
        n += 1
        dest = f"{db_file}.pre-tags-{stamp}-{n}"
    src = sqlite3.connect(db_file)
    dst = sqlite3.connect(dest)
    try:
        src.backup(dst)
    except BaseException:
        # A partial copy (disk full) must not stay: every restart would add another one.
        dst.close()
        src.close()
        try:
            os.remove(dest)
        except OSError:
            pass
        raise
    dst.close()
    src.close()
    os.chmod(dest, 0o600)  # holds password and API-key hashes
    logger.info("Wrote pre-tags database copy: %s", dest)
    return dest


def _loads_list(raw: object) -> list:
    if not raw:
        return []
    try:
        value = json.loads(str(raw))
    except Exception:
        return []
    return value if isinstance(value, list) else []


def _convert_scopes(raw: object) -> list[str] | None:
    """New scope list for a stored scopes_json, or None when nothing changes."""
    scopes = _loads_list(raw)
    if not any(str(scope).strip() in SCOPE_RENAMES for scope in scopes):
        return None
    out: list[str] = []
    for scope in scopes:
        name = SCOPE_RENAMES.get(str(scope).strip(), str(scope).strip())
        if name and name not in out:
            out.append(name)
    return out


def run_tags_migration(engine: Engine) -> bool:
    """Run the migration if it has not run yet. Returns True when it ran now.

    Raises (leaving the flag unset, nothing changed) when the pre-migration copy cannot be written
    or any step fails: the next start tries again.
    """
    tables = set(inspect(engine).get_table_names())
    if not _REQUIRED_TABLES <= tables:
        return False

    with engine.connect() as conn:
        if _read_meta(conn, MIGRATION_FLAG_KEY) is not None:
            return False
        user_count = int(conn.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0)
        item_count = int(conn.execute(text("SELECT COUNT(*) FROM parts")).scalar() or 0)

    copy_path = pre_migration_copy(engine) if (user_count or item_count) else None

    try:
        with engine.begin() as conn:
            _migrate(conn, tables)
    except Exception:
        # Nothing changed (single transaction). Remove this attempt's copy so a crash loop
        # does not fill the disk with one copy per start.
        if copy_path:
            try:
                os.remove(copy_path)
            except OSError:
                pass
        raise
    return True


def _migrate(conn, tables: set[str]) -> None:
    now = _now_db()

    # 2. Default hint
    default_id = conn.execute(text("SELECT id FROM ai_hints WHERE is_default = 1")).scalar()
    if default_id is None:
        default_id = str(uuid.uuid4())
        conn.execute(
            text("INSERT INTO ai_hints (id, name, text, is_default, created_at, updated_at) "
                 "VALUES (:id, :name, :text, 1, :now, :now)"),
            {"id": default_id, "name": DEFAULT_HINT_NAME, "text": DEFAULT_HINT_TEXT, "now": now},
        )
    used_hint_names = {str(n).lower() for (n,) in conn.execute(text("SELECT name FROM ai_hints"))}
    hint_by_text: dict[str, str] = {
        str(t): str(i) for i, t in conn.execute(text("SELECT id, text FROM ai_hints WHERE is_default = 0")) if str(t).strip()
    }

    collections: list[dict] = []
    if "collections" in tables:
        collection_columns = {c["name"] for c in inspect(conn).get_columns("collections")}
        hint_column = "ai_hint" if "ai_hint" in collection_columns else "NULL"
        rows = conn.execute(text(
            f"SELECT id, name, icon, color, description, {hint_column} AS ai_hint, created_at, updated_at "
            "FROM collections ORDER BY created_at ASC, name ASC, id ASC"
        )).mappings().all()
        collections = [dict(row) for row in rows]

    # 3. Hints: one row per distinct non-empty hint text, named after the first collection that has it.
    hint_for_collection: dict[str, str] = {}
    for col in collections:
        hint_text = str(col["ai_hint"] or "").strip()
        if not hint_text:
            continue
        existing = hint_by_text.get(hint_text)
        if existing is None:
            base = str(col["name"] or "").strip() or "Hint"
            name, n = base, 1
            while name.lower() in used_hint_names:
                n += 1
                name = f"{base} ({n})"
            used_hint_names.add(name.lower())
            existing = str(uuid.uuid4())
            conn.execute(
                text("INSERT INTO ai_hints (id, name, text, is_default, created_at, updated_at) "
                     "VALUES (:id, :name, :text, 0, :now, :now)"),
                {"id": existing, "name": name, "text": hint_text, "now": now},
            )
            hint_by_text[hint_text] = existing
        hint_for_collection[str(col["id"])] = existing

    # 4. Tags: same id/name/icon/color/description; names that differ only by case merge into the first.
    survivor_by_lower: dict[str, dict] = {}
    survivor_of_collection: dict[str, str] = {}
    renamed_tag_by_lower: dict[str, str] = {}  # original collection name (lower) -> new tag name, for ';' renames
    tag_rows: list[dict] = []
    # Final tag names (lower case) already taken. Collections without ';' keep their name, so a renamed
    # one that clashes with them gets the suffix, whichever comes first.
    used_tag_names: set[str] = {
        str(c["name"] or "").strip().lower() for c in collections if ";" not in str(c["name"] or "")
    }
    for col in collections:
        name = str(col["name"] or "").strip()
        if not name:
            logger.warning("Skipping collection %s with a blank name", col["id"])
            continue
        key = name.lower()  # items, filters and nav order match on the ORIGINAL collection name
        survivor = survivor_by_lower.get(key)
        if survivor is not None:
            logger.warning("Merging collection %r (%s) into tag %r (%s): names differ only by case",
                           name, col["id"], survivor["name"], survivor["id"])
            survivor_of_collection[str(col["id"])] = str(survivor["id"])
            continue
        # ';' separates tags in CSV import/export, so it cannot be part of a tag name.
        tag_name = name
        if ";" in name:
            tag_name = re.sub(r" {2,}", " ", name.replace(";", ",")).strip()
            base, n = tag_name, 1
            while tag_name.lower() in used_tag_names:
                n += 1
                tag_name = f"{base} ({n})"
            logger.warning("Renaming collection %r (%s) to tag %r: tag names cannot contain ';'",
                           name, col["id"], tag_name)
        used_tag_names.add(tag_name.lower())
        if tag_name != name:
            renamed_tag_by_lower[key] = tag_name
        tag = {
            "id": str(col["id"]), "name": tag_name, "icon": col["icon"], "color": col["color"],
            "description": col["description"], "created_at": col["created_at"] or now,
            "updated_at": col["updated_at"] or now,
        }
        survivor_by_lower[key] = tag
        survivor_of_collection[str(col["id"])] = tag["id"]
        tag_rows.append(tag)
    if tag_rows:
        conn.execute(
            text("INSERT INTO tags (id, name, icon, color, description, created_at, updated_at) "
                 "VALUES (:id, :name, :icon, :color, :description, :created_at, :updated_at)"),
            tag_rows,
        )

    # 5. Item tags, matched on the old collection name case-insensitively.
    link_rows: list[dict] = []
    if survivor_by_lower:
        for item_id, coll_name in conn.execute(text("SELECT id, collection FROM parts WHERE collection IS NOT NULL")):
            tag = survivor_by_lower.get(str(coll_name or "").strip().lower())
            if tag is not None:
                link_rows.append({"i": str(item_id), "t": tag["id"]})
    for start in range(0, len(link_rows), 5000):
        conn.execute(text("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (:i, :t)"),
                     link_rows[start:start + 5000])

    # 6 + 7. Users: pinned filters, preferred hint and tag, last opened tag.
    skipped_total = 0
    user_columns = {c["name"] for c in inspect(conn).get_columns("users")}
    select_cols = ["id", "shortcut_filters"]
    for optional in ("collection_nav_order", "preferred_add_collection_id", "last_open_collection"):
        select_cols.append(optional if optional in user_columns else f"NULL AS {optional}")
    users = conn.execute(text(f"SELECT {', '.join(select_cols)} FROM users")).mappings().all()
    created_order = [t["id"] for t in tag_rows]  # tag_rows is already in created_at order
    for user in users:
        existing_filters = [f for f in _loads_list(user["shortcut_filters"]) if isinstance(f, dict)]
        converted_existing: list[dict] = []
        for entry in existing_filters:
            entry = dict(entry)
            if "collection" in entry:
                legacy = str(entry.pop("collection") or "").strip()
                if legacy == "__none":
                    entry["tag_id"] = "__none"
                elif legacy:
                    tag = survivor_by_lower.get(legacy.lower())
                    if tag is None and not entry.get("tag_id"):
                        # The collection no longer exists: keeping the filter would turn it into
                        # "show everything", so it is dropped.
                        continue
                    entry["tag_id"] = tag["id"] if tag else entry.get("tag_id")
                else:
                    entry.setdefault("tag_id", None)
            converted_existing.append(entry)

        nav_order: list[str] = []
        for raw_id in _loads_list(user["collection_nav_order"]):
            tag_id = survivor_of_collection.get(str(raw_id).strip())
            if tag_id and tag_id not in nav_order:
                nav_order.append(tag_id)
        ordered_ids = nav_order + [tid for tid in created_order if tid not in nav_order]
        tag_by_id = {t["id"]: t for t in tag_rows}
        migrated = [{
            "id": str(uuid.uuid4()),
            "name": tag_by_id[tid]["name"][:MAX_FILTER_NAME_LENGTH],
            "query": "",
            "tag_id": tid,
            "statuses": [],
            "status": None,
            "site_id": None,
            "area_id": None,
            "location_id": None,
            "quantity_min": None,
            "quantity_max": None,
            "pinned": True,
            "icon": lenient_icon(tag_by_id[tid]["icon"]),
            "color": lenient_color(tag_by_id[tid]["color"]),
        } for tid in ordered_ids]

        room = max(0, MAX_SHORTCUT_FILTERS - len(converted_existing))
        if len(migrated) > room:
            skipped = len(migrated) - room
            skipped_total += skipped
            logger.warning("User %s: %d pinned filter(s) not created (100 filter cap)", user["id"], skipped)
            migrated = migrated[:room]
        combined = migrated + converted_existing

        updates: dict[str, object] = {}
        if combined != existing_filters:
            updates["shortcut_filters"] = json.dumps(combined) if combined else None

        preferred_collection = str(user["preferred_add_collection_id"] or "").strip()
        if preferred_collection:
            if preferred_collection in survivor_of_collection:
                updates["preferred_add_hint_id"] = hint_for_collection.get(preferred_collection)
                updates["preferred_add_tag_ids"] = json.dumps([survivor_of_collection[preferred_collection]])
            else:
                logger.warning("User %s: preferred collection %s no longer exists", user["id"], preferred_collection)
        last_open = user["last_open_collection"]
        if last_open and str(last_open).strip():
            # last_open_tag holds the tag NAME: follow a ';' rename.
            updates["last_open_tag"] = renamed_tag_by_lower.get(str(last_open).strip().lower(), str(last_open))

        if updates:
            assignments = ", ".join(f"{col} = :{col}" for col in updates)
            conn.execute(text(f"UPDATE users SET {assignments} WHERE id = :id"), {**updates, "id": user["id"]})

    # 8. API key scopes
    if "api_keys" in tables:
        for key_id, scopes_json in conn.execute(text("SELECT id, scopes_json FROM api_keys")).all():
            converted = _convert_scopes(scopes_json)
            if converted is not None:
                conn.execute(text("UPDATE api_keys SET scopes_json = :s WHERE id = :id"),
                             {"s": json.dumps(converted), "id": key_id})

    # 9. Counts for the What's New tour, flag last
    _write_meta(conn, CONVERTED_KEY, str(len(collections)))
    _write_meta(conn, SKIPPED_KEY, str(skipped_total))
    _write_meta(conn, MIGRATION_FLAG_KEY, "1")
    logger.info("Tags migration done: %d collection(s) converted, %d filter(s) skipped",
                len(collections), skipped_total)


def migration_summary(db) -> dict:
    """Counts for ``whats_new.tags_migration`` (zeros on a database that never had collections)."""
    def _int(key: str) -> int:
        row = db.execute(text("SELECT value FROM app_meta WHERE key = :k"), {"k": key}).first()
        try:
            return int(row[0]) if row else 0
        except (TypeError, ValueError):
            return 0

    try:
        return {"collections_converted": _int(CONVERTED_KEY), "filters_skipped": _int(SKIPPED_KEY)}
    except Exception:
        return {"collections_converted": 0, "filters_skipped": 0}
