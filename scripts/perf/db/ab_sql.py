"""Interleaved A/B of the hot-path SQL across DB variants (raw sqlite3, no ORM noise).

usage (from api/): PYTHONPATH=. python ../scripts/perf/db/ab_sql.py DB_A DB_B [DB_C...]  [--runs N]
Statements are captured by running the real route code against DB_A. Prints min/median ms per statement per DB.
"""
import os, sqlite3, statistics, sys, time

args = [a for a in sys.argv[1:] if not a.startswith("--")]
runs = int(sys.argv[sys.argv.index("--runs") + 1]) if "--runs" in sys.argv else 15
if "--runs" in sys.argv:
    args.remove(sys.argv[sys.argv.index("--runs") + 1])
os.environ["DATABASE_URL"] = "sqlite:///" + args[0]
from datetime import datetime, timezone
from sqlalchemy import event
from stowge.db import SessionLocal, engine
from stowge.helpers.serializers import list_locations_payload, tag_item_counts
from stowge.models import Part, Tag
from stowge.routes.items import list_parts

db = SessionLocal(); cap = []
@event.listens_for(engine, "before_cursor_execute")
def _c(conn, cur, st, p, ctx, many): cap.append((st, tuple(p)))
t0 = db.query(Tag.name).order_by(Tag.name).first()[0]; t1 = db.query(Tag.name).order_by(Tag.name.desc()).first()[0]
loc = db.query(Part.location_id).filter(Part.location_id.isnot(None)).first()[0]
D = dict(q=None, tag=None, location=None, status=None, site_id=None, area_id=None, location_id=None,
         quantity_min=None, quantity_max=None, sort_by=None, sort_dir=None, db=db, me=None)
sc = {"default": {}, "q=resistor": {"q": "resistor"}, "q=zzzz": {"q": "zzzz"}, "1 tag": {"tag": [t0]},
      "2 tags": {"tag": [t0, t1]}, "status+qty": {"status": "draft", "quantity_min": 5, "quantity_max": 20},
      "location_id": {"location_id": loc}, "sort location": {"sort_by": "location"},
      "sort tags": {"sort_by": "tags"}, "sort status": {"sort_by": "status", "sort_dir": "desc"}}
Q = {}
for n, kw in sc.items():
    cap.clear(); list_parts(**{**D, **kw}); Q["list " + n] = [c for c in cap if "FROM parts" in c[0] and "LIMIT" in c[0]][0]
cap.clear(); tag_item_counts(db); Q["tag counts"] = cap[-1]
cap.clear(); list_locations_payload(db); Q["location counts"] = [c for c in cap if "count(parts.id)" in c[0]][0]
Q["location in-use"] = ("SELECT count(*) FROM parts WHERE location_id = ?", (loc,))
conns = {p: sqlite3.connect(p) for p in args}
res = {k: {p: [] for p in args} for k in Q}
for _ in range(runs):
    for k, (st, pr) in Q.items():
        for p, c in conns.items():
            t = time.perf_counter(); c.execute(st, pr).fetchall(); res[k][p].append((time.perf_counter() - t) * 1000)
print(f"{'query':18s}" + "".join(f"{os.path.basename(p)[:14]:>22s}" for p in args) + "   (min/median ms)")
for k in Q:
    print(f"{k:18s}" + "".join(f"{min(res[k][p]):10.2f}/{statistics.median(res[k][p]):<10.2f} " for p in args))
