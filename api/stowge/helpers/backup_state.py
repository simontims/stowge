"""In-memory state tracking for backup/restore async operations.

Each backup or restore is an "operation" identified by a UUID.
Only one operation may be active at a time.
"""

import uuid
from datetime import datetime, timezone
from threading import Lock

from fastapi import HTTPException

from ..datetime_utils import utc_iso

# ---------------------------------------------------------------------------
# Backup Operations
# ---------------------------------------------------------------------------

_BACKUP_OPS_LOCK = Lock()
_BACKUP_OPS: dict[str, dict] = {}
_ACTIVE_BACKUP_OP_ID: str | None = None


def new_backup_operation(op_type: str) -> str:
    """Create a new backup/restore operation. Returns the operation ID.

    Raises HTTP 409 if another operation is already running.
    """
    global _ACTIVE_BACKUP_OP_ID
    with _BACKUP_OPS_LOCK:
        if _ACTIVE_BACKUP_OP_ID:
            active = _BACKUP_OPS.get(_ACTIVE_BACKUP_OP_ID)
            if active and active.get("status") == "running":
                raise HTTPException(status_code=409, detail="Another backup/restore operation is already in progress")

        op_id = str(uuid.uuid4())
        _BACKUP_OPS[op_id] = {
            "id": op_id,
            "type": op_type,
            "status": "running",
            "stage": "starting",
            "progress": 0,
            "message": "Starting",
            "error": None,
            "result": None,
            "updated_at": utc_iso(datetime.now(timezone.utc)),
        }
        _ACTIVE_BACKUP_OP_ID = op_id
        return op_id


def update_backup_operation(op_id: str, *, stage: str, progress: int, message: str):
    """Update progress of a running operation."""
    with _BACKUP_OPS_LOCK:
        op = _BACKUP_OPS.get(op_id)
        if not op:
            return
        op["stage"] = stage
        op["progress"] = max(0, min(100, int(progress)))
        op["message"] = message
        op["updated_at"] = utc_iso(datetime.now(timezone.utc))


def finish_backup_operation(op_id: str, *, status: str, result: dict | None = None, error: str | None = None):
    """Mark an operation as completed or failed."""
    global _ACTIVE_BACKUP_OP_ID
    with _BACKUP_OPS_LOCK:
        op = _BACKUP_OPS.get(op_id)
        if not op:
            return
        op["status"] = status
        op["result"] = result
        op["error"] = error
        if status == "completed":
            op["progress"] = 100
            op["stage"] = "complete"
        op["updated_at"] = utc_iso(datetime.now(timezone.utc))
        if _ACTIVE_BACKUP_OP_ID == op_id:
            _ACTIVE_BACKUP_OP_ID = None


def get_backup_operation(op_id: str) -> dict | None:
    """Retrieve the state of a backup operation by ID."""
    with _BACKUP_OPS_LOCK:
        return _BACKUP_OPS.get(op_id)


def is_any_backup_running() -> bool:
    """Check whether any backup/restore operation is currently active."""
    with _BACKUP_OPS_LOCK:
        return _ACTIVE_BACKUP_OP_ID is not None


def get_active_backup_op_id() -> str | None:
    with _BACKUP_OPS_LOCK:
        return _ACTIVE_BACKUP_OP_ID


# ---------------------------------------------------------------------------
# Restore Validations (temp staging area for verified restores)
# ---------------------------------------------------------------------------

_RESTORE_VALIDATIONS_LOCK = Lock()
_RESTORE_VALIDATIONS: dict[str, dict] = {}


def store_restore_validation(validation_id: str, data: dict):
    with _RESTORE_VALIDATIONS_LOCK:
        _RESTORE_VALIDATIONS[validation_id] = data


def pop_restore_validation(validation_id: str) -> dict | None:
    with _RESTORE_VALIDATIONS_LOCK:
        return _RESTORE_VALIDATIONS.pop(validation_id, None)


def get_restore_validation(validation_id: str) -> dict | None:
    with _RESTORE_VALIDATIONS_LOCK:
        return _RESTORE_VALIDATIONS.get(validation_id)
