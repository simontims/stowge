"""
Test configuration. Sets a throw-away SQLite database *before* any app module
is imported, so the engine and init_db() use it instead of the real data file.
"""
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from stowge.main import app
from stowge.auth import (
    SESSION_COOKIE_NAME,
    create_session,
    hash_password,
)
from stowge.db import get_db
from stowge.models import User, Base


_db_fd, _db_path = tempfile.mkstemp(suffix=".db")
os.close(_db_fd)
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_db_path}")


# ---------------------------------------------------------------------------
# Shared Test Helpers
# ---------------------------------------------------------------------------

client = TestClient(app, raise_server_exceptions=True)


def make_db() -> Session:
    """Get a fresh database session for tests."""
    return next(get_db())


def create_user(
    db: Session,
    *,
    username: str = "test@example.com",
    password: str = "Secret123!",
    first_name: str = "Test",
    last_name: str = "User",
    role: str = "user",
) -> User:
    """Create a new user in the database."""
    user = User(
        username=username,
        first_name=first_name,
        last_name=last_name,
        password_hash=hash_password(password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_or_create_user(
    username: str,
    *,
    password: str = "Secret123!",
    first_name: str = "Test",
    last_name: str = "User",
    role: str = "user",
) -> User:
    """Get existing user or create if missing."""
    db = make_db()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = create_user(
            db,
            username=username,
            password=password,
            first_name=first_name,
            last_name=last_name,
            role=role,
        )
    return user


def valid_session_cookie(username: str, **user_kwargs) -> str:
    """Create a session directly (no HTTP) and return the opaque token."""
    user = get_or_create_user(username, **user_kwargs)
    db = make_db()
    return create_session(user, db)


def auth_cookies(username: str = "test_auth@example.com", **user_kwargs) -> dict:
    """Get auth cookies for a test user."""
    token = valid_session_cookie(username, **user_kwargs)
    return {SESSION_COOKIE_NAME: token}


def write_asset(base_dir: Path, rel_path: str, content: bytes = b"x") -> Path:
    """Write a test asset file to the filesystem."""
    abs_path = base_dir / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)
    return abs_path


# ---------------------------------------------------------------------------
# Pytest Fixtures for Test Isolation
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_db():
    """
    Fixture providing a fresh isolated SQLite database for each test.
    Uses in-memory database with StaticPool for fast, isolated test execution.
    """
    # Create a fresh in-memory database for this test
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    
    # Create all tables
    Base.metadata.create_all(engine)
    
    # Create a session factory
    TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    yield TestingSession
    
    # Cleanup after test
    engine.dispose()


@pytest.fixture
def isolated_client(isolated_db):
    """
    Fixture providing a TestClient with isolated database.
    Each test gets a fresh database and fresh app instance.
    """
    def override_get_db():
        db = isolated_db()
        try:
            yield db
        finally:
            db.close()
    
    # Override the get_db dependency
    app.dependency_overrides[get_db] = override_get_db
    
    test_client = TestClient(app, raise_server_exceptions=True)
    
    yield test_client
    
    # Clean up dependency overrides
    app.dependency_overrides.clear()


# Helper functions for isolated database tests
def make_isolated_db(isolated_db):
    """Get a session from the isolated database fixture."""
    return isolated_db()


def get_or_create_user_isolated(isolated_db, username: str, **user_kwargs) -> User:
    """Get or create user in isolated database."""
    db = isolated_db()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            user = User(
                username=username,
                first_name=user_kwargs.get("first_name", "Test"),
                last_name=user_kwargs.get("last_name", "User"),
                password_hash=hash_password(user_kwargs.get("password", "Secret123!")),
                role=user_kwargs.get("role", "user"),
            )
            db.add(user)
            db.commit()
            db.refresh(user)
        return user
    finally:
        db.close()


def auth_cookies_isolated(isolated_db, username: str = "test_auth@example.com", **user_kwargs) -> dict:
    """Get auth cookies for a test user in isolated database."""
    user = get_or_create_user_isolated(isolated_db, username, **user_kwargs)
    db = isolated_db()
    try:
        token = create_session(user, db)
        return {SESSION_COOKIE_NAME: token}
    finally:
        db.close()
