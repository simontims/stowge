from datetime import datetime, timezone

from conftest import auth_cookies_isolated

from stowge.models import LLMConfig


def _create_llm_config(isolated_db, *, validated_at=None) -> LLMConfig:
    db = isolated_db()
    try:
        llm = LLMConfig(
            name="Primary AI",
            provider="openai",
            model="openai/gpt-4o-mini",
            api_key="saved-secret",
            api_base="https://api.openai.com/v1",
            is_default=1,
            evidence_enabled=1,
            ai_max_edge=1600,
            ai_quality=85,
            validated_at=validated_at,
        )
        db.add(llm)
        db.commit()
        db.refresh(llm)
        return llm
    finally:
        db.close()


def test_validate_draft_uses_unsaved_form_values_and_saved_key_fallback(isolated_client, isolated_db, monkeypatch):
    cookies = auth_cookies_isolated(isolated_db, "ai_validate_draft@example.com", role="admin")
    llm = _create_llm_config(isolated_db)

    captured: dict[str, object] = {}

    def fake_run(model: str, api_key: str, api_base: str | None) -> str:
        captured["model"] = model
        captured["api_key"] = api_key
        captured["api_base"] = api_base
        return "OK"

    monkeypatch.setattr("stowge.main._run_llm_validation", fake_run)

    response = isolated_client.post(
        f"/api/admin/settings/ai/{llm.id}/validate-draft",
        cookies=cookies,
        json={
            "provider": "openai",
            "model": "openai/gpt-4.1-mini",
            "api_base": "https://draft.example/v1",
            "api_key": "",  # blank means use saved key
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["provider"] == "openai"
    assert payload["model"] == "openai/gpt-4.1-mini"

    assert captured["model"] == "openai/gpt-4.1-mini"
    assert captured["api_key"] == "saved-secret"
    assert captured["api_base"] == "https://draft.example/v1"

    db = isolated_db()
    try:
        refreshed = db.query(LLMConfig).filter(LLMConfig.id == llm.id).first()
        assert refreshed is not None
        assert refreshed.validated_at is None
    finally:
        db.close()


def test_validate_draft_returns_400_when_no_api_key_available(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "ai_validate_draft_no_key@example.com", role="admin")

    db = isolated_db()
    try:
        llm = LLMConfig(
            name="No Key AI",
            provider="openai",
            model="openai/gpt-4o-mini",
            api_key="",
            api_base="https://api.openai.com/v1",
            is_default=1,
            evidence_enabled=0,
            ai_max_edge=1600,
            ai_quality=85,
        )
        db.add(llm)
        db.commit()
        db.refresh(llm)
        llm_id = llm.id
    finally:
        db.close()

    response = isolated_client.post(
        f"/api/admin/settings/ai/{llm_id}/validate-draft",
        cookies=cookies,
        json={
            "provider": "openai",
            "model": "openai/gpt-4o-mini",
            "api_base": "https://api.openai.com/v1",
            "api_key": "",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "api_key is required"


def test_patch_validation_state_persists_validated_and_not_validated(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "ai_patch_validation_state@example.com", role="admin")
    llm = _create_llm_config(isolated_db)

    mark_validated = isolated_client.patch(
        f"/api/admin/settings/ai/{llm.id}",
        cookies=cookies,
        json={"validation_state": "validated"},
    )
    assert mark_validated.status_code == 200, mark_validated.text
    assert mark_validated.json()["is_validated"] is True
    assert mark_validated.json()["validated_at"] is not None

    db = isolated_db()
    try:
        refreshed = db.query(LLMConfig).filter(LLMConfig.id == llm.id).first()
        assert refreshed is not None
        assert refreshed.validated_at is not None
    finally:
        db.close()

    mark_not_validated = isolated_client.patch(
        f"/api/admin/settings/ai/{llm.id}",
        cookies=cookies,
        json={"validation_state": "not_validated"},
    )
    assert mark_not_validated.status_code == 200, mark_not_validated.text
    assert mark_not_validated.json()["is_validated"] is False
    assert mark_not_validated.json()["validated_at"] is None

    db = isolated_db()
    try:
        refreshed = db.query(LLMConfig).filter(LLMConfig.id == llm.id).first()
        assert refreshed is not None
        assert refreshed.validated_at is None
    finally:
        db.close()


def test_patch_validation_state_validated_overrides_reset_when_model_changes(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "ai_patch_validation_override@example.com", role="admin")
    llm = _create_llm_config(isolated_db, validated_at=datetime.now(timezone.utc))

    response = isolated_client.patch(
        f"/api/admin/settings/ai/{llm.id}",
        cookies=cookies,
        json={
            "model": "openai/gpt-4.1-mini",
            "validation_state": "validated",
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["model"] == "openai/gpt-4.1-mini"
    assert payload["is_validated"] is True
    assert payload["validated_at"] is not None


def test_patch_rejects_invalid_validation_state(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "ai_patch_validation_invalid@example.com", role="admin")
    llm = _create_llm_config(isolated_db)

    response = isolated_client.patch(
        f"/api/admin/settings/ai/{llm.id}",
        cookies=cookies,
        json={"validation_state": "maybe"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "validation_state must be 'validated' or 'not_validated'"
