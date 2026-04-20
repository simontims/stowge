"""
Location photo variant path behavior tests.

Covers:
  - PATCH /api/locations/{id} cleans old display/thumb/original siblings
  - DELETE /api/locations/{id} cleans display/thumb/original siblings
  - GET /api/admin/maintenance/orphaned-images does not count tracked location siblings
"""

from pathlib import Path

from fastapi.testclient import TestClient

from stowge.auth import SESSION_COOKIE_NAME
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

def _location_variants(display_path: str) -> tuple[str, str, str]:
    return (
        display_path,
        display_path.replace("/display.", "/thumb."),
        display_path.replace("/display.", "/original."),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_patch_location_photo_cleans_old_variant_paths(tmp_path, monkeypatch, isolated_db, isolated_client):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    from conftest import auth_cookies_isolated
    cookies = auth_cookies_isolated(isolated_db, "loc_patch@example.com", role="admin")

    old_display = "loc-old/display.jpg"
    new_display = "loc-new/display.jpg"

    old_variants = _location_variants(old_display)
    new_variants = _location_variants(new_display)

    for rel_path in old_variants:
        write_asset(tmp_path, rel_path)
    for rel_path in new_variants:
        write_asset(tmp_path, rel_path)

    create_response = isolated_client.post(
        "/api/locations",
        json={"name": "Location Patch Cleanup", "photo_path": old_display},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    location_id = create_response.json()["id"]

    patch_response = isolated_client.patch(
        f"/api/locations/{location_id}",
        json={"photo_path": new_display},
        cookies=cookies,
    )
    assert patch_response.status_code == 200, patch_response.text

    for rel_path in old_variants:
        assert not (tmp_path / rel_path).exists()
    for rel_path in new_variants:
        assert (tmp_path / rel_path).exists()


def test_delete_location_cleans_all_variant_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = auth_cookies("loc_delete@example.com", role="admin")

    display_path = "loc-delete/display.jpg"
    variants = _location_variants(display_path)
    for rel_path in variants:
        write_asset(tmp_path, rel_path)

    create_response = client.post(
        "/api/locations",
        json={"name": "Location Delete Cleanup", "photo_path": display_path},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    location_id = create_response.json()["id"]

    delete_response = client.delete(f"/api/locations/{location_id}", cookies=cookies)
    assert delete_response.status_code == 200, delete_response.text

    for rel_path in variants:
        assert not (tmp_path / rel_path).exists()


def test_orphan_scan_ignores_location_photo_sibling_variants(tmp_path, monkeypatch, isolated_db, isolated_client):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    from conftest import auth_cookies_isolated
    cookies = auth_cookies_isolated(isolated_db, "loc_orphan@example.com", role="admin")

    display_path = "loc-track/display.jpg"
    variants = _location_variants(display_path)
    for rel_path in variants:
        write_asset(tmp_path, rel_path, b"tracked")

    orphan_rel_path = "orphan/untracked.jpg"
    orphan_bytes = b"orphan-file"
    write_asset(tmp_path, orphan_rel_path, orphan_bytes)

    create_response = isolated_client.post(
        "/api/locations",
        json={"name": "Location Orphan Scan", "photo_path": display_path},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text

    scan_response = isolated_client.get("/api/admin/maintenance/orphaned-images", cookies=cookies)
    assert scan_response.status_code == 200, scan_response.text
    payload = scan_response.json()

    assert payload["file_count"] == 1
    assert payload["disk_bytes"] == len(orphan_bytes)
