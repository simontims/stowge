"""
Location photo variant path behavior tests.

Covers:
  - PATCH /api/locations/{id} cleans old display/thumb/original siblings
  - DELETE /api/locations/{id} cleans display/thumb/original siblings
  - GET /api/admin/maintenance/orphaned-images does not count tracked location siblings
"""

from pathlib import Path

from fastapi.testclient import TestClient

from stowge.auth import SESSION_COOKIE_NAME, create_session, hash_password
from stowge.db import get_db
from stowge.main import app
from stowge.models import User


client = TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db():
    return next(get_db())


def _get_or_create_admin(username: str = "location_test_admin@example.com") -> User:
    db = _make_db()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            first_name="Location",
            last_name="Admin",
            password_hash=hash_password("Secret123!"),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _auth_cookies() -> dict:
    user = _get_or_create_admin()
    db = _make_db()
    token = create_session(user, db)
    return {SESSION_COOKIE_NAME: token}


def _write_asset(base_dir: Path, rel_path: str, content: bytes = b"x") -> Path:
    abs_path = base_dir / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)
    return abs_path


def _location_variants(display_path: str) -> tuple[str, str, str]:
    return (
        display_path,
        display_path.replace("/display.", "/thumb."),
        display_path.replace("/display.", "/original."),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_patch_location_photo_cleans_old_variant_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = _auth_cookies()

    old_display = "loc-old/display.jpg"
    new_display = "loc-new/display.jpg"

    old_variants = _location_variants(old_display)
    new_variants = _location_variants(new_display)

    for rel_path in old_variants:
        _write_asset(tmp_path, rel_path)
    for rel_path in new_variants:
        _write_asset(tmp_path, rel_path)

    create_response = client.post(
        "/api/locations",
        json={"name": "Location Patch Cleanup", "photo_path": old_display},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    location_id = create_response.json()["id"]

    patch_response = client.patch(
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
    cookies = _auth_cookies()

    display_path = "loc-delete/display.jpg"
    variants = _location_variants(display_path)
    for rel_path in variants:
        _write_asset(tmp_path, rel_path)

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


def test_orphan_scan_ignores_location_photo_sibling_variants(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = _auth_cookies()

    display_path = "loc-track/display.jpg"
    variants = _location_variants(display_path)
    for rel_path in variants:
        _write_asset(tmp_path, rel_path, b"tracked")

    orphan_rel_path = "orphan/untracked.jpg"
    orphan_bytes = b"orphan-file"
    _write_asset(tmp_path, orphan_rel_path, orphan_bytes)

    create_response = client.post(
        "/api/locations",
        json={"name": "Location Orphan Scan", "photo_path": display_path},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text

    scan_response = client.get("/api/admin/maintenance/orphaned-images", cookies=cookies)
    assert scan_response.status_code == 200, scan_response.text
    payload = scan_response.json()

    assert payload["file_count"] == 1
    assert payload["disk_bytes"] == len(orphan_bytes)
