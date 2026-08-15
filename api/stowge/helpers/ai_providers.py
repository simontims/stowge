"""AI provider metadata, model catalogs, and LLM utility functions."""

from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from ..models import LLMConfig

# ---------------------------------------------------------------------------
# Provider Metadata
# ---------------------------------------------------------------------------

AI_PROVIDER_META: dict[str, dict[str, str]] = {
    "openai": {
        "label": "OpenAI",
        "api_base": "https://api.openai.com/v1",
    },
    "anthropic": {
        "label": "Anthropic",
        "api_base": "https://api.anthropic.com",
    },
    "gemini": {
        "label": "Google Gemini",
        "api_base": "https://generativelanguage.googleapis.com",
    },
    "azure": {
        "label": "Azure OpenAI",
        "api_base": "https://YOUR_RESOURCE_NAME.openai.azure.com",
    },
    "groq": {
        "label": "Groq",
        "api_base": "https://api.groq.com/openai/v1",
    },
    "mistral": {
        "label": "Mistral",
        "api_base": "https://api.mistral.ai/v1",
    },
    "xai": {
        "label": "xAI",
        "api_base": "https://api.x.ai/v1",
    },
    "openrouter": {
        "label": "OpenRouter",
        "api_base": "https://openrouter.ai/api/v1",
    },
}

AI_PROVIDER_FALLBACK_MODELS: dict[str, list[str]] = {
    "openai": ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "openai/gpt-4.1"],
    "anthropic": [
        "anthropic/claude-3-5-sonnet-latest",
        "anthropic/claude-3-5-haiku-latest",
        "anthropic/claude-3-opus-latest",
    ],
    "gemini": ["gemini/gemini-1.5-pro", "gemini/gemini-1.5-flash", "gemini/gemini-2.0-flash"],
    "azure": ["azure/YOUR_DEPLOYMENT_NAME", "azure/gpt-4o-mini", "azure/gpt-4.1-mini"],
    "groq": ["groq/llama-3.1-70b-versatile", "groq/llama-3.1-8b-instant", "groq/mixtral-8x7b-32768"],
    "mistral": ["mistral/mistral-large-latest", "mistral/mistral-small-latest", "mistral/open-mixtral-8x22b"],
    "xai": ["xai/grok-2-latest", "xai/grok-beta", "xai/grok-2-mini"],
    "openrouter": [
        "openrouter/openai/gpt-4o-mini",
        "openrouter/anthropic/claude-3.5-sonnet",
        "openrouter/google/gemini-1.5-pro",
    ],
}

# Pattern-based recommendations so suggested models survive LiteLLM catalog updates.
AI_PROVIDER_RECOMMENDED_PATTERNS: dict[str, list[str]] = {
    "openai": ["gpt-4.1", "gpt-4o-mini", "gpt-4.1-mini"],
    "anthropic": ["claude-3-5-sonnet", "claude-3.5-sonnet", "claude-sonnet", "claude-3-5-haiku", "claude-3.5-haiku", "claude-haiku"],
    "gemini": ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"],
    "azure": ["gpt-4.1-mini", "gpt-4o-mini"],
    "groq": ["llama-3.3-70b-versatile", "llama-3.1-70b-versatile", "llama3-70b", "mixtral-8x7b"],
    "mistral": ["mistral-large", "mistral-small"],
    "xai": ["grok-2", "grok"],
    "openrouter": ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-1.5-pro", "gpt-4o-mini", "claude-3.5-sonnet", "gemini-1.5-pro"],
}

# Keep model catalogs relevant to photo identification workflows.
AI_IDENTIFY_ALLOWED_MODES = {"chat", "completion"}
AI_IDENTIFY_EXCLUDED_MODES = {
    "embedding",
    "image_generation",
    "audio_transcription",
    "audio_speech",
    "moderation",
    "rerank",
    "search",
}
AI_IDENTIFY_BLOCKLIST_SUBSTRINGS = (
    "dall-e",
    "whisper",
    "tts",
    "embedding",
    "moderation",
    "rerank",
    "search",
)

OPENAI_COMPATIBLE_DISCOVERY_PROVIDERS = {
    "openai",
    "groq",
    "mistral",
    "xai",
    "openrouter",
}


class ModelDiscoveryError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def normalize_provider(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def normalize_model(value: str) -> str:
    return value.strip()


def normalize_model_for_provider(provider: str, model: str) -> str:
    value = normalize_model(model)
    if normalize_provider(provider) == "openai" and value.lower().startswith("openai/"):
        return value[len("openai/"):]
    return value


def default_api_base_for_provider(provider: str) -> str | None:
    return AI_PROVIDER_META.get(provider, {}).get("api_base")


def _validated_api_base(api_base: str) -> str:
    value = api_base.strip().rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ModelDiscoveryError("API base must be a valid HTTP or HTTPS URL.")
    return value


def _versioned_models_url(api_base: str, version: str) -> str:
    if api_base.endswith(f"/{version}"):
        return f"{api_base}/models"
    return f"{api_base}/{version}/models"


def _normalize_discovered_model(provider: str, model_id: str) -> str:
    value = model_id.strip()
    if provider == "openai":
        return normalize_model_for_provider(provider, value)
    if provider == "gemini":
        value = value.removeprefix("models/")
    prefix = f"{provider}/"
    if value.lower().startswith(prefix):
        return value
    return f"{prefix}{value}"


def _known_vision_models(provider: str) -> set[str]:
    output: set[str] = set()
    try:
        import litellm

        for model_name, metadata in (getattr(litellm, "model_cost", {}) or {}).items():
            if not isinstance(model_name, str) or not isinstance(metadata, dict):
                continue
            if str(metadata.get("litellm_provider") or "").strip().lower() != provider:
                continue
            if metadata.get("supports_vision") is True:
                output.add(_normalize_model_key(provider, model_name))
    except Exception:
        pass
    return output


def _request_discovery_page(
    client: httpx.Client,
    url: str,
    *,
    headers: dict[str, str],
    params: dict[str, str] | None = None,
) -> dict:
    try:
        response = client.get(url, headers=headers, params=params)
    except httpx.TimeoutException as exc:
        raise ModelDiscoveryError("The provider timed out while listing models.") from exc
    except httpx.HTTPError as exc:
        raise ModelDiscoveryError("Unable to connect to the provider model API.") from exc

    if response.status_code in {401, 403}:
        raise ModelDiscoveryError("The provider rejected the API key.", 400)
    if response.status_code == 429:
        raise ModelDiscoveryError("The provider rate-limited model discovery. Try again shortly.", 429)
    if response.status_code >= 400:
        raise ModelDiscoveryError("The provider could not list models.")

    try:
        payload = response.json()
    except ValueError as exc:
        raise ModelDiscoveryError("The provider returned an invalid model list.") from exc
    if not isinstance(payload, dict):
        raise ModelDiscoveryError("The provider returned an invalid model list.")
    return payload


def discover_provider_models(provider: str, api_key: str, api_base: str) -> dict:
    provider = normalize_provider(provider)
    if provider == "azure":
        return {
            "supported": False,
            "models": [],
            "recommended_models": [],
            "unverified_models": [],
            "message": "Azure deployment discovery requires Azure management credentials. Enter the deployment name manually.",
        }
    if provider not in AI_PROVIDER_META:
        raise ModelDiscoveryError("Unsupported AI provider.")
    if not api_key.strip():
        raise ModelDiscoveryError("API key is required.")

    base = _validated_api_base(api_base)
    raw_model_ids: list[str] = []
    timeout = httpx.Timeout(15.0, connect=5.0)

    with httpx.Client(timeout=timeout, follow_redirects=False) as client:
        if provider in OPENAI_COMPATIBLE_DISCOVERY_PROVIDERS:
            payload = _request_discovery_page(
                client,
                f"{base}/models",
                headers={"Authorization": f"Bearer {api_key.strip()}"},
            )
            raw_model_ids = [str(row.get("id") or "") for row in payload.get("data", []) if isinstance(row, dict)]
        elif provider == "anthropic":
            url = _versioned_models_url(base, "v1")
            after_id = ""
            while True:
                params = {"limit": "100"}
                if after_id:
                    params["after_id"] = after_id
                payload = _request_discovery_page(
                    client,
                    url,
                    headers={"x-api-key": api_key.strip(), "anthropic-version": "2023-06-01"},
                    params=params,
                )
                rows = payload.get("data", [])
                raw_model_ids.extend(str(row.get("id") or "") for row in rows if isinstance(row, dict))
                if not payload.get("has_more") or not payload.get("last_id"):
                    break
                after_id = str(payload["last_id"])
        elif provider == "gemini":
            url = _versioned_models_url(base, "v1beta")
            page_token = ""
            while True:
                params = {"key": api_key.strip(), "pageSize": "1000"}
                if page_token:
                    params["pageToken"] = page_token
                payload = _request_discovery_page(client, url, headers={}, params=params)
                rows = payload.get("models", [])
                raw_model_ids.extend(
                    str(row.get("name") or "")
                    for row in rows
                    if isinstance(row, dict) and "generateContent" in (row.get("supportedGenerationMethods") or [])
                )
                page_token = str(payload.get("nextPageToken") or "")
                if not page_token:
                    break

    models = sorted(
        {
            _normalize_discovered_model(provider, model_id)
            for model_id in raw_model_ids
            if model_id.strip() and not any(token in model_id.lower() for token in AI_IDENTIFY_BLOCKLIST_SUBSTRINGS)
        }
    )
    known_vision = _known_vision_models(provider)
    recommended = [model for model in models if _normalize_model_key(provider, model) in known_vision]
    unverified = [model for model in models if model not in recommended]
    return {
        "supported": True,
        "models": models,
        "recommended_models": recommended,
        "unverified_models": unverified,
        "message": f"Found {len(models)} model{'s' if len(models) != 1 else ''}.",
    }


def run_llm_validation(model: str, api_key: str, api_base: str | None) -> str:
    from litellm import completion

    resp = completion(
        model=model,
        messages=[
            {
                "role": "user",
                "content": "Reply with exactly OK.",
            }
        ],
        max_tokens=8,
        temperature=0,
        timeout=20,
        api_key=api_key,
        api_base=api_base,
    )

    try:
        return str(resp.choices[0].message.content or "").strip()[:160]
    except Exception:
        return ""


def litellm_models_by_provider() -> dict[str, list[str]]:
    providers: dict[str, list[tuple[str, dict]]] = {k: [] for k in AI_PROVIDER_META.keys()}
    try:
        import litellm

        model_cost = getattr(litellm, "model_cost", {}) or {}
        for model_name, metadata in model_cost.items():
            if not isinstance(model_name, str) or not isinstance(metadata, dict):
                continue

            provider = str(metadata.get("litellm_provider") or "").strip().lower()
            if provider in providers:
                providers[provider].append((model_name, metadata))
    except Exception:
        pass

    def is_blocked_model_name(model_name: str) -> bool:
        key = model_name.strip().lower()
        return any(token in key for token in AI_IDENTIFY_BLOCKLIST_SUBSTRINGS)

    def is_identify_mode(metadata: dict) -> bool:
        mode = str(metadata.get("mode") or "").strip().lower()
        if mode in AI_IDENTIFY_EXCLUDED_MODES:
            return False
        if mode and mode not in AI_IDENTIFY_ALLOWED_MODES:
            return False
        return True

    def is_vision_capable(metadata: dict) -> bool:
        return bool(metadata.get("supports_vision") is True)

    output: dict[str, list[str]] = {}
    for provider in AI_PROVIDER_META.keys():
        entries = providers.get(provider) or []
        identify_candidates = [
            model_name
            for model_name, metadata in entries
            if not is_blocked_model_name(model_name) and is_identify_mode(metadata)
        ]
        vision_candidates = [
            model_name
            for model_name, metadata in entries
            if not is_blocked_model_name(model_name)
            and is_identify_mode(metadata)
            and is_vision_capable(metadata)
        ]

        # Prefer explicit vision-capable matches when metadata is available.
        models = sorted(set(vision_candidates or identify_candidates))
        if not models:
            fallback_models = [
                model_name
                for model_name in AI_PROVIDER_FALLBACK_MODELS.get(provider, [])
                if not is_blocked_model_name(model_name)
            ]
            models = sorted(set(fallback_models))
        output[provider] = models
    return output


def _normalize_model_key(provider: str, model_name: str) -> str:
    key = (model_name or "").strip().lower()
    prefix = f"{provider.lower()}/"
    if key.startswith(prefix):
        return key[len(prefix):]
    return key


def recommended_models_for_provider(provider: str, models: list[str]) -> list[str]:
    patterns = AI_PROVIDER_RECOMMENDED_PATTERNS.get(provider, [])
    if not patterns or not models:
        return []

    recommended: list[str] = []
    used: set[str] = set()

    for pattern in patterns:
        pattern_key = _normalize_model_key(provider, pattern)
        for candidate in models:
            if candidate in used:
                continue
            candidate_key = _normalize_model_key(provider, candidate)
            if pattern_key in candidate_key:
                recommended.append(candidate)
                used.add(candidate)
                break

    return recommended


def resolve_llm_config(db: Session, selected_id: str | None = None) -> LLMConfig | None:
    if selected_id:
        return db.query(LLMConfig).filter(LLMConfig.id == selected_id).first()

    default_cfg = db.query(LLMConfig).filter(LLMConfig.is_default == 1).first()
    if default_cfg:
        return default_cfg

    return db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).first()
