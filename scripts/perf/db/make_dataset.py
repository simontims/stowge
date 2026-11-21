"""Build a large synthetic Stowge DB for perf benchmarks.

usage: make_dataset.py SRC_LIVE_COPY DEST [items=20000]
Starts from a copy of a real (old-schema) DB so existing-DB index gaps are
reproduced, wipes the data tables and inserts synthetic rows.
"""
import random
import shutil
import sqlite3
import sys
import uuid

src, dest = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
shutil.copy(src, dest)
c = sqlite3.connect(dest)
random.seed(7)
uid = lambda: str(uuid.uuid4())
for t in ("item_tags", "images", "item_contents", "parts", "sessions", "locations", "tags", "api_keys"):
    c.execute(f"delete from {t}")
site = c.execute("select id from sites").fetchone()[0]
areas = [r[0] for r in c.execute("select id from areas")]
user = c.execute("select id from users").fetchone()[0]
locs = [uid() for _ in range(5000)]
c.executemany("insert into locations(id,name,area_id,item_count,created_at,updated_at) values(?,?,?,0,'2026-01-01','2026-01-01')",
              [(l, f"Shelf {i:05d} bin", random.choice(areas), ) for i, l in enumerate(locs)])
tags = [uid() for _ in range(200)]
c.executemany("insert into tags(id,name,created_at,updated_at) values(?,?,'2026-01-01','2026-01-01')",
              [(t, f"Tag{i:03d}") for i, t in enumerate(tags)])
words = "resistor capacitor screw bolt cable adapter sensor board relay switch fuse led motor gear spring washer nut connector battery".split()
parts, its, imgs = [], [], []
for i in range(N):
    p = uid()
    name = f"{random.choice(words)} {random.choice(words)} {i}"
    parts.append((p, name, f"desc {random.choice(words)} {random.choice(words)}", random.choice(["draft", "confirmed", "confirmed"]),
                  random.choice(locs) if random.random() > .05 else None, random.randint(0, 50), 1 if random.random() < .03 else 0,
                  f"2026-01-{1+i%28:02d}T00:00:00", f"2026-02-{1+i%28:02d}T00:00:00"))
    for t in random.sample(tags, random.randint(2, 4)):
        its.append((p, t))
    for k in range(3):
        imgs.append((uid(), p, "2026-01-01", "t", "d", "image/webp", 1 if k == 0 else 0))
c.executemany("insert into parts(id,name,description,status,location_id,quantity,is_deleted,created_at,updated_at) values(?,?,?,?,?,?,?,?,?)", parts)
c.executemany("insert into item_tags values(?,?)", its)
c.executemany("insert into images(id,part_id,created_at,path_thumb,path_display,mime,is_primary) values(?,?,?,?,?,?,?)", imgs)
# 1000 sessions, mostly expired, for lookup/cleanup
c.executemany("insert into sessions values(?,?,?,?,?)",
              [(uuid.uuid4().hex + uuid.uuid4().hex, user, "2026-01-01", "2026-01-01", "2027-01-01" if i % 10 == 0 else "2026-01-02") for i in range(1000)])
c.execute("insert into sessions values('known-session',?, '2026-01-01','2026-01-01','2027-01-01')", (user,))
c.commit()
c.execute("vacuum")
for t in ("parts", "images", "item_tags", "locations", "tags", "sessions"):
    print(t, c.execute(f"select count(*) from {t}").fetchone()[0])
