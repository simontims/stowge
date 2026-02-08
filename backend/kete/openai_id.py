import os
import json
from typing import Literal, List, Dict

from fastapi import HTTPException
from openai import OpenAI

OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = (
    "You are an assistant helping inventory electronic components and modules from photos.\n"
    "Be conservative: if you cannot read markings or cannot confidently identify, set unknown=true.\n"
    "Prefer a practical inventory name over a perfect part number.\n\n"
    "Return concise results:\n"
    "- name: short label (e.g., \"ESP32-WROOM-32 Dev Module\", \"AMS1117-3.3 Regulator Module\")\n"
    "- description: 1-3 sentences with key markings/features and what to verify\n"
    "- category: module|ic|connector|sensor|passive|devboard|cable|tool|unknown\n"
    "- confidence: 0..1\n"
    "- evidence: the markings you read and visual cues you used\n"
)

JSON_SCHEMA_ONE = {
    "name": "kete_identify_one",
    "schema": {
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
    },
}

JSON_SCHEMA_FIVE = {
    "name": "kete_identify_five",
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["candidates"],
        "properties": {
            "candidates": {
                "type": "array",
                "minItems": 5,
                "maxItems": 5,
                "items": {
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
                },
            }
        },
    },
}

import os
import base64
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def identify(images_b64: list[str], model: str) -> dict:
    # Build message with images (up to 5)
    content = [
        {
            "type": "text",
            "text": (
                "Identify the electronic part/module in the photos. "
                "Return JSON with keys: name, description. "
                "Be concise. If unsure, still pick the single best guess."
            ),
        }
    ]

    for b64 in images_b64[:5]:
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"},
            }
        )

    resp = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": content}],
        temperature=0.2,
    )

    text = resp.choices[0].message.content or ""
    return {"raw": text}
