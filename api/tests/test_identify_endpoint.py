from io import BytesIO

from conftest import auth_cookies_isolated

from stowge.models import LLMConfig


def test_identify_uses_selected_llm_config_without_server_error(isolated_client, isolated_db, monkeypatch):
    cookies = auth_cookies_isolated(isolated_db, "identify_test@example.com", role="admin")

    db = isolated_db()
    try:
        llm = LLMConfig(
            name="Primary AI",
            provider="openai",
            model="openai/gpt-4o-mini",
            api_key="secret",
            api_base="https://api.openai.com/v1",
            is_default=1,
            evidence_enabled=1,
            ai_max_edge=1234,
            ai_quality=77,
        )
        db.add(llm)
        db.commit()
        db.refresh(llm)
        llm_id = llm.id
    finally:
        db.close()

    captured: dict[str, object] = {}

    def fake_process_for_identify(images, max_edge=1600, quality=85):
        captured["image_count"] = len(images)
        captured["max_edge"] = max_edge
        captured["quality"] = quality
        return ["ZmFrZQ=="]

    def fake_openai_identify(b64s, llm_config, mode, include_evidence, collection_context=None):
        captured["llm_config"] = llm_config
        captured["mode"] = mode
        captured["include_evidence"] = include_evidence
        captured["collection_context"] = collection_context
        return {"candidates": [{"name": "Widget", "confidence": 0.9}]}

    monkeypatch.setattr("stowge.main.process_for_identify", fake_process_for_identify)
    monkeypatch.setattr("stowge.main.openai_identify", fake_openai_identify)

    response = isolated_client.post(
        f"/api/identify?mode=three&llm_id={llm_id}",
        cookies=cookies,
        files={"images": ("photo.jpg", BytesIO(b"fake-image"), "image/jpeg")},
    )

    assert response.status_code == 200, response.text
    payload = response.json()

    assert payload["mode"] == "three"
    assert payload["llm"]["id"] == llm_id
    assert payload["ai"]["candidates"][0]["name"] == "Widget"
    assert captured["image_count"] == 1
    assert captured["max_edge"] == 1234
    assert captured["quality"] == 77
    assert captured["mode"] == "three"
    assert captured["include_evidence"] is True