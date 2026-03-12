import os
import json
import re
from typing import Any, Dict, List, Literal, Optional

from fastapi import HTTPException
from openai import OpenAI

Mode = Literal["one", "many", "five", "three"]

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
OPENAI_TIMEOUT = float(os.getenv("OPENAI_TIMEOUT", "45"))

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = (
    "You are an assistant helping inventory electronic components and modules from photos.\n"
    "Be conservative: if you cannot read markings or cannot confidently identify, set unknown=true.\n"
    "Prefer a practical inventory name over a perfect part number.\n\n"
    "Return concise results:\n"
    "- unknown: true|false\n"
    "- name: short label (e.g., \"ESP32-WROOM-32 Dev Module\", \"AMS1117-3.3 Regulator Module\")\n"
    "- description: 1-3 sentences with key markings/features and what to verify\n"
    "- category: module|ic|connector|sensor|passive|devboard|cable|tool|unknown\n"
    "- confidence: 0..1\n"
    "- evidence: the markings you read and visual cues you used\n"
)

JSON_SCHEMA_ONE: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["unknown", "name", "description", "category", "confidence", "evidence"],
    "properties": {
        "unknown": {"type": "boolean"},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "category": {"type": "string"},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "evidence": {"type": "string"},
    },
}

JSON_SCHEMA_THREE: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "minItems": 1,
            "maxItems": 3,
            "items": JSON_SCHEMA_ONE,
        }
    },
}

JSON_SCHEMA_FIVE: Dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "minItems": 5,
            "maxItems": 5,
            "items": JSON_SCHEMA_ONE,
        }
    },
}

_ALLOWED_CATEGORIES = {
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


def _schema_instruction(mode: Mode) -> str:
    if mode == "three":
        return (
            f"{_JSON_ONLY_INSTRUCTION}\n"
            "You must return an object matching this JSON schema:\n"
            f"{json.dumps(JSON_SCHEMA_THREE)}\n"
            "Return only candidates you can genuinely identify or clear alternatives.\n"
            "Do NOT include filler items with unknown confidence. Return 1, 2, or 3 items as appropriate.\n"
            "If the first item is very confident and you cannot identify genuine alternatives, return just 1.\n"
        )
    if mode in ("many", "five"):
        return (
            f"{_JSON_ONLY_INSTRUCTION}\n"
            "You must return an object matching this JSON schema:\n"
            f"{json.dumps(JSON_SCHEMA_FIVE)}\n"
            "Provide exactly 5 candidates, best first.\n"
        )
    return (
        f"{_JSON_ONLY_INSTRUCTION}\n"
        "You must return an object matching this JSON schema:\n"
        f"{json.dumps(JSON_SCHEMA_ONE)}\n"
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


def _coerce_and_sanitize_one(obj: Dict[str, Any]) -> Dict[str, Any]:
    # Provide safe defaults / coercions
    unknown = bool(obj.get("unknown", False))
    name = str(obj.get("name", "")).strip()
    description = str(obj.get("description", "")).strip()
    category = str(obj.get("category", "unknown")).strip().lower()
    evidence = str(obj.get("evidence", "")).strip()

    try:
        confidence = float(obj.get("confidence", 0.0))
    except Exception:
        confidence = 0.0

    confidence = max(0.0, min(1.0, confidence))
    if category not in _ALLOWED_CATEGORIES:
        category = "unknown"

    if not name:
        # If name missing, force unknown
        unknown = True
        name = "Unknown part"
    if not description:
        description = "No description provided."
    if not evidence:
        evidence = "No clear markings or distinctive features could be confirmed."

    return {
        "unknown": unknown,
        "name": name,
        "description": description,
        "category": category,
        "confidence": confidence,
        "evidence": evidence,
    }


def _sanitize(mode: Mode, parsed: Dict[str, Any]) -> Dict[str, Any]:
    if mode == "three":
        cands = parsed.get("candidates", [])
        if not isinstance(cands, list):
            cands = []
        # Allow 1-3 items, no padding
        cands = cands[:3]
        return {"candidates": [_coerce_and_sanitize_one(c) if isinstance(c, dict) else _coerce_and_sanitize_one({}) for c in cands]}
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
                    "category": "unknown",
                    "confidence": 0.0,
                    "evidence": "Insufficient visual evidence.",
                }
            )
        return {"candidates": [_coerce_and_sanitize_one(c) if isinstance(c, dict) else _coerce_and_sanitize_one({}) for c in cands]}

    # one
    return _coerce_and_sanitize_one(parsed if isinstance(parsed, dict) else {})


def identify(images_b64: List[str], mode: Mode = "one", model: Optional[str] = None) -> Dict[str, Any]:
    """
    images_b64: list of base64 strings (no data: prefix)
    mode:
      - "one": return single object
      - "many"/"five": return {"candidates":[...5...]}
    """
    if not images_b64:
        raise HTTPException(status_code=400, detail="No images provided")

    use_model = model or OPENAI_MODEL

    # Build multi-modal message content: instruction + images
    user_content: List[Dict[str, Any]] = [{"type": "text", "text": _schema_instruction(mode)}]
    for b64 in images_b64[:5]:
        user_content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            }
        )

    try:
        resp = client.chat.completions.create(
            model=use_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_content},
            ],
            temperature=0.2,
            timeout=OPENAI_TIMEOUT,
        )
    except Exception as e:
        # Ensure JSON error response upstream
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {e}")

    text = (resp.choices[0].message.content or "").strip()
    json_text = _extract_json(text)

    if not json_text:
        # Return something predictable instead of blowing up
        if mode in ("many", "five"):
            return _sanitize(mode, {"candidates": []}) | {"raw": text, "error": "model_returned_no_json"}
        return _sanitize(mode, {}) | {"raw": text, "error": "model_returned_no_json"}

    try:
        parsed = json.loads(json_text)
    except Exception:
        # Still salvageable: return sanitized fallback with raw
        if mode in ("many", "five"):
            return _sanitize(mode, {"candidates": []}) | {"raw": text, "error": "model_returned_invalid_json"}
        return _sanitize(mode, {}) | {"raw": text, "error": "model_returned_invalid_json"}

    # Enforce shape (best-effort) and return
    return _sanitize(mode, parsed)