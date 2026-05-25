"""In-memory event logs for SSE streaming.

Two independent event buffers:
  - parts_events: inventory changes (item created/updated/deleted)
  - maintenance_events: scheduler task lifecycle (started/completed/failed)

Both use a bounded ring buffer with per-event sequence numbers so SSE clients
can reconnect and catch up without missing events.
"""

from datetime import datetime, timezone
from threading import Lock

# ---------------------------------------------------------------------------
# Parts / Inventory Events
# ---------------------------------------------------------------------------

_PARTS_EVENTS_LOCK = Lock()
_PARTS_EVENTS_SEQ = 0
_PARTS_EVENTS_LOG: list[dict] = []
_PARTS_EVENTS_MAX = 256


def publish_parts_event(event_type: str, payload: dict):
    global _PARTS_EVENTS_SEQ
    with _PARTS_EVENTS_LOCK:
        _PARTS_EVENTS_SEQ += 1
        event = {
            "seq": _PARTS_EVENTS_SEQ,
            "type": event_type,
            "ts": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        _PARTS_EVENTS_LOG.append(event)
        if len(_PARTS_EVENTS_LOG) > _PARTS_EVENTS_MAX:
            del _PARTS_EVENTS_LOG[0 : len(_PARTS_EVENTS_LOG) - _PARTS_EVENTS_MAX]


def publish_inventory_change(action: str, part_id: str):
    """Emit both legacy and new event names so old and new clients keep working."""
    publish_parts_event("parts_changed", {"action": action, "part_id": part_id})
    publish_parts_event("items_changed", {"action": action, "item_id": part_id, "part_id": part_id})


def parts_events_since(last_seq: int) -> list[dict]:
    with _PARTS_EVENTS_LOCK:
        return [e for e in _PARTS_EVENTS_LOG if int(e.get("seq", 0)) > last_seq]


# ---------------------------------------------------------------------------
# Maintenance Events
# ---------------------------------------------------------------------------

_MAINTENANCE_EVENTS_LOCK = Lock()
_MAINTENANCE_EVENTS_SEQ = 0
_MAINTENANCE_EVENTS_LOG: list[dict] = []
_MAINTENANCE_EVENTS_MAX = 256


def publish_maintenance_event(event_type: str, payload: dict):
    global _MAINTENANCE_EVENTS_SEQ
    with _MAINTENANCE_EVENTS_LOCK:
        _MAINTENANCE_EVENTS_SEQ += 1
        event = {
            "seq": _MAINTENANCE_EVENTS_SEQ,
            "type": event_type,
            "ts": datetime.now(timezone.utc).isoformat(),
            **payload,
        }
        _MAINTENANCE_EVENTS_LOG.append(event)
        if len(_MAINTENANCE_EVENTS_LOG) > _MAINTENANCE_EVENTS_MAX:
            del _MAINTENANCE_EVENTS_LOG[0 : len(_MAINTENANCE_EVENTS_LOG) - _MAINTENANCE_EVENTS_MAX]


def maintenance_events_since(last_seq: int) -> list[dict]:
    with _MAINTENANCE_EVENTS_LOCK:
        return [e for e in _MAINTENANCE_EVENTS_LOG if int(e.get("seq", 0)) > last_seq]
