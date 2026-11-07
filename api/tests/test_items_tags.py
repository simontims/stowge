"""Items and tags: tag_ids on create/patch, the tag filter, tag search, tag sort, item JSON shape."""
from conftest import auth_cookies_isolated

from stowge.models import ItemTag, Part


def _setup(isolated_client, isolated_db, user="items_tags@example.com"):
    cookies = auth_cookies_isolated(isolated_db, user, role="admin")
    tags = {}
    for name in ("Electronics", "To Sell", "tools", "Camping"):
        r = isolated_client.post("/api/tags", json={"name": name, "icon": "box", "color": "#112233"}, cookies=cookies)
        assert r.status_code == 200, r.text
        tags[name] = r.json()["id"]
    return cookies, tags


def _create(client, cookies, name, tag_ids=None, **extra):
    payload = {"name": name, **extra}
    if tag_ids is not None:
        payload["tag_ids"] = tag_ids
    r = client.post("/api/items", json=payload, cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _names(response):
    assert response.status_code == 200, response.text
    return [i["name"] for i in response.json()]


def test_create_with_tag_ids_returns_tags_ordered_by_name_case_insensitively(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Multimeter", [tags["tools"], tags["To Sell"], tags["Electronics"]])
    detail = isolated_client.get(f"/api/items/{item}", cookies=cookies).json()
    assert detail["tags"] == [
        {"id": tags["Electronics"], "name": "Electronics", "icon": "box", "color": "#112233"},
        {"id": tags["To Sell"], "name": "To Sell", "icon": "box", "color": "#112233"},
        {"id": tags["tools"], "name": "tools", "icon": "box", "color": "#112233"},  # "tools" sorts with the T's, not after Z
    ]
    listed = isolated_client.get("/api/items", cookies=cookies).json()[0]
    assert [t["name"] for t in listed["tags"]] == ["Electronics", "To Sell", "tools"]


def test_the_collection_field_is_gone_from_item_json(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Thing", [tags["Camping"]], collection="Camping")
    assert "collection" not in isolated_client.get(f"/api/items/{item}", cookies=cookies).json()
    assert "collection" not in isolated_client.get("/api/items", cookies=cookies).json()[0]
    deleted = isolated_client.delete(f"/api/items/{item}", cookies=cookies)
    assert deleted.status_code == 200
    assert "collection" not in isolated_client.get("/api/items/deleted", cookies=cookies).json()[0]
    restored = isolated_client.post(f"/api/items/{item}/restore", cookies=cookies).json()["item"]
    assert "collection" not in restored
    assert [t["name"] for t in restored["tags"]] == ["Camping"]


def test_collection_in_a_create_payload_is_not_stored(isolated_client, isolated_db):
    cookies, _tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Thing", collection="Whatever")
    db = isolated_db()
    try:
        assert db.query(Part).filter(Part.id == item).one().collection is None
    finally:
        db.close()


def test_unknown_tag_id_is_400_and_creates_nothing(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    r = isolated_client.post("/api/items", json={"name": "Thing", "tag_ids": [tags["tools"], "nope"]}, cookies=cookies)
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid tag"
    assert isolated_client.get("/api/items", cookies=cookies).json() == []
    assert isolated_client.post("/api/items", json={"name": "Thing", "tag_ids": "tools"}, cookies=cookies).status_code == 400
    assert isolated_client.post("/api/items", json={"name": "Thing", "tag_ids": [""]}, cookies=cookies).status_code == 400


def test_duplicate_tag_ids_are_ignored(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Thing", [tags["tools"], tags["tools"]])
    assert len(isolated_client.get(f"/api/items/{item}", cookies=cookies).json()["tags"]) == 1


def test_patch_replaces_the_whole_list_and_empty_clears(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Thing", [tags["tools"], tags["Camping"]])

    r = isolated_client.patch(f"/api/items/{item}", json={"tag_ids": [tags["Electronics"]]}, cookies=cookies)
    assert r.status_code == 200
    assert [t["name"] for t in isolated_client.get(f"/api/items/{item}", cookies=cookies).json()["tags"]] == ["Electronics"]

    isolated_client.patch(f"/api/items/{item}", json={"name": "Renamed"}, cookies=cookies)  # no tag_ids: untouched
    assert [t["name"] for t in isolated_client.get(f"/api/items/{item}", cookies=cookies).json()["tags"]] == ["Electronics"]

    isolated_client.patch(f"/api/items/{item}", json={"tag_ids": []}, cookies=cookies)
    assert isolated_client.get(f"/api/items/{item}", cookies=cookies).json()["tags"] == []
    db = isolated_db()
    try:
        assert db.query(ItemTag).filter(ItemTag.item_id == item).count() == 0
    finally:
        db.close()


def test_patch_with_an_unknown_tag_is_400_and_keeps_the_old_tags(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Thing", [tags["tools"]])
    r = isolated_client.patch(f"/api/items/{item}", json={"tag_ids": ["nope"], "name": "Changed"}, cookies=cookies)
    assert r.status_code == 400 and r.json()["detail"] == "Invalid tag"
    detail = isolated_client.get(f"/api/items/{item}", cookies=cookies).json()
    assert [t["name"] for t in detail["tags"]] == ["tools"]
    assert detail["name"] == "Thing"


def test_tag_filter_by_name_is_case_insensitive(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Drill", [tags["tools"]])
    _create(isolated_client, cookies, "Tent", [tags["Camping"]])
    assert _names(isolated_client.get("/api/items?tag=TOOLS", cookies=cookies)) == ["Drill"]
    assert _names(isolated_client.get("/api/items?tag=tools", cookies=cookies)) == ["Drill"]


def test_repeated_tag_filter_is_an_and(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Both", [tags["Electronics"], tags["To Sell"]])
    _create(isolated_client, cookies, "OnlyElectronics", [tags["Electronics"]])
    _create(isolated_client, cookies, "OnlySale", [tags["To Sell"]])
    assert sorted(_names(isolated_client.get("/api/items?tag=Electronics", cookies=cookies))) == ["Both", "OnlyElectronics"]
    assert _names(isolated_client.get("/api/items?tag=Electronics&tag=To%20Sell", cookies=cookies)) == ["Both"]


def test_none_filter_finds_untagged_items_only(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Tagged", [tags["tools"]])
    _create(isolated_client, cookies, "Loose")
    assert _names(isolated_client.get("/api/items?tag=__none", cookies=cookies)) == ["Loose"]
    # untagged AND a named tag can never match
    assert _names(isolated_client.get("/api/items?tag=__none&tag=tools", cookies=cookies)) == []


def test_unknown_tag_name_gives_an_empty_result_not_an_error(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Tagged", [tags["tools"]])
    assert _names(isolated_client.get("/api/items?tag=Nonexistent", cookies=cookies)) == []
    assert _names(isolated_client.get("/api/items?tag=tools&tag=Nonexistent", cookies=cookies)) == []


def test_old_collection_query_param_no_longer_filters(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Aa", [tags["tools"]])
    _create(isolated_client, cookies, "Bb")
    assert sorted(_names(isolated_client.get("/api/items?collection=tools", cookies=cookies))) == ["Aa", "Bb"]


def test_soft_deleted_items_never_appear_under_a_tag(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Binned", [tags["tools"]])
    isolated_client.delete(f"/api/items/{item}", cookies=cookies)
    assert _names(isolated_client.get("/api/items?tag=tools", cookies=cookies)) == []
    assert _names(isolated_client.get("/api/items?tag=__none", cookies=cookies)) == []
    assert _names(isolated_client.get("/api/items/deleted", cookies=cookies)) == ["Binned"]


def test_search_matches_tag_names_and_the_item_appears_once(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Hex driver", [tags["tools"], tags["To Sell"]])
    _create(isolated_client, cookies, "Travel adapter", [tags["Electronics"]])
    _create(isolated_client, cookies, "Unrelated")
    assert _names(isolated_client.get("/api/items?q=electro", cookies=cookies)) == ["Travel adapter"]
    assert _names(isolated_client.get("/api/items?q=sell", cookies=cookies)) == ["Hex driver"]
    assert _names(isolated_client.get("/api/items?q=to", cookies=cookies)).count("Hex driver") == 1  # matches two tags, one row
    assert _names(isolated_client.get("/api/items?q=driver", cookies=cookies)) == ["Hex driver"]


def test_deleted_items_search_also_matches_tag_names(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Old saw", [tags["tools"]])
    isolated_client.delete(f"/api/items/{item}", cookies=cookies)
    assert _names(isolated_client.get("/api/items/deleted?q=tools", cookies=cookies)) == ["Old saw"]
    assert _names(isolated_client.get("/api/items/deleted?q=zzz", cookies=cookies)) == []


def test_sort_by_tags_uses_the_first_tag_name_with_untagged_last(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Loose one")
    _create(isolated_client, cookies, "In tools", [tags["tools"]])
    _create(isolated_client, cookies, "In camping and tools", [tags["tools"], tags["Camping"]])
    _create(isolated_client, cookies, "In electronics", [tags["Electronics"]])

    asc = _names(isolated_client.get("/api/items?sort_by=tags&sort_dir=asc", cookies=cookies))
    assert asc == ["In camping and tools", "In electronics", "In tools", "Loose one"]
    desc = _names(isolated_client.get("/api/items?sort_by=tags&sort_dir=desc", cookies=cookies))
    assert desc == ["In tools", "In electronics", "In camping and tools", "Loose one"]  # untagged still last


def test_old_collection_sort_key_falls_back_to_name(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    _create(isolated_client, cookies, "Bbb", [tags["Camping"]])
    _create(isolated_client, cookies, "Aaa", [tags["tools"]])
    assert _names(isolated_client.get("/api/items?sort_by=collection", cookies=cookies)) == ["Aaa", "Bbb"]


def test_hard_deleting_items_removes_their_tag_links(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    item = _create(isolated_client, cookies, "Doomed", [tags["tools"], tags["Camping"]])
    isolated_client.delete(f"/api/items/{item}", cookies=cookies)
    assert isolated_client.post("/api/items/deleted/purge", cookies=cookies).json() == {"deleted": 1}
    db = isolated_db()
    try:
        assert db.query(ItemTag).count() == 0
    finally:
        db.close()


def test_bootstrap_carries_tags_and_hints_instead_of_collections(isolated_client, isolated_db):
    cookies, tags = _setup(isolated_client, isolated_db)
    payload = isolated_client.get("/api/items/bootstrap", cookies=cookies).json()
    assert "collections" not in payload
    assert [t["name"] for t in payload["tags"]] == ["Electronics", "To Sell", "tools", "Camping"]
    assert set(payload["tags"][0]) == {"id", "name", "icon", "color", "description", "item_count"}
    assert [h["name"] for h in payload["hints"]] == ["Default"]
    assert payload["hints"][0]["is_default"] is True
