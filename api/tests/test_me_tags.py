"""/api/me: sticky hint and tags, last opened tag, shortcut filters with tag_id."""
import json

from conftest import auth_cookies_isolated

from stowge.models import User


def _setup(isolated_client, isolated_db, name="me_tags@example.com"):
    cookies = auth_cookies_isolated(isolated_db, name, role="user")
    tag = isolated_client.post("/api/tags", json={"name": "Tools"}, cookies=cookies).json()
    tag2 = isolated_client.post("/api/tags", json={"name": "Camping"}, cookies=cookies).json()
    hint = isolated_client.post("/api/hints", json={"name": "Garage", "text": "x"}, cookies=cookies).json()
    return cookies, tag, tag2, hint


def _patch(client, cookies, body):
    return client.patch("/api/me", json=body, cookies=cookies)


def _filter(**extra):
    return {"id": "f1", "name": "A filter", "query": "", "pinned": True, **extra}


def test_me_has_the_new_fields_with_empty_defaults_and_none_of_the_old(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    me = isolated_client.get("/api/me", cookies=cookies).json()
    assert me["preferred_add_hint_id"] is None
    assert me["preferred_add_tag_ids"] == []
    assert me["last_open_tag"] is None
    for gone in ("preferred_add_collection_id", "last_open_collection", "collection_nav_order"):
        assert gone not in me
    assert me["whats_new"]["tags_migration"] == {"collections_converted": 0, "filters_skipped": 0}


def test_old_collection_fields_in_a_patch_are_ignored(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"preferred_add_collection_id": "x", "last_open_collection": "y", "collection_nav_order": ["a"]})
    assert r.status_code == 200
    db = isolated_db()
    try:
        u = db.query(User).filter(User.username == "me_tags@example.com").one()
        assert u.preferred_add_collection_id is None and u.last_open_collection is None and u.collection_nav_order is None
    finally:
        db.close()


def test_preferred_hint_is_validated_and_null_means_default(isolated_client, isolated_db):
    cookies, _t, _t2, hint = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"preferred_add_hint_id": hint["id"]})
    assert r.status_code == 200 and r.json()["preferred_add_hint_id"] == hint["id"]
    bad = _patch(isolated_client, cookies, {"preferred_add_hint_id": "nope"})
    assert bad.status_code == 400 and "preferred_add_hint_id" in bad.json()["detail"]
    assert isolated_client.get("/api/me", cookies=cookies).json()["preferred_add_hint_id"] == hint["id"]
    assert _patch(isolated_client, cookies, {"preferred_add_hint_id": None}).json()["preferred_add_hint_id"] is None
    assert _patch(isolated_client, cookies, {"preferred_add_hint_id": hint["id"]}).status_code == 200
    assert _patch(isolated_client, cookies, {"preferred_add_hint_id": ""}).json()["preferred_add_hint_id"] is None


def test_preferred_tag_ids_are_validated_deduplicated_and_clearable(isolated_client, isolated_db):
    cookies, tag, tag2, _hint = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"preferred_add_tag_ids": [tag["id"], tag2["id"], tag["id"]]})
    assert r.status_code == 200
    assert r.json()["preferred_add_tag_ids"] == [tag["id"], tag2["id"]]
    for bad in (["nope"], [tag["id"], "nope"], [""], "not-a-list", {"a": 1}):
        r = _patch(isolated_client, cookies, {"preferred_add_tag_ids": bad})
        assert r.status_code == 400, bad
    assert isolated_client.get("/api/me", cookies=cookies).json()["preferred_add_tag_ids"] == [tag["id"], tag2["id"]]
    assert _patch(isolated_client, cookies, {"preferred_add_tag_ids": []}).json()["preferred_add_tag_ids"] == []
    assert _patch(isolated_client, cookies, {"preferred_add_tag_ids": [tag["id"]]}).status_code == 200
    assert _patch(isolated_client, cookies, {"preferred_add_tag_ids": None}).json()["preferred_add_tag_ids"] == []


def test_last_open_tag_is_a_free_string_or_null(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    assert _patch(isolated_client, cookies, {"last_open_tag": "  Tools "}).json()["last_open_tag"] == "Tools"
    assert _patch(isolated_client, cookies, {"last_open_tag": "__none"}).json()["last_open_tag"] == "__none"
    assert _patch(isolated_client, cookies, {"last_open_tag": None}).json()["last_open_tag"] is None
    assert _patch(isolated_client, cookies, {"last_open_tag": "x"}).status_code == 200
    assert _patch(isolated_client, cookies, {"last_open_tag": "  "}).json()["last_open_tag"] is None


def test_shortcut_filter_stores_tag_id_and_returns_it(isolated_client, isolated_db):
    cookies, tag, *_ = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"shortcut_filters": [_filter(tag_id=tag["id"], icon="box", color="#112233")]})
    assert r.status_code == 200, r.text
    row = r.json()["shortcut_filters"][0]
    assert row["tag_id"] == tag["id"]
    assert row["icon"] == "box" and row["color"] == "#112233"
    assert "collection" not in row
    assert isolated_client.get("/api/me", cookies=cookies).json()["shortcut_filters"][0]["tag_id"] == tag["id"]


def test_shortcut_filter_accepts_none_marker_and_null(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"shortcut_filters": [_filter(id="a", tag_id="__none"), _filter(id="b", tag_id=None), _filter(id="c")]})
    assert r.status_code == 200
    assert [f["tag_id"] for f in r.json()["shortcut_filters"]] == ["__none", None, None]


def test_shortcut_filter_with_an_unknown_tag_id_is_400(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"shortcut_filters": [_filter(tag_id="no-such-tag")]})
    assert r.status_code == 400
    assert "Invalid shortcut filter tag" in r.json()["detail"]
    assert isolated_client.get("/api/me", cookies=cookies).json()["shortcut_filters"] == []


def test_a_tag_name_is_not_accepted_where_an_id_is_required(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    assert _patch(isolated_client, cookies, {"shortcut_filters": [_filter(tag_id="Tools")]}).status_code == 400


def test_the_old_collection_key_in_a_filter_is_dropped_not_validated_or_stored(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    r = _patch(isolated_client, cookies, {"shortcut_filters": [_filter(collection="Ghost collection")]})
    assert r.status_code == 200
    assert "collection" not in r.json()["shortcut_filters"][0]
    db = isolated_db()
    try:
        raw = db.query(User).filter(User.username == "me_tags@example.com").one().shortcut_filters
        assert "collection" not in json.loads(raw)[0]
    finally:
        db.close()


def test_stored_old_collection_keys_are_dropped_when_read(isolated_client, isolated_db):
    cookies, tag, *_ = _setup(isolated_client, isolated_db)
    db = isolated_db()
    try:
        u = db.query(User).filter(User.username == "me_tags@example.com").one()
        u.shortcut_filters = json.dumps([
            {"id": "old", "name": "Old style", "query": "", "collection": "Tools", "pinned": True},
            {"id": "mixed", "name": "Mixed", "query": "", "collection": "Tools", "tag_id": tag["id"]},
        ])
        db.commit()
    finally:
        db.close()
    rows = isolated_client.get("/api/me", cookies=cookies).json()["shortcut_filters"]
    assert [r["tag_id"] for r in rows] == [None, tag["id"]]
    assert all("collection" not in r for r in rows)


def test_the_hundred_filter_cap_still_applies(isolated_client, isolated_db):
    cookies, *_ = _setup(isolated_client, isolated_db)
    many = [_filter(id=f"f{i}", name=f"F{i}") for i in range(101)]
    assert _patch(isolated_client, cookies, {"shortcut_filters": many}).status_code == 400
    assert _patch(isolated_client, cookies, {"shortcut_filters": many[:100]}).status_code == 200
