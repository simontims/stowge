"""Request-path performance guards: bounded query counts, chunked export, compression, caching."""
import csv
import gzip
import io
import json
from datetime import datetime, timedelta, timezone

from conftest import auth_cookies_isolated
from sqlalchemy import event

from stowge.auth import SESSION_COOKIE_NAME
from stowge.helpers.serializers import tags_by_item_id
from stowge.models import (Area, ItemContentsEntry, ItemTag, Location, Part,
                           PartImage, Site, Tag, UserSession)


class QueryCounter:
    def __init__(self, session_factory):
        self.engine = session_factory.kw["bind"]
        self.count = 0
        self.statements: list[str] = []

    def _on(self, conn, cursor, statement, params, context, executemany):
        self.count += 1
        self.statements.append(statement)

    def __enter__(self):
        event.listen(self.engine, "before_cursor_execute", self._on)
        return self

    def __exit__(self, *exc):
        event.remove(self.engine, "before_cursor_execute", self._on)


def _seed_items(isolated_db, n: int, tag_count: int = 3, start: int = 0):
    db = isolated_db()
    try:
        if db.query(Site).count():
            tags = db.query(Tag).order_by(Tag.name).all()
            locs = db.query(Location).filter(Location.name.like("loc%")).order_by(Location.name).all()
        else:
            tags = [Tag(name=f"tag{i}") for i in range(tag_count)]
            site = Site(name="S")
            db.add_all(tags + [site])
            db.flush()
            area = Area(name="A", site_id=site.id)
            db.add(area)
            db.flush()
            locs = [Location(name=f"loc{i}", area_id=area.id) for i in range(4)]
            db.add_all(locs)
            db.flush()
        for i in range(start, start + n):
            part = Part(name=f"item{i:03d}", location_id=locs[i % 4].id, ai_alternatives=[{"x": "y" * 50}])
            db.add(part)
            db.flush()
            db.add_all([PartImage(id=f"img-{i}-{k}", part_id=part.id, path_thumb="t.webp", path_display="d.webp",
                                  is_primary=1 if k == 0 else 0) for k in range(3)])
            db.add(ItemContentsEntry(item_id=part.id, name="c", quantity=1, sort_order=0))
            for tag in tags[: i % (tag_count + 1)]:
                db.add(ItemTag(item_id=part.id, tag_id=tag.id))
        db.commit()
    finally:
        db.close()


def _count_for(client, isolated_db, cookies, url: str) -> int:
    client.get(url, cookies=cookies)  # warm (session touch etc.)
    with QueryCounter(isolated_db) as qc:
        r = client.get(url, cookies=cookies)
    assert r.status_code == 200, r.text
    return qc.count


def test_item_list_query_count_does_not_grow_with_rows(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-list@example.com", role="admin")
    _seed_items(isolated_db, 5)
    small = _count_for(isolated_client, isolated_db, cookies, "/api/items")
    _seed_items(isolated_db, 60, start=5)
    big = _count_for(isolated_client, isolated_db, cookies, "/api/items")
    assert big == small
    assert big <= 10  # auth(1) + list + images + locations + contents + tags(2)


def test_item_list_body_unchanged_by_loader_options(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-body@example.com", role="admin")
    _seed_items(isolated_db, 6)
    body = isolated_client.get("/api/items", cookies=cookies).json()
    assert [row["name"] for row in body] == sorted(row["name"] for row in body)
    row = body[3]
    assert set(row) == {"id", "name", "description", "tags", "location", "status", "quantity",
                        "contents_count", "created_at", "thumb"}
    assert row["thumb"].startswith("/api/images/img-3-0?variant=thumb&exp=")  # primary image chosen
    assert row["contents_count"] == 1
    assert [t["name"] for t in row["tags"]] == ["tag0", "tag1", "tag2"][: 3 % 4]
    # AI blobs are still returned by the detail endpoint (only deferred in the list).
    detail = isolated_client.get(f"/api/items/{row['id']}", cookies=cookies).json()
    assert detail["ai_alternatives"] == [{"x": "y" * 50}]


def test_deleted_list_query_count_bounded(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-del@example.com", role="admin")
    _seed_items(isolated_db, 40)
    db = isolated_db()
    db.query(Part).update({"is_deleted": 1})
    db.commit()
    db.close()
    assert _count_for(isolated_client, isolated_db, cookies, "/api/items/deleted") <= 10


def test_locations_list_query_count_is_constant(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-loc@example.com", role="admin")
    _seed_items(isolated_db, 2)
    small = _count_for(isolated_client, isolated_db, cookies, "/api/locations")
    db = isolated_db()
    area = db.query(Area).first()
    db.add_all([Location(name=f"extra{i}", area_id=area.id) for i in range(30)])
    db.commit()
    db.close()
    body = isolated_client.get("/api/locations", cookies=cookies).json()
    assert len(body) == 34
    assert {(b["area_name"], b["site_name"]) for b in body} == {("A", "S")}
    assert _count_for(isolated_client, isolated_db, cookies, "/api/locations") == small


def test_authenticated_request_uses_single_session_lookup(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-auth@example.com", role="admin")
    with QueryCounter(isolated_db) as qc:
        assert isolated_client.get("/api/sites", cookies=cookies).status_code == 200
    selects = [s for s in qc.statements if "FROM sessions" in s]
    assert len(selects) == 1 and "JOIN users" in selects[0]
    assert not any(s.lstrip().upper().startswith("UPDATE") for s in qc.statements)


def test_last_seen_write_is_throttled_but_still_happens_when_stale(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-seen@example.com", role="admin")
    token = cookies[SESSION_COOKIE_NAME]

    def last_seen():
        db = isolated_db()
        try:
            return db.query(UserSession).filter(UserSession.id == token).one().last_seen_at
        finally:
            db.close()

    before = last_seen()
    isolated_client.get("/api/sites", cookies=cookies)
    assert last_seen() == before  # fresh: no write

    db = isolated_db()
    row = db.query(UserSession).filter(UserSession.id == token).one()
    row.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=10)
    db.commit()
    db.close()
    stale = last_seen()
    with QueryCounter(isolated_db) as qc:
        isolated_client.get("/api/sites", cookies=cookies)
    assert last_seen() > stale
    assert any(s.lstrip().upper().startswith("UPDATE") for s in qc.statements)


def test_tags_by_item_id_matches_join_semantics(isolated_db):
    db = isolated_db()
    try:
        b, a, c = Tag(name="beta"), Tag(name="Alpha"), Tag(name="gamma")
        p = Part(name="p")
        db.add_all([b, a, c, p])
        db.flush()
        db.add_all([ItemTag(item_id=p.id, tag_id=t.id) for t in (c, b, a)])
        db.commit()
        out = tags_by_item_id(db, [p.id, "missing"])
        assert list(out) == [p.id]
        assert [t["name"] for t in out[p.id]] == ["Alpha", "beta", "gamma"]
        assert set(out[p.id][0]) == {"id", "name", "icon", "color"}
        assert tags_by_item_id(db, []) == {}
    finally:
        db.close()


def test_csv_export_chunks_and_content(isolated_client, isolated_db, monkeypatch):
    monkeypatch.setattr("stowge.routes.export._CSV_CHUNK_BYTES", 200)
    cookies = auth_cookies_isolated(isolated_db, "perf-csv@example.com", role="admin")
    _seed_items(isolated_db, 25)
    with isolated_client.stream("GET", "/api/export/csv", cookies=cookies, headers={"Accept-Encoding": "identity"}) as r:
        chunks = list(r.iter_raw())
    assert 2 < len(chunks) < 26  # batched, not one chunk per row
    rows = list(csv.reader(io.StringIO(b"".join(chunks).decode())))
    assert rows[0][:3] == ["name", "description", "tags"]
    assert len(rows) == 26
    assert [r_[0] for r_ in rows[1:]] == sorted(r_[0] for r_ in rows[1:])
    assert rows[1][5] == "loc0" and rows[1][3] == "S" and rows[1][4] == "A"
    assert rows[1][8] == "c (x1)"


def test_large_json_is_gzipped_and_identical(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-gzip@example.com", role="admin")
    _seed_items(isolated_db, 30)
    plain = isolated_client.get("/api/items", cookies=cookies, headers={"Accept-Encoding": "identity"})
    with isolated_client.stream("GET", "/api/items", cookies=cookies, headers={"Accept-Encoding": "gzip"}) as r:
        raw = b"".join(r.iter_raw())
        assert r.headers["content-encoding"] == "gzip"
        assert "accept-encoding" in r.headers["vary"].lower()
    assert "content-encoding" not in plain.headers
    assert len(raw) < len(plain.content) / 2
    a, b = json.loads(gzip.decompress(raw)), plain.json()
    strip = lambda rows: [{k: v for k, v in row.items() if k != "thumb"} for row in rows]  # noqa: E731
    assert strip(a) == strip(b)


def test_small_json_not_compressed(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "perf-small@example.com", role="admin")
    r = isolated_client.get("/api/sites", cookies=cookies, headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in r.headers


def test_security_headers_on_all_responses(isolated_client):
    for url in ("/healthz", "/api/me", "/api/does-not-exist"):
        r = isolated_client.get(url)
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert r.headers["permissions-policy"] == "camera=(self)"


def test_hashed_assets_get_immutable_cache_control(isolated_client, tmp_path, monkeypatch):
    from fastapi.staticfiles import StaticFiles
    from stowge.main import app

    (tmp_path / "app-abc123.js").write_text("console.log(1)")
    for route in app.routes:
        if getattr(route, "path", None) == "/assets":
            monkeypatch.setattr(route, "app", StaticFiles(directory=str(tmp_path)))
    r = isolated_client.get("/assets/app-abc123.js")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert r.headers["etag"]
    r2 = isolated_client.get("/assets/app-abc123.js", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304
    # Non-asset routes keep their own policy.
    assert "immutable" not in isolated_client.get("/api/me").headers.get("cache-control", "")


def test_image_endpoint_cache_headers_and_304(isolated_client, isolated_db, tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    monkeypatch.setenv("IMAGE_URL_SECRET", "perf-secret")
    (tmp_path / "t.webp").write_bytes(b"RIFFxxxxWEBP" * 10)
    cookies = auth_cookies_isolated(isolated_db, "perf-img@example.com", role="admin")
    _seed_items(isolated_db, 1)
    db = isolated_db()
    db.query(PartImage).update({"path_thumb": "t.webp"})
    db.commit()
    db.close()
    url = isolated_client.get("/api/items", cookies=cookies).json()[0]["thumb"]
    r = isolated_client.get(url)  # signed URL, no cookie needed
    assert r.status_code == 200
    assert r.headers["cache-control"] == "public, max-age=604800, immutable"
    etag = r.headers["etag"]
    r2 = isolated_client.get(url, headers={"If-None-Match": etag})
    assert r2.status_code == 304 and r2.content == b""
    assert "content-encoding" not in r.headers  # images are never re-compressed


# --- review-fix guards -------------------------------------------------------------------------

def _image_setup(isolated_client, isolated_db, tmp_path, monkeypatch, email, real_image=False):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    monkeypatch.setenv("IMAGE_URL_SECRET", "perf-secret")
    if real_image:
        from PIL import Image
        Image.effect_noise((64, 32), 80).convert("RGB").save(tmp_path / "t.webp", format="WEBP")
    else:
        (tmp_path / "t.webp").write_bytes(b"RIFFxxxxWEBP" * 10)
    cookies = auth_cookies_isolated(isolated_db, email, role="admin")
    _seed_items(isolated_db, 1)
    db = isolated_db()
    db.query(PartImage).update({"path_thumb": "t.webp"})
    db.commit()
    image_id = db.query(PartImage).first().id
    db.close()
    url = isolated_client.get("/api/items", cookies=cookies).json()[0]["thumb"]
    return cookies, url, image_id


def test_image_with_authorization_header_does_not_500(isolated_client, isolated_db, tmp_path, monkeypatch):
    cookies, url, image_id = _image_setup(isolated_client, isolated_db, tmp_path, monkeypatch, "perf-hdr@example.com")
    path = f"/api/images/{image_id}?variant=thumb"
    hdr = {"Authorization": "Bearer whatever"}
    assert isolated_client.get(path, cookies=cookies, headers=hdr).status_code == 200
    isolated_client.cookies.clear()
    assert isolated_client.get(path, headers=hdr).status_code == 401


def test_image_304_never_bypasses_signature(isolated_client, isolated_db, tmp_path, monkeypatch):
    import time
    from urllib.parse import parse_qs, urlparse
    from stowge.helpers.serializers import sign_image
    cookies, url, image_id = _image_setup(isolated_client, isolated_db, tmp_path, monkeypatch, "perf-sig@example.com")
    etag = isolated_client.get(url).headers["etag"]
    inm = {"If-None-Match": etag}
    q = parse_qs(urlparse(url).query)
    base = f"/api/images/{image_id}?variant=thumb"
    past = int(time.time()) - 10
    bad = [
        base,  # missing
        f"{base}&exp={q['exp'][0]}&sig=deadbeef",  # bad signature
        f"{base}&exp={past}&sig={sign_image(image_id, 'thumb', past)}",  # expired
    ]
    for u in bad:
        assert isolated_client.get(u, headers=inm).status_code == 401, u
    assert isolated_client.get(url, headers=inm).status_code == 304


def test_image_etag_changes_when_rotated(isolated_client, isolated_db, tmp_path, monkeypatch):
    cookies, url, image_id = _image_setup(isolated_client, isolated_db, tmp_path, monkeypatch, "perf-rot@example.com", real_image=True)
    r1 = isolated_client.get(url)
    assert r1.status_code == 200
    assert isolated_client.post(f"/api/images/{image_id}/rotate", cookies=cookies).status_code == 200
    r2 = isolated_client.get(url, headers={"If-None-Match": r1.headers["etag"]})
    assert r2.status_code == 200 and r2.content != r1.content
    assert r2.headers["etag"] != r1.headers["etag"]


def test_tags_by_item_id_across_chunk_boundaries(isolated_db):
    db = isolated_db()
    try:
        tags = [Tag(name=n) for n in ("beta", "Alpha", "alpha2", "Gamma", "delta")]
        db.add_all(tags)
        parts = [Part(name=f"p{i}") for i in range(1203)]
        db.add_all(parts)
        db.flush()
        for i, p in enumerate(parts):
            for t in tags[: (i % len(tags)) + 1][::-1]:
                db.add(ItemTag(item_id=p.id, tag_id=t.id))
        db.commit()
        ids = [p.id for p in parts]
        out = tags_by_item_id(db, ids)
        for pid in ids:
            rows = (db.query(Tag.id, Tag.name, Tag.icon, Tag.color).join(ItemTag, ItemTag.tag_id == Tag.id)
                    .filter(ItemTag.item_id == pid).all())
            expected = [{"id": a, "name": b, "icon": c, "color": d}
                        for a, b, c, d in sorted(rows, key=lambda r: (r[1].lower(), r[1]))]
            assert out[pid] == expected
        assert len(out) == len(ids)
    finally:
        db.close()


def test_vacuum_connects_with_long_busy_timeout(tmp_path, monkeypatch):
    import sqlite3
    from stowge.helpers import maintenance
    db_file = tmp_path / "v.db"
    sqlite3.connect(db_file).close()
    monkeypatch.setattr(maintenance, "DATABASE_FILE", str(db_file))
    seen = {}
    real = sqlite3.connect

    def spy(*a, **kw):
        seen.update(kw)
        seen["args"] = a
        return real(*a, **kw)

    monkeypatch.setattr(sqlite3, "connect", spy)
    assert "freed_bytes" in maintenance.run_vacuum_once()
    timeout = seen.get("timeout", seen["args"][1] if len(seen["args"]) > 1 else 5.0)
    assert timeout >= 30
