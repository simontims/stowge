"""In-process API benchmark: timing (median of N), SQL statements, payload size per endpoint.
Usage (from api/): DATABASE_DIR=<dir with stowge.db> ASSETS_DIR=<assets> IMAGE_URL_SECRET=x \
  .venv/bin/python ../scripts/perf/api/bench.py [runs] [--json out.json]
Never point DATABASE_DIR at live data; seed.py builds a copy."""
import os, sys, time, json, statistics, uuid
os.environ.setdefault("IMAGE_URL_SECRET", "bench-secret")
os.environ.setdefault("SESSION_COOKIE_SECURE", "false")
os.environ.setdefault("UI_DIR", "/nonexistent")
from sqlalchemy import event
from fastapi.testclient import TestClient
from stowge.db import engine, SessionLocal
from stowge.main import app
from stowge.models import User, Part, PartImage
from stowge.auth import create_session, hash_password, SESSION_COOKIE_NAME

counter = {"n": 0}
@event.listens_for(engine, "before_cursor_execute")
def _c(conn, cur, stmt, params, ctx, many): counter["n"] += 1

runs = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 7
db = SessionLocal()
u = db.query(User).filter(User.username == "bench@example.com").first()
if not u:
    u = User(username="bench@example.com", password_hash=hash_password("x"), role="admin"); db.add(u); db.commit(); db.refresh(u)
sid = create_session(u, db)
part = db.query(Part).filter(Part.is_deleted == 0).first()
img = db.query(PartImage).first()
tagname = None
from stowge.models import Tag
tagname = db.query(Tag.name).first()[0]
db.close()
c = TestClient(app, cookies={SESSION_COOKIE_NAME: sid})
from stowge.helpers.serializers import signed_image_url
imgurl = signed_image_url(img.id, "thumb")
cases = [
 ("me", "/api/me"),
 ("items default", "/api/items"),
 ("items q=bolt", "/api/items?q=bolt"),
 ("items tag", f"/api/items?tag={tagname}"),
 ("items sort tags", "/api/items?sort_by=tags"),
 ("items status+loc", "/api/items?status=confirmed&sort_by=location"),
 ("item detail", f"/api/items/{part.id}"),
 ("tags", "/api/tags"),
 ("locations", "/api/locations"),
 ("areas", "/api/areas"),
 ("sites", "/api/sites"),
 ("hints", "/api/hints"),
 ("image thumb", imgurl),
 ("export csv", "/api/export/csv"),
]
out = {}
print(f"{'case':<20}{'status':>7}{'ms(med)':>10}{'sql':>6}{'bytes':>10}")
for name, url in cases:
    ts = []; r = None
    for i in range(runs + 1):
        counter["n"] = 0
        t = time.perf_counter(); r = c.get(url); dt = (time.perf_counter() - t) * 1000
        if i: ts.append(dt)  # first run is warmup
    out[name] = dict(status=r.status_code, ms=round(statistics.median(ts), 2), sql=counter["n"], bytes=len(r.content))
    print(f"{name:<20}{r.status_code:>7}{out[name]['ms']:>10}{counter['n']:>6}{len(r.content):>10}")
if "--json" in sys.argv:
    json.dump(out, open(sys.argv[sys.argv.index("--json") + 1], "w"), indent=1)
