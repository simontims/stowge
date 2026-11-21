"""Build a synthetic benchmark DB: python seed.py <live.db (read-only)> <out_dir> [items]
Copies the live DB via sqlite backup from a mode=ro URI, then adds N items/200 tags/images."""
import random, sqlite3, sys, uuid, os, datetime as dt
src_path, out_dir = sys.argv[1], sys.argv[2]
n_items = int(sys.argv[3]) if len(sys.argv) > 3 else 20000
os.makedirs(out_dir, exist_ok=True)
dst_path = os.path.join(out_dir, "stowge.db")
if os.path.exists(dst_path): os.remove(dst_path)
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst); src.close()
random.seed(1)
cur = dst.cursor()
real = [r[0] for r in cur.execute("select path_thumb from images limit 60")]
rows = cur.execute("select path_thumb,path_display from images limit 60").fetchall()
now = dt.datetime.now(dt.timezone.utc).isoformat(sep=" ")
tags = []
for i in range(200):
    tid = str(uuid.uuid4()); tags.append(tid)
    cur.execute("insert into tags(id,name,icon,color,description,created_at,updated_at) values(?,?,?,?,?,?,?)",
                (tid, f"perf-tag-{i:03d}", "cpu", "#60a5fa", "desc", now, now))
site = cur.execute("select id from sites limit 1").fetchone()
area = str(uuid.uuid4())
cur.execute("insert into areas(id,name,site_id,created_at,updated_at) values(?,?,?,?,?)", (area,"perf-area",site[0] if site else None,now,now))
locs = []
for i in range(60):
    lid = str(uuid.uuid4()); locs.append(lid)
    cur.execute("insert into locations(id,name,area_id,item_count,created_at,updated_at) values(?,?,?,?,?,?)",
                (lid, f"perf-loc-{i:02d}", area, 0, now, now))
words = "bolt screw washer resistor capacitor cable adapter sensor motor gear spring bracket hinge led switch relay fuse".split()
for i in range(n_items):
    pid = str(uuid.uuid4())
    name = f"{random.choice(words)} {random.choice(words)} {i}"
    cur.execute("insert into parts(id,name,description,status,quantity,location_id,created_at,updated_at,is_deleted,ai_alternatives) values(?,?,?,?,?,?,?,?,?,?)",
        (pid, name, "synthetic " + " ".join(random.choices(words, k=8)), random.choice(["draft","confirmed"]),
         random.randint(0,50), random.choice(locs), now, now, 1 if i % 50 == 0 else 0,
         '[{"name":"x","confidence":0.5,"notes":"' + "n"*400 + '"}]'))
    for t in random.sample(tags, random.randint(0,4)):
        cur.execute("insert into item_tags(item_id,tag_id) values(?,?)", (pid, t))
    for k in range(random.randint(1,4)):
        th, di = random.choice(rows)
        cur.execute("insert into images(id,part_id,created_at,path_thumb,path_display,mime,is_primary) values(?,?,?,?,?,?,?)",
                    (str(uuid.uuid4()), pid, now, th, di, "image/webp", 1 if k == 0 else 0))
dst.commit()
print({t: cur.execute(f"select count(*) from {t}").fetchone()[0] for t in ("parts","images","tags","item_tags","locations")})
dst.close()
