import httpx

from conftest import auth_cookies_isolated

from stowge.helpers.ai_providers import ModelDiscoveryError, discover_provider_models
from stowge.models import LLMConfig

HTTPX_CLIENT = httpx.Client


def _mock_client(monkeypatch, handler):
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "stowge.helpers.ai_providers.httpx.Client",
        lambda **kwargs: HTTPX_CLIENT(transport=transport, **kwargs),
    )


def test_openai_compatible_discovery_normalizes_and_filters_models(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://api.openai.com/v1/models"
        assert request.headers["Authorization"] == "Bearer secret-key"
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "chatgpt-4o-latest"},
                    {"id": "chatgpt-4o-latest"},
                    {"id": "text-embedding-3-small"},
                ]
            },
        )

    _mock_client(monkeypatch, handler)
    monkeypatch.setattr(
        "stowge.helpers.ai_providers._known_vision_models",
        lambda provider: {"chatgpt-4o-latest"},
    )

    result = discover_provider_models("openai", "secret-key", "https://api.openai.com/v1")

    assert result["supported"] is True
    assert result["models"] == ["chatgpt-4o-latest"]
    assert result["recommended_models"] == ["chatgpt-4o-latest"]
    assert result["unverified_models"] == []


def test_anthropic_discovery_paginates(monkeypatch):
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["x-api-key"] == "anthropic-secret"
        assert request.headers["anthropic-version"] == "2023-06-01"
        if request.url.params.get("after_id") is None:
            return httpx.Response(200, json={"data": [{"id": "claude-a"}], "has_more": True, "last_id": "claude-a"})
        return httpx.Response(200, json={"data": [{"id": "claude-b"}], "has_more": False})

    _mock_client(monkeypatch, handler)
    monkeypatch.setattr("stowge.helpers.ai_providers._known_vision_models", lambda provider: set())

    result = discover_provider_models("anthropic", "anthropic-secret", "https://api.anthropic.com")

    assert len(requests) == 2
    assert str(requests[0].url).startswith("https://api.anthropic.com/v1/models?")
    assert requests[1].url.params["after_id"] == "claude-a"
    assert result["models"] == ["anthropic/claude-a", "anthropic/claude-b"]
    assert result["unverified_models"] == result["models"]


def test_gemini_discovery_keeps_generate_content_models(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["key"] == "gemini-secret"
        return httpx.Response(
            200,
            json={
                "models": [
                    {"name": "models/gemini-flash", "supportedGenerationMethods": ["generateContent"]},
                    {"name": "models/text-embedding", "supportedGenerationMethods": ["embedContent"]},
                ]
            },
        )

    _mock_client(monkeypatch, handler)
    monkeypatch.setattr("stowge.helpers.ai_providers._known_vision_models", lambda provider: {"gemini-flash"})

    result = discover_provider_models("gemini", "gemini-secret", "https://generativelanguage.googleapis.com")

    assert result["models"] == ["gemini/gemini-flash"]
    assert result["recommended_models"] == ["gemini/gemini-flash"]


def test_azure_discovery_returns_manual_fallback():
    result = discover_provider_models("azure", "azure-secret", "https://example.openai.azure.com")

    assert result["supported"] is False
    assert result["models"] == []
    assert "manually" in result["message"]


def test_discovery_auth_error_does_not_expose_key(monkeypatch):
    _mock_client(monkeypatch, lambda request: httpx.Response(401, json={"error": "bad key"}))

    try:
        discover_provider_models("openai", "do-not-leak", "https://api.openai.com/v1")
        raise AssertionError("Expected discovery to fail")
    except ModelDiscoveryError as exc:
        assert exc.status_code == 400
        assert "do-not-leak" not in str(exc)
        assert "rejected" in str(exc)


def test_discovery_timeout_returns_form_level_error(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    _mock_client(monkeypatch, handler)

    try:
        discover_provider_models("openai", "do-not-leak", "https://api.openai.com/v1")
        raise AssertionError("Expected discovery to fail")
    except ModelDiscoveryError as exc:
        assert exc.status_code == 400
        assert str(exc) == "The provider timed out while listing models."


def test_discovery_rejects_malformed_provider_response(monkeypatch):
    _mock_client(monkeypatch, lambda request: httpx.Response(200, content=b"not-json"))

    try:
        discover_provider_models("openai", "do-not-leak", "https://api.openai.com/v1")
        raise AssertionError("Expected discovery to fail")
    except ModelDiscoveryError as exc:
        assert exc.status_code == 400
        assert "do-not-leak" not in str(exc)
        assert "invalid model list" in str(exc)


def test_discovery_endpoint_requires_admin(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "discovery_user@example.com", role="user")

    response = isolated_client.post(
        "/api/admin/settings/ai/models/discover",
        cookies=cookies,
        json={"provider": "openai", "api_key": "secret", "api_base": "https://api.openai.com/v1"},
    )

    assert response.status_code == 403


def test_discovery_endpoint_uses_unsaved_credentials_without_database_write(isolated_client, isolated_db, monkeypatch):
    cookies = auth_cookies_isolated(isolated_db, "discovery_admin@example.com", role="admin")
    captured = {}

    def fake_discover(provider: str, api_key: str, api_base: str) -> dict:
        captured.update(provider=provider, api_key=api_key, api_base=api_base)
        return {
            "supported": True,
            "models": ["openai/gpt-4o-mini"],
            "recommended_models": ["openai/gpt-4o-mini"],
            "unverified_models": [],
            "message": "Found 1 model.",
        }

    monkeypatch.setattr("stowge.routes.ai_settings.discover_provider_models", fake_discover)

    response = isolated_client.post(
        "/api/admin/settings/ai/models/discover",
        cookies=cookies,
        json={"provider": " OpenAI ", "api_key": "draft-secret", "api_base": "https://draft.example/v1"},
    )

    assert response.status_code == 200, response.text
    assert captured == {
        "provider": "openai",
        "api_key": "draft-secret",
        "api_base": "https://draft.example/v1",
    }
    db = isolated_db()
    try:
        assert db.query(LLMConfig).count() == 0
    finally:
        db.close()
