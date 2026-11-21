"""Time the real hot-path code against a DB file.

usage: DATABASE_URL=sqlite:////path/db python bench_queries.py [--plans] [--runs 7]
Runs from api/ (cd api && .venv/bin/python ../scripts/perf/db/bench_queries.py).
Prints median ms per scenario; --plans prints EXPLAIN QUERY PLAN of captured SQL.
"""
import statistics
import sys
import time
from datetime import datetime, timezone

from sqlalchemy import event

from stowge.db import SessionLocal, engine
from stowge.helpers.serializers import tag_item_counts, list_locations_payload
from stowge.models import Part, UserSession, User, Tag
from stowge.routes.items import list_parts, get_part

runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 7
plans = "--plans" in sys.argv
db = SessionLocal()
cap: list[str] = []


@event.listens_for(engine, "before_cursor_execute")
def _cap(conn, cur, stmt, params, ctx, many):
    cap.append((stmt, params))


tag0 = db.query(Tag.name).order_by(Tag.name).first()[0]
tag1 = db.query(Tag.name).order_by(Tag.name.desc()).first()[0]
loc = db.query(Part.location_id).filter(Part.location_id.isnot(None)).first()[0]
pid = db.query(Part.id).first()[0]
D = dict(q=None, tag=None, location=None, status=None, site_id=None, area_id=None, location_id=None,
         quantity_min=None, quantity_max=None, sort_by=None, sort_dir=None, db=db, me=None)
S = {
    "list default": lambda: list_parts(**D),
    "list q=resistor": lambda: list_parts(**{**D, "q": "resistor"}),
    "list q=zzzz (no hit)": lambda: list_parts(**{**D, "q": "zzzz"}),
    "list 1 tag": lambda: list_parts(**{**D, "tag": [tag0]}),
    "list 2 tags": lambda: list_parts(**{**D, "tag": [tag0, tag1]}),
    "list status+qty": lambda: list_parts(**{**D, "status": "draft", "quantity_min": 5, "quantity_max": 20}),
    "list location_id": lambda: list_parts(**{**D, "location_id": loc}),
    "list sort location": lambda: list_parts(**{**D, "sort_by": "location"}),
    "list sort tags": lambda: list_parts(**{**D, "sort_by": "tags"}),
    "list sort status desc": lambda: list_parts(**{**D, "sort_by": "status", "sort_dir": "desc"}),
    "tag counts (all)": lambda: tag_item_counts(db),
    "locations list": lambda: list_locations_payload(db),
    "item detail": lambda: get_part(pid, include_deleted=False, db=db, me=None),
    "session lookup": lambda: db.query(UserSession).filter(UserSession.id == "known-session", UserSession.expires_at > datetime.now(timezone.utc)).first(),
    "session prune (user)": lambda: db.query(UserSession).filter(UserSession.expires_at < datetime(2020, 1, 1, tzinfo=timezone.utc)).count(),
    "location item delete-check": lambda: db.query(Part).filter(Part.location_id == loc).count(),
}
for name, fn in S.items():
    try:
        fn()
    except TypeError as e:
        print(f"{name:28s} SKIP {e}")
        continue
    ts = []
    for _ in range(runs):
        db.rollback()
        t = time.perf_counter(); fn(); ts.append((time.perf_counter() - t) * 1000)
    print(f"{name:28s} median {statistics.median(ts):9.2f} ms  min {min(ts):9.2f}")
    if plans:
        cap.clear(); fn()
        raw = engine.raw_connection()
        for stmt, params in cap[:3]:
            if not stmt.lstrip().upper().startswith("SELECT"):
                continue
            rows = raw.execute("EXPLAIN QUERY PLAN " + stmt, params if isinstance(params, (tuple, list)) else tuple(params)).fetchall()
            print("   ", stmt[:70].replace("\n", " "))
            for r in rows:
                print("      ", r[-1])
        raw.close()
