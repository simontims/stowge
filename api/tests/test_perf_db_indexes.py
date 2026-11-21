"""DB-layer performance guards: indexes on existing databases, PRAGMAs, pool, statistics."""
import sqlite3

import pytest
from sqlalchemy import create_engine, inspect, text

from stowge import db as stowge_db
from stowge.models import Part
from stowge.schema_upgrades import OBSOLETE_INDEXES, refresh_statistics, upgrade_indexes

OLD_DDL = """
CREATE TABLE locations (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, area_id VARCHAR);
CREATE TABLE parts (id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, collection VARCHAR, status VARCHAR NOT NULL DEFAULT 'draft',
                    location_id VARCHAR, quantity INTEGER NOT NULL DEFAULT 1, is_deleted INTEGER NOT NULL DEFAULT 0);
CREATE INDEX ix_parts_collection ON parts (collection);
CREATE INDEX ix_parts_location_id ON parts (location_id);
CREATE TABLE sessions (id VARCHAR PRIMARY KEY, user_id VARCHAR NOT NULL, created_at DATETIME, last_seen_at DATETIME, expires_at DATETIME NOT NULL);
"""


@pytest.fixture()
def old_db(tmp_path):
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript(OLD_DDL)
    c.executemany("INSERT INTO locations(id,name) VALUES (?,?)", [(f"l{i}", f"L{i}") for i in range(20)])
    c.executemany("INSERT INTO parts(id,name,location_id,is_deleted) VALUES (?,?,?,?)",
                  [(f"p{i}", f"n{i}", f"l{i % 20}", i % 7 == 0) for i in range(20000)])
    c.commit()
    c.close()
    eng = create_engine(f"sqlite:///{path}")
    yield eng
    eng.dispose()


def _index_names(eng, table):
    return {i["name"] for i in inspect(eng).get_indexes(table)}


def _plan(eng, sql, **params):
    with eng.connect() as conn:
        return " | ".join(r[-1] for r in conn.execute(text("EXPLAIN QUERY PLAN " + sql), params))


def test_upgrade_adds_composite_index_and_drops_obsolete_on_existing_db(old_db):
    assert {"ix_parts_collection", "ix_parts_location_id"} <= _index_names(old_db, "parts")
    created = upgrade_indexes(old_db)
    names = _index_names(old_db, "parts")
    assert "ix_parts_location_deleted_id" in names
    assert not set(OBSOLETE_INDEXES) & names
    assert "ix_parts_location_deleted_id" in created
    # other declared-but-missing indexes on pre-existing tables are added too
    assert "ix_locations_area_id" in _index_names(old_db, "locations")
    assert "ix_sessions_expires_at" in _index_names(old_db, "sessions")


def test_upgrade_is_idempotent_and_keeps_rows(old_db):
    upgrade_indexes(old_db)

    def snapshot():
        with old_db.connect() as conn:
            counts = {t: conn.execute(text(f"SELECT count(*) FROM {t}")).scalar() for t in ("parts", "locations", "sessions")}
            schema = conn.execute(text("SELECT type,name,sql FROM sqlite_master ORDER BY name")).fetchall()
        return counts, schema

    before = snapshot()
    assert upgrade_indexes(old_db) == []
    assert snapshot() == before
    assert before[0]["parts"] == 20000


def test_location_queries_use_the_composite_index(old_db):
    upgrade_indexes(old_db)
    in_use = _plan(old_db, "SELECT count(*) FROM parts WHERE location_id = :l", l="l1")
    assert "ix_parts_location_deleted_id" in in_use and "SCAN parts" not in in_use
    grouped = _plan(old_db, "SELECT location_id, count(id) FROM parts WHERE location_id IN ('l1','l2') AND is_deleted = 0 GROUP BY location_id")
    assert "COVERING INDEX ix_parts_location_deleted_id" in grouped


def test_model_declares_composite_index_and_no_collection_index():
    names = {i.name for i in Part.__table__.indexes}
    assert "ix_parts_location_deleted_id" in names
    assert "ix_parts_collection" not in names and "ix_parts_location_id" not in names


def test_init_db_is_a_noop_on_second_run():
    from stowge.main import init_db
    from stowge.db import engine

    def snap():
        with engine.connect() as conn:
            rows = conn.execute(text("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_stat%' ORDER BY name")).fetchall()
            counts = {r[1]: conn.execute(text(f'SELECT count(*) FROM "{r[1]}"')).scalar() for r in rows if r[0] == "table"}
        return rows, counts

    init_db()
    first = snap()
    init_db()
    assert snap() == first


def test_connection_pragmas_on_wal_file(tmp_path):
    c = sqlite3.connect(tmp_path / "w.db", timeout=stowge_db._BUSY_TIMEOUT_SECONDS)
    stowge_db._set_pragmas(c, None)
    assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert c.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
    assert c.execute("PRAGMA cache_size").fetchone()[0] == -16384
    assert c.execute("PRAGMA temp_store").fetchone()[0] == 2  # MEMORY
    assert c.execute("PRAGMA busy_timeout").fetchone()[0] == 30000
    c.close()


def test_synchronous_stays_full_when_wal_is_unavailable():
    """:memory: cannot use WAL (as some network mounts): keep synchronous=FULL, never NORMAL."""
    c = sqlite3.connect(":memory:")
    stowge_db._set_pragmas(c, None)
    assert c.execute("PRAGMA journal_mode").fetchone()[0] != "wal"
    assert c.execute("PRAGMA synchronous").fetchone()[0] == 2  # FULL
    c.close()


def test_engine_pool_covers_the_request_thread_pool():
    pool = stowge_db.engine.pool
    assert pool.size() + pool._max_overflow >= 40


def test_refresh_statistics_populates_missing_stats(old_db):
    upgrade_indexes(old_db)
    with old_db.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM sqlite_master WHERE name='sqlite_stat1'")).scalar() == 0
    refresh_statistics(old_db)
    with old_db.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM sqlite_master WHERE name='sqlite_stat1'")).scalar() == 1
        tbls = {r[0] for r in conn.execute(text("SELECT tbl FROM sqlite_stat1"))}
    assert "parts" in tbls
    refresh_statistics(old_db)  # second run must not fail
