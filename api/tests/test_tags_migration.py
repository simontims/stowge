"""Startup migration: collections -> tags, collection AI hints -> AI hints.

Every test builds a database in the OLD schema (see old_schema.py), points the app's startup
at it (monkeypatching ``stowge.main.engine``) and runs the real ``init_db()``.
"""
import glob
import json
import os
import sqlite3
import stat
import time

import pytest
from old_schema import OldDb
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from stowge import main as stowge_main
from stowge import tags_migration
from stowge.ai_hints import DEFAULT_HINT_TEXT
from stowge.helpers.serializers import list_hints_payload, list_tags_payload, serialize_user
from stowge.models import User

FLAG = "tags_migration_v1"


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def start(tmp_path, monkeypatch, build=None, schema="live"):
    """Build an old-schema DB (via ``build(OldDb)``), run the app startup against it, return the engine."""
    path = tmp_path / "stowge.db"
    if build is not None:
        old = OldDb(path, schema=schema)
        build(old)
        old.close()
    engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(stowge_main, "engine", engine)
    stowge_main.init_db()
    return engine


def q(engine, sql, **params):
    with engine.connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), params).mappings().all()]


def scalar(engine, sql, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def meta(engine, key):
    return scalar(engine, "SELECT value FROM app_meta WHERE key = :k", k=key)


def user_filters(engine, username):
    raw = scalar(engine, "SELECT shortcut_filters FROM users WHERE username = :u", u=username)
    return json.loads(raw) if raw else []


def hint_names(engine):
    return {r["name"]: r for r in q(engine, "SELECT * FROM ai_hints")}


def dump_all(engine):
    """Every row of every table, for before/after comparisons."""
    out = {}
    for row in q(engine, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        rows = q(engine, f'SELECT * FROM "{row["name"]}"')
        out[row["name"]] = sorted(json.dumps(r, sort_keys=True, default=str) for r in rows)
    return out


def pre_copies(tmp_path):
    return sorted(glob.glob(str(tmp_path / "stowge.db.pre-tags-*")))


# ---------------------------------------------------------------------------
# tags, items, hints
# ---------------------------------------------------------------------------

class TestCollectionsBecomeTags:
    def _build(self, old):
        self.electronics = old.collection("Electronics", ai_hint="Think electronics", icon="cpu", color="#60a5fa", description="Devices")
        self.tools = old.collection("Tools")
        self.camping = old.collection("Camping", ai_hint="Think electronics")  # identical text: shares a hint row
        self.garden = old.collection("Garden", ai_hint="  Plants  ")
        self.blank_hint = old.collection("Blank", ai_hint="   ")
        self.i_elec = old.item("Multimeter", collection="Electronics")
        self.i_tools_lower = old.item("Hammer", collection="tools")  # name differs by case
        self.i_none = old.item("Loose screw")
        self.i_ghost = old.item("Ghost item", collection="Not a collection")
        self.i_deleted = old.item("Old saw", collection="Tools", deleted=1)
        self.user = old.user("u@example.com", preferred_collection=self.camping, last_open="Tools")

    @pytest.fixture
    def engine(self, tmp_path, monkeypatch):
        return start(tmp_path, monkeypatch, self._build)

    def test_each_collection_becomes_a_tag_keeping_its_id_and_fields(self, engine):
        tags = {t["name"]: t for t in q(engine, "SELECT * FROM tags")}
        assert set(tags) == {"Electronics", "Tools", "Camping", "Garden", "Blank"}
        assert tags["Electronics"]["id"] == self.electronics
        assert tags["Tools"]["id"] == self.tools
        assert (tags["Electronics"]["icon"], tags["Electronics"]["color"], tags["Electronics"]["description"]) == (
            "cpu", "#60a5fa", "Devices")
        # no ai_hint on a tag
        assert "ai_hint" not in tags["Electronics"]

    def test_tags_keep_their_creation_order_in_the_list_payload(self, engine):
        with Session(engine) as db:
            assert [t["name"] for t in list_tags_payload(db)] == ["Electronics", "Tools", "Camping", "Garden", "Blank"]

    def test_items_get_the_tag_matching_their_collection_case_insensitively(self, engine):
        links = {(r["item_id"], r["tag_id"]) for r in q(engine, "SELECT * FROM item_tags")}
        assert links == {
            (self.i_elec, self.electronics),
            (self.i_tools_lower, self.tools),
            (self.i_deleted, self.tools),
        }

    def test_item_counts_exclude_soft_deleted_items(self, engine):
        with Session(engine) as db:
            counts = {t["name"]: t["item_count"] for t in list_tags_payload(db)}
        assert counts["Tools"] == 1  # the soft-deleted saw is linked but not counted
        assert counts["Electronics"] == 1
        assert counts["Garden"] == 0

    def test_default_hint_exists_once_with_the_exact_text(self, engine):
        defaults = q(engine, "SELECT * FROM ai_hints WHERE is_default = 1")
        assert len(defaults) == 1
        assert defaults[0]["name"] == "Default"
        assert defaults[0]["text"] == DEFAULT_HINT_TEXT
        assert defaults[0]["text"].startswith("General household and workshop inventory.")
        assert defaults[0]["text"].endswith("than guessing.")
        assert 'e.g. "Makita 18V Drill Driver", "USB-C to HDMI Cable 2m"' in defaults[0]["text"]

    def test_collections_with_hints_become_hints_and_identical_texts_share_one_row(self, engine):
        hints = hint_names(engine)
        assert set(hints) == {"Default", "Electronics", "Garden"}  # Camping shares Electronics' row, Tools/Blank have none
        assert hints["Electronics"]["text"] == "Think electronics"
        assert hints["Garden"]["text"] == "Plants"  # trimmed
        assert hints["Electronics"]["is_default"] == 0

    def test_hints_list_payload_puts_default_first_then_by_name(self, engine):
        with Session(engine) as db:
            assert [h["name"] for h in list_hints_payload(db)] == ["Default", "Electronics", "Garden"]

    def test_preferred_collection_becomes_the_sticky_hint_and_tag(self, engine):
        hints = hint_names(engine)
        row = q(engine, "SELECT * FROM users WHERE username = 'u@example.com'")[0]
        assert row["preferred_add_hint_id"] == hints["Electronics"]["id"]  # Camping's hint is the shared row
        assert json.loads(row["preferred_add_tag_ids"]) == [self.camping]
        assert row["last_open_tag"] == "Tools"

    def test_me_payload_shows_the_new_fields_and_no_old_ones(self, engine):
        with Session(engine) as db:
            me = serialize_user(db.query(User).filter(User.username == "u@example.com").one())
        assert me["preferred_add_tag_ids"] == [self.camping]
        assert me["last_open_tag"] == "Tools"
        for gone in ("preferred_add_collection_id", "last_open_collection", "collection_nav_order"):
            assert gone not in me
        assert me["whats_new"]["tags_migration"] == {"collections_converted": 5, "filters_skipped": 0}

    def test_flag_and_converted_count_are_recorded(self, engine):
        assert meta(engine, FLAG) is not None
        assert meta(engine, "tags_migration_collections_converted") == "5"
        assert meta(engine, "tags_migration_filters_skipped") == "0"

    def test_old_data_stays_unread_and_unwritten(self, engine):
        assert scalar(engine, "SELECT COUNT(*) FROM collections") == 5
        assert scalar(engine, "SELECT collection FROM parts WHERE id = :i", i=self.i_tools_lower) == "tools"
        assert scalar(engine, "SELECT preferred_add_collection_id FROM users") == self.camping
        assert scalar(engine, "SELECT ai_hint FROM collections WHERE id = :i", i=self.electronics) == "Think electronics"

    def test_ghost_and_uncollected_items_stay_untagged(self, engine):
        tagged = {r["item_id"] for r in q(engine, "SELECT item_id FROM item_tags")}
        assert self.i_none not in tagged
        assert self.i_ghost not in tagged
        assert scalar(engine, "SELECT COUNT(*) FROM parts") == 5  # nothing deleted


class TestOldSchemas:
    """The migration works from both old shapes: the live install (69d9ab6) and release 1 (1e2e394)."""

    @pytest.mark.parametrize("schema", ["live", "release1"])
    def test_full_scenario_from_each_old_schema(self, tmp_path, monkeypatch, schema):
        ids = {}

        def build(old):
            ids["c"] = old.collection("Parts", ai_hint="resistors", icon="cpu")
            ids["i"] = old.item("R1", collection="Parts")
            uid = old.user("s@example.com", preferred_collection=ids["c"], nav_order=[ids["c"]], filters=[_filter(1, collection="Parts")])
            old.api_key(uid, ["collections.read"])

        engine = start(tmp_path, monkeypatch, build, schema=schema)
        columns = {r["name"] for r in q(engine, "PRAGMA table_info(users)")}
        assert {"last_seen_note", "welcome_seen_version", "preferred_add_hint_id", "preferred_add_tag_ids", "last_open_tag"} <= columns
        assert [t["id"] for t in q(engine, "SELECT id FROM tags")] == [ids["c"]]
        assert scalar(engine, "SELECT item_id FROM item_tags") == ids["i"]
        filters = user_filters(engine, "s@example.com")
        assert [f["name"] for f in filters] == ["Parts", "Mine 1"]
        assert filters[1]["tag_id"] == ids["c"]
        assert json.loads(scalar(engine, "SELECT scopes_json FROM api_keys")) == ["tags.read"]
        assert set(hint_names(engine)) == {"Default", "Parts"}
        with Session(engine) as db:
            me = serialize_user(db.query(User).filter(User.username == "s@example.com").one())
        assert me["preferred_add_tag_ids"] == [ids["c"]]


class TestNameClashes:
    def test_case_clashing_collections_merge_into_the_first_by_created_at(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            # created order is the reverse of alphabetical so the "first" is not the first by name
            ids["upper"] = old.collection("TOOLS", created=1)
            ids["title"] = old.collection("Tools", created=2)
            ids["lower"] = old.collection("tools", created=3)
            ids["other"] = old.collection("Other", created=4)
            ids["i_upper"] = old.item("a", collection="TOOLS")
            ids["i_title"] = old.item("b", collection="Tools")
            ids["i_lower"] = old.item("c", collection="tools")

        engine = start(tmp_path, monkeypatch, build)
        assert sorted(r["name"] for r in q(engine, "SELECT name FROM tags")) == ["Other", "TOOLS"]
        assert scalar(engine, "SELECT id FROM tags WHERE name = 'TOOLS'") == ids["upper"]
        links = {(r["item_id"], r["tag_id"]) for r in q(engine, "SELECT * FROM item_tags")}
        assert links == {(ids["i_upper"], ids["upper"]), (ids["i_title"], ids["upper"]), (ids["i_lower"], ids["upper"])}
        # converted counts the collections before merging
        assert meta(engine, "tags_migration_collections_converted") == "4"

    def test_the_tag_name_index_is_case_insensitive(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch, lambda old: old.collection("Tools"))
        with pytest.raises(Exception, match="UNIQUE"):
            with engine.begin() as conn:
                conn.execute(text("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('x', 'TOOLS', 'n', 'n')"))

    def test_merged_collections_user_references_follow_the_survivor(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            ids["first"] = old.collection("TOOLS", ai_hint="first hint", created=1)
            ids["second"] = old.collection("Tools", ai_hint="second hint", created=2)
            old.user("m@example.com", preferred_collection=ids["second"], nav_order=[ids["second"]])

        engine = start(tmp_path, monkeypatch, build)
        hints = hint_names(engine)
        # both collections had hints: the second gets a suffix because "tools" is taken (case-insensitive)
        assert set(hints) == {"Default", "TOOLS", "Tools (2)"}
        row = q(engine, "SELECT * FROM users")[0]
        assert json.loads(row["preferred_add_tag_ids"]) == [ids["first"]]  # the survivor, not the merged id
        assert row["preferred_add_hint_id"] == hints["Tools (2)"]["id"]
        filters = user_filters(engine, "m@example.com")
        assert [f["tag_id"] for f in filters] == [ids["first"]]  # one tag, one filter

    def test_a_collection_hint_named_default_gets_a_suffix(self, tmp_path, monkeypatch):
        def build(old):
            old.collection("Default", ai_hint="alpha", created=1)
            old.collection("default", ai_hint="beta", created=2)

        engine = start(tmp_path, monkeypatch, build)
        hints = hint_names(engine)
        assert set(hints) == {"Default", "Default (2)", "default (3)"}
        assert hints["Default"]["is_default"] == 1
        assert hints["Default"]["text"] == DEFAULT_HINT_TEXT  # untouched
        assert hints["Default (2)"]["text"] == "alpha"
        assert hints["default (3)"]["text"] == "beta"


# ---------------------------------------------------------------------------
# users: pinned filters
# ---------------------------------------------------------------------------

def _filter(i, **extra):
    return {"id": f"f{i}", "name": f"Mine {i}", "query": "", "statuses": [], "pinned": False, **extra}


class TestPinnedFilters:
    def test_migrated_filter_has_the_contract_shape(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            ids["a"] = old.collection("Electronics", icon="cpu", color="#60A5FA")
            old.user("s@example.com")

        engine = start(tmp_path, monkeypatch, build)
        (f,) = user_filters(engine, "s@example.com")
        assert f["name"] == "Electronics"
        assert f["query"] == ""
        assert f["tag_id"] == ids["a"]
        assert f["statuses"] == []
        assert f["pinned"] is True
        assert f["icon"] == "cpu"
        assert f["color"] == "#60a5fa"
        assert f["site_id"] is None and f["area_id"] is None and f["location_id"] is None
        assert f["quantity_min"] is None and f["quantity_max"] is None
        assert len(f["id"]) == 36 and "collection" not in f

    def test_filters_follow_collection_nav_order_and_the_rest_go_last_in_created_order(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            for n, name in enumerate("ABCD", start=1):
                ids[name] = old.collection(name + name, created=n)
            old.user("ordered@example.com", nav_order=[ids["C"], "stale-id", ids["A"], ids["C"]])
            old.user("unordered@example.com")  # no collection_nav_order at all

        engine = start(tmp_path, monkeypatch, build)
        assert [f["name"] for f in user_filters(engine, "ordered@example.com")] == ["CC", "AA", "BB", "DD"]
        assert [f["name"] for f in user_filters(engine, "unordered@example.com")] == ["AA", "BB", "CC", "DD"]

    def test_migrated_filters_come_first_then_the_users_own(self, tmp_path, monkeypatch):
        def build(old):
            old.collection("Tools")
            old.user("own@example.com", filters=[_filter(1), _filter(2)])

        engine = start(tmp_path, monkeypatch, build)
        assert [f["name"] for f in user_filters(engine, "own@example.com")] == ["Tools", "Mine 1", "Mine 2"]

    def test_existing_filters_with_a_collection_switch_to_tag_id(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            ids["tools"] = old.collection("Tools")
            old.user("conv@example.com", filters=[
                _filter(1, collection="tools"),
                _filter(2, collection="__none"),
                _filter(3, collection="Vanished"),
                _filter(4, collection=None),
                "junk",
            ])

        engine = start(tmp_path, monkeypatch, build)
        filters = user_filters(engine, "conv@example.com")
        by_name = {f["name"]: f for f in filters}
        assert by_name["Mine 1"]["tag_id"] == ids["tools"]
        assert by_name["Mine 2"]["tag_id"] == "__none"
        assert "Mine 3" not in by_name  # its collection no longer exists: dropped, not turned into "show everything"
        assert by_name["Mine 4"]["tag_id"] is None
        assert all("collection" not in f for f in filters)
        assert len(filters) == 4  # 1 migrated + Mine 1, 2, 4; the dead-collection filter and the junk string are dropped

    def test_a_user_near_the_cap_gets_what_fits_and_the_rest_is_counted(self, tmp_path, monkeypatch):
        def build(old):
            for n in range(1, 6):
                old.collection(f"Col{n}", created=n)
            old.user("busy@example.com", filters=[_filter(i) for i in range(98)])
            old.user("empty@example.com")

        engine = start(tmp_path, monkeypatch, build)
        filters = user_filters(engine, "busy@example.com")
        assert len(filters) == 100
        assert [f["name"] for f in filters[:2]] == ["Col1", "Col2"]
        assert filters[2]["name"] == "Mine 0" and filters[-1]["name"] == "Mine 97"  # the user's own are never dropped
        assert len(user_filters(engine, "empty@example.com")) == 5
        assert meta(engine, "tags_migration_filters_skipped") == "3"
        with Session(engine) as db:
            me = serialize_user(db.query(User).filter(User.username == "busy@example.com").one())
        assert me["whats_new"]["tags_migration"]["filters_skipped"] == 3

    def test_a_large_number_of_collections_never_fails_startup(self, tmp_path, monkeypatch):
        def build(old):
            for n in range(1, 301):
                old.collection(f"Collection number {n:03d}", created=(n % 28) + 1)
            old.user("many@example.com")
            old.user("many2@example.com", filters=[_filter(i) for i in range(100)])

        engine = start(tmp_path, monkeypatch, build)
        assert len(user_filters(engine, "many@example.com")) == 100
        assert len(user_filters(engine, "many2@example.com")) == 100  # already full: nothing added
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 300
        assert meta(engine, "tags_migration_filters_skipped") == str(200 + 300)
        assert meta(engine, "tags_migration_collections_converted") == "300"

    def test_unreadable_stored_filters_do_not_break_the_migration(self, tmp_path, monkeypatch):
        def build(old):
            old.collection("Tools")
            uid = old.user("bad@example.com")
            old.con.execute("UPDATE users SET shortcut_filters = '{{{ not json', collection_nav_order = 'nope' WHERE id = ?", (uid,))

        engine = start(tmp_path, monkeypatch, build)
        assert [f["name"] for f in user_filters(engine, "bad@example.com")] == ["Tools"]

    def test_users_with_nothing_to_convert_are_left_alone(self, tmp_path, monkeypatch):
        def build(old):
            old.user("plain@example.com")

        engine = start(tmp_path, monkeypatch, build)
        row = q(engine, "SELECT * FROM users")[0]
        assert row["shortcut_filters"] is None
        assert row["preferred_add_tag_ids"] is None and row["preferred_add_hint_id"] is None


# ---------------------------------------------------------------------------
# preferences, API keys
# ---------------------------------------------------------------------------

class TestPreferences:
    def test_preferred_collection_without_a_hint_means_the_default_hint(self, tmp_path, monkeypatch):
        ids = {}

        def build(old):
            ids["c"] = old.collection("NoHint")
            old.user("p@example.com", preferred_collection=ids["c"])

        engine = start(tmp_path, monkeypatch, build)
        row = q(engine, "SELECT * FROM users")[0]
        assert row["preferred_add_hint_id"] is None
        assert json.loads(row["preferred_add_tag_ids"]) == [ids["c"]]

    def test_a_preferred_collection_that_no_longer_exists_changes_nothing(self, tmp_path, monkeypatch):
        def build(old):
            old.collection("Real")
            old.user("d@example.com", preferred_collection="deleted-collection-id")

        engine = start(tmp_path, monkeypatch, build)
        row = q(engine, "SELECT * FROM users")[0]
        assert row["preferred_add_tag_ids"] is None and row["preferred_add_hint_id"] is None


class TestApiKeys:
    def test_collection_scopes_become_tag_scopes_deduplicated(self, tmp_path, monkeypatch):
        keys = {}

        def build(old):
            uid = old.user("k@example.com")
            keys["a"] = old.api_key(uid, ["items.read", "collections.read", "collections.write", "collections.delete"], "a")
            keys["b"] = old.api_key(uid, ["collections.read", "tags.read", "collections.read"], "b")
            keys["c"] = old.api_key(uid, ["items.read", "locations.write"], "c")
            keys["d"] = old.api_key(uid, [], "d")

        engine = start(tmp_path, monkeypatch, build)
        scopes = {r["id"]: json.loads(r["scopes_json"]) for r in q(engine, "SELECT id, scopes_json FROM api_keys")}
        assert scopes[keys["a"]] == ["items.read", "tags.read", "tags.write", "tags.delete"]
        assert scopes[keys["b"]] == ["tags.read"]
        assert scopes[keys["c"]] == ["items.read", "locations.write"]
        assert scopes[keys["d"]] == []
        assert not any("collections." in r["scopes_json"] for r in q(engine, "SELECT scopes_json FROM api_keys"))

    def test_a_migrated_key_passes_the_scope_check(self, tmp_path, monkeypatch):
        from stowge.api_key_auth import scopes_from_json

        def build(old):
            uid = old.user("k2@example.com")
            old.api_key(uid, ["collections.read"])

        engine = start(tmp_path, monkeypatch, build)
        stored = scalar(engine, "SELECT scopes_json FROM api_keys")
        assert "tags.read" in scopes_from_json(stored)
        assert "collections.read" not in scopes_from_json(stored)


# ---------------------------------------------------------------------------
# once only, fresh databases, safety
# ---------------------------------------------------------------------------

class TestRunsOnce:
    def _build(self, old):
        old.collection("Tools", ai_hint="hint")
        old.item("Hammer", collection="Tools")
        uid = old.user("o@example.com", filters=[_filter(1)])
        old.api_key(uid, ["collections.read"])

    def test_a_second_start_changes_nothing(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch, self._build)
        before = dump_all(engine)
        stowge_main.init_db()
        stowge_main.init_db()
        assert dump_all(engine) == before
        assert len(pre_copies(tmp_path)) == 1  # no second copy either

    def test_run_tags_migration_reports_whether_it_ran(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch, self._build)
        assert tags_migration.is_migrated(engine) is True
        assert tags_migration.run_tags_migration(engine) is False

    def test_user_changes_after_migration_survive_the_next_start(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch, self._build)
        with engine.begin() as conn:
            conn.execute(text("UPDATE users SET shortcut_filters = NULL"))
            conn.execute(text("DELETE FROM tags"))
        stowge_main.init_db()
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 0  # not re-created from the old collections
        assert scalar(engine, "SELECT shortcut_filters FROM users") is None

    def test_a_fresh_database_only_gets_the_default_hint(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch)  # no file yet: create_all builds everything
        assert [r["name"] for r in q(engine, "SELECT name FROM ai_hints")] == ["Default"]
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 0
        assert meta(engine, FLAG) is not None
        assert meta(engine, "tags_migration_collections_converted") == "0"
        assert pre_copies(tmp_path) == []  # nothing to protect
        with Session(engine) as db:
            from conftest import create_user
            user = create_user(db, username="fresh@example.com")
            assert serialize_user(user)["whats_new"]["tags_migration"] == {"collections_converted": 0, "filters_skipped": 0}

    def test_an_old_database_with_nothing_in_it_needs_no_copy(self, tmp_path, monkeypatch):
        engine = start(tmp_path, monkeypatch, lambda old: None)
        assert pre_copies(tmp_path) == []
        assert meta(engine, FLAG) is not None

    def test_a_large_database_migrates_quickly(self, tmp_path, monkeypatch):
        def build(old):
            old.collection("Alpha", created=1)
            old.collection("Beta", created=2)
            old.con.executemany(
                "INSERT INTO parts (id, name, collection, status, quantity, is_deleted, created_at, updated_at) "
                "VALUES (?, ?, ?, 'draft', 1, 0, 'x', 'x')",
                [(f"item-{n}", f"Item {n}", "alpha" if n % 2 else "BETA") for n in range(6000)],
            )
            old.con.commit()

        began = time.monotonic()
        engine = start(tmp_path, monkeypatch, build)
        assert time.monotonic() - began < 20
        assert scalar(engine, "SELECT COUNT(*) FROM item_tags") == 6000


class TestPreMigrationCopy:
    def _build(self, old):
        old.collection("Tools", ai_hint="hint")
        old.item("Hammer", collection="Tools")
        old.user("c@example.com")

    def test_a_consistent_copy_of_the_old_data_is_written_next_to_the_database(self, tmp_path, monkeypatch):
        start(tmp_path, monkeypatch, self._build)
        (copy,) = pre_copies(tmp_path)
        assert copy.startswith(str(tmp_path / "stowge.db.pre-tags-"))
        con = sqlite3.connect(copy)
        try:
            assert con.execute("SELECT name FROM collections").fetchall() == [("Tools",)]
            assert con.execute("SELECT collection FROM parts").fetchall() == [("Tools",)]
            assert con.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 1
            # taken BEFORE the migration: no tags, no flag
            assert con.execute("SELECT COUNT(*) FROM tags").fetchone()[0] == 0
            assert con.execute("SELECT COUNT(*) FROM app_meta WHERE key = ?", (FLAG,)).fetchone()[0] == 0
        finally:
            con.close()

    def test_a_failed_copy_aborts_the_migration_and_leaves_the_flag_unset(self, tmp_path, monkeypatch):
        def broken(_engine):
            raise OSError("disk full")

        monkeypatch.setattr(tags_migration, "pre_migration_copy", broken)
        path = tmp_path / "stowge.db"
        old = OldDb(path)
        self._build(old)
        old.close()
        engine = create_engine(f"sqlite:///{path}")
        monkeypatch.setattr(stowge_main, "engine", engine)
        with pytest.raises(OSError, match="disk full"):
            stowge_main.init_db()
        assert scalar(engine, "SELECT COUNT(*) FROM app_meta WHERE key = :k", k=FLAG) == 0
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 0
        assert scalar(engine, "SELECT COUNT(*) FROM ai_hints") == 0
        # the next start (with a working disk) migrates normally
        monkeypatch.undo()
        monkeypatch.setattr(stowge_main, "engine", engine)
        stowge_main.init_db()
        assert meta(engine, FLAG) is not None
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 1

    def test_a_sqlite_backup_error_also_aborts(self, tmp_path, monkeypatch):
        path = tmp_path / "stowge.db"
        old = OldDb(path)
        self._build(old)
        old.close()
        engine = create_engine(f"sqlite:///{path}")
        monkeypatch.setattr(stowge_main, "engine", engine)

        def refuse(*_a, **_k):
            raise sqlite3.OperationalError("unable to open database file")

        monkeypatch.setattr(tags_migration.sqlite3, "connect", refuse)
        with pytest.raises(sqlite3.OperationalError):
            stowge_main.init_db()
        monkeypatch.undo()
        assert scalar(engine, "SELECT COUNT(*) FROM app_meta WHERE key = :k", k=FLAG) == 0

    def test_a_failure_part_way_rolls_everything_back(self, tmp_path, monkeypatch):
        path = tmp_path / "stowge.db"
        old = OldDb(path)
        self._build(old)
        uid = old.user("k@example.com")
        old.api_key(uid, ["collections.read"])
        old.close()
        engine = create_engine(f"sqlite:///{path}")
        monkeypatch.setattr(stowge_main, "engine", engine)

        def boom(_raw):
            raise RuntimeError("late failure")

        monkeypatch.setattr(tags_migration, "_convert_scopes", boom)
        with pytest.raises(RuntimeError, match="late failure"):
            stowge_main.init_db()
        # tags, links, hints and user rows were written before the failure: all rolled back
        assert scalar(engine, "SELECT COUNT(*) FROM tags") == 0
        assert scalar(engine, "SELECT COUNT(*) FROM item_tags") == 0
        assert scalar(engine, "SELECT COUNT(*) FROM ai_hints") == 0
        assert scalar(engine, "SELECT COUNT(*) FROM users WHERE shortcut_filters IS NOT NULL") == 0
        assert scalar(engine, "SELECT COUNT(*) FROM app_meta WHERE key = :k", k=FLAG) == 0
        monkeypatch.undo()
        monkeypatch.setattr(stowge_main, "engine", engine)
        stowge_main.init_db()  # and a later start succeeds
        assert meta(engine, FLAG) is not None


class TestRestoreOfAnOldBackup:
    def _old_file(self, path):
        old = OldDb(path)
        old.collection("Restored", ai_hint="restored hint")
        old.item("Thing", collection="Restored")
        uid = old.user("r@example.com")
        old.api_key(uid, ["collections.write"])
        old.close()

    def test_an_old_backup_passes_the_required_tables_check(self, tmp_path):
        from stowge.backup_restore import REQUIRED_BACKUP_TABLES, validate_backup_database_schema

        path = tmp_path / "old.db"
        self._old_file(path)
        validate_backup_database_schema(str(path))  # must not raise: no new table is required
        assert not {"tags", "item_tags", "ai_hints"} & REQUIRED_BACKUP_TABLES
        assert "collections" in REQUIRED_BACKUP_TABLES

    def test_restoring_an_old_backup_over_a_migrated_database_migrates_again(self, tmp_path, monkeypatch):
        from stowge.routes.backup import _migrate_restored_database

        # a database that already ran the migration (flag set, tags in place)
        def build(old):
            old.collection("Before", created=1)
            old.user("before@example.com")

        engine = start(tmp_path, monkeypatch, build)
        assert [r["name"] for r in q(engine, "SELECT name FROM tags")] == ["Before"]
        assert len(pre_copies(tmp_path)) == 1
        engine.dispose()

        # "restore": the file is replaced by an old-schema backup, the way restore_from_validation does
        backup = tmp_path / "backup.db"
        self._old_file(backup)
        for suffix in ("-wal", "-shm"):
            (tmp_path / f"stowge.db{suffix}").unlink(missing_ok=True)
        (tmp_path / "stowge.db").write_bytes(backup.read_bytes())

        _migrate_restored_database()

        assert [r["name"] for r in q(engine, "SELECT name FROM tags")] == ["Restored"]
        assert meta(engine, "tags_migration_collections_converted") == "1"
        assert json.loads(scalar(engine, "SELECT scopes_json FROM api_keys")) == ["tags.write"]
        assert "Restored" in hint_names(engine)
        # one copy per migration run, even inside the same second: the restored data was protected too
        copies = pre_copies(tmp_path)
        assert len(copies) == 2
        restored_copy = sqlite3.connect(copies[1])
        try:
            assert restored_copy.execute("SELECT name FROM collections").fetchall() == [("Restored",)]
        finally:
            restored_copy.close()


class TestFailedMigrationCleansUp:
    def test_a_failing_transaction_leaves_no_copy_behind_so_a_crash_loop_cannot_fill_the_disk(self, tmp_path, monkeypatch):
        path = tmp_path / "stowge.db"
        old = OldDb(path)
        old.collection("Tools")
        old.user("u@example.com")
        old.close()
        engine = create_engine(f"sqlite:///{path}")
        monkeypatch.setattr(stowge_main, "engine", engine)

        def boom(*_a, **_k):
            raise RuntimeError("step failed")

        monkeypatch.setattr(tags_migration, "_migrate", boom)
        for _ in range(3):
            with pytest.raises(RuntimeError, match="step failed"):
                stowge_main.init_db()
        assert pre_copies(tmp_path) == []
        assert scalar(engine, "SELECT COUNT(*) FROM app_meta WHERE key = :k", k=FLAG) == 0


# ---------------------------------------------------------------------------
# review fixes: partial copies, copy permissions, ';' in collection names
# ---------------------------------------------------------------------------

def test_a_failed_pre_migration_copy_leaves_no_partial_file_after_repeated_starts(tmp_path, monkeypatch):
    paths = {}

    class DiskFullSource:
        """Source connection whose backup writes some bytes, then dies (disk full)."""

        def __init__(self, real):
            self.real = real

        def backup(self, target):
            with open(paths[id(target)], "ab") as partial:
                partial.write(b"partial")
            raise OSError("disk full")

        def close(self):
            self.real.close()

    class FakeSqlite:
        def connect(self, path):
            real = sqlite3.connect(path)
            paths[id(real)] = str(path)
            return real if ".pre-tags-" in str(path) else DiskFullSource(real)

    path = tmp_path / "stowge.db"
    old = OldDb(path)
    old.collection("Tools")
    old.user("u@example.com")
    old.close()
    engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(stowge_main, "engine", engine)
    monkeypatch.setattr(tags_migration, "sqlite3", FakeSqlite())
    for _ in range(3):
        with pytest.raises(OSError, match="disk full"):
            stowge_main.init_db()
        assert pre_copies(tmp_path) == []
    assert meta(engine, FLAG) is None


def test_the_pre_migration_copy_is_private_to_the_owner(tmp_path, monkeypatch):
    start(tmp_path, monkeypatch, lambda old: (old.collection("Tools"), old.user("u@example.com")))
    copies = pre_copies(tmp_path)
    assert len(copies) == 1
    assert stat.S_IMODE(os.stat(copies[0]).st_mode) == 0o600


class TestSemicolonCollectionNames:
    def _build(self, old):
        self.semi = old.collection("Nuts;  Bolts", created=1)
        self.comma = old.collection("Nuts, Bolts", created=2)
        self.plain = old.collection("Other", created=3)
        self.i_semi = old.item("a", collection="Nuts;  Bolts")
        self.i_comma = old.item("b", collection="Nuts, Bolts")
        old.user("u@example.com", last_open="Nuts;  Bolts")

    @pytest.fixture
    def engine(self, tmp_path, monkeypatch):
        return start(tmp_path, monkeypatch, self._build)

    def test_the_separator_is_replaced_and_a_clash_gets_the_suffix_after_it(self, engine):
        tags = {t["id"]: t["name"] for t in q(engine, "SELECT id, name FROM tags")}
        assert tags[self.comma] == "Nuts, Bolts"  # untouched, keeps its name even though it comes second
        assert tags[self.semi] == "Nuts, Bolts (2)"
        assert tags[self.plain] == "Other"
        assert not [n for n in tags.values() if ";" in n]

    def test_items_still_match_on_the_original_collection_name(self, engine):
        links = {(r["item_id"], r["tag_id"]) for r in q(engine, "SELECT * FROM item_tags")}
        assert links == {(self.i_semi, self.semi), (self.i_comma, self.comma)}

    def test_last_open_tag_follows_the_new_name(self, engine):
        assert scalar(engine, "SELECT last_open_tag FROM users") == "Nuts, Bolts (2)"


def test_a_semicolon_name_without_a_clash_just_loses_the_separator(tmp_path, monkeypatch):
    engine = start(tmp_path, monkeypatch, lambda old: old.collection("Nuts; Bolts"))
    assert [t["name"] for t in q(engine, "SELECT name FROM tags")] == ["Nuts, Bolts"]
