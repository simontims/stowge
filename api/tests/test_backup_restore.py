"""
Backup and restore admin API tests.

Covers:
  - admin auth requirement on backup endpoints
  - create backup operation and list/details endpoints
  - restore test + restore apply operations
  - session invalidation after restore apply
"""

import time
import tarfile
import io
import json
import sqlite3
from pathlib import Path
from uuid import uuid4

from conftest import client, auth_cookies, make_db
from stowge.main import _purge_orphaned_images_once
from stowge.models import Part, PartImage



def _wait_for_operation_done(operation_id: str, cookies: dict, timeout_seconds: float = 8.0):
    deadline = time.time() + timeout_seconds
    last = None
    while time.time() < deadline:
        r = client.get(f"/api/admin/backups/operations/{operation_id}", cookies=cookies)
        assert r.status_code == 200
        payload = r.json()
        last = payload
        if payload.get("status") in ("completed", "failed"):
            return payload
        time.sleep(0.05)
    raise AssertionError(f"Operation {operation_id} did not complete in time. Last payload: {last}")


class TestBackupRestoreApi:
    def test_backups_list_requires_admin_auth(self):
        r = client.get("/api/admin/backups")
        assert r.status_code == 401

    def test_create_backup_and_list_details(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("backup-admin@example.com", role="admin")

        create = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create.status_code == 200
        op_id = create.json().get("operation_id")
        assert op_id

        op = _wait_for_operation_done(op_id, cookies)
        assert op["status"] == "completed"
        result = op.get("result") or {}
        filename = result.get("filename")
        assert isinstance(filename, str)
        assert filename.endswith(".tar.gz")

        backup_file = Path(tmp_path) / "backups" / filename
        assert backup_file.exists()

        listing = client.get("/api/admin/backups", cookies=cookies)
        assert listing.status_code == 200
        backups = listing.json().get("backups") or []
        names = [row.get("filename") for row in backups]
        assert filename in names

        details = client.get(f"/api/admin/backups/{filename}", cookies=cookies)
        assert details.status_code == 200
        manifest = details.json().get("manifest") or {}
        assert manifest.get("includes_assets") is False
        assert manifest.get("backup_name") == "Stowge Backup"

    def test_create_backup_with_custom_name_stores_manifest_name(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("backup-name-admin@example.com", role="admin")

        create = client.post(
            "/api/admin/backups/create",
            json={"include_assets": False, "backup_name": "Quarterly Inventory Snapshot"},
            cookies=cookies,
        )
        assert create.status_code == 200
        op = _wait_for_operation_done(create.json()["operation_id"], cookies)
        assert op["status"] == "completed"

        filename = (op.get("result") or {}).get("filename")
        assert isinstance(filename, str)

        details = client.get(f"/api/admin/backups/{filename}", cookies=cookies)
        assert details.status_code == 200
        manifest = details.json().get("manifest") or {}
        assert manifest.get("backup_name") == "Quarterly Inventory Snapshot"

    def test_restore_apply_invalidates_sessions(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("restore-admin@example.com", role="admin")

        create = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create.status_code == 200
        create_op_id = create.json().get("operation_id")
        create_op = _wait_for_operation_done(create_op_id, cookies)
        assert create_op["status"] == "completed"

        filename = (create_op.get("result") or {}).get("filename")
        assert isinstance(filename, str)

        test_restore = client.post(f"/api/admin/backups/{filename}/restore-test", cookies=cookies)
        assert test_restore.status_code == 200
        test_op_id = test_restore.json().get("operation_id")
        test_op = _wait_for_operation_done(test_op_id, cookies)
        assert test_op["status"] == "completed"

        validation_id = ((test_op.get("result") or {}).get("validation_id"))
        assert isinstance(validation_id, str)

        apply_restore = client.post(
            "/api/admin/backups/restore/apply",
            json={"validation_id": validation_id},
            cookies=cookies,
        )
        assert apply_restore.status_code == 200
        assert isinstance(apply_restore.json().get("operation_id"), str)

        # Restore invalidates all sessions, including the one used for this test.
        # Allow a short window for the async worker to complete invalidation.
        for _ in range(40):
            post = client.get("/api/admin/backups", cookies=cookies)
            if post.status_code == 401:
                break
            time.sleep(0.05)
        else:
            raise AssertionError("Expected session to be invalidated after restore apply")

        post = client.get("/api/admin/backups", cookies=cookies)
        assert post.status_code == 401

    def test_backup_fails_when_space_is_insufficient(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        monkeypatch.setattr("stowge.backup_restore.disk_free_bytes", lambda _path: 1)
        cookies = auth_cookies("space-admin@example.com", role="admin")

        create = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create.status_code == 200
        op_id = create.json().get("operation_id")
        op = _wait_for_operation_done(op_id, cookies)
        assert op["status"] == "failed"
        assert "Not enough free space" in str(op.get("error") or "")

    def test_restore_test_fails_for_corrupt_archive(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("corrupt-admin@example.com", role="admin")

        backups_dir = Path(tmp_path) / "backups"
        backups_dir.mkdir(parents=True, exist_ok=True)
        bad_name = "stowge_2026-04-23.tar.gz"
        (backups_dir / bad_name).write_bytes(b"not-a-tar-archive")

        test_restore = client.post(f"/api/admin/backups/{bad_name}/restore-test", cookies=cookies)
        assert test_restore.status_code == 200
        op_id = test_restore.json().get("operation_id")
        op = _wait_for_operation_done(op_id, cookies)
        assert op["status"] == "failed"

    def test_multiple_backups_use_timestamp_filenames(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("unique-admin@example.com", role="admin")

        create_a = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create_a.status_code == 200
        op_a = _wait_for_operation_done(create_a.json()["operation_id"], cookies)
        assert op_a["status"] == "completed"
        filename_a = (op_a.get("result") or {}).get("filename")

        create_b = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create_b.status_code == 200
        op_b = _wait_for_operation_done(create_b.json()["operation_id"], cookies)
        assert op_b["status"] == "completed"
        filename_b = (op_b.get("result") or {}).get("filename")

        assert isinstance(filename_a, str)
        assert isinstance(filename_b, str)
        assert filename_a != filename_b
        assert filename_a.startswith("stowge_")
        assert filename_b.startswith("stowge_")
        assert filename_a.endswith(".tar.gz")
        assert filename_b.endswith(".tar.gz")
        assert len(filename_a.removeprefix("stowge_").removesuffix(".tar.gz")) > len("2026-04-23")

    def test_delete_backup_removes_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("delete-admin@example.com", role="admin")

        create = client.post("/api/admin/backups/create", json={"include_assets": False}, cookies=cookies)
        assert create.status_code == 200
        op = _wait_for_operation_done(create.json()["operation_id"], cookies)
        filename = (op.get("result") or {}).get("filename")
        assert isinstance(filename, str)

        target = Path(tmp_path) / "backups" / filename
        assert target.exists()

        deleted = client.delete(f"/api/admin/backups/{filename}", cookies=cookies)
        assert deleted.status_code == 200
        assert deleted.json().get("ok") is True
        assert not target.exists()

    def test_restore_test_fails_for_manifest_version_mismatch(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("manifest-admin@example.com", role="admin")

        backup_name = "stowge_2026-04-23.tar.gz"
        backups = Path(tmp_path) / "backups"
        backups.mkdir(parents=True, exist_ok=True)

        db_file = tmp_path / "mini.db"
        raw = sqlite3.connect(str(db_file))
        try:
            for tbl in ("users", "sessions", "parts", "images", "collections", "locations", "llm_configs", "image_settings"):
                raw.execute(f"CREATE TABLE {tbl} (id TEXT)")
            raw.commit()
        finally:
            raw.close()

        manifest = {
            "manifest_version": 999,
            "created_at": "2026-04-23T00:00:00Z",
            "backup_name": backup_name,
            "includes_assets": False,
            "db_relative_path": "db/stowge.db",
            "assets_relative_root": "assets",
            "db_bytes": db_file.stat().st_size,
        }

        with tarfile.open(backups / backup_name, "w:gz") as tar:
            tar.add(db_file, arcname="db/stowge.db")
            payload = json.dumps(manifest).encode("utf-8")
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))

        test_restore = client.post(f"/api/admin/backups/{backup_name}/restore-test", cookies=cookies)
        assert test_restore.status_code == 200
        op = _wait_for_operation_done(test_restore.json()["operation_id"], cookies)
        assert op["status"] == "failed"
        assert "Unsupported backup manifest version" in str(op.get("error") or "")
        failure = (op.get("result") or {}).get("preflight_failure") or {}
        assert failure.get("code") == "manifest_version_mismatch"

    def test_restore_test_fails_for_missing_required_tables(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("schema-admin@example.com", role="admin")

        backup_name = "stowge_2026-04-24.tar.gz"
        backups = Path(tmp_path) / "backups"
        backups.mkdir(parents=True, exist_ok=True)

        db_file = tmp_path / "bad_schema.db"
        raw = sqlite3.connect(str(db_file))
        try:
            raw.execute("CREATE TABLE users (id TEXT)")
            raw.commit()
        finally:
            raw.close()

        manifest = {
            "manifest_version": 1,
            "created_at": "2026-04-23T00:00:00Z",
            "backup_name": backup_name,
            "includes_assets": False,
            "db_relative_path": "db/stowge.db",
            "assets_relative_root": "assets",
            "db_bytes": db_file.stat().st_size,
        }

        with tarfile.open(backups / backup_name, "w:gz") as tar:
            tar.add(db_file, arcname="db/stowge.db")
            payload = json.dumps(manifest).encode("utf-8")
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))

        test_restore = client.post(f"/api/admin/backups/{backup_name}/restore-test", cookies=cookies)
        assert test_restore.status_code == 200
        op = _wait_for_operation_done(test_restore.json()["operation_id"], cookies)
        assert op["status"] == "failed"
        assert "SQL backup missing required tables" in str(op.get("error") or "")
        failure = (op.get("result") or {}).get("preflight_failure") or {}
        assert failure.get("code") == "sql_schema_missing_tables"

    def test_restore_test_fails_when_manifest_reports_incomplete_assets(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        cookies = auth_cookies("incomplete-assets-admin@example.com", role="admin")

        backup_name = "stowge_2026-04-25.tar.gz"
        backups = Path(tmp_path) / "backups"
        backups.mkdir(parents=True, exist_ok=True)

        db_file = tmp_path / "ok_schema.db"
        raw = sqlite3.connect(str(db_file))
        try:
            for tbl in ("users", "sessions", "parts", "images", "collections", "locations", "llm_configs", "image_settings"):
                raw.execute(f"CREATE TABLE {tbl} (id TEXT)")
            raw.commit()
        finally:
            raw.close()

        manifest = {
            "manifest_version": 1,
            "created_at": "2026-04-23T00:00:00Z",
            "backup_name": backup_name,
            "includes_assets": True,
            "db_relative_path": "db/stowge.db",
            "assets_relative_root": "assets",
            "db_bytes": db_file.stat().st_size,
            "asset_referenced_count": 10,
            "asset_included_count": 0,
            "asset_missing_count": 10,
        }

        with tarfile.open(backups / backup_name, "w:gz") as tar:
            tar.add(db_file, arcname="db/stowge.db")
            payload = json.dumps(manifest).encode("utf-8")
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(payload)
            tar.addfile(info, io.BytesIO(payload))

        test_restore = client.post(f"/api/admin/backups/{backup_name}/restore-test", cookies=cookies)
        assert test_restore.status_code == 200
        op = _wait_for_operation_done(test_restore.json()["operation_id"], cookies)
        assert op["status"] == "failed"
        assert "assets are incomplete" in str(op.get("error") or "").lower()
        failure = (op.get("result") or {}).get("preflight_failure") or {}
        assert failure.get("code") == "backup_assets_incomplete"

    def test_orphan_cleanup_preserves_windows_style_tracked_paths(self, tmp_path, monkeypatch):
        monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
        db = make_db()
        try:
            image_id = f"img-win-path-{uuid4().hex}"
            part = Part(name="P", status="confirmed", quantity=1)
            db.add(part)
            db.commit()
            db.refresh(part)

            image = PartImage(
                id=image_id,
                part_id=part.id,
                path_thumb=f"{image_id}\\thumb.webp",
                path_display=f"{image_id}\\display.webp",
                path_original=None,
                mime="image/webp",
                width=100,
                height=100,
                is_primary=1,
            )
            db.add(image)
            db.commit()

            asset_file = Path(tmp_path) / image_id / "thumb.webp"
            asset_file.parent.mkdir(parents=True, exist_ok=True)
            asset_file.write_bytes(b"x")

            result = _purge_orphaned_images_once(db)
            assert result["deleted"] == 0
            assert asset_file.exists()
        finally:
            db.close()
