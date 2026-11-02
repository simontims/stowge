"""AI hints: /api/hints CRUD, the undeletable Default, sticky choice reset."""
from conftest import auth_cookies_isolated

from stowge.ai_hints import DEFAULT_HINT_TEXT
from stowge.models import AiHint


def _cookies(isolated_db, name="hints@example.com"):
    return auth_cookies_isolated(isolated_db, name, role="user")


def _hints(client, cookies):
    r = client.get("/api/hints", cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()


def _default(client, cookies):
    return next(h for h in _hints(client, cookies) if h["is_default"])


def test_requires_login(isolated_client):
    assert isolated_client.get("/api/hints").status_code == 401
    assert isolated_client.post("/api/hints", json={"name": "Abc"}).status_code == 401


def test_default_exists_even_on_a_database_that_skipped_the_migration(isolated_client, isolated_db):
    hints = _hints(isolated_client, _cookies(isolated_db))
    assert hints == [{"id": hints[0]["id"], "name": "Default", "text": DEFAULT_HINT_TEXT, "is_default": True}]


def test_default_is_first_then_by_name_case_insensitively(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    for name in ("zeta", "Alpha", "beta"):
        assert isolated_client.post("/api/hints", json={"name": name, "text": "t"}, cookies=cookies).status_code == 200
    assert [h["name"] for h in _hints(isolated_client, cookies)] == ["Default", "Alpha", "beta", "zeta"]


def test_create_returns_the_shape_and_text_may_be_empty(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    r = isolated_client.post("/api/hints", json={"name": "Electronics"}, cookies=cookies)
    assert r.status_code == 200
    assert r.json() == {"id": r.json()["id"], "name": "Electronics", "text": "", "is_default": False}
    r2 = isolated_client.post("/api/hints", json={"name": "Garage", "text": "  Mostly tools.  "}, cookies=cookies)
    assert r2.json()["text"] == "Mostly tools."


def test_names_are_unique_case_insensitively_including_default(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    assert isolated_client.post("/api/hints", json={"name": "Garage"}, cookies=cookies).status_code == 200
    for clash in ("garage", "GARAGE", "default", "Default"):
        r = isolated_client.post("/api/hints", json={"name": clash}, cookies=cookies)
        assert r.status_code == 400, clash
    other = isolated_client.post("/api/hints", json={"name": "Shed"}, cookies=cookies).json()
    assert isolated_client.patch(f"/api/hints/{other['id']}", json={"name": "gArAgE"}, cookies=cookies).status_code == 400
    assert isolated_client.patch(f"/api/hints/{other['id']}", json={"name": "SHED"}, cookies=cookies).status_code == 200


def test_name_needs_two_characters(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    assert isolated_client.post("/api/hints", json={"name": "a"}, cookies=cookies).status_code == 400


def test_default_text_is_editable_but_it_cannot_be_renamed_or_deleted(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    default = _default(isolated_client, cookies)

    r = isolated_client.patch(f"/api/hints/{default['id']}", json={"text": "My own general wording"}, cookies=cookies)
    assert r.status_code == 200 and r.json()["text"] == "My own general wording"
    assert _default(isolated_client, cookies)["text"] == "My own general wording"

    assert isolated_client.patch(f"/api/hints/{default['id']}", json={"text": ""}, cookies=cookies).json()["text"] == ""

    assert isolated_client.patch(f"/api/hints/{default['id']}", json={"name": "Renamed"}, cookies=cookies).status_code == 400
    # sending the unchanged name alongside the text is not a rename
    ok = isolated_client.patch(f"/api/hints/{default['id']}", json={"name": "Default", "text": "x"}, cookies=cookies)
    assert ok.status_code == 200 and ok.json()["name"] == "Default"

    r = isolated_client.delete(f"/api/hints/{default['id']}", cookies=cookies)
    assert r.status_code == 400
    assert _default(isolated_client, cookies)["id"] == default["id"]


def test_edit_and_delete_a_normal_hint(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    hint = isolated_client.post("/api/hints", json={"name": "Garage", "text": "a"}, cookies=cookies).json()
    r = isolated_client.patch(f"/api/hints/{hint['id']}", json={"name": "Workshop", "text": "b"}, cookies=cookies)
    assert r.json() == {"id": hint["id"], "name": "Workshop", "text": "b", "is_default": False}
    assert isolated_client.delete(f"/api/hints/{hint['id']}", cookies=cookies).status_code == 200
    assert [h["name"] for h in _hints(isolated_client, cookies)] == ["Default"]
    assert isolated_client.delete(f"/api/hints/{hint['id']}", cookies=cookies).status_code == 404
    assert isolated_client.patch(f"/api/hints/{hint['id']}", json={"text": "x"}, cookies=cookies).status_code == 404


def test_deleting_a_hint_resets_the_users_who_had_it_selected_to_default(isolated_client, isolated_db):
    alice = _cookies(isolated_db, "alice@example.com")
    bob = _cookies(isolated_db, "bob@example.com")
    keep = isolated_client.post("/api/hints", json={"name": "Keep"}, cookies=alice).json()
    drop = isolated_client.post("/api/hints", json={"name": "Drop"}, cookies=alice).json()
    isolated_client.patch("/api/me", cookies=alice, json={"preferred_add_hint_id": drop["id"]})
    isolated_client.patch("/api/me", cookies=bob, json={"preferred_add_hint_id": keep["id"]})

    assert isolated_client.delete(f"/api/hints/{drop['id']}", cookies=bob).status_code == 200

    assert isolated_client.get("/api/me", cookies=alice).json()["preferred_add_hint_id"] is None
    assert isolated_client.get("/api/me", cookies=bob).json()["preferred_add_hint_id"] == keep["id"]


def test_hints_have_no_tag_relationship_and_exactly_one_default_row(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    _hints(isolated_client, cookies)
    _hints(isolated_client, cookies)
    isolated_client.post("/api/hints", json={"name": "Other"}, cookies=cookies)
    db = isolated_db()
    try:
        assert db.query(AiHint).filter(AiHint.is_default == 1).count() == 1
    finally:
        db.close()
