"""
Asset cleanup centralization tests.

Covers:
  - cleanup_asset_paths removes files and empty parent dirs
  - DELETE /api/items/{id} removes stored image variants
  - POST /api/images/discard removes only unlinked image assets
"""

from pathlib import Path

from fastapi.testclient import TestClient

from stowge.auth import SESSION_COOKIE_NAME, create_session, hash_password
from stowge.db import get_db
from stowge.images import cleanup_asset_paths
from stowge.main import app
from stowge.models import User


client = TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_db():
    return next(get_db())


def _get_or_create_admin(username: str = "asset_cleanup_admin@example.com") -> User:
    db = _make_db()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            first_name="Asset",
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
        _write_asset(tmp_path, rel_path)

    deleted = cleanup_asset_paths(rel_paths)

    assert deleted == 3
    for rel_path in rel_paths:
        assert not (tmp_path / rel_path).exists()
    assert not (tmp_path / "cleanup-a").exists()


def test_delete_item_uses_shared_asset_cleanup_for_variants(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = _auth_cookies()

    stored = _stored_image_payload("part-cleanup-1")
    for rel_path in (stored["path_thumb"], stored["path_display"], stored["path_original"]):
        _write_asset(tmp_path, rel_path)

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


def test_discard_images_removes_unlinked_only(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = _auth_cookies()

    deletable = _stored_image_payload("discard-me")
    linked = _stored_image_payload("keep-linked")

    for rel_path in (deletable["path_thumb"], deletable["path_display"], deletable["path_original"]):
        _write_asset(tmp_path, rel_path)
    for rel_path in (linked["path_thumb"], linked["path_display"], linked["path_original"]):
        _write_asset(tmp_path, rel_path)

    create_response = client.post(
        "/api/items",
        json={"name": "Linked Item", "stored_images": [linked]},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text

    discard_response = client.post(
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
