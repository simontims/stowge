"""
Test configuration. Sets a throw-away SQLite database *before* any app module
is imported, so the engine and init_db() use it instead of the real data file.
"""
import os
import tempfile

_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_db_path}")
