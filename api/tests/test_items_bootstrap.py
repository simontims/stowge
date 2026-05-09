from conftest import auth_cookies_isolated

from stowge.models import Collection, LLMConfig, Location


def test_items_bootstrap_returns_add_page_dependencies(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "bootstrap_test@example.com", role="admin")

    db = isolated_db()
    try:
        collection = Collection(name="Electronics", icon="cpu", color="#60a5fa", description="Devices")
        location = Location(name="Garage", description="Main shelves")
        llm = LLMConfig(
            name="Primary AI",
            provider="openai",
            model="openai/gpt-4o-mini",
            api_key="secret",
            api_base="https://api.openai.com/v1",
            is_default=1,
            evidence_enabled=1,
            ai_max_edge=1600,
            ai_quality=85,
        )
        db.add_all([collection, location, llm])
        db.commit()
        db.refresh(collection)
        db.refresh(location)
        db.refresh(llm)
    finally:
        db.close()

    response = isolated_client.get("/api/items/bootstrap", cookies=cookies)

    assert response.status_code == 200, response.text
    payload = response.json()

    assert [entry["name"] for entry in payload["collections"]] == ["Electronics"]
    assert [entry["name"] for entry in payload["locations"]] == ["Garage"]
    assert payload["ai_settings"]["default_llm_id"] == llm.id
    assert len(payload["ai_settings"]["configs"]) == 1
    assert payload["ai_settings"]["configs"][0]["name"] == "Primary AI"
    assert payload["ai_settings"]["configs"][0]["ai_max_edge"] == 1600
    assert payload["ai_settings"]["configs"][0]["ai_quality"] == 85


def test_items_bootstrap_collection_count_excludes_soft_deleted_items(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "bootstrap_count_test@example.com", role="admin")

    db = isolated_db()
    try:
        collection = Collection(name="Tools", icon="wrench", color="#60a5fa", description="Workshop tools")
        db.add(collection)
        db.commit()
    finally:
        db.close()

    create_response = isolated_client.post(
        "/api/items",
        json={"name": "Socket Set", "collection": "Tools", "status": "confirmed"},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    item_id = create_response.json()["id"]

    delete_response = isolated_client.delete(f"/api/items/{item_id}", cookies=cookies)
    assert delete_response.status_code == 200, delete_response.text

    response = isolated_client.get("/api/items/bootstrap", cookies=cookies)
    assert response.status_code == 200, response.text
    payload = response.json()

    tools = next(entry for entry in payload["collections"] if entry["name"] == "Tools")
    assert tools["item_count"] == 0