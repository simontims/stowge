"""External API: /v1/tags, item tags by name, the clean break from collections, scope migration."""
import pytest
from conftest import auth_cookies_isolated

from stowge.api_key_auth import ACTIVE_API_KEY_SCOPES, ALLOWED_API_KEY_SCOPES

BASE = "/external-api/v1"
ALL = ["items.read", "items.write", "items.delete", "tags.read", "tags.write", "tags.delete", "locations.read"]
REMOVED = "collection is no longer supported; use tags"


@pytest.fixture
def api(isolated_client, isolated_db):
    admin = auth_cookies_isolated(isolated_db, "v1tags@example.com", role="admin")

    def key(scopes=ALL):
        r = isolated_client.post("/api/api-keys", json={"name": "k", "key_type": "system", "scopes": scopes}, cookies=admin)
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['api_key']}"}

    return isolated_client, admin, key


def test_scope_sets_have_tags_and_no_collections():
    for scopes in (ALLOWED_API_KEY_SCOPES, ACTIVE_API_KEY_SCOPES):
        assert {"tags.read", "tags.write", "tags.delete"} <= scopes
        assert not [s for s in scopes if s.startswith("collections.")]


@pytest.mark.parametrize("scope", ["collections.read", "collections.write", "collections.delete"])
def test_creating_a_key_with_a_collections_scope_is_rejected(api, scope):
    client, admin, _key = api
    r = client.post("/api/api-keys", json={"name": "k", "key_type": "system", "scopes": ["items.read", scope]}, cookies=admin)
    assert r.status_code == 400
    assert "Unsupported scope" in r.json()["detail"]


def test_tags_crud_with_the_same_fields_as_the_internal_api(api):
    client, admin, key = api
    h = key()
    created = client.post(f"{BASE}/tags", json={"name": "Bins", "icon": "box", "color": "#123456", "description": "Storage"}, headers=h)
    assert created.status_code == 200, created.text
    tag = created.json()
    assert tag == {"id": tag["id"], "name": "Bins", "icon": "box", "color": "#123456", "description": "Storage", "item_count": 0}
    assert client.get(f"{BASE}/tags/{tag['id']}", headers=h).json() == tag
    assert client.get(f"{BASE}/tags", headers=h).json() == [tag]
    patched = client.patch(f"{BASE}/tags/{tag['id']}", json={"name": "Boxes"}, headers=h).json()
    assert patched["name"] == "Boxes"
    internal = client.get("/api/tags", cookies=admin).json()[0]
    assert internal == patched
    assert client.delete(f"{BASE}/tags/{tag['id']}", headers=h).json() == {"ok": True, "items_untagged": 0}
    assert client.get(f"{BASE}/tags/{tag['id']}", headers=h).status_code == 404
    assert client.patch(f"{BASE}/tags/{tag['id']}", json={"name": "Zz"}, headers=h).status_code == 404
    assert client.delete(f"{BASE}/tags/{tag['id']}", headers=h).status_code == 404


def test_tag_names_are_case_insensitively_unique_over_the_external_api(api):
    client, _admin, key = api
    h = key()
    client.post(f"{BASE}/tags", json={"name": "Tools"}, headers=h)
    assert client.post(f"{BASE}/tags", json={"name": "TOOLS"}, headers=h).status_code == 400
    other = client.post(f"{BASE}/tags", json={"name": "Garden"}, headers=h).json()
    assert client.patch(f"{BASE}/tags/{other['id']}", json={"name": "tools"}, headers=h).status_code == 400
    assert client.post(f"{BASE}/tags", json={"name": "x"}, headers=h).status_code == 400


def test_each_tag_operation_needs_its_own_scope(api):
    client, _admin, key = api
    full = key()
    tag = client.post(f"{BASE}/tags", json={"name": "Tools"}, headers=full).json()
    read_only = key(["tags.read"])
    assert client.get(f"{BASE}/tags", headers=read_only).status_code == 200
    for call in (
        lambda: client.post(f"{BASE}/tags", json={"name": "Abc"}, headers=read_only),
        lambda: client.patch(f"{BASE}/tags/{tag['id']}", json={"name": "Abc"}, headers=read_only),
        lambda: client.delete(f"{BASE}/tags/{tag['id']}", headers=read_only),
    ):
        r = call()
        assert r.status_code == 403
    no_tags = key(["items.read"])
    r = client.get(f"{BASE}/tags", headers=no_tags)
    assert r.status_code == 403 and r.json()["detail"]["missing_scopes"] == ["tags.read"]
    assert client.delete(f"{BASE}/tags/{tag['id']}", headers=key(["tags.write"])).status_code == 403


def test_collections_endpoints_are_gone(api):
    client, _admin, key = api
    h = key()
    for method, path in (("get", "/collections"), ("post", "/collections"), ("get", "/collections/x"),
                         ("patch", "/collections/x"), ("delete", "/collections/x"), ("get", "/collections/x/items")):
        r = getattr(client, method)(f"{BASE}{path}", headers=h, **({"json": {"name": "Abc"}} if method in ("post", "patch") else {}))
        assert r.status_code in (404, 405), (method, path, r.status_code)
    paths = client.get("/external-api/openapi.json").json()["paths"]
    assert not [p for p in paths if "collection" in p]


def test_items_read_and_write_tags_as_names(api):
    client, _admin, key = api
    h = key()
    for name in ("Electronics", "To Sell"):
        client.post(f"{BASE}/tags", json={"name": name}, headers=h)
    created = client.post(f"{BASE}/items", json={"name": "Multimeter", "tags": ["to sell", "Electronics", "ELECTRONICS"]}, headers=h)
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["tags"] == ["Electronics", "To Sell"]  # names with their stored casing, ordered by name, deduplicated
    assert "collection" not in body
    assert client.get(f"{BASE}/items/{body['id']}", headers=h).json()["tags"] == ["Electronics", "To Sell"]
    assert client.get(f"{BASE}/items", headers=h).json()[0]["tags"] == ["Electronics", "To Sell"]


def test_patch_replaces_the_tag_list_and_empty_list_clears(api):
    client, _admin, key = api
    h = key()
    for name in ("Aaa", "Bbb"):
        client.post(f"{BASE}/tags", json={"name": name}, headers=h)
    item = client.post(f"{BASE}/items", json={"name": "Thing", "tags": ["Aaa"]}, headers=h).json()
    assert client.patch(f"{BASE}/items/{item['id']}", json={"tags": ["Bbb"]}, headers=h).json()["tags"] == ["Bbb"]
    assert client.patch(f"{BASE}/items/{item['id']}", json={"quantity": 3}, headers=h).json()["tags"] == ["Bbb"]
    assert client.patch(f"{BASE}/items/{item['id']}", json={"tags": []}, headers=h).json()["tags"] == []


def test_unknown_tag_names_are_a_400_and_never_auto_created(api):
    client, _admin, key = api
    h = key()
    client.post(f"{BASE}/tags", json={"name": "Known"}, headers=h)
    r = client.post(f"{BASE}/items", json={"name": "Thing", "tags": ["Known", "Brand new"]}, headers=h)
    assert r.status_code == 400 and "Brand new" in r.json()["detail"]
    assert client.get(f"{BASE}/items", headers=h).json() == []
    item = client.post(f"{BASE}/items", json={"name": "Thing", "tags": ["Known"]}, headers=h).json()
    r = client.patch(f"{BASE}/items/{item['id']}", json={"tags": ["Brand new"]}, headers=h)
    assert r.status_code == 400
    assert [t["name"] for t in client.get(f"{BASE}/tags", headers=h).json()] == ["Known"]
    assert client.get(f"{BASE}/items/{item['id']}", headers=h).json()["tags"] == ["Known"]
    assert client.post(f"{BASE}/items", json={"name": "Thing", "tags": "Known"}, headers=h).status_code == 400


def test_a_body_with_collection_is_rejected_with_the_exact_message(api):
    client, _admin, key = api
    h = key()
    for payload in ({"name": "Thing", "collection": "Tools"}, {"name": "Thing", "collection": ""}, {"name": "Thing", "collection": None},
                    {"name": "Thing", "tags": [], "collection": "Tools"}):
        r = client.post(f"{BASE}/items", json=payload, headers=h)
        assert r.status_code == 400, payload
        assert r.json()["detail"] == REMOVED
    item = client.post(f"{BASE}/items", json={"name": "Thing"}, headers=h).json()
    r = client.patch(f"{BASE}/items/{item['id']}", json={"collection": "Tools"}, headers=h)
    assert r.status_code == 400 and r.json()["detail"] == REMOVED
    r = client.patch(f"{BASE}/items/{item['id']}", json={"name": "Renamed", "collection": "Tools"}, headers=h)
    assert r.status_code == 400
    assert client.get(f"{BASE}/items/{item['id']}", headers=h).json()["name"] == "Thing"  # the rest of the body was not applied
    assert len(client.get(f"{BASE}/items", headers=h).json()) == 1


def test_item_tag_filter_is_repeatable_and_supports_none(api):
    client, _admin, key = api
    h = key()
    for name in ("Aaa", "Bbb"):
        client.post(f"{BASE}/tags", json={"name": name}, headers=h)
    client.post(f"{BASE}/items", json={"name": "Both", "tags": ["Aaa", "Bbb"]}, headers=h)
    client.post(f"{BASE}/items", json={"name": "OnlyA", "tags": ["Aaa"]}, headers=h)
    client.post(f"{BASE}/items", json={"name": "Neither"}, headers=h)

    def names(query):
        r = client.get(f"{BASE}/items?{query}", headers=h)
        assert r.status_code == 200, r.text
        return sorted(i["name"] for i in r.json())

    assert names("tag=aaa") == ["Both", "OnlyA"]
    assert names("tag=Aaa&tag=Bbb") == ["Both"]
    assert names("tag=__none") == ["Neither"]
    assert names("tag=Ghost") == []
    assert names("q=bbb") == ["Both"]  # search matches tag names
    assert client.get(f"{BASE}/items?collection=Aaa", headers=h).status_code == 400  # refused, not silently ignored


def test_tag_item_count_and_delete_untag_items_and_clean_users(api):
    client, admin, key = api
    h = key()
    tag = client.post(f"{BASE}/tags", json={"name": "Bins"}, headers=h).json()
    client.post(f"{BASE}/items", json={"name": "One", "tags": ["Bins"]}, headers=h)
    gone = client.post(f"{BASE}/items", json={"name": "Two", "tags": ["Bins"]}, headers=h).json()
    client.delete(f"{BASE}/items/{gone['id']}", headers=h)
    assert client.get(f"{BASE}/tags/{tag['id']}", headers=h).json()["item_count"] == 1  # soft-deleted not counted
    client.patch("/api/me", cookies=admin, json={"preferred_add_tag_ids": [tag["id"]],
                                                 "shortcut_filters": [{"id": "x", "name": "Bins", "tag_id": tag["id"], "pinned": True}]})
    assert client.delete(f"{BASE}/tags/{tag['id']}", headers=h).json() == {"ok": True, "items_untagged": 1}
    assert client.get(f"{BASE}/items", headers=h).json()[0]["tags"] == []
    me = client.get("/api/me", cookies=admin).json()
    assert me["preferred_add_tag_ids"] == [] and me["shortcut_filters"] == []


def test_listing_items_with_the_old_collection_parameter_is_refused_not_ignored(api):
    client, _admin, key = api
    h = key()
    r = client.get(f"{BASE}/items?collection=Electronics", headers=h)
    assert r.status_code == 400 and r.json()["detail"] == REMOVED
    assert client.get(f"{BASE}/items?tag=Electronics", headers=h).status_code == 200


def test_tag_ids_in_an_external_write_is_refused_and_semicolons_in_names_too(api):
    client, _admin, key = api
    h = key()
    assert client.post(f"{BASE}/items", json={"name": "Thing", "tag_ids": ["x"]}, headers=h).status_code == 400
    assert client.post(f"{BASE}/tags", json={"name": "A;B"}, headers=h).status_code == 400
