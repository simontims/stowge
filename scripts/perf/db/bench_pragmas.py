"""Commit latency / read throughput under PRAGMA variants (WAL).
usage: python bench_pragmas.py DB_FILE   (works on a scratch copy it makes itself)
"""
import os, shutil, sqlite3, statistics, sys, tempfile, time

src = sys.argv[1]
d = os.path.dirname(os.path.abspath(src))
work = os.path.join(d, "pragma_work.db")
VARIANTS = {
    "baseline (sync=FULL)": [],
    "sync=NORMAL": ["PRAGMA synchronous=NORMAL"],
    "NORMAL+cache64M+temp=MEM": ["PRAGMA synchronous=NORMAL", "PRAGMA cache_size=-65536", "PRAGMA temp_store=MEMORY"],
    "NORMAL+mmap256M": ["PRAGMA synchronous=NORMAL", "PRAGMA mmap_size=268435456"],
}
for name, prag in VARIANTS.items():
    for ext in ("", "-wal", "-shm"):
        try: os.remove(work + ext)
        except FileNotFoundError: pass
    shutil.copy(src, work)
    c = sqlite3.connect(work, check_same_thread=False); c.execute("PRAGMA journal_mode=WAL")
    for p in prag: c.execute(p)
    ts = []
    for i in range(300):          # one session touch per request, as auth.current_user does
        t = time.perf_counter()
        c.execute("UPDATE sessions SET last_seen_at=? WHERE id='known-session'", (f"2026-11-15T00:00:{i%60:02d}",)); c.commit()
        ts.append((time.perf_counter() - t) * 1000)
    w = statistics.median(ts)
    rs = []
    for _ in range(5):
        t = time.perf_counter()
        c.execute("SELECT item_tags.tag_id, count(*) FROM item_tags JOIN parts ON parts.id=item_tags.item_id WHERE parts.is_deleted=0 GROUP BY 1").fetchall()
        c.execute("SELECT * FROM parts WHERE name LIKE '%zzzz%' OR description LIKE '%zzzz%'").fetchall()
        rs.append((time.perf_counter() - t) * 1000)
    print(f"{name:28s} commit median {w:7.3f} ms  p95 {sorted(ts)[int(.95*len(ts))]:7.3f}  read-scan median {statistics.median(rs):7.1f} ms")
    c.close()
for ext in ("", "-wal", "-shm"):
    try: os.remove(work + ext)
    except FileNotFoundError: pass
