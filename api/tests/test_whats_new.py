"""What's New cursor, severities, supersession, and the welcome flow."""
import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from conftest import auth_cookies, client, make_db
from stowge import main as stowge_main
from stowge import whats_new
from stowge.models import Base, User


def set_notes(monkeypatch, notes):
    monkeypatch.setenv(whats_new.PREVIEW_NOTES_ENV, json.dumps(notes))


def note(id, severity="interrupt", version="0.11.0", **extra):
    return {"id": id, "severity": severity, "version": version, "title": f"Title {id}", "summary": f"Summary {id}", **extra}


@pytest.fixture
def three(monkeypatch):
    """a (seq 1, interrupt), b (seq 2, dot), c (seq 3, interrupt)."""
    set_notes(monkeypatch, [note("a"), note("b", "dot"), note("c")])


def _me(cookies):
    r = client.get("/api/me", cookies=cookies)
    assert r.status_code == 200
    return r.json()


def _ids(me):
    return [n["id"] for n in me["whats_new"]["unseen"]]


class TestRegistry:
    def test_release_1_ships_no_notes(self, monkeypatch):
        monkeypatch.delenv(whats_new.PREVIEW_NOTES_ENV, raising=False)
        assert whats_new.NOTES == ()
        assert whats_new.all_notes() == []
        assert whats_new.latest_seq() == 0

    def test_preview_notes_get_increasing_seq(self, three):
        assert [(n.id, n.seq) for n in whats_new.all_notes()] == [("a", 1), ("b", 2), ("c", 3)]

    def test_bad_preview_notes_are_ignored(self, monkeypatch):
        monkeypatch.setenv(whats_new.PREVIEW_NOTES_ENV, "not json")
        assert whats_new.all_notes() == []
        set_notes(monkeypatch, [{"id": "x", "severity": "loud", "version": "1"}, {"severity": "dot", "version": "1"},
                                {"id": "nov", "severity": "dot"}, "str", note("ok", "dot")])
        assert [n.id for n in whats_new.all_notes()] == ["ok"]


class TestUnseenAndSupersession:
    def test_everything_above_the_cursor_is_unseen(self, three):
        assert [n.id for n in whats_new.unseen_notes(0)] == ["a", "b", "c"]
        assert [n.id for n in whats_new.unseen_notes(1)] == ["b", "c"]
        assert whats_new.unseen_notes(3) == []

    def test_a_newer_unseen_note_hides_the_one_it_replaces(self, monkeypatch):
        set_notes(monkeypatch, [note("old"), note("mid", "dot"), note("new", supersedes=["old"])])
        assert [n.id for n in whats_new.unseen_notes(0)] == ["mid", "new"]

    def test_replaced_note_is_not_hidden_when_the_replacement_is_already_seen_is_impossible(self, monkeypatch):
        # A replacement always has a higher seq, so a user past the old note but before the new one still sees the new one only.
        set_notes(monkeypatch, [note("old"), note("new", supersedes=["old"])])
        assert [n.id for n in whats_new.unseen_notes(1)] == ["new"]

    def test_chain_of_replacements_leaves_only_the_last(self, monkeypatch):
        set_notes(monkeypatch, [note("v1"), note("v2", supersedes=["v1"]), note("v3", supersedes=["v2"])])
        assert [n.id for n in whats_new.unseen_notes(0)] == ["v3"]

    def test_history_is_newest_first_and_leaves_out_replaced_notes(self, monkeypatch):
        set_notes(monkeypatch, [note("old"), note("keep", "dot"), note("new", supersedes=["old"])])
        rows = whats_new.history(0)
        assert [r["id"] for r in rows] == ["new", "keep"]
        assert all(r["unread"] for r in rows)
        assert "superseded_by" not in rows[0]

    def test_history_flags_what_the_user_has_already_seen(self, three):
        assert [(r["id"], r["unread"]) for r in whats_new.history(2)] == [("c", True), ("b", False), ("a", False)]

    def test_history_carries_the_version_for_grouping(self, monkeypatch):
        set_notes(monkeypatch, [note("a", version="0.9.0"), note("b", version="0.11.0")])
        assert [(r["id"], r["version"]) for r in whats_new.history(0)] == [("b", "0.11.0"), ("a", "0.9.0")]

    def test_cursor_clamping(self, three):
        assert whats_new.clamp_cursor(0, None) == 3
        assert whats_new.clamp_cursor(2, 1) == 2  # never goes down
        assert whats_new.clamp_cursor(0, 99) == 3  # never past the newest
        assert whats_new.clamp_cursor(0, -5) == 0


class TestMe:
    def test_no_notes_registered_means_nothing_unseen(self, monkeypatch):
        monkeypatch.delenv(whats_new.PREVIEW_NOTES_ENV, raising=False)
        me = _me(auth_cookies("wn_none@example.com"))
        assert me["whats_new"]["latest_seq"] == 0
        assert me["whats_new"]["unseen"] == []
        assert me["whats_new"]["unseen_interrupt_count"] == 0

    def test_existing_account_sees_every_note_and_counts_interrupts(self, three):
        me = _me(auth_cookies("wn_existing@example.com"))  # created directly, cursor 0
        assert _ids(me) == ["a", "b", "c"]
        assert me["whats_new"]["unseen_interrupt_count"] == 2
        assert me["whats_new"]["latest_seq"] == 3

    def test_note_payload_has_what_the_ui_needs(self, three):
        first = _me(auth_cookies("wn_payload@example.com"))["whats_new"]["unseen"][0]
        assert set(first) == {"id", "seq", "severity", "version", "title", "summary", "date", "supersedes"}


class TestSeenEndpoint:
    def test_no_body_marks_everything_seen(self, three):
        cookies = auth_cookies("wn_all@example.com")
        r = client.post("/api/me/whats-new/seen", cookies=cookies)
        assert r.status_code == 200
        assert r.json()["whats_new"]["unseen"] == []
        assert _me(cookies)["whats_new"]["unseen"] == []

    def test_seq_marks_up_to_that_note(self, three):
        cookies = auth_cookies("wn_seq@example.com")
        r = client.post("/api/me/whats-new/seen", json={"seq": 1}, cookies=cookies)
        assert _ids(r.json()) == ["b", "c"]

    def test_cursor_never_moves_backwards(self, three):
        cookies = auth_cookies("wn_back@example.com")
        client.post("/api/me/whats-new/seen", json={"seq": 3}, cookies=cookies)
        r = client.post("/api/me/whats-new/seen", json={"seq": 1}, cookies=cookies)
        assert r.json()["whats_new"]["unseen"] == []

    def test_seq_past_the_newest_is_clamped(self, three):
        cookies = auth_cookies("wn_clamp@example.com")
        r = client.post("/api/me/whats-new/seen", json={"seq": 999}, cookies=cookies)
        assert r.status_code == 200
        db = make_db()
        assert db.query(User).filter(User.username == "wn_clamp@example.com").one().last_seen_note == 3

    def test_a_note_added_later_is_still_unseen(self, monkeypatch):
        set_notes(monkeypatch, [note("a")])
        cookies = auth_cookies("wn_later@example.com")
        client.post("/api/me/whats-new/seen", cookies=cookies)
        set_notes(monkeypatch, [note("a"), note("b")])
        assert _ids(_me(cookies)) == ["b"]

    def test_bad_seq_is_400(self, three):
        cookies = auth_cookies("wn_bad@example.com")
        assert client.post("/api/me/whats-new/seen", json={"seq": "x"}, cookies=cookies).status_code == 400

    def test_requires_login(self, three):
        assert client.post("/api/me/whats-new/seen").status_code == 401
        assert client.get("/api/whats-new").status_code == 401

    def test_users_do_not_share_state(self, three):
        one = auth_cookies("wn_one@example.com")
        two = auth_cookies("wn_two@example.com")
        client.post("/api/me/whats-new/seen", cookies=one)
        assert _ids(_me(two)) == ["a", "b", "c"]


class TestHistoryEndpoint:
    def test_lists_all_notes_with_unread_flags(self, three):
        cookies = auth_cookies("wn_hist@example.com")
        client.post("/api/me/whats-new/seen", json={"seq": 2}, cookies=cookies)
        rows = client.get("/api/whats-new", cookies=cookies).json()["notes"]
        assert [(r["id"], r["unread"]) for r in rows] == [("c", True), ("b", False), ("a", False)]


class TestNewAccounts:
    def test_admin_created_account_starts_at_the_latest_note_with_welcome_pending(self, three):
        admin = auth_cookies("wn_admin@example.com", role="admin")
        r = client.post("/api/users", cookies=admin, json={"email": "wn_new@example.com", "password": "Pass1234!", "role": "user"})
        assert r.status_code == 200
        wn = r.json()["whats_new"]
        assert wn["unseen"] == []
        assert wn["welcome_pending"] is True

    def test_account_created_before_a_note_ships_still_sees_it(self, monkeypatch):
        monkeypatch.delenv(whats_new.PREVIEW_NOTES_ENV, raising=False)
        admin = auth_cookies("wn_admin2@example.com", role="admin")
        client.post("/api/users", cookies=admin, json={"email": "wn_early@example.com", "password": "Pass1234!", "role": "user"})
        early = auth_cookies("wn_early@example.com")
        set_notes(monkeypatch, [note("a")])
        assert _ids(_me(early)) == ["a"]


class TestWelcome:
    def test_pending_until_seen_then_stays_seen(self, monkeypatch):
        monkeypatch.delenv(whats_new.PREVIEW_NOTES_ENV, raising=False)
        cookies = auth_cookies("wn_welcome@example.com")
        assert _me(cookies)["whats_new"]["welcome_pending"] is True
        r = client.post("/api/me/welcome/seen", cookies=cookies)
        assert r.status_code == 200
        assert r.json()["whats_new"]["welcome_pending"] is False
        assert client.post("/api/me/welcome/seen", cookies=cookies).json()["whats_new"]["welcome_pending"] is False

    def test_welcome_and_notes_are_independent(self, three):
        cookies = auth_cookies("wn_indep@example.com")
        client.post("/api/me/welcome/seen", cookies=cookies)
        me = _me(cookies)
        assert me["whats_new"]["welcome_pending"] is False
        assert _ids(me) == ["a", "b", "c"]

    def test_bumping_the_welcome_version_shows_it_again(self, monkeypatch):
        cookies = auth_cookies("wn_bump@example.com")
        client.post("/api/me/welcome/seen", cookies=cookies)
        monkeypatch.setattr(whats_new, "WELCOME_VERSION", whats_new.WELCOME_VERSION + 1)
        assert _me(cookies)["whats_new"]["welcome_pending"] is True


class TestMigration:
    def _engine(self, tmp_path, monkeypatch):
        engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
        Base.metadata.create_all(engine)
        monkeypatch.setattr(stowge_main, "engine", engine)
        return engine

    def _add(self, engine, username, last_login):
        with sessionmaker(bind=engine)() as db:
            db.add(User(username=username, password_hash="h", role="user", last_login_at=last_login))
            db.commit()

    def _welcome(self, engine, username):
        with sessionmaker(bind=engine)() as db:
            return db.query(User).filter(User.username == username).one().welcome_seen_version

    def test_startup_migration_adds_the_columns_and_is_idempotent(self, tmp_path, monkeypatch):
        engine = self._engine(tmp_path, monkeypatch)
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users DROP COLUMN last_seen_note"))
            conn.execute(text("ALTER TABLE users DROP COLUMN welcome_seen_version"))
        stowge_main._run_startup_migrations()
        stowge_main._run_startup_migrations()
        cols = {c["name"] for c in inspect(engine).get_columns("users")}
        assert {"last_seen_note", "welcome_seen_version"} <= cols

    def test_accounts_that_have_logged_in_are_marked_as_having_seen_the_welcome(self, tmp_path, monkeypatch):
        engine = self._engine(tmp_path, monkeypatch)
        self._add(engine, "old@example.com", datetime.now(timezone.utc))
        self._add(engine, "never@example.com", None)
        assert stowge_main.backfill_welcome_seen() == 1
        assert self._welcome(engine, "old@example.com") == whats_new.WELCOME_VERSION
        assert self._welcome(engine, "never@example.com") == 0

    def test_backfill_runs_once_only(self, tmp_path, monkeypatch):
        engine = self._engine(tmp_path, monkeypatch)
        stowge_main.backfill_welcome_seen()
        self._add(engine, "later@example.com", datetime.now(timezone.utc))
        assert stowge_main.backfill_welcome_seen() == 0
        assert self._welcome(engine, "later@example.com") == 0

    def test_startup_migrations_run_the_backfill(self, tmp_path, monkeypatch):
        engine = self._engine(tmp_path, monkeypatch)
        self._add(engine, "old@example.com", datetime.now(timezone.utc))
        stowge_main._run_startup_migrations()
        stowge_main._run_startup_migrations()
        assert self._welcome(engine, "old@example.com") == whats_new.WELCOME_VERSION
