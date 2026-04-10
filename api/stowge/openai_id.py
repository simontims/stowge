import json
import re
from typing import Any, Dict, List, Literal, Optional

from fastapi import HTTPException
from litellm import completion

Mode = Literal["one", "many", "five", "three"]

LITELLM_TIMEOUT = 45.0

SYSTEM_PROMPT_BASE = (
    "You are an assistant helping inventory items from photos.\n"
    "Be conservative: if you cannot read markings or cannot confidently identify, set unknown=true.\n"
    "Prefer a practical inventory name over a perfect part number.\n\n"
    "Return concise results:\n"
    "- unknown: true|false\n"
    "- name: short label (e.g., \"ESP32-WROOM-32 Dev Module\", \"AMS1117-3.3 Regulator Module\")\n"
    "- description: 1-3 sentences with key markings/features and what to verify. "
    "Do NOT start the description with 'This is a', 'This is an', 'This is', or similar phrasing — write directly about the item.\n"
    "- collection: module|ic|connector|sensor|passive|devboard|cable|tool|unknown\n"
    "- confidence: 0..1\n"
)

def _system_prompt(include_evidence: bool) -> str:
    if include_evidence:
        return SYSTEM_PROMPT_BASE + "- evidence: the markings you read and visual cues you used\n"
    return SYSTEM_PROMPT_BASE


def _json_schema_one(include_evidence: bool) -> Dict[str, Any]:
    required = ["unknown", "name", "description", "collection", "confidence"]
    properties: Dict[str, Any] = {
        "unknown": {"type": "boolean"},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "collection": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
    }
    if include_evidence:
        required.append("evidence")
        properties["evidence"] = {"type": "string"}

    return {
        "type": "object",
        "additionalProperties": False,
        "required": required,
        "properties": properties,
    }


def _json_schema_three(include_evidence: bool) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["candidates"],
        "properties": {
            "candidates": {
                "type": "array",
                "minItems": 1,
                "maxItems": 3,
                "items": _json_schema_one(include_evidence),
            }
        },
    }


def _json_schema_five(include_evidence: bool) -> Dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["candidates"],
        "properties": {
            "candidates": {
                "type": "array",
                "minItems": 5,
                "maxItems": 5,
                "items": _json_schema_one(include_evidence),
            }
        },
    }

_ALLOWED_COLLECTIONS = {
    "module",
    "ic",
    "connector",
    "sensor",
    "passive",
    "devboard",
    "cable",
    "tool",
    "unknown",
}

_JSON_ONLY_INSTRUCTION = (
    "Return STRICT JSON only. No markdown, no code fences, no commentary. JSON only."
)


def _schema_instruction(mode: Mode, include_evidence: bool) -> str:
    if mode == "three":
        return (
            f"{_JSON_ONLY_INSTRUCTION}\n"
            "You must return an object matching this JSON schema:\n"
            f"{json.dumps(_json_schema_three(include_evidence))}\n"
            "Return only candidates you can genuinely identify or clear alternatives.\n"
            "Do NOT include filler items with unknown confidence. Return 1, 2, or 3 items as appropriate.\n"
            "If the first item is very confident and you cannot identify genuine alternatives, return just 1.\n"
        )
    if mode in ("many", "five"):
        return (
            f"{_JSON_ONLY_INSTRUCTION}\n"
            "You must return an object matching this JSON schema:\n"
            f"{json.dumps(_json_schema_five(include_evidence))}\n"
            "Provide exactly 5 candidates, best first.\n"
        )
    return (
        f"{_JSON_ONLY_INSTRUCTION}\n"
        "You must return an object matching this JSON schema:\n"
        f"{json.dumps(_json_schema_one(include_evidence))}\n"
        "Pick the single best guess even if uncertain.\n"
    )


def _extract_json(text: str) -> str:
    """
    Tries to recover JSON if the model wraps it in text.
    We first try raw parse, then fenced blocks, then first {...} span.
    """
    t = (text or "").strip()
    if not t:
        return ""

    # If it's already JSON, keep it.
    if t.startswith("{") and t.endswith("}"):
        return t

    # Strip ```json ... ``` fences
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", t, flags=re.DOTALL | re.IGNORECASE)
    if m:
        return m.group(1).strip()

    # Find the first top-level {...} block (best-effort)
    m = re.search(r"(\{.*\})", t, flags=re.DOTALL)
    if m:
        return m.group(1).strip()

    return ""


def _coerce_and_sanitize_one(obj: Dict[str, Any], include_evidence: bool) -> Dict[str, Any]:
    # Provide safe defaults / coercions
    unknown = bool(obj.get("unknown", False))
    name = str(obj.get("name", "")).strip()
    description = str(obj.get("description", "")).strip()
    collection = str(obj.get("collection", "unknown")).strip().lower()
    evidence = str(obj.get("evidence", "")).strip()

    try:
        confidence = float(obj.get("confidence", 0.0))
    except Exception:
        confidence = 0.0

    confidence = max(0.0, min(1.0, confidence))
    if collection not in _ALLOWED_COLLECTIONS:
        collection = "unknown"

    if not name:
        # If name missing, force unknown
        unknown = True
        name = "Unknown part"
    if not description:
        description = "No description provided."
    out: Dict[str, Any] = {
        "unknown": unknown,
        "name": name,
        "description": description,
        "collection": collection,
        "confidence": confidence,
    }
    if include_evidence:
        if not evidence:
            evidence = "No clear markings or distinctive features could be confirmed."
        out["evidence"] = evidence
    return out


def _sanitize(mode: Mode, parsed: Dict[str, Any], include_evidence: bool) -> Dict[str, Any]:
    if mode == "three":
        cands = parsed.get("candidates", [])
        if not isinstance(cands, list):
            cands = []
        # Allow 1-3 items, no padding
        cands = cands[:3]
        return {"candidates": [_coerce_and_sanitize_one(c, include_evidence) if isinstance(c, dict) else _coerce_and_sanitize_one({}, include_evidence) for c in cands]}
    if mode in ("many", "five"):
        cands = parsed.get("candidates", [])
        if not isinstance(cands, list):
            cands = []
        # Ensure exactly 5
        cands = cands[:5]
        while len(cands) < 5:
            cands.append(
                {
                    "unknown": True,
                    "name": "Unknown part",
                    "description": "Could not confidently identify from photos.",
                    "collection": "unknown",
                    "confidence": 0.0,
                }
            )
        return {"candidates": [_coerce_and_sanitize_one(c, include_evidence) if isinstance(c, dict) else _coerce_and_sanitize_one({}, include_evidence) for c in cands]}

    # one
    return _coerce_and_sanitize_one(parsed if isinstance(parsed, dict) else {}, include_evidence)


def identify(
    images_b64: List[str],
    llm_config: Dict[str, Any],
    mode: Mode = "one",
    model: Optional[str] = None,
    include_evidence: bool = True,
    collection_context: Optional[str] = None,
) -> Dict[str, Any]:
    """
    images_b64: list of base64 strings (no data: prefix)
    mode:
      - "one": return single object
      - "many"/"five": return {"candidates":[...5...]}
    """
    if not images_b64:
        raise HTTPException(status_code=400, detail="No images provided")

    use_model = (model or llm_config.get("model") or "").strip()
    if not use_model:
        raise HTTPException(status_code=400, detail="No model configured")

    api_key = str(llm_config.get("api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="No API key configured for selected model")

    api_base_raw = llm_config.get("api_base")
    api_base = str(api_base_raw).strip() if api_base_raw else None

    # Build multi-modal message content: instruction + images
    prompt_text = _schema_instruction(mode, include_evidence)
    if collection_context:
        prompt_text = (
            f"{prompt_text}\n"
            "User-selected collection context (treat as guidance, not certainty):\n"
            f"{collection_context}\n"
            "Use this context to improve identification quality."
        )

    user_content: List[Dict[str, Any]] = [{"type": "text", "text": prompt_text}]
    for b64 in images_b64[:5]:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            }
        )

    try:
        resp = completion(
            model=use_model,
            messages=[
                {"role": "system", "content": _system_prompt(include_evidence)},
                {"role": "user", "content": user_content},
            ],
            temperature=0.2,
            timeout=LITELLM_TIMEOUT,
            api_key=api_key,
            api_base=api_base,
        )
    except Exception as e:
        # Ensure JSON error response upstream
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

    text = (resp.choices[0].message.content or "").strip()
    json_text = _extract_json(text)

    if not json_text:
        # Return something predictable instead of blowing up
        if mode in ("many", "five"):
            return _sanitize(mode, {"candidates": []}, include_evidence) | {"raw": text, "error": "model_returned_no_json"}
        return _sanitize(mode, {}, include_evidence) | {"raw": text, "error": "model_returned_no_json"}

    try:
        parsed = json.loads(json_text)
    except Exception:
        # Still salvageable: return sanitized fallback with raw
        if mode in ("many", "five"):
            return _sanitize(mode, {"candidates": []}, include_evidence) | {"raw": text, "error": "model_returned_invalid_json"}
        return _sanitize(mode, {}, include_evidence) | {"raw": text, "error": "model_returned_invalid_json"}

    # Enforce shape (best-effort) and return
    return _sanitize(mode, parsed, include_evidence)