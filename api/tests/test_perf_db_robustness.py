"""Startup/restore robustness of the index upgrade (best-effort) and its wiring."""
import logging
import os
import sqlite3

from sqlalchemy import create_engine

from stowge import main as stowge_main
from stowge.models import Base
from stowge.schema_upgrades import upgrade_indexes

IDX = "ix_parts_location_deleted_id"


def _make_old_schema_db(path):
    """Current tables, but without the new index and without statistics (like an old release)."""
    eng = create_engine(f"sqlite:///{path}")
    Base.metadata.create_all(eng)
    eng.dispose()
    c = sqlite3.connect(path)
    c.execute(f'DROP INDEX IF EXISTS "{IDX}"')
    c.execute("CREATE INDEX IF NOT EXISTS ix_parts_location_id ON parts (location_id)")
    c.execute("DROP TABLE IF EXISTS sqlite_stat1")
    c.commit()
    c.close()


def _names(path, where):
    c = sqlite3.connect(path)
    try:
        return {r[0] for r in c.execute(f"SELECT name FROM sqlite_master WHERE {where}")}
    finally:
        c.close()


def test_upgrade_indexes_survives_read_only_db(tmp_path, caplog):
    path = tmp_path / "ro.db"
    _make_old_schema_db(path)
    os.chmod(path, 0o444)
    eng = create_engine(f"sqlite:///file:{path}?mode=ro&uri=true")
    try:
        with caplog.at_level(logging.WARNING, logger="stowge.schema_upgrades"):
            assert upgrade_indexes(eng) == []
    finally:
        eng.dispose()
    assert any("could not" in r.message or "skipped" in r.message for r in caplog.records)
    assert IDX not in _names(path, "type='index'")


def test_upgrade_indexes_survives_locked_db(tmp_path, caplog):
    path = tmp_path / "locked.db"
    _make_old_schema_db(path)
    holder = sqlite3.connect(path, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")  # hold the write lock
    eng = create_engine(f"sqlite:///{path}", connect_args={"timeout": 0.2})
    try:
        with caplog.at_level(logging.WARNING, logger="stowge.schema_upgrades"):
            assert upgrade_indexes(eng) == []
    finally:
        eng.dispose()
        holder.execute("ROLLBACK")
        holder.close()
    assert any(r.levelno == logging.WARNING for r in caplog.records)
    assert IDX not in _names(path, "type='index'")


def test_init_db_applies_index_and_statistics_to_old_db(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    _make_old_schema_db(path)
    assert IDX not in _names(path, "type='index'")
    assert "sqlite_stat1" not in _names(path, "type='table'")
    eng = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(stowge_main, "engine", eng)
    try:
        stowge_main.init_db()
    finally:
        eng.dispose()
    assert IDX in _names(path, "type='index'")
    assert "sqlite_stat1" in _names(path, "type='table'")


def test_failed_create_does_not_drop_the_old_location_index(tmp_path, monkeypatch):
    """If the covering index cannot be built, the old location index must stay (else parts has none)."""
    from sqlalchemy import create_engine
    from sqlalchemy.schema import Index
    path = tmp_path / "old.db"
    _make_old_schema_db(path)
    real_create = Index.create

    def failing(self, bind=None, checkfirst=False):
        if self.name == IDX:
            raise RuntimeError("disk full")
        return real_create(self, bind=bind, checkfirst=checkfirst)

    monkeypatch.setattr(Index, "create", failing)
    eng = create_engine(f"sqlite:///{path}")
    try:
        upgrade_indexes(eng)
    finally:
        eng.dispose()
    names = _names(path, "type='index'")
    assert IDX not in names
    assert "ix_parts_location_id" in names
