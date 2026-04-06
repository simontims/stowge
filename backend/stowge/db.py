import os
from pathlib import Path
from sqlalchemy import create_engine, event as sa_event
from sqlalchemy.orm import sessionmaker, declarative_base

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

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

@sa_event.listens_for(engine, "connect")
def _set_wal_mode(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
