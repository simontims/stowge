"""Tags: /api/tags CRUD, case-insensitive names, deletion clean-up."""
import json

from conftest import auth_cookies_isolated

from stowge.models import ItemTag, Part, User


def _cookies(isolated_db, name="tags@example.com", **kw):
    return auth_cookies_isolated(isolated_db, name, role=kw.pop("role", "user"), **kw)


def _tag(client, cookies, name, **extra):
    r = client.post("/api/tags", json={"name": name, **extra}, cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()


def _item(client, cookies, name="Thing", **extra):
    r = client.post("/api/items", json={"name": name, **extra}, cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_requires_login(isolated_client):
    assert isolated_client.get("/api/tags").status_code == 401
    assert isolated_client.post("/api/tags", json={"name": "Tools"}).status_code == 401
    assert isolated_client.patch("/api/tags/x", json={}).status_code == 401
    assert isolated_client.delete("/api/tags/x").status_code == 401


def test_create_and_list_returns_the_contract_shape(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    created = _tag(isolated_client, cookies, "Electronics", icon="cpu", color="#60a5fa", description="Devices")
    assert created == {
        "id": created["id"], "name": "Electronics", "icon": "cpu", "color": "#60a5fa",
        "description": "Devices", "item_count": 0,
    }
    listing = isolated_client.get("/api/tags", cookies=cookies).json()
    assert listing == [created]
    assert "ai_hint" not in listing[0]


def test_any_logged_in_user_can_manage_tags(isolated_client, isolated_db):
    cookies = _cookies(isolated_db, role="user")
    tag = _tag(isolated_client, cookies, "Plain user tag")
    assert isolated_client.patch(f"/api/tags/{tag['id']}", json={"name": "Renamed"}, cookies=cookies).status_code == 200
    assert isolated_client.delete(f"/api/tags/{tag['id']}", cookies=cookies).status_code == 200


def test_list_is_ordered_by_creation_not_by_name(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    for name in ("Zebra", "Apple", "Mango"):
        _tag(isolated_client, cookies, name)
    assert [t["name"] for t in isolated_client.get("/api/tags", cookies=cookies).json()] == ["Zebra", "Apple", "Mango"]


def test_duplicate_names_are_rejected_case_insensitively(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    _tag(isolated_client, cookies, "Tools")
    for clash in ("Tools", "tools", "TOOLS"):
        r = isolated_client.post("/api/tags", json={"name": clash}, cookies=cookies)
        assert r.status_code == 400, clash
        assert "already exists" in r.json()["detail"]
    assert len(isolated_client.get("/api/tags", cookies=cookies).json()) == 1


def test_rename_to_a_case_variant_of_another_tag_is_rejected_but_own_case_change_is_fine(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tools = _tag(isolated_client, cookies, "Tools")
    other = _tag(isolated_client, cookies, "Garden")
    assert isolated_client.patch(f"/api/tags/{other['id']}", json={"name": "tOOLS"}, cookies=cookies).status_code == 400
    ok = isolated_client.patch(f"/api/tags/{tools['id']}", json={"name": "TOOLS"}, cookies=cookies)
    assert ok.status_code == 200 and ok.json()["name"] == "TOOLS"


def test_name_needs_at_least_two_characters(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    assert isolated_client.post("/api/tags", json={"name": "x"}, cookies=cookies).status_code == 400
    assert isolated_client.post("/api/tags", json={"name": "  "}, cookies=cookies).status_code == 400
    assert isolated_client.post("/api/tags", json={}, cookies=cookies).status_code == 400
    tag = _tag(isolated_client, cookies, "ok")
    assert isolated_client.patch(f"/api/tags/{tag['id']}", json={"name": "y"}, cookies=cookies).status_code == 400


def test_patch_updates_only_the_fields_sent_and_clears_blank_ones(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tag = _tag(isolated_client, cookies, "Tools", icon="wrench", color="#112233", description="d")
    r = isolated_client.patch(f"/api/tags/{tag['id']}", json={"description": ""}, cookies=cookies)
    assert r.status_code == 200
    assert r.json()["description"] is None and r.json()["icon"] == "wrench" and r.json()["color"] == "#112233"
    r = isolated_client.patch(f"/api/tags/{tag['id']}", json={"icon": "hammer", "color": ""}, cookies=cookies)
    assert r.json()["icon"] == "hammer" and r.json()["color"] is None


def test_unknown_tag_is_404(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    assert isolated_client.patch("/api/tags/nope", json={"name": "Nope"}, cookies=cookies).status_code == 404
    assert isolated_client.delete("/api/tags/nope", cookies=cookies).status_code == 404


def test_item_count_excludes_soft_deleted_items(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tag = _tag(isolated_client, cookies, "Tools")
    keep = _item(isolated_client, cookies, "Keep", tag_ids=[tag["id"]])
    gone = _item(isolated_client, cookies, "Gone", tag_ids=[tag["id"]])
    assert isolated_client.get("/api/tags", cookies=cookies).json()[0]["item_count"] == 2
    isolated_client.delete(f"/api/items/{gone}", cookies=cookies)
    assert isolated_client.get("/api/tags", cookies=cookies).json()[0]["item_count"] == 1
    patched = isolated_client.patch(f"/api/tags/{tag['id']}", json={"description": "x"}, cookies=cookies).json()
    assert patched["item_count"] == 1
    assert keep


def test_delete_untags_items_but_keeps_them(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tools = _tag(isolated_client, cookies, "Tools")
    sale = _tag(isolated_client, cookies, "To Sell")
    item = _item(isolated_client, cookies, "Drill", tag_ids=[tools["id"], sale["id"]])
    deleted_item = _item(isolated_client, cookies, "Binned", tag_ids=[tools["id"]])
    isolated_client.delete(f"/api/items/{deleted_item}", cookies=cookies)

    r = isolated_client.delete(f"/api/tags/{tools['id']}", cookies=cookies)
    assert r.status_code == 200
    # items_untagged counts the active items that lost the tag (the binned one is not an active item)
    assert r.json() == {"ok": True, "items_untagged": 1}

    detail = isolated_client.get(f"/api/items/{item}", cookies=cookies).json()
    assert [t["name"] for t in detail["tags"]] == ["To Sell"]
    assert isolated_client.get("/api/items?tag=Tools", cookies=cookies).json() == []
    db = isolated_db()
    try:
        assert db.query(ItemTag).filter(ItemTag.tag_id == tools["id"]).count() == 0
        assert db.query(Part).count() == 2
    finally:
        db.close()


def test_delete_removes_the_tag_from_every_users_sticky_tags_and_deletes_pinned_filters(isolated_client, isolated_db):
    alice = _cookies(isolated_db, "alice@example.com")
    bob = _cookies(isolated_db, "bob@example.com")
    tools = _tag(isolated_client, alice, "Tools")
    garden = _tag(isolated_client, alice, "Garden")

    def filt(i, tag_id, pinned=True):
        return {"id": f"f{i}", "name": f"Filter {i}", "query": "", "tag_id": tag_id, "pinned": pinned}

    for cookies in (alice, bob):
        r = isolated_client.patch("/api/me", cookies=cookies, json={
            "preferred_add_tag_ids": [tools["id"], garden["id"]],
            "shortcut_filters": [filt(1, tools["id"]), filt(2, garden["id"]), filt(3, tools["id"], pinned=False), filt(4, "__none"), filt(5, None)],
        })
        assert r.status_code == 200, r.text

    assert isolated_client.delete(f"/api/tags/{tools['id']}", cookies=alice).status_code == 200

    for cookies in (alice, bob):
        me = isolated_client.get("/api/me", cookies=cookies).json()
        assert me["preferred_add_tag_ids"] == [garden["id"]]
        assert [f["name"] for f in me["shortcut_filters"]] == ["Filter 2", "Filter 4", "Filter 5"]  # pinned or not, tag filters go


def test_delete_leaves_other_users_without_sticky_tags_alone(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tag = _tag(isolated_client, cookies, "Solo")
    isolated_client.patch("/api/me", cookies=cookies, json={"preferred_add_tag_ids": [tag["id"]]})
    other = _tag(isolated_client, cookies, "Other")
    isolated_client.delete(f"/api/tags/{other['id']}", cookies=cookies)
    assert isolated_client.get("/api/me", cookies=cookies).json()["preferred_add_tag_ids"] == [tag["id"]]
    isolated_client.delete(f"/api/tags/{tag['id']}", cookies=cookies)
    db = isolated_db()
    try:
        assert db.query(User).filter(User.username == "tags@example.com").one().preferred_add_tag_ids is None
    finally:
        db.close()


def test_there_is_no_move_to_option_and_collections_routes_are_gone(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    a = _tag(isolated_client, cookies, "Aaa")
    b = _tag(isolated_client, cookies, "Bbb")
    item = _item(isolated_client, cookies, "Thing", tag_ids=[a["id"]])
    isolated_client.delete(f"/api/tags/{a['id']}?move_to_tag_id={b['id']}", cookies=cookies)
    assert isolated_client.get(f"/api/items/{item}", cookies=cookies).json()["tags"] == []
    for method in ("get", "post"):
        assert getattr(isolated_client, method)("/api/collections", cookies=cookies).status_code in (404, 405)
    assert isolated_client.patch("/api/collections/x", json={}, cookies=cookies).status_code in (404, 405)
    assert isolated_client.delete("/api/collections/x", cookies=cookies).status_code in (404, 405)


def test_shortcut_filters_json_survives_a_malformed_row_when_a_tag_is_deleted(isolated_client, isolated_db):
    cookies = _cookies(isolated_db)
    tag = _tag(isolated_client, cookies, "Tools")
    db = isolated_db()
    try:
        user = db.query(User).filter(User.username == "tags@example.com").one()
        user.shortcut_filters = json.dumps(["junk", {"id": "f", "name": "n", "tag_id": tag["id"]}, {"id": "g", "name": "m"}])
        db.commit()
    finally:
        db.close()
    assert isolated_client.delete(f"/api/tags/{tag['id']}", cookies=cookies).status_code == 200
    assert [f["name"] for f in isolated_client.get("/api/me", cookies=cookies).json()["shortcut_filters"]] == ["m"]


def test_tag_names_cannot_contain_the_csv_separator(isolated_client, isolated_db):
    cookies = _cookies(isolated_db, "semi@example.com")
    r = isolated_client.post("/api/tags", json={"name": "A;B"}, cookies=cookies)
    assert r.status_code == 400 and "';'" in r.json()["detail"]
    tag = _tag(isolated_client, cookies, "Fine")
    assert isolated_client.patch(f"/api/tags/{tag['id']}", json={"name": "x;y"}, cookies=cookies).status_code == 400


def _set_last_open(isolated_db, username, value):
    db = isolated_db()
    try:
        db.query(User).filter(User.username == username).one().last_open_tag = value
        db.commit()
    finally:
        db.close()


def _last_open(isolated_client, cookies):
    return isolated_client.get("/api/me", cookies=cookies).json()["last_open_tag"]


def test_renaming_a_tag_updates_last_open_tag_for_users_who_had_it_open(isolated_client, isolated_db):
    cookies = _cookies(isolated_db, "rename@example.com")
    tag = _tag(isolated_client, cookies, "Cables")
    _set_last_open(isolated_db, "rename@example.com", "cables")  # case differs on purpose
    assert isolated_client.patch(f"/api/tags/{tag['id']}", json={"name": "Leads"}, cookies=cookies).status_code == 200
    assert _last_open(isolated_client, cookies) == "Leads"


def test_deleting_a_tag_clears_last_open_tag(isolated_client, isolated_db):
    cookies = _cookies(isolated_db, "gone@example.com")
    tag = _tag(isolated_client, cookies, "Cables")
    other = _tag(isolated_client, cookies, "Tools")
    _set_last_open(isolated_db, "gone@example.com", "Cables")
    assert isolated_client.delete(f"/api/tags/{other['id']}", cookies=cookies).status_code == 200
    assert _last_open(isolated_client, cookies) == "Cables"  # other tags do not touch it
    assert isolated_client.delete(f"/api/tags/{tag['id']}", cookies=cookies).status_code == 200
    assert _last_open(isolated_client, cookies) is None
