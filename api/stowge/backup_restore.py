import io
import json
import os
import shutil
import sqlite3
import tarfile
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from .models import PartImage, Location

BACKUP_MANIFEST_VERSION = 1
REQUIRED_MANIFEST_KEYS = {
    "manifest_version",
    "created_at",
    "backup_name",
    "includes_assets",
    "db_relative_path",
    "assets_relative_root",
    "db_bytes",
}
REQUIRED_BACKUP_TABLES = {
    "users",
    "sessions",
    "parts",
    "images",
    "collections",
    "locations",
    "llm_configs",
    "image_settings",
}


class BackupError(Exception):
    def __init__(self, message: str, code: str = "backup_error"):
        super().__init__(message)
        self.code = code


@dataclass
class BackupSpaceEstimate:
    required_bytes: int
    free_bytes: int



def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")



def backup_filename(dt: datetime | None = None, extension: str = ".tar.gz") -> str:
    stamp = (dt or datetime.now(timezone.utc)).strftime("%Y-%m-%d_%H-%M-%S-%f")
    return f"stowge_{stamp}{extension}"


def unique_backup_filename(backups_root: str, dt: datetime | None = None, extension: str = ".tar.gz") -> str:
    candidate = backup_filename(dt=dt, extension=extension)
    while os.path.exists(os.path.join(backups_root, candidate)):
        candidate = backup_filename(extension=extension)
    return candidate



def backups_dir(assets_root: str) -> str:
    return os.path.join(assets_root, "backups")



def ensure_backups_dir(assets_root: str) -> str:
    out = backups_dir(assets_root)
    os.makedirs(out, exist_ok=True)
    return out



def temp_root(backups_root: str) -> str:
    root = os.path.join(backups_root, ".tmp")
    os.makedirs(root, exist_ok=True)
    return root



def _safe_rel(rel_path: str) -> str:
    rel = str(rel_path).replace("\\", "/").strip("/")
    if not rel or rel.startswith("../") or "/../" in rel:
        raise BackupError("Invalid relative asset path", code="invalid_relative_asset_path")
    return rel



def _location_photo_variant_paths(photo_path: str | None) -> tuple[str, str, str] | tuple[()]:
    if not photo_path:
        return ()
    display_path = str(photo_path)
    thumb_path = display_path.replace("/display.", "/thumb.")
    original_path = display_path.replace("/display.", "/original.")
    return (display_path, thumb_path, original_path)



def gather_referenced_assets(db: Session) -> set[str]:
    tracked: set[str] = set()
    for (pt, pd, po) in db.query(PartImage.path_thumb, PartImage.path_display, PartImage.path_original).all():
        for p in (pt, pd, po):
            if p:
                tracked.add(_safe_rel(str(p)))

    for (photo_path,) in db.query(Location.photo_path).filter(Location.photo_path.isnot(None)).all():
        for rel in _location_photo_variant_paths(photo_path):
            tracked.add(_safe_rel(rel))

    return tracked



def calc_paths_size(base_dir: str, rel_paths: set[str]) -> tuple[int, int, int]:
    total = 0
    found = 0
    missing = 0
    for rel in rel_paths:
        abs_path = os.path.join(base_dir, rel)
        if not os.path.isfile(abs_path):
            missing += 1
            continue
        found += 1
        try:
            total += os.path.getsize(abs_path)
        except OSError:
            pass
    return total, found, missing



def estimate_backup_space(db_file: str, asset_bytes: int) -> BackupSpaceEstimate:
    db_size = os.path.getsize(db_file) if os.path.isfile(db_file) else 0
    # Rough estimate includes source copies + compressed output + headroom.
    rough_required = int((db_size + asset_bytes) * 2.2) + (64 * 1024 * 1024)
    return BackupSpaceEstimate(required_bytes=rough_required, free_bytes=0)



def disk_free_bytes(path: str) -> int:
    return int(shutil.disk_usage(path).free)



def checkpoint_sqlite(db_file: str) -> None:
    if not os.path.isfile(db_file):
        raise BackupError("Database file not found")
    raw = sqlite3.connect(db_file)
    try:
        raw.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        raw.close()



def create_backup_archive(
    *,
    db: Session,
    db_file: str,
    assets_root: str,
    include_assets: bool,
    backup_name: str | None,
    app_version: str,
    progress_callback=None,
) -> dict:
    def _progress(stage: str, pct: int, message: str):
        if progress_callback:
            progress_callback(stage=stage, progress=pct, message=message)

    assets_root = os.path.abspath(assets_root)
    backups_root = ensure_backups_dir(assets_root)
    tmp_root = temp_root(backups_root)

    _progress("space_check", 5, "Calculating required space")

    tracked_assets = gather_referenced_assets(db) if include_assets else set()
    asset_bytes, asset_found_count, asset_missing_count = calc_paths_size(assets_root, tracked_assets)

    estimate = estimate_backup_space(db_file, asset_bytes)
    free = disk_free_bytes(assets_root)
    estimate.free_bytes = free
    if free < estimate.required_bytes:
        raise BackupError(
            f"Not enough free space in assets mount. Required about {estimate.required_bytes} bytes, available {free} bytes.",
            code="disk_space_insufficient_backup",
        )

    _progress("db_snapshot", 15, "Creating database snapshot")
    checkpoint_sqlite(db_file)

    archive_filename = unique_backup_filename(backups_root)
    final_path = os.path.join(backups_root, archive_filename)
    backup_display_name = (backup_name or "").strip() or "Stowge Backup"

    temp_dir = tempfile.mkdtemp(prefix="backup_", dir=tmp_root)
    try:
        db_snap_dir = os.path.join(temp_dir, "db")
        os.makedirs(db_snap_dir, exist_ok=True)
        db_snap_path = os.path.join(db_snap_dir, "stowge.db")
        shutil.copy2(db_file, db_snap_path)

        _progress("manifest", 30, "Preparing manifest")
        manifest = {
            "manifest_version": BACKUP_MANIFEST_VERSION,
            "created_at": utc_now_iso(),
            "backup_name": backup_display_name,
            "includes_assets": bool(include_assets),
            "db_relative_path": "db/stowge.db",
            "assets_relative_root": "assets",
            "app_version": app_version,
            "asset_referenced_count": len(tracked_assets),
            "asset_included_count": asset_found_count if include_assets else 0,
            "asset_missing_count": asset_missing_count if include_assets else 0,
            "asset_bytes": asset_bytes if include_assets else 0,
            "db_bytes": os.path.getsize(db_snap_path),
        }

        _progress("archive", 45, "Creating compressed archive")
        with tarfile.open(final_path, "w:gz") as tar:
            tar.add(db_snap_path, arcname="db/stowge.db")

            if include_assets:
                total_assets = max(1, asset_found_count)
                included = 0
                for rel in sorted(tracked_assets):
                    abs_path = os.path.join(assets_root, rel)
                    if not os.path.isfile(abs_path):
                        continue
                    tar.add(abs_path, arcname=f"assets/{rel}")
                    included += 1
                    if included % 25 == 0:
                        pct = min(90, 45 + int((included / total_assets) * 40))
                        _progress("archive", pct, f"Archived {included}/{asset_found_count} assets")

            manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name="manifest.json")
            info.size = len(manifest_bytes)
            info.mtime = int(datetime.now(timezone.utc).timestamp())
            tar.addfile(info, io.BytesIO(manifest_bytes))

        _progress("cleanup", 95, "Cleaning temporary files")

        archive_size = os.path.getsize(final_path)
        result = {
            "filename": archive_filename,
            "path": final_path,
            "archive_bytes": archive_size,
            "manifest": manifest,
            "required_bytes_estimate": estimate.required_bytes,
            "free_bytes": free,
        }

        _progress("complete", 100, "Backup completed")
        return result
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)



def list_backups(assets_root: str) -> list[dict]:
    root = ensure_backups_dir(assets_root)
    rows: list[dict] = []
    for entry in os.scandir(root):
        if not entry.is_file():
            continue
        if not entry.name.endswith(".tar.gz"):
            continue
        st = entry.stat()
        rows.append(
            {
                "filename": entry.name,
                "size_bytes": int(st.st_size),
                "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
            }
        )
    rows.sort(key=lambda x: x["modified_at"], reverse=True)
    return rows


def read_manifest_from_archive(backup_path: str) -> dict:
    if not os.path.isfile(backup_path):
        raise BackupError("Backup not found", code="backup_not_found")
    try:
        with tarfile.open(backup_path, "r:gz") as tar:
            member = tar.getmember("manifest.json")
            extracted = tar.extractfile(member)
            if extracted is None:
                raise BackupError("Manifest not found in backup")
            data = json.loads(extracted.read().decode("utf-8"))
    except KeyError:
        raise BackupError("Manifest not found in backup", code="manifest_missing")
    except BackupError:
        raise
    except Exception as exc:
        raise BackupError(f"Failed to read backup manifest: {exc}", code="manifest_read_failed")
    if not isinstance(data, dict):
        raise BackupError("Invalid manifest format", code="manifest_invalid_format")
    _validate_manifest(data)
    return data



def _ensure_within(path: str, root: str) -> None:
    root_abs = os.path.abspath(root)
    path_abs = os.path.abspath(path)
    if os.path.commonpath([root_abs, path_abs]) != root_abs:
        raise BackupError("Archive contains invalid path", code="archive_invalid_path")



def _safe_extract_tar(tar_path: str, dest_dir: str) -> None:
    with tarfile.open(tar_path, "r:gz") as tar:
        members = tar.getmembers()
        for m in members:
            if m.issym() or m.islnk():
                raise BackupError("Archive links are not allowed", code="archive_links_not_allowed")
            member_target = os.path.join(dest_dir, m.name)
            _ensure_within(member_target, dest_dir)
        tar.extractall(dest_dir)



def _load_manifest(path: str) -> dict:
    if not os.path.isfile(path):
        raise BackupError("Manifest not found in backup", code="manifest_missing")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:
        raise BackupError(f"Invalid manifest: {exc}", code="manifest_invalid")
    if not isinstance(data, dict):
        raise BackupError("Invalid manifest format", code="manifest_invalid_format")
    _validate_manifest(data)
    return data


def _validate_manifest(manifest: dict) -> None:
    missing = REQUIRED_MANIFEST_KEYS.difference(manifest.keys())
    if missing:
        raise BackupError(
            f"Manifest missing required keys: {', '.join(sorted(missing))}",
            code="manifest_missing_keys",
        )

    version = manifest.get("manifest_version")
    if int(version) != BACKUP_MANIFEST_VERSION:
        raise BackupError(
            f"Unsupported backup manifest version: {version}. Expected {BACKUP_MANIFEST_VERSION}.",
            code="manifest_version_mismatch",
        )

    if not isinstance(manifest.get("includes_assets"), bool):
        raise BackupError("Manifest field includes_assets must be boolean", code="manifest_invalid_includes_assets")

    if "asset_included_count" in manifest and not isinstance(manifest.get("asset_included_count"), int):
        raise BackupError("Manifest field asset_included_count must be integer", code="manifest_invalid_asset_included_count")
    if "asset_missing_count" in manifest and not isinstance(manifest.get("asset_missing_count"), int):
        raise BackupError("Manifest field asset_missing_count must be integer", code="manifest_invalid_asset_missing_count")
    if "asset_referenced_count" in manifest and not isinstance(manifest.get("asset_referenced_count"), int):
        raise BackupError("Manifest field asset_referenced_count must be integer", code="manifest_invalid_asset_referenced_count")

    db_rel = str(manifest.get("db_relative_path") or "")
    if not db_rel or db_rel.startswith("/") or ".." in db_rel.replace("\\", "/"):
        raise BackupError("Manifest contains invalid db_relative_path", code="manifest_invalid_db_relative_path")



def validate_sqlite_file(path: str) -> None:
    if not os.path.isfile(path):
        raise BackupError("SQL backup file not found", code="sql_backup_missing")
    raw = sqlite3.connect(path)
    try:
        row = raw.execute("PRAGMA integrity_check").fetchone()
        if not row or str(row[0]).lower() != "ok":
            raise BackupError("SQL backup failed integrity check", code="sql_integrity_failed")
    finally:
        raw.close()


def validate_backup_database_schema(path: str) -> None:
    raw = sqlite3.connect(path)
    try:
        rows = raw.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        names = {str(row[0]) for row in rows}
        missing = sorted(REQUIRED_BACKUP_TABLES.difference(names))
        if missing:
            raise BackupError(
                f"SQL backup missing required tables: {', '.join(missing)}",
                code="sql_schema_missing_tables",
            )
    finally:
        raw.close()



def start_restore_validation(
    *,
    backup_path: str,
    assets_root: str,
    progress_callback=None,
) -> dict:
    def _progress(stage: str, pct: int, message: str):
        if progress_callback:
            progress_callback(stage=stage, progress=pct, message=message)

    if not os.path.isfile(backup_path):
        raise BackupError("Backup not found", code="backup_not_found")

    backups_root = ensure_backups_dir(assets_root)
    tmp_root = temp_root(backups_root)
    restore_tmp = tempfile.mkdtemp(prefix="restore_", dir=tmp_root)

    _progress("space_check", 10, "Checking available space")
    free = disk_free_bytes(assets_root)

    try:
        _progress("extract", 30, "Unpacking archive")
        _safe_extract_tar(backup_path, restore_tmp)

        manifest = _load_manifest(os.path.join(restore_tmp, "manifest.json"))
        includes_assets = bool(manifest.get("includes_assets"))

        if includes_assets:
            referenced = int(manifest.get("asset_referenced_count") or 0)
            included = int(manifest.get("asset_included_count") or 0)
            missing_assets = int(manifest.get("asset_missing_count") or 0)
            if referenced > 0 and (included <= 0 or missing_assets > 0):
                raise BackupError(
                    "Backup assets are incomplete for restore. Create a new backup with all referenced assets present.",
                    code="backup_assets_incomplete",
                )

        db_rel = str(manifest.get("db_relative_path") or "db/stowge.db")
        db_path = os.path.join(restore_tmp, db_rel)

        required = int(manifest.get("db_bytes") or 0)
        if includes_assets:
            required += int(manifest.get("asset_bytes") or 0)
        required = int(required * 1.4) + (32 * 1024 * 1024)

        if free < required:
            raise BackupError(
                f"Not enough free space in assets mount for restore. Required about {required} bytes, available {free} bytes.",
                code="disk_space_insufficient_restore",
            )

        _progress("validate_sql", 60, "Validating SQL backup")
        validate_sqlite_file(db_path)

        _progress("validate_schema", 70, "Validating backup schema")
        validate_backup_database_schema(db_path)

        assets_count = int(manifest.get("asset_included_count") or 0)

        _progress("ready", 100, "Backup ready to restore")
        return {
            "tmp_dir": restore_tmp,
            "manifest": manifest,
            "db_path": db_path,
            "includes_assets": includes_assets,
            "assets_count": assets_count,
            "free_bytes": free,
            "required_bytes_estimate": required,
        }
    except Exception:
        remove_tmp_dir(restore_tmp)
        raise



def clear_assets_except_backups(assets_root: str) -> None:
    root = Path(assets_root)
    if not root.exists():
        return
    for child in root.iterdir():
        if child.name == "backups":
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            try:
                child.unlink()
            except OSError:
                pass



def restore_from_validation(
    *,
    validation_tmp_dir: str,
    db_file: str,
    assets_root: str,
    includes_assets: bool,
    progress_callback=None,
) -> dict:
    def _progress(stage: str, pct: int, message: str):
        if progress_callback:
            progress_callback(stage=stage, progress=pct, message=message)

    manifest = _load_manifest(os.path.join(validation_tmp_dir, "manifest.json"))
    db_rel = str(manifest.get("db_relative_path") or "db/stowge.db")
    snap_db = os.path.join(validation_tmp_dir, db_rel)

    _progress("restore_db", 20, "Restoring database")
    validate_sqlite_file(snap_db)

    src = sqlite3.connect(snap_db)
    dst = sqlite3.connect(db_file)
    try:
        dst.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        src.backup(dst)
        dst.commit()
    finally:
        dst.close()
        src.close()

    _progress("restore_assets", 45, "Restoring asset files")
    clear_assets_except_backups(assets_root)

    if includes_assets:
        restored_assets = os.path.join(validation_tmp_dir, "assets")
        if os.path.isdir(restored_assets):
            for root, _dirs, files in os.walk(restored_assets):
                for fname in files:
                    abs_src = os.path.join(root, fname)
                    rel = os.path.relpath(abs_src, restored_assets)
                    abs_dst = os.path.join(assets_root, rel)
                    os.makedirs(os.path.dirname(abs_dst), exist_ok=True)
                    shutil.copy2(abs_src, abs_dst)

    _progress("db_maintenance", 75, "Running database maintenance")
    raw = sqlite3.connect(db_file)
    try:
        raw.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        raw.execute("VACUUM")
        raw.execute("ANALYZE")
        raw.execute("PRAGMA optimize")
    finally:
        raw.close()

    _progress("cleanup", 95, "Deleting temporary files")

    return {
        "manifest": manifest,
    }



def remove_tmp_dir(path: str) -> None:
    shutil.rmtree(path, ignore_errors=True)
