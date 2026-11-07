"""Fixes from the second independent review of release 2: non-ASCII last_open_tag, duplicate-name races, CSV tag validation."""
import pytest
from conftest import auth_cookies_isolated

from stowge.models import Tag, User
from stowge.routes import api_v1, hints, import_csv
from stowge.routes import tags as tags_routes

BASE = "/external-api/v1"
ALL = ["items.read", "items.write", "items.delete", "tags.read", "tags.write", "tags.delete"]


@pytest.fixture
def ctx(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "review2@example.com", role="admin")
    r = isolated_client.post("/api/api-keys", json={"name": "k", "key_type": "system", "scopes": ALL}, cookies=cookies)
    assert r.status_code == 200, r.text
    return isolated_client, isolated_db, cookies, {"Authorization": f"Bearer {r.json()['api_key']}"}


def _set_last_open(isolated_db, username, value):
    db = isolated_db()
    try:
        db.query(User).filter(User.username == username).one().last_open_tag = value
        db.commit()
    finally:
        db.close()


def _last_open(client, cookies):
    return client.get("/api/me", cookies=cookies).json()["last_open_tag"]


# ----- S2 / S7: non-ASCII names follow a rename and are cleared on delete, internal and /v1 -----

@pytest.mark.parametrize("via", ["internal", "v1"])
def test_non_ascii_tag_rename_updates_last_open_tag(ctx, via):
    client, isolated_db, cookies, headers = ctx
    tag = client.post("/api/tags", json={"name": "Écran"}, cookies=cookies).json()
    _set_last_open(isolated_db, "review2@example.com", "Écran")
    if via == "internal":
        r = client.patch(f"/api/tags/{tag['id']}", json={"name": "Display"}, cookies=cookies)
    else:
        r = client.patch(f"{BASE}/tags/{tag['id']}", json={"name": "Display"}, headers=headers)
    assert r.status_code == 200, r.text
    assert _last_open(client, cookies) == "Display"


@pytest.mark.parametrize("via", ["internal", "v1"])
def test_non_ascii_tag_delete_clears_last_open_tag(ctx, via):
    client, isolated_db, cookies, headers = ctx
    tag = client.post("/api/tags", json={"name": "Écran"}, cookies=cookies).json()
    _set_last_open(isolated_db, "review2@example.com", "Écran")
    if via == "internal":
        r = client.delete(f"/api/tags/{tag['id']}", cookies=cookies)
    else:
        r = client.delete(f"{BASE}/tags/{tag['id']}", headers=headers)
    assert r.status_code == 200, r.text
    assert _last_open(client, cookies) is None


# ----- S3: a duplicate name that slips past the pre-check is a 400, not a 500 -----

def _clash_tag(isolated_db, name):
    db = isolated_db()
    try:
        db.add(Tag(name=name))
        db.commit()
    finally:
        db.close()


def test_tag_create_and_rename_race_returns_400_internal(ctx, monkeypatch):
    client, isolated_db, cookies, _h = ctx
    other = client.post("/api/tags", json={"name": "Other"}, cookies=cookies).json()
    _clash_tag(isolated_db, "Taken")
    monkeypatch.setattr(tags_routes, "find_tag_by_name", lambda *a, **k: None)
    r = client.post("/api/tags", json={"name": "TAKEN"}, cookies=cookies)
    assert (r.status_code, r.json()["detail"]) == (400, "Tag name already exists")
    r = client.patch(f"/api/tags/{other['id']}", json={"name": "taken"}, cookies=cookies)
    assert (r.status_code, r.json()["detail"]) == (400, "Tag name already exists")


def test_tag_create_and_rename_race_returns_400_v1(ctx, monkeypatch):
    client, isolated_db, cookies, headers = ctx
    other = client.post("/api/tags", json={"name": "Other"}, cookies=cookies).json()
    _clash_tag(isolated_db, "Taken")
    monkeypatch.setattr(api_v1, "find_tag_by_name", lambda *a, **k: None)
    r = client.post(f"{BASE}/tags", json={"name": "TAKEN"}, headers=headers)
    assert (r.status_code, r.json()["detail"]) == (400, "Tag name already exists")
    r = client.patch(f"{BASE}/tags/{other['id']}", json={"name": "taken"}, headers=headers)
    assert (r.status_code, r.json()["detail"]) == (400, "Tag name already exists")


def test_hint_create_and_rename_race_returns_400(ctx, monkeypatch):
    client, _db, cookies, _h = ctx
    taken = client.post("/api/hints", json={"name": "Taken", "text": "a"}, cookies=cookies)
    other = client.post("/api/hints", json={"name": "Other", "text": "b"}, cookies=cookies).json()
    assert taken.status_code == 200
    monkeypatch.setattr(hints, "hint_by_name", lambda *a, **k: None)
    r = client.post("/api/hints", json={"name": "TAKEN"}, cookies=cookies)
    assert (r.status_code, r.json()["detail"]) == (400, "Hint name already exists")
    r = client.patch(f"/api/hints/{other['id']}", json={"name": "taken"}, cookies=cookies)
    assert (r.status_code, r.json()["detail"]) == (400, "Hint name already exists")


def test_csv_confirm_tag_create_race_returns_400_and_imports_nothing(ctx, monkeypatch):
    client, isolated_db, cookies, _h = ctx
    real = import_csv._unique_tag_names

    def racing(rows):  # runs after the confirm step looked up the existing tags
        names = real(rows)
        _clash_tag(isolated_db, "Fresh")
        return names

    monkeypatch.setattr(import_csv, "_unique_tag_names", racing)
    files = {"file": ("in.csv", "name,tags\nOne,Fresh\n", "text/csv")}
    r = client.post("/api/import/csv/confirm?create_tags=true", files=files, cookies=cookies)
    assert r.status_code == 400, r.text
    assert "already exists" in r.json()["detail"]
    assert client.get("/api/items", cookies=cookies).json() == []


# ----- S4a: CSV tag names are validated like hand-made tags -----

@pytest.mark.parametrize("header,cell", [("tags", "Good; X"), ("tags", "Good; a;b"), ("collection", "Old; thing"), ("collection", "Z")])
def test_csv_invalid_tag_names_are_listed_in_preview_and_refused_on_import(ctx, header, cell):
    client, _db, cookies, _h = ctx
    text = f"name,{header}\nRow,\"{cell}\"\n"
    r = client.post("/api/import/csv/preview", files={"file": ("in.csv", text, "text/csv")}, cookies=cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["invalid_tags"], body
    assert not set(body["invalid_tags"]) & set(body["missing_tags"])
    r = client.post("/api/import/csv/confirm?create_tags=true", files={"file": ("in.csv", text, "text/csv")}, cookies=cookies)
    assert r.status_code == 400, r.text
    for name in body["invalid_tags"]:
        assert name in r.json()["detail"]
    assert client.get("/api/items", cookies=cookies).json() == []
    assert client.get("/api/tags", cookies=cookies).json() == []


def test_csv_valid_tags_still_listed_as_missing_with_an_empty_invalid_list(ctx):
    client, _db, cookies, _h = ctx
    text = "name,tags\nRow,\"Alpha; Beta, gamma\"\n"
    body = client.post("/api/import/csv/preview", files={"file": ("in.csv", text, "text/csv")}, cookies=cookies).json()
    assert body["missing_tags"] == ["Alpha", "Beta, gamma"] and body["invalid_tags"] == []


# ----- S5 / S6: docs say what the code does -----

def _doc(*parts):
    from pathlib import Path
    return Path(__file__).resolve().parents[2].joinpath(*parts).read_text(encoding="utf-8")


def test_deployment_rollback_steps_cover_wal_files_and_data_loss():
    text = _doc("docs", "DEPLOYMENT.md")
    for needle in ("stop the container", "`stowge.db-wal`", "`stowge.db-shm`", "`.pre-tags-*`", "is lost on rollback"):
        assert needle in text, needle


@pytest.mark.parametrize("name", ["MIGRATING-collections-to-tags.md", "CHANGELOG.md"])
def test_api_docs_describe_the_v1_rejections_and_csv_rules(name):
    text = _doc("docs", "api", name)
    for needle in ("GET /v1/items?collection=", "HTTP 400", "tag_ids", "collection_id", "`;`", "invalid_tags"):
        assert needle in text, needle
    assert "`;` **only**" in text or "`;` only" in text


def test_the_documented_v1_rejections_hold(ctx):
    client, _db, _cookies, headers = ctx
    r = client.get(f"{BASE}/items?collection=", headers=headers)
    assert (r.status_code, r.json()["detail"]) == (400, "collection is no longer supported; use tags")
    for field in ("collection_id", "tag_ids"):
        r = client.post(f"{BASE}/items", json={"name": "Thing", field: "x"}, headers=headers)
        assert r.status_code == 400, field
