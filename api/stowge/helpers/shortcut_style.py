"""Icon and colour fields on user shortcut filters."""

from __future__ import annotations

import re

_ICON_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def parse_icon(value: object) -> str | None:
    """Return a valid icon name, or None when empty. Raises ValueError when set but invalid."""
    text = str(value or "").strip()
    if not text:
        return None
    if not _ICON_RE.match(text):
        raise ValueError("icon must be an icon name (letters, digits, '-' or '_', up to 64 characters)")
    return text


def parse_color(value: object) -> str | None:
    """Return a lower-cased hex colour, or None when empty. Raises ValueError when set but invalid."""
    text = str(value or "").strip()
    if not text:
        return None
    if not _COLOR_RE.match(text):
        raise ValueError("color must be a hex colour such as #38bdf8")
    return text.lower()


def lenient_icon(value: object) -> str | None:
    try:
        return parse_icon(value)
    except ValueError:
        return None


def lenient_color(value: object) -> str | None:
    try:
        return parse_color(value)
    except ValueError:
        return None
