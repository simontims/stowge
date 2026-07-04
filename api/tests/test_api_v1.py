from conftest import auth_cookies_isolated


EXTERNAL_BASE = "/external-api/v1"


def _create_key(isolated_client, admin_cookies, scopes):
    response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Integration key",
            "key_type": "system",
            "scopes": scopes,
        },
        cookies=admin_cookies,
    )
    assert response.status_code == 200, response.text
    return response.json()["api_key"]


def _seed_inventory(isolated_client, admin_cookies):
    collection_resp = isolated_client.post(
        "/api/collections",
        json={"name": "Tools", "description": "Garage tools"},
        cookies=admin_cookies,
    )
    assert collection_resp.status_code == 200, collection_resp.text
    collection_id = collection_resp.json()["id"]

    location_resp = isolated_client.post(
        "/api/locations",
        json={"name": "Garage"},
        cookies=admin_cookies,
    )
    assert location_resp.status_code == 200, location_resp.text
    location_id = location_resp.json()["id"]

    item_resp = isolated_client.post(
        "/api/items",
        json={
            "name": "Socket Wrench",
            "description": "Engine tools",
            "collection": "Tools",
            "location_id": location_id,
            "status": "confirmed",
            "quantity": 2,
        },
        cookies=admin_cookies,
    )
    assert item_resp.status_code == 200, item_resp.text
    item_id = item_resp.json()["id"]

    return collection_id, location_id, item_id


def test_external_v1_read_operations_and_scope_enforcement(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin@example.com", role="admin")
    _seed_inventory(isolated_client, admin_cookies)

    key = _create_key(isolated_client, admin_cookies, ["items.read"])
    headers = {"Authorization": f"Bearer {key}"}

    items = isolated_client.get(f"{EXTERNAL_BASE}/items?q=socket", headers=headers)
    assert items.status_code == 200, items.text
    payload = items.json()
    assert len(payload) == 1
    assert payload[0]["name"] == "Socket Wrench"

    collections_denied = isolated_client.get(f"{EXTERNAL_BASE}/collections", headers=headers)
    assert collections_denied.status_code == 403


def test_external_v1_collections_locations_nested_and_item_detail(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin-2@example.com", role="admin")
    collection_id, location_id, item_id = _seed_inventory(isolated_client, admin_cookies)

    key = _create_key(
        isolated_client,
        admin_cookies,
        ["items.read", "collections.read", "locations.read"],
    )
    headers = {"Authorization": f"Bearer {key}"}

    collections = isolated_client.get(f"{EXTERNAL_BASE}/collections", headers=headers)
    assert collections.status_code == 200, collections.text
    assert len(collections.json()) == 1

    locations = isolated_client.get(f"{EXTERNAL_BASE}/locations", headers=headers)
    assert locations.status_code == 200, locations.text
    assert len(locations.json()) == 1

    item_detail = isolated_client.get(f"{EXTERNAL_BASE}/items/{item_id}", headers=headers)
    assert item_detail.status_code == 200, item_detail.text
    assert item_detail.json()["id"] == item_id

    collection_items = isolated_client.get(f"{EXTERNAL_BASE}/collections/{collection_id}/items", headers=headers)
    assert collection_items.status_code == 200, collection_items.text
    assert len(collection_items.json()) == 1

    location_items = isolated_client.get(f"{EXTERNAL_BASE}/locations/{location_id}/items", headers=headers)
    assert location_items.status_code == 200, location_items.text
    assert len(location_items.json()) == 1


def test_external_v1_full_crud_for_items_collections_and_locations(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin-3@example.com", role="admin")

    key = _create_key(
        isolated_client,
        admin_cookies,
        [
            "items.read",
            "items.write",
            "items.delete",
            "collections.read",
            "collections.write",
            "collections.delete",
            "locations.read",
            "locations.write",
            "locations.delete",
        ],
    )
    headers = {"Authorization": f"Bearer {key}"}

    create_collection = isolated_client.post(
        f"{EXTERNAL_BASE}/collections",
        json={"name": "Bins", "description": "Storage bins"},
        headers=headers,
    )
    assert create_collection.status_code == 200, create_collection.text
    collection_id = create_collection.json()["id"]

    list_collections = isolated_client.get(f"{EXTERNAL_BASE}/collections", headers=headers)
    assert list_collections.status_code == 200, list_collections.text
    assert any(row["id"] == collection_id for row in list_collections.json())

    get_collection = isolated_client.get(f"{EXTERNAL_BASE}/collections/{collection_id}", headers=headers)
    assert get_collection.status_code == 200, get_collection.text
    assert get_collection.json()["name"] == "Bins"

    patch_collection = isolated_client.patch(
        f"{EXTERNAL_BASE}/collections/{collection_id}",
        json={"description": "Organized storage bins"},
        headers=headers,
    )
    assert patch_collection.status_code == 200, patch_collection.text
    assert patch_collection.json()["description"] == "Organized storage bins"

    create_location = isolated_client.post(
        f"{EXTERNAL_BASE}/locations",
        json={"name": "Shed"},
        headers=headers,
    )
    assert create_location.status_code == 200, create_location.text
    location_id = create_location.json()["id"]

    list_locations = isolated_client.get(f"{EXTERNAL_BASE}/locations", headers=headers)
    assert list_locations.status_code == 200, list_locations.text
    assert any(row["id"] == location_id for row in list_locations.json())

    get_location = isolated_client.get(f"{EXTERNAL_BASE}/locations/{location_id}", headers=headers)
    assert get_location.status_code == 200, get_location.text
    assert get_location.json()["name"] == "Shed"

    patch_location = isolated_client.patch(
        f"{EXTERNAL_BASE}/locations/{location_id}",
        json={"description": "Backyard shed"},
        headers=headers,
    )
    assert patch_location.status_code == 200, patch_location.text
    assert patch_location.json()["description"] == "Backyard shed"

    create_item = isolated_client.post(
        f"{EXTERNAL_BASE}/items",
        json={
            "name": "Cable Ties",
            "collection": "Bins",
            "location_id": location_id,
            "status": "confirmed",
            "quantity": 10,
        },
        headers=headers,
    )
    assert create_item.status_code == 200, create_item.text
    item_id = create_item.json()["id"]

    list_items = isolated_client.get(f"{EXTERNAL_BASE}/items?q=cable", headers=headers)
    assert list_items.status_code == 200, list_items.text
    assert any(row["id"] == item_id for row in list_items.json())

    get_item = isolated_client.get(f"{EXTERNAL_BASE}/items/{item_id}", headers=headers)
    assert get_item.status_code == 200, get_item.text
    assert get_item.json()["name"] == "Cable Ties"

    patch_item = isolated_client.patch(
        f"{EXTERNAL_BASE}/items/{item_id}",
        json={"quantity": 20},
        headers=headers,
    )
    assert patch_item.status_code == 200, patch_item.text
    assert patch_item.json()["quantity"] == 20

    delete_item = isolated_client.delete(f"{EXTERNAL_BASE}/items/{item_id}", headers=headers)
    assert delete_item.status_code == 200, delete_item.text

    deleted_item_get = isolated_client.get(f"{EXTERNAL_BASE}/items/{item_id}", headers=headers)
    assert deleted_item_get.status_code == 404, deleted_item_get.text

    deleted_item_list = isolated_client.get(f"{EXTERNAL_BASE}/items?q=cable", headers=headers)
    assert deleted_item_list.status_code == 200, deleted_item_list.text
    assert all(row["id"] != item_id for row in deleted_item_list.json())

    delete_collection = isolated_client.delete(f"{EXTERNAL_BASE}/collections/{collection_id}", headers=headers)
    assert delete_collection.status_code == 200, delete_collection.text

    deleted_collection_get = isolated_client.get(f"{EXTERNAL_BASE}/collections/{collection_id}", headers=headers)
    assert deleted_collection_get.status_code == 404, deleted_collection_get.text

    deleted_collection_list = isolated_client.get(f"{EXTERNAL_BASE}/collections", headers=headers)
    assert deleted_collection_list.status_code == 200, deleted_collection_list.text
    assert all(row["id"] != collection_id for row in deleted_collection_list.json())

    delete_location = isolated_client.delete(f"{EXTERNAL_BASE}/locations/{location_id}", headers=headers)
    assert delete_location.status_code == 200, delete_location.text

    deleted_location_get = isolated_client.get(f"{EXTERNAL_BASE}/locations/{location_id}", headers=headers)
    assert deleted_location_get.status_code == 404, deleted_location_get.text

    deleted_location_list = isolated_client.get(f"{EXTERNAL_BASE}/locations", headers=headers)
    assert deleted_location_list.status_code == 200, deleted_location_list.text
    assert all(row["id"] != location_id for row in deleted_location_list.json())


def test_external_v1_requires_bearer_token(isolated_client):
    response = isolated_client.get(f"{EXTERNAL_BASE}/items")
    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token"


def test_external_docs_expose_only_external_surface(isolated_client):
    docs_response = isolated_client.get("/external-api/openapi.json")
    assert docs_response.status_code == 200, docs_response.text

    openapi = docs_response.json()
    assert "paths" in openapi
    paths = set(openapi["paths"].keys())

    assert "/v1/items" in paths
    assert "/v1/collections" in paths
    assert "/v1/locations" in paths

    assert "/api/login" not in paths
    assert "/api/admin/maintenance/schedules" not in paths
    assert "/api/api-keys" not in paths
