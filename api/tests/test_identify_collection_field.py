"""Identify output: the `collection` value is passed through, not clamped to a fixed list."""
from stowge import openai_id


def _one(**fields):
    base = {"name": "Thing", "description": "A thing", "confidence": 0.5}
    base.update(fields)
    return openai_id._coerce_and_sanitize_one(base, include_evidence=False)


def test_module_has_no_hard_coded_collection_list():
    assert not hasattr(openai_id, "_ALLOWED_COLLECTIONS")


def test_collection_outside_the_old_list_is_kept():
    assert _one(collection="Camping Gear")["collection"] == "camping gear"


def test_collection_from_the_old_list_is_kept():
    assert _one(collection="Connector")["collection"] == "connector"


def test_missing_or_blank_collection_is_unknown():
    assert _one()["collection"] == "unknown"
    assert _one(collection="   ")["collection"] == "unknown"
