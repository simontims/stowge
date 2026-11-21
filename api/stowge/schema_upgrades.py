"""Idempotent index/statistics upgrades for EXISTING databases.

``Base.metadata.create_all`` creates missing tables but never adds indexes to tables that
already exist, so databases created by older releases lack indexes the models declare (for
example ``parts.location_id``). ``upgrade_indexes`` closes that gap on every start; each step
is ``IF [NOT] EXISTS`` so a second run changes nothing.
"""
import logging

from sqlalchemy import text
from sqlalchemy.engine import Engine

from . import models  # noqa: F401  (registers every table on Base.metadata)
from .db import Base

logger = logging.getLogger("stowge.schema_upgrades")

# Superseded / dead indexes. ix_parts_location_id is replaced by the composite
# ix_parts_location_deleted_id (same leading column); ix_parts_collection indexed a legacy
# column nothing reads or writes any more, so it only slowed down inserts.
OBSOLETE_INDEXES = ("ix_parts_location_id", "ix_parts_collection")
REPLACEMENT_INDEX = "ix_parts_location_deleted_id"


def upgrade_indexes(engine: Engine) -> list[str]:
    """Create missing non-unique model indexes, drop obsolete ones. Returns the names created.

    Best-effort: each index is created/dropped in its own transaction and any failure (read-only
    file, lock timeout, ...) is logged and skipped. Skipping is safe, queries just run slower.
    """
    created: list[str] = []
    dropped: list[str] = []
    try:
        with engine.connect() as conn:
            # Straight from sqlite_master: cheap, and SQLAlchemy cannot reflect expression indexes.
            have = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='index'"))}
            tables = {r[0] for r in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
            todo = []
            for table in Base.metadata.sorted_tables:
                if table.name not in tables:
                    continue
                cols = {r[1] for r in conn.execute(text(f'PRAGMA table_info("{table.name}")'))}
                for idx in sorted(table.indexes, key=lambda i: i.name or ""):
                    if idx.unique or idx.name in have:
                        continue
                    if not all(getattr(c, "name", None) in cols for c in idx.columns):
                        continue
                    todo.append(idx)
            conn.rollback()
    except Exception:
        logger.warning("Index upgrade skipped: could not inspect schema", exc_info=True)
        return created

    for idx in todo:
        try:
            with engine.begin() as conn:
                idx.create(bind=conn, checkfirst=False)
            created.append(idx.name)
        except Exception as exc:
            logger.warning("Index upgrade: could not create %s (%s); skipping", idx.name, exc)
    for name in OBSOLETE_INDEXES:
        # Never drop the old location index unless its replacement exists, or parts has none.
        if name == "ix_parts_location_id" and REPLACEMENT_INDEX not in have and REPLACEMENT_INDEX not in created:
            continue
        if name in have:
            try:
                with engine.begin() as conn:
                    conn.execute(text(f'DROP INDEX "{name}"'))
                dropped.append(name)
            except Exception as exc:
                logger.warning("Index upgrade: could not drop %s (%s); skipping", name, exc)
    if created or dropped:
        # Drop pooled connections so none keeps a schema/plan cache from before the DDL
        # (observed: the first statement on the DDL connection still planned with a dropped index).
        engine.dispose()
        logger.info("Indexes created: %s; dropped: %s", ", ".join(created) or "-", ", ".join(dropped) or "-")
    return created


def refresh_statistics(engine: Engine) -> None:
    """``PRAGMA optimize``: (re)analyse only tables whose statistics are missing or badly stale.

    Without sqlite_stat1 the planner guesses; on a 20k-item database that picked a plan 4x
    slower for the per-tag counts query. Cheap (tens of ms) and a no-op when stats are fine.
    """
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        has_stats = cur.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").fetchone()
        if not has_stats:
            # PRAGMA optimize only analyses tables the connection has queried, so a database that
            # never ran ANALYZE needs one explicit pass (sampled: ~10 ms for 20k items).
            cur.execute("PRAGMA analysis_limit=1000")
            cur.execute("ANALYZE")
            cur.execute("PRAGMA analysis_limit=0")
        cur.execute("PRAGMA optimize(0x10002)")  # then re-analyse tables whose size changed a lot
        cur.fetchall()
        raw.commit()
    except Exception:  # never block startup on a statistics refresh
        logger.warning("PRAGMA optimize failed", exc_info=True)
    finally:
        raw.close()
