"""docs/api is generated from the code and must be current; the tags release docs exist."""
import json
from pathlib import Path

from stowge.external_api import external_api_app

DOCS = Path(__file__).resolve().parents[2] / "docs" / "api"


def test_generated_openapi_is_current():
    on_disk = json.loads((DOCS / "openapi.json").read_text(encoding="utf-8"))
    assert on_disk == external_api_app.openapi(), "run: api/.venv/bin/python scripts/generate_api_docs.py"


def test_endpoints_table_lists_tags_and_no_collections():
    text = (DOCS / "endpoints.md").read_text(encoding="utf-8")
    assert "/v1/tags" in text and "/v1/tags/{tag_id}" in text
    assert "collection" not in text.lower()


def test_changelog_and_migration_guide_describe_the_break():
    changelog = (DOCS / "CHANGELOG.md").read_text(encoding="utf-8")
    unreleased = changelog.split("## Unreleased", 1)[1]
    for needle in ("/v1/collections", "collections.read", "tags.read", "/v1/tags", "collection is no longer supported; use tags"):
        assert needle in unreleased, needle
    guide = (DOCS / "MIGRATING-collections-to-tags.md").read_text(encoding="utf-8")
    for needle in ("GET /v1/tags", "?tag=", "\"tags\": [", "collections.read", "Home Assistant", "curl"):
        assert needle in guide, needle
