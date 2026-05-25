"""Shared UTC datetime utilities.

Consolidates _utc_iso, _coerce_utc, utc_now_iso, and now_utc into a
single module so the codebase has one consistent approach to timezone handling.
"""

from datetime import datetime, timezone


def now_utc() -> datetime:
    """Return the current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def utc_iso(dt: datetime | None) -> str | None:
    """Return an ISO-8601 string always suffixed with 'Z' (UTC).

    SQLite drops timezone info on round-trip, so naive datetimes that
    originated from datetime.now(timezone.utc) are explicitly re-marked.
    Returns None when dt is None.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def coerce_utc(dt: datetime | None) -> datetime | None:
    """Ensure a datetime is timezone-aware UTC.

    - None → None
    - Naive → assumed UTC, tagged with tzinfo
    - Aware (non-UTC) → converted to UTC
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def utc_now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string with 'Z' suffix."""
    return now_utc().isoformat().replace("+00:00", "Z")
