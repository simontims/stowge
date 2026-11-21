import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy import event as sa_event
from sqlalchemy.orm import declarative_base, sessionmaker

# DATABASE_URL is the escape hatch for tests and advanced users.
# Most deployments set DATABASE_DIR instead, and the URL is built from it.
_explicit_url = os.environ.get("DATABASE_URL")
if _explicit_url:
    DATABASE_URL = _explicit_url
else:
    _db_dir = os.environ.get("DATABASE_DIR", "")
    DATABASE_URL = f"sqlite:///{_db_dir}/stowge.db" if _db_dir else "sqlite:///./stowge.db"

# Resolved filesystem path to the database file (used by vacuum endpoint etc.)
DATABASE_FILE = DATABASE_URL[len("sqlite:///"):]

# Create parent directories for SQLite file
Path(DATABASE_FILE).parent.mkdir(parents=True, exist_ok=True)

# FastAPI runs sync endpoints on a 40-thread pool and each request holds a connection for its
# whole duration, so the default pool (5 + 10 overflow) serialised bursts into waves. SQLite
# connections are cheap (opened lazily), so size the pool to the thread pool.
# busy timeout: wait up to 30 s (sqlite3 default is 5 s) for the write lock so a request that
# collides with VACUUM / a backup / a restore waits instead of failing with "database is locked".
_BUSY_TIMEOUT_SECONDS = 30

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False, "timeout": _BUSY_TIMEOUT_SECONDS},
    pool_size=10,
    max_overflow=30,
)

@sa_event.listens_for(engine, "connect")
def _set_pragmas(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    try:
        mode = str(cursor.execute("PRAGMA journal_mode=WAL").fetchone()[0]).lower()
        # synchronous=NORMAL is only safe together with WAL (a power cut can lose the last
        # commits but never corrupts the file). If WAL could not be enabled (some NAS / CIFS
        # mounts refuse it and silently keep the rollback journal) stay on the default FULL.
        if mode == "wal":
            cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-16384")   # 16 MiB page cache per connection (default 2 MiB)
        cursor.execute("PRAGMA temp_store=MEMORY")   # ORDER BY / GROUP BY b-trees in RAM, not temp files
    finally:
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
