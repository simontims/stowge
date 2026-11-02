"""What's New and the welcome flow.

Two separate things, tracked per user:

* **Welcome flow** - a tour of the product as it is *today*, for new users. It is edited whenever
  the product changes, so a version number is recorded: ``users.welcome_seen_version`` (0 = never
  seen). Editing the welcome flow does not re-show it to people who already saw it; they hear
  about changes through What's New instead. Bump ``WELCOME_VERSION`` only for a rewrite that is
  worth showing to nobody twice, i.e. keep it at 1 unless the stored meaning changes.
* **What's New notes** - what changed. Each note has an increasing ``seq``. A user keeps one
  cursor, ``users.last_seen_note`` (the highest seq they have dealt with). Everything above it is
  unseen. New accounts start at the latest seq (they get the welcome flow instead).

A note has a severity:
Each note also records the release ``version`` it shipped in; the What's New page groups by it.

* ``interrupt`` - changes behaviour users rely on. Shown once as a card at login.
* ``dot``       - everything else. Only lights the unread dot on the "What's New" menu entry.

A note may list older note ids it ``supersedes``. When both are unseen, the older one is hidden, so
a user who was away never has to read something that was since replaced. The What's New page keeps
the full history.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field

SEVERITY_INTERRUPT = "interrupt"
SEVERITY_DOT = "dot"
SEVERITIES = (SEVERITY_INTERRUPT, SEVERITY_DOT)

# Bump only for a welcome flow rewrite that should be shown again to everybody who saw an older one.
WELCOME_VERSION = 1


@dataclass(frozen=True)
class Note:
    id: str
    seq: int
    severity: str
    version: str  # release the change shipped in, e.g. "0.11.0"; the What's New page groups by it
    title: str
    summary: str
    date: str | None = None
    supersedes: tuple[str, ...] = field(default_factory=tuple)

    def public(self) -> dict:
        return {
            "id": self.id,
            "seq": self.seq,
            "severity": self.severity,
            "version": self.version,
            "title": self.title,
            "summary": self.summary,
            "date": self.date,
            "supersedes": list(self.supersedes),
        }


# Notes shipped with this build, oldest first. To add one: append a Note with the next seq and the release version it ships in, and (for a guided tour) register a component for the
# same id in ui/src/components/onboarding/whatsNew/registry.ts.
NOTES: tuple[Note, ...] = (
    Note(
        id="welcome-tour",
        seq=1,
        severity=SEVERITY_DOT,
        version="0.11.0",
        date="2026-11-02",
        title="Welcome to Stowge tour",
        summary="New users get a short tour. Replay it any time from your user menu.",
    ),
    Note(
        id="filter-icons",
        seq=2,
        severity=SEVERITY_DOT,
        version="0.11.0",
        date="2026-11-02",
        title="Icons and colours for shortcut filters",
        summary="Choose an icon and a colour for each filter in Settings.",
    ),
    Note(
        id="tags-and-hints",
        seq=3,
        severity=SEVERITY_INTERRUPT,
        version="0.12.0",
        date="2026-11-02",
        title="Collections are now tags",
        summary=(
            "Your collections became tags, and an item can have several. "
            "AI hints are now a separate list. Your menu looks the same."
        ),
    ),
)

# Test/preview seam: a JSON list of extra notes, appended after NOTES with the next seq numbers.
# Example: [{"id":"x","severity":"interrupt","version":"0.11.0","title":"T","summary":"S","supersedes":["y"]}].
# Leave unset in production.
PREVIEW_NOTES_ENV = "STOWGE_PREVIEW_NOTES"


def _preview_notes(start_seq: int) -> list[Note]:
    raw = os.environ.get(PREVIEW_NOTES_ENV, "").strip()
    if not raw:
        return []
    try:
        rows = json.loads(raw)
    except Exception:
        return []
    out: list[Note] = []
    if not isinstance(rows, list):
        return out
    for row in rows:
        if not isinstance(row, dict):
            continue
        note_id = str(row.get("id") or "").strip()
        severity = str(row.get("severity") or SEVERITY_DOT).strip()
        version = str(row.get("version") or "").strip()
        if not note_id or severity not in SEVERITIES or not version:
            continue
        out.append(Note(
            id=note_id,
            seq=start_seq + len(out),
            severity=severity,
            version=version,
            title=str(row.get("title") or note_id),
            summary=str(row.get("summary") or ""),
            date=str(row.get("date") or "") or None,
            supersedes=tuple(str(s) for s in (row.get("supersedes") or []) if str(s).strip()),
        ))
    return out


def all_notes() -> list[Note]:
    base = list(NOTES)
    next_seq = (base[-1].seq + 1) if base else 1
    return base + _preview_notes(next_seq)


def latest_seq() -> int:
    notes = all_notes()
    return notes[-1].seq if notes else 0


def unseen_notes(last_seen: int) -> list[Note]:
    """Notes above the cursor, minus any that a newer unseen note supersedes, oldest first."""
    pending = [n for n in all_notes() if n.seq > (last_seen or 0)]
    replaced = {old for n in pending for old in n.supersedes}
    return [n for n in pending if n.id not in replaced]


def history(last_seen: int) -> list[dict]:
    """Notes for the What's New page, newest first. A note that a later note replaced is left out:
    it is out of date, so there is nothing to read. ``unread`` = still new to this user."""
    all_ = all_notes()
    replaced = {old for n in all_ for old in n.supersedes}
    unseen_ids = {n.id for n in unseen_notes(last_seen)}
    return [{**n.public(), "unread": n.id in unseen_ids} for n in reversed(all_) if n.id not in replaced]


def whats_new_for_user(last_seen: int, welcome_seen_version: int) -> dict:
    """The per-user state the UI needs (part of /api/me). ``tags_migration`` is added by the serializer."""
    unseen = unseen_notes(last_seen)
    return {
        "latest_seq": latest_seq(),
        "unseen": [n.public() for n in unseen],
        "unseen_interrupt_count": sum(1 for n in unseen if n.severity == SEVERITY_INTERRUPT),
        "welcome_pending": (welcome_seen_version or 0) < WELCOME_VERSION,
    }


def cursor_for_new_account() -> int:
    """New accounts start at the latest note: they get the welcome flow, not old What's New."""
    return latest_seq()


def clamp_cursor(current: int, requested: int | None) -> int:
    """Next cursor value: never goes down, never past the latest note. None = latest."""
    target = latest_seq() if requested is None else max(0, min(int(requested), latest_seq()))
    return max(int(current or 0), target)
