"""Identify prompt and output: no collection field, mixed examples, hint context."""
import json

from stowge import openai_id


def _one(**fields):
    base = {"name": "Thing", "description": "A thing", "confidence": 0.5}
    base.update(fields)
    return openai_id._coerce_and_sanitize_one(base, include_evidence=False)


def test_module_has_no_hard_coded_collection_list():
    assert not hasattr(openai_id, "_ALLOWED_COLLECTIONS")


def test_parsed_candidate_has_no_collection_key_even_if_the_model_sends_one():
    out = _one(collection="Camping Gear")
    assert "collection" not in out
    assert set(out) == {"unknown", "name", "description", "confidence"}


def test_padding_candidates_have_no_collection_key():
    out = openai_id._sanitize("five", {"candidates": []}, include_evidence=False)
    assert len(out["candidates"]) == 5
    assert all("collection" not in c for c in out["candidates"])


def test_prompt_does_not_mention_collection_or_the_electronics_only_enum():
    prompt = openai_id._system_prompt(include_evidence=True)
    assert "collection" not in prompt.lower()
    assert "devboard" not in prompt


def test_prompt_examples_are_mixed_not_electronics_only():
    prompt = openai_id.SYSTEM_PROMPT_BASE
    assert "Makita 18V Drill Driver" in prompt
    assert "USB-C to HDMI Cable 2m" in prompt
    assert "AMS1117-3.3 Regulator Module" not in prompt


def test_json_schemas_have_no_collection_property():
    for builder in (openai_id._json_schema_one, openai_id._json_schema_three, openai_id._json_schema_five):
        assert "collection" not in json.dumps(builder(True))
