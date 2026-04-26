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