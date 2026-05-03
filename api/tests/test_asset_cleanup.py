"""
Asset cleanup centralization tests.

Covers:
  - cleanup_asset_paths removes files and empty parent dirs
    - DELETE /api/items/{id} soft-deletes item and preserves stored image variants
  - POST /api/images/discard removes only unlinked image assets
"""
from stowge.images import cleanup_asset_paths
from uuid import uuid4
from conftest import (
    client,
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


def test_delete_item_soft_delete_preserves_assets_for_undo(tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = auth_cookies("asset_cleanup@example.com", role="admin")

    image_id = f"part-cleanup-{uuid4()}"
    stored = _stored_image_payload(image_id)
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
        assert (tmp_path / rel_path).exists()
    assert (tmp_path / image_id).exists()


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


def test_orphan_maintenance_keeps_assets_for_soft_deleted_items(tmp_path, monkeypatch, isolated_db, isolated_client):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    from conftest import auth_cookies_isolated
    cookies = auth_cookies_isolated(isolated_db, "asset_orphan_soft_delete@example.com", role="admin")

    soft_deleted = _stored_image_payload(f"soft-deleted-{uuid4()}")
    for rel_path in (soft_deleted["path_thumb"], soft_deleted["path_display"], soft_deleted["path_original"]):
      write_asset(tmp_path, rel_path, b"tracked-soft-delete")

    orphan_rel_path = "orphan/untracked.jpg"
    orphan_bytes = b"orphan"
    write_asset(tmp_path, orphan_rel_path, orphan_bytes)

    create_response = isolated_client.post(
        "/api/items",
        json={"name": "Soft Delete Orphan Guard", "stored_images": [soft_deleted]},
        cookies=cookies,
    )
    assert create_response.status_code == 200, create_response.text
    item_id = create_response.json()["id"]

    delete_response = isolated_client.delete(f"/api/items/{item_id}", cookies=cookies)
    assert delete_response.status_code == 200, delete_response.text

    scan_response = isolated_client.get("/api/admin/maintenance/orphaned-images", cookies=cookies)
    assert scan_response.status_code == 200, scan_response.text
    scan_payload = scan_response.json()
    assert scan_payload["file_count"] == 1
    assert scan_payload["disk_bytes"] == len(orphan_bytes)

    purge_response = isolated_client.delete("/api/admin/maintenance/orphaned-images", cookies=cookies)
    assert purge_response.status_code == 200, purge_response.text
    purge_payload = purge_response.json()
    assert purge_payload["deleted"] == 1
    assert purge_payload["freed_bytes"] == len(orphan_bytes)

    for rel_path in (soft_deleted["path_thumb"], soft_deleted["path_display"], soft_deleted["path_original"]):
        assert (tmp_path / rel_path).exists()
    assert not (tmp_path / orphan_rel_path).exists()
