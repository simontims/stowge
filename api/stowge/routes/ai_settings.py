"""AI/LLM configuration CRUD, provider catalog, identify endpoint.

Also provides shared helpers used by other route modules:
- resolve_llm_config_for_request(db, llm_id) - resolve active LLM config
"""

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import (APIRouter, Depends, File, HTTPException, Query,
                     UploadFile)
from sqlalchemy.orm import Session

from ..auth import current_user, require_admin
from ..db import get_db
from ..helpers.ai_providers import (AI_PROVIDER_META, default_api_base_for_provider,
                                    litellm_models_by_provider, normalize_model,
                                    normalize_provider, recommended_models_for_provider,
                                    resolve_llm_config, run_llm_validation)
from ..helpers.serializers import (list_public_ai_settings_payload,
                                   serialize_llm_admin, serialize_llm_public)
from ..images import process_for_identify
from ..models import Collection, LLMConfig, User
from ..openai_id import identify as openai_identify

router = APIRouter()


def resolve_llm_config_for_request(db: Session, llm_id: str | None = None) -> LLMConfig | None:
    """Public wrapper so other route modules can resolve LLM config."""
    return resolve_llm_config(db, llm_id)


# ---------------------------------------------------------------------------
# Public AI Settings
# ---------------------------------------------------------------------------

@router.get("/api/settings/ai")
def list_ai_settings(db: Session = Depends(get_db), me: User = Depends(current_user)):
    return list_public_ai_settings_payload(db)


# ---------------------------------------------------------------------------
# Admin AI Settings
# ---------------------------------------------------------------------------

@router.get("/api/admin/settings/ai")
def list_ai_settings_admin(db: Session = Depends(get_db), me: User = Depends(require_admin)):
    configs = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).all()
    active = resolve_llm_config(db)
    return {
        "default_llm_id": active.id if active else None,
        "configs": [serialize_llm_admin(c) for c in configs],
    }


@router.get("/api/admin/settings/ai/providers")
def list_ai_providers_catalog(me: User = Depends(require_admin)):
    models_by_provider = litellm_models_by_provider()
    providers = []
    for provider, meta in AI_PROVIDER_META.items():
        models = models_by_provider.get(provider, [])
        recommended = recommended_models_for_provider(provider, models)
        providers.append(
            {
                "value": provider,
                "label": meta["label"],
                "api_base": meta["api_base"],
                "models": models,
                "recommended_models": recommended,
            }
        )
    return {"providers": providers}


@router.post("/api/admin/settings/ai")
def create_ai_setting(payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    name = str(payload.get("name") or "").strip()
    provider = normalize_provider(str(payload.get("provider") or ""))
    model = normalize_model(str(payload.get("model") or ""))
    api_key = str(payload.get("api_key") or "").strip()
    api_base = str(payload.get("api_base") or "").strip()
    is_default = bool(payload.get("is_default", False))
    evidence_enabled = bool(payload.get("evidence_enabled", False))

    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    if not model:
        raise HTTPException(status_code=400, detail="model is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")
    if not api_base:
        api_base = default_api_base_for_provider(provider) or ""
    if not api_base:
        raise HTTPException(status_code=400, detail="api_base is required")

    cfg = LLMConfig(
        name=name,
        provider=provider,
        model=model,
        api_key=api_key,
        api_base=api_base,
        is_default=1 if is_default else 0,
        evidence_enabled=1 if evidence_enabled else 0,
        ai_max_edge=int(payload.get("ai_max_edge") or 1600),
        ai_quality=int(payload.get("ai_quality") or 85),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(cfg)
    db.flush()

    total = db.query(LLMConfig).count()
    if total == 1:
        cfg.is_default = 1
    elif cfg.is_default:
        db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})

    db.commit()
    db.refresh(cfg)
    return serialize_llm_admin(cfg)


@router.patch("/api/admin/settings/ai/{config_id}")
def update_ai_setting(config_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    if "name" in payload:
        next_name = str(payload.get("name") or "").strip()
        if not next_name:
            raise HTTPException(status_code=400, detail="name is required")
        cfg.name = next_name

    provider_updated = False
    validation_needs_reset = False
    if "provider" in payload:
        next_provider = normalize_provider(str(payload.get("provider") or ""))
        if not next_provider:
            raise HTTPException(status_code=400, detail="provider is required")
        if cfg.provider != next_provider:
            validation_needs_reset = True
        cfg.provider = next_provider
        provider_updated = True

    if "model" in payload:
        next_model = normalize_model(str(payload.get("model") or ""))
        if not next_model:
            raise HTTPException(status_code=400, detail="model is required")
        if cfg.model != next_model:
            validation_needs_reset = True
        cfg.model = next_model

    if "api_key" in payload:
        next_key = str(payload.get("api_key") or "").strip()
        if next_key:
            validation_needs_reset = True
            cfg.api_key = next_key

    if "api_base" in payload:
        next_api_base = str(payload.get("api_base") or "").strip() or None
        if (cfg.api_base or "") != (next_api_base or ""):
            validation_needs_reset = True
        cfg.api_base = next_api_base

    if provider_updated and not (cfg.api_base or "").strip():
        cfg.api_base = default_api_base_for_provider(cfg.provider)

    if not (cfg.api_base or "").strip():
        raise HTTPException(status_code=400, detail="api_base is required")

    if bool(payload.get("is_default", False)):
        db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})
        cfg.is_default = 1

    if "evidence_enabled" in payload:
        cfg.evidence_enabled = 1 if bool(payload.get("evidence_enabled")) else 0

    if "ai_max_edge" in payload:
        v = int(payload["ai_max_edge"] or 1600)
        if not (64 <= v <= 4096):
            raise HTTPException(status_code=400, detail="ai_max_edge must be 64-4096")
        cfg.ai_max_edge = v

    if "ai_quality" in payload:
        v = int(payload["ai_quality"] or 85)
        if not (1 <= v <= 100):
            raise HTTPException(status_code=400, detail="ai_quality must be 1-100")
        cfg.ai_quality = v

    validation_state = payload.get("validation_state")
    if validation_state is not None and validation_state not in {"validated", "not_validated"}:
        raise HTTPException(status_code=400, detail="validation_state must be 'validated' or 'not_validated'")

    if validation_state == "validated":
        cfg.validated_at = datetime.now(timezone.utc)
    elif validation_state == "not_validated":
        cfg.validated_at = None
    elif validation_needs_reset:
        cfg.validated_at = None

    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cfg)
    return serialize_llm_admin(cfg)


@router.post("/api/admin/settings/ai/{config_id}/default")
def set_default_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    db.query(LLMConfig).filter(LLMConfig.id != cfg.id).update({"is_default": 0})
    cfg.is_default = 1
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(cfg)
    return serialize_llm_admin(cfg)


@router.post("/api/admin/settings/ai/{config_id}/validate")
def validate_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    try:
        preview = run_llm_validation(cfg.model, cfg.api_key, cfg.api_base)

        cfg.validated_at = datetime.now(timezone.utc)
        cfg.updated_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "ok": True,
            "provider": cfg.provider,
            "model": cfg.model,
            "response_preview": preview[:160],
        }
    except Exception as e:
        cfg.validated_at = None
        cfg.updated_at = datetime.now(timezone.utc)
        db.commit()
        raise HTTPException(status_code=400, detail=f"Validation failed: {e}")


@router.post("/api/admin/settings/ai/{config_id}/validate-draft")
def validate_ai_setting_draft(config_id: str, payload: dict, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    provider = normalize_provider(str(payload.get("provider") or cfg.provider or ""))
    model = normalize_model(str(payload.get("model") or cfg.model or ""))
    api_base = str(payload.get("api_base") or cfg.api_base or "").strip()
    api_key_input = str(payload.get("api_key") or "").strip()
    api_key = api_key_input or (cfg.api_key or "")

    if not provider:
        raise HTTPException(status_code=400, detail="provider is required")
    if not model:
        raise HTTPException(status_code=400, detail="model is required")
    if not api_base:
        api_base = default_api_base_for_provider(provider) or ""
    if not api_base:
        raise HTTPException(status_code=400, detail="api_base is required")
    if not api_key:
        raise HTTPException(status_code=400, detail="api_key is required")

    try:
        preview = run_llm_validation(model, api_key, api_base)
        return {
            "ok": True,
            "provider": provider,
            "model": model,
            "response_preview": preview,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Validation failed: {e}")


@router.delete("/api/admin/settings/ai/{config_id}")
def delete_ai_setting(config_id: str, db: Session = Depends(get_db), me: User = Depends(require_admin)):
    cfg = db.query(LLMConfig).filter(LLMConfig.id == config_id).first()
    if not cfg:
        raise HTTPException(status_code=404, detail="AI config not found")

    was_default = bool(cfg.is_default)
    db.delete(cfg)
    db.flush()

    if was_default:
        replacement = db.query(LLMConfig).order_by(LLMConfig.created_at.asc()).first()
        if replacement:
            replacement.is_default = 1
            replacement.updated_at = datetime.now(timezone.utc)

    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Identify
# ---------------------------------------------------------------------------

@router.post("/api/identify")
def identify(
    mode: Literal["one", "three", "five"] = "one",
    llm_id: Optional[str] = Query(default=None),
    collection_id: Optional[str] = Query(default=None),
    images: List[UploadFile] = File(...),
    me: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if len(images) < 1 or len(images) > 5:
        raise HTTPException(status_code=400, detail="Provide 1 to 5 images")

    cfg = resolve_llm_config(db, llm_id)
    if not cfg:
        raise HTTPException(status_code=400, detail="No AI models configured. Add one under Settings / AI.")

    b64s = process_for_identify(
        images,
        max_edge=cfg.ai_max_edge if cfg.ai_max_edge is not None else 1600,
        quality=cfg.ai_quality if cfg.ai_quality is not None else 85,
    )

    collection_context: Optional[str] = None
    if collection_id:
        selected_collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not selected_collection:
            raise HTTPException(status_code=400, detail="Invalid collection_id")

        context_parts = [f"Collection name: {selected_collection.name}"]
        if (selected_collection.ai_hint or "").strip():
            context_parts.append(f"Collection hint: {selected_collection.ai_hint.strip()}")
        collection_context = "\n".join(context_parts)

    ai_mode = mode if mode in ("one", "three", "five") else "one"
    ai = openai_identify(
        b64s,
        llm_config={
            "model": cfg.model,
            "api_key": cfg.api_key,
            "api_base": cfg.api_base,
        },
        mode=ai_mode,
        include_evidence=bool(cfg.evidence_enabled),
        collection_context=collection_context,
    )

    return {
        "mode": mode,
        "llm": serialize_llm_public(cfg),
        "ai": ai,
        "uploaded_images": [],
        "stored_images": [],
    }
