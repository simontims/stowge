"""AI provider metadata, model catalogs, and LLM utility functions."""

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


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def normalize_provider(value: str) -> str:
    return value.strip().lower().replace(" ", "_")


def normalize_model(value: str) -> str:
    return value.strip()


def default_api_base_for_provider(provider: str) -> str | None:
    return AI_PROVIDER_META.get(provider, {}).get("api_base")


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
