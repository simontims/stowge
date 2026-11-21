"""Dump normalised response bodies for a fixed URL set so two code versions can be diffed.
Usage (from the api/ dir of the version under test): DATABASE_DIR=... python dump_bodies.py out.json"""
import os, sys, json, re
os.environ.setdefault("IMAGE_URL_SECRET", "bench-secret")
from fastapi.testclient import TestClient
from stowge.db import SessionLocal
from stowge.main import app
from stowge.models import User, Part, Tag, Location
from stowge.auth import create_session, SESSION_COOKIE_NAME
db = SessionLocal(); u = db.query(User).filter(User.role == "admin").first() or db.query(User).first()
sid = create_session(u, db)
part = db.query(Part).filter(Part.is_deleted == 0).order_by(Part.name).first()
dpart = db.query(Part).filter(Part.is_deleted == 1).first()
tag = db.query(Tag.name).first()[0]; loc = db.query(Location).first()
db.close()
c = TestClient(app, cookies={SESSION_COOKIE_NAME: sid})
urls = ["/api/me", "/api/items", "/api/items?q=bolt", f"/api/items?tag={tag}", "/api/items?tag=__none",
        "/api/items?sort_by=tags&sort_dir=desc", "/api/items?sort_by=location", "/api/items?status=draft,confirmed&quantity_min=5",
        "/api/items/deleted", f"/api/items/{part.id}", f"/api/items/{dpart.id}?include_deleted=true", "/api/items/bootstrap",
        "/api/tags", "/api/locations", f"/api/locations?area_id={loc.area_id}", "/api/areas", "/api/sites", "/api/hints",
        "/api/export/csv", "/api/export/csv?scope=all", f"/api/export/csv?tag={tag}", "/api/nope"]
norm = lambda t: re.sub(r"exp=\d+&sig=[0-9a-f]+", "exp=X&sig=S", t)
out = {}
for url in urls:
    r = c.get(url, headers={"Accept-Encoding": "identity"})
    out[url] = {"status": r.status_code, "ctype": r.headers.get("content-type"), "body": norm(r.text)}
json.dump(out, open(sys.argv[1], "w"))
print(len(out), "urls")
