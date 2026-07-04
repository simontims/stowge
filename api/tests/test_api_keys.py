from conftest import auth_cookies_isolated


def test_admin_can_create_list_and_revoke_api_key(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin@example.com", role="admin")

    create_response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Home Assistant",
            "key_type": "system",
            "scopes": ["items.read", "collections.read", "locations.read"],
        },
        cookies=admin_cookies,
    )

    assert create_response.status_code == 200, create_response.text
    body = create_response.json()
    assert "api_key" in body
    assert body["api_key"].startswith("stgk_")
    assert body["record"]["name"] == "Home Assistant"
    assert body["record"]["status"] == "active"
    assert body["record"]["key_type"] == "system"

    list_response = isolated_client.get("/api/api-keys", cookies=admin_cookies)
    assert list_response.status_code == 200, list_response.text
    list_body = list_response.json()
    assert len(list_body) == 1
    assert list_body[0]["name"] == "Home Assistant"
    assert "api_key" not in list_body[0]

    revoke_response = isolated_client.post(
        f"/api/api-keys/{body['record']['id']}/revoke",
        json={"reason": "integration rotated"},
        cookies=admin_cookies,
    )
    assert revoke_response.status_code == 200, revoke_response.text
    assert revoke_response.json()["status"] == "revoked"

    denied = isolated_client.get(
        "/external-api/v1/items",
        headers={"Authorization": f"Bearer {body['api_key']}"},
    )
    assert denied.status_code == 401


def test_non_admin_cannot_manage_api_keys(isolated_client, isolated_db):
    user_cookies = auth_cookies_isolated(isolated_db, "api-keys-user@example.com", role="user")

    response = isolated_client.get("/api/api-keys", cookies=user_cookies)
    assert response.status_code == 403


def test_create_user_key_requires_user_id(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin-2@example.com", role="admin")

    response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Broken User Key",
            "key_type": "user",
            "scopes": ["items.read"],
        },
        cookies=admin_cookies,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "user_id is required for user key_type"


def test_create_rejects_unknown_scope(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin-3@example.com", role="admin")

    response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Unknown Scope",
            "key_type": "system",
            "scopes": ["items.read", "explode.everything"],
        },
        cookies=admin_cookies,
    )

    assert response.status_code == 400
    assert "Unsupported scope" in response.json()["detail"]


def test_create_accepts_write_scope(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin-4@example.com", role="admin")

    response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Write Scope Too Early",
            "key_type": "system",
            "scopes": ["items.read", "items.write"],
        },
        cookies=admin_cookies,
    )

    assert response.status_code == 200, response.text


def test_admin_can_delete_revoked_api_key(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin-5@example.com", role="admin")

    create_response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Temporary Key",
            "key_type": "system",
            "scopes": ["items.read"],
        },
        cookies=admin_cookies,
    )
    assert create_response.status_code == 200, create_response.text
    key_id = create_response.json()["record"]["id"]

    revoke_response = isolated_client.post(
        f"/api/api-keys/{key_id}/revoke",
        json={"reason": "cleanup"},
        cookies=admin_cookies,
    )
    assert revoke_response.status_code == 200, revoke_response.text
    assert revoke_response.json()["status"] == "revoked"

    delete_response = isolated_client.delete(f"/api/api-keys/{key_id}", cookies=admin_cookies)
    assert delete_response.status_code == 200, delete_response.text
    assert delete_response.json()["ok"] is True

    list_response = isolated_client.get("/api/api-keys", cookies=admin_cookies)
    assert list_response.status_code == 200, list_response.text
    assert all(row["id"] != key_id for row in list_response.json())


def test_delete_active_api_key_is_rejected(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "api-keys-admin-6@example.com", role="admin")

    create_response = isolated_client.post(
        "/api/api-keys",
        json={
            "name": "Still Active",
            "key_type": "system",
            "scopes": ["items.read"],
        },
        cookies=admin_cookies,
    )
    assert create_response.status_code == 200, create_response.text
    key_id = create_response.json()["record"]["id"]

    delete_response = isolated_client.delete(f"/api/api-keys/{key_id}", cookies=admin_cookies)
    assert delete_response.status_code == 400
    assert delete_response.json()["detail"] == "API key must be revoked before deletion"
