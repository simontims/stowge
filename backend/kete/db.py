import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./kete.db")

# Create parent directories for SQLite if using file-based path
if DATABASE_URL.startswith("sqlite:///"):
    db_path = DATABASE_URL.replace("sqlite:///", "")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
# SQLite-specific configuration
connect_args = {}
kwargs = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
    kwargs = {}

engine = create_engine(DATABASE_URL, connect_args=connect_args, **kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
