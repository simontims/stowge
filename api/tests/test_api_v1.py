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
    tag_resp = isolated_client.post(
        "/api/tags",
        json={"name": "Tools", "description": "Garage tools"},
        cookies=admin_cookies,
    )
    assert tag_resp.status_code == 200, tag_resp.text
    tag_id = tag_resp.json()["id"]

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
            "tag_ids": [tag_id],
            "location_id": location_id,
            "status": "confirmed",
            "quantity": 2,
        },
        cookies=admin_cookies,
    )
    assert item_resp.status_code == 200, item_resp.text
    item_id = item_resp.json()["id"]

    return tag_id, location_id, item_id


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

    tags_denied = isolated_client.get(f"{EXTERNAL_BASE}/tags", headers=headers)
    assert tags_denied.status_code == 403
    assert tags_denied.json()["detail"]["missing_scopes"] == ["tags.read"]


def test_external_v1_tags_locations_nested_and_item_detail(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin-2@example.com", role="admin")
    tag_id, location_id, item_id = _seed_inventory(isolated_client, admin_cookies)

    key = _create_key(
        isolated_client,
        admin_cookies,
        ["items.read", "tags.read", "locations.read"],
    )
    headers = {"Authorization": f"Bearer {key}"}

    tags = isolated_client.get(f"{EXTERNAL_BASE}/tags", headers=headers)
    assert tags.status_code == 200, tags.text
    assert len(tags.json()) == 1
    assert tags.json()[0]["item_count"] == 1

    locations = isolated_client.get(f"{EXTERNAL_BASE}/locations", headers=headers)
    assert locations.status_code == 200, locations.text
    assert len(locations.json()) == 1

    item_detail = isolated_client.get(f"{EXTERNAL_BASE}/items/{item_id}", headers=headers)
    assert item_detail.status_code == 200, item_detail.text
    assert item_detail.json()["id"] == item_id
    assert item_detail.json()["tags"] == ["Tools"]
    assert "collection" not in item_detail.json()

    tag_items = isolated_client.get(f"{EXTERNAL_BASE}/items?tag=tools", headers=headers)
    assert tag_items.status_code == 200, tag_items.text
    assert len(tag_items.json()) == 1

    location_items = isolated_client.get(f"{EXTERNAL_BASE}/locations/{location_id}/items", headers=headers)
    assert location_items.status_code == 200, location_items.text
    assert len(location_items.json()) == 1


def test_external_v1_full_crud_for_items_tags_and_locations(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin-3@example.com", role="admin")

    key = _create_key(
        isolated_client,
        admin_cookies,
        [
            "items.read",
            "items.write",
            "items.delete",
            "tags.read",
            "tags.write",
            "tags.delete",
            "locations.read",
            "locations.write",
            "locations.delete",
        ],
    )
    headers = {"Authorization": f"Bearer {key}"}

    create_tag = isolated_client.post(
        f"{EXTERNAL_BASE}/tags",
        json={"name": "Bins", "description": "Storage bins"},
        headers=headers,
    )
    assert create_tag.status_code == 200, create_tag.text
    tag_id = create_tag.json()["id"]

    list_tags = isolated_client.get(f"{EXTERNAL_BASE}/tags", headers=headers)
    assert list_tags.status_code == 200, list_tags.text
    assert any(row["id"] == tag_id for row in list_tags.json())

    get_tag = isolated_client.get(f"{EXTERNAL_BASE}/tags/{tag_id}", headers=headers)
    assert get_tag.status_code == 200, get_tag.text
    assert get_tag.json()["name"] == "Bins"

    patch_tag = isolated_client.patch(
        f"{EXTERNAL_BASE}/tags/{tag_id}",
        json={"description": "Organized storage bins"},
        headers=headers,
    )
    assert patch_tag.status_code == 200, patch_tag.text
    assert patch_tag.json()["description"] == "Organized storage bins"

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
            "tags": ["bins"],
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
    assert get_item.json()["tags"] == ["Bins"]

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

    delete_tag = isolated_client.delete(f"{EXTERNAL_BASE}/tags/{tag_id}", headers=headers)
    assert delete_tag.status_code == 200, delete_tag.text

    deleted_tag_get = isolated_client.get(f"{EXTERNAL_BASE}/tags/{tag_id}", headers=headers)
    assert deleted_tag_get.status_code == 404, deleted_tag_get.text

    deleted_tag_list = isolated_client.get(f"{EXTERNAL_BASE}/tags", headers=headers)
    assert deleted_tag_list.status_code == 200, deleted_tag_list.text
    assert all(row["id"] != tag_id for row in deleted_tag_list.json())

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


def test_external_v1_sites_areas_and_location_hierarchy(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "v1-admin-4@example.com", role="admin")

    key = _create_key(
        isolated_client,
        admin_cookies,
        [
            "locations.read",
            "locations.write",
            "locations.delete",
        ],
    )
    headers = {"Authorization": f"Bearer {key}"}

    create_site = isolated_client.post(
        f"{EXTERNAL_BASE}/sites",
        json={"name": "Boat", "description": "Marina site"},
        headers=headers,
    )
    assert create_site.status_code == 200, create_site.text
    site_id = create_site.json()["id"]

    list_sites = isolated_client.get(f"{EXTERNAL_BASE}/sites", headers=headers)
    assert list_sites.status_code == 200, list_sites.text
    assert any(site["id"] == site_id for site in list_sites.json())

    create_area = isolated_client.post(
        f"{EXTERNAL_BASE}/areas",
        json={"name": "Engine Bay", "site_id": site_id},
        headers=headers,
    )
    assert create_area.status_code == 200, create_area.text
    area_id = create_area.json()["id"]
    assert create_area.json()["site_id"] == site_id

    list_areas = isolated_client.get(f"{EXTERNAL_BASE}/areas?site_id={site_id}", headers=headers)
    assert list_areas.status_code == 200, list_areas.text
    assert any(area["id"] == area_id for area in list_areas.json())

    create_location = isolated_client.post(
        f"{EXTERNAL_BASE}/locations",
        json={"name": "Port Locker", "area_id": area_id},
        headers=headers,
    )
    assert create_location.status_code == 200, create_location.text
    location_id = create_location.json()["id"]
    assert create_location.json()["area_id"] == area_id
    assert create_location.json()["site_id"] == site_id

    list_locations_by_area = isolated_client.get(
        f"{EXTERNAL_BASE}/locations?area_id={area_id}",
        headers=headers,
    )
    assert list_locations_by_area.status_code == 200, list_locations_by_area.text
    assert any(location["id"] == location_id for location in list_locations_by_area.json())

    list_locations_by_site = isolated_client.get(
        f"{EXTERNAL_BASE}/locations?site_id={site_id}",
        headers=headers,
    )
    assert list_locations_by_site.status_code == 200, list_locations_by_site.text
    assert any(location["id"] == location_id for location in list_locations_by_site.json())

    delete_location = isolated_client.delete(f"{EXTERNAL_BASE}/locations/{location_id}", headers=headers)
    assert delete_location.status_code == 200, delete_location.text

    delete_area = isolated_client.delete(f"{EXTERNAL_BASE}/areas/{area_id}", headers=headers)
    assert delete_area.status_code == 200, delete_area.text

    delete_site = isolated_client.delete(f"{EXTERNAL_BASE}/sites/{site_id}", headers=headers)
    assert delete_site.status_code == 200, delete_site.text


def test_external_docs_expose_only_external_surface(isolated_client):
    docs_response = isolated_client.get("/external-api/openapi.json")
    assert docs_response.status_code == 200, docs_response.text

    openapi = docs_response.json()
    assert "paths" in openapi
    paths = set(openapi["paths"].keys())

    assert "/v1/items" in paths
    assert "/v1/tags" in paths
    assert "/v1/collections" not in paths
    assert not any(path.startswith("/v1/collections") for path in paths)
    assert "/v1/locations" in paths
    assert "/v1/sites" in paths
    assert "/v1/areas" in paths

    assert "/api/login" not in paths
    assert "/api/admin/maintenance/schedules" not in paths
    assert "/api/api-keys" not in paths
