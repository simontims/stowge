"""
Asset cleanup centralization tests.

Covers:
  - cleanup_asset_paths removes files and empty parent dirs
  - DELETE /api/items/{id} removes stored image variants
  - POST /api/images/discard removes only unlinked image assets
"""

from pathlib import Path

from fastapi.testclient import TestClient

from stowge.auth import SESSION_COOKIE_NAME
from stowge.images import cleanup_asset_paths
from stowge.main import app
from stowge.models import User
from conftest import (
    client,
    make_db,
    get_or_create_user,
    auth_cookies,
    write_asset,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stored_image_payload(image_id: str) -> dict:
    return {
        "id": image_id,
        "path_thumb": f"{image_id}/thumb.jpg",
        "path_display": f"{image_id}/display.jpg",
        "path_original": f"{image_id}/original.jpg",
        "mime": "image/jpeg",
        "width": 100,
        "height": 100,
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_cleanup_asset_paths_removes_files_and_empty_parent_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))

    rel_paths = ["cleanup-a/thumb.jpg", "cleanup-a/display.jpg", "cleanup-a/original.jpg"]
    for rel_path in rel_paths:
        write_asset(tmp_path, rel_path)

    deleted = cleanup_asset_paths(rel_paths)

    assert deleted == 3
    for rel_path in rel_paths:
        assert not (tmp_path / rel_path).exists()
    assert not (tmp_path / "cleanup-a").exists()


def test_delete_item_uses_shared_asset_cleanup_for_variants(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = auth_cookies("asset_cleanup@example.com", role="admin")

    stored = _stored_image_payload("part-cleanup-1")
    for rel_path in (stored["path_thumb"], stored["path_display"], stored["path_original"]):
        write_asset(tmp_path, rel_path)

    create_response = client.post(
        "/api/items",
        json={"name": "Cleanup Item", "stored_images": [stored]},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    part_id = create_response.json()["id"]

    delete_response = client.delete(f"/api/items/{part_id}", cookies=cookies)
    assert delete_response.status_code == 200, delete_response.text

    for rel_path in (stored["path_thumb"], stored["path_display"], stored["path_original"]):
        assert not (tmp_path / rel_path).exists()
    assert not (tmp_path / "part-cleanup-1").exists()


def test_discard_images_removes_unlinked_only(tmp_path, monkeypatch, isolated_db, isolated_client):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    from conftest import auth_cookies_isolated
    cookies = auth_cookies_isolated(isolated_db, "asset_discard@example.com", role="admin")

    deletable = _stored_image_payload("discard-me")
    linked = _stored_image_payload("keep-linked")

    for rel_path in (deletable["path_thumb"], deletable["path_display"], deletable["path_original"]):
        write_asset(tmp_path, rel_path)
    for rel_path in (linked["path_thumb"], linked["path_display"], linked["path_original"]):
        write_asset(tmp_path, rel_path)

    create_response = isolated_client.post(
        "/api/items",
        json={"name": "Linked Item", "stored_images": [linked]},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text

    discard_response = isolated_client.post(
        "/api/images/discard",
        json={"image_ids": ["discard-me", "keep-linked", "missing-id"]},
        cookies=cookies,
    )
    assert discard_response.status_code == 200, discard_response.text

    payload = discard_response.json()
    assert payload["requested"] == 3
    assert payload["skipped_linked"] == 1
    assert payload["deleted"] == 1

    for rel_path in (deletable["path_thumb"], deletable["path_display"], deletable["path_original"]):
        assert not (tmp_path / rel_path).exists()

    for rel_path in (linked["path_thumb"], linked["path_display"], linked["path_original"]):
        assert (tmp_path / rel_path).exists()
