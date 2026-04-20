"""
Authentication and authorization tests.

Covers:
  - password hashing / verification
  - session lifecycle (create, validate, expire, delete)
  - POST /api/login
  - POST /api/logout
  - GET  /api/me
  - require_admin enforced on admin-only endpoints
  - POST /api/setup/first-admin (first-run flow)
  - email enumeration timing mitigation (both paths return 401)

Design note: only TestLogin exercises the HTTP login endpoint.  All other
test classes obtain a valid session cookie by calling create_session()
directly, so they never hit the rate-limiter on /api/login.
"""
from datetime import datetime, timedelta, timezone

from stowge.main import app
from stowge.auth import (
    SESSION_COOKIE_NAME,
    create_session,
    delete_session,
    hash_password,
    verify_password,
)
from stowge.db import get_db
from stowge.models import User, UserSession
from conftest import (
    client,
    make_db,
    create_user,
    get_or_create_user,
    valid_session_cookie,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _login(username="test@example.com", password="Secret123!"):
    """POST /api/login and return the full Response."""
    return client.post("/api/login", json={"username": username, "password": password})


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

class TestPasswordHashing:
    def test_hash_is_not_plaintext(self):
        pw = "MySecurePassword!"
        assert hash_password(pw) != pw

    def test_verify_correct_password(self):
        pw = "MySecurePassword!"
        assert verify_password(pw, hash_password(pw)) is True

    def test_verify_wrong_password(self):
        assert verify_password("wrong", hash_password("correct")) is False

    def test_different_hashes_for_same_password(self):
        """bcrypt uses a random salt — two hashes of the same password must differ."""
        pw = "SamePassword1"
        assert hash_password(pw) != hash_password(pw)

    def test_long_password_does_not_raise(self):
        """SHA-256 pre-hash means bcrypt never sees >72 bytes."""
        long_pw = "a" * 300
        hashed = hash_password(long_pw)
        assert verify_password(long_pw, hashed) is True


# ---------------------------------------------------------------------------
# Session lifecycle (unit — direct function calls)
# ---------------------------------------------------------------------------

class TestSessionLifecycle:
    def test_create_session_returns_token(self):
        user = get_or_create_user("sess_create@example.com")
        db = make_db()
        token = create_session(user, db)
        assert isinstance(token, str)
        assert len(token) == 64  # secrets.token_hex(32)

    def test_session_row_written_to_db(self):
        user = get_or_create_user("sess_row@example.com")
        db = make_db()
        token = create_session(user, db)
        row = db.query(UserSession).filter(UserSession.id == token).first()
        assert row is not None
        assert row.user_id == user.id

    def test_delete_session_removes_row(self):
        user = get_or_create_user("sess_del@example.com")
        db = make_db()
        token = create_session(user, db)
        delete_session(token, db)
        row = db.query(UserSession).filter(UserSession.id == token).first()
        assert row is None

    def test_expired_sessions_pruned_on_new_login(self):
        user = get_or_create_user("sess_prune@example.com")
        db = make_db()

        # Create a session and manually expire it.
        old_token = create_session(user, db)
        old_row = db.query(UserSession).filter(UserSession.id == old_token).first()
        old_row.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()

        # A new login should prune the expired row.
        create_session(user, db)
        assert db.query(UserSession).filter(UserSession.id == old_token).first() is None

    def test_create_multiple_sessions_for_same_user(self):
        """Multiple valid sessions for the same user must coexist."""
        user = get_or_create_user("sess_multi@example.com")
        db = make_db()
        t1 = create_session(user, db)
        t2 = create_session(user, db)
        assert t1 != t2
        rows = db.query(UserSession).filter(UserSession.user_id == user.id).all()
        ids = {r.id for r in rows}
        assert t1 in ids
        assert t2 in ids


# ---------------------------------------------------------------------------
# POST /api/login
# ---------------------------------------------------------------------------

class TestLogin:
    def setup_method(self):
        db = make_db()
        # Ensure a fresh user exists for each test method.
        if not db.query(User).filter(User.username == "login@example.com").first():
            create_user(db, username="login@example.com", password="Pass1234!")

    def test_login_success_returns_200(self):
        r = _login("login@example.com", "Pass1234!")
        assert r.status_code == 200

    def test_login_sets_session_cookie(self):
        r = _login("login@example.com", "Pass1234!")
        assert SESSION_COOKIE_NAME in r.cookies

    def test_login_response_body_has_user_fields(self):
        r = _login("login@example.com", "Pass1234!")
        body = r.json()
        assert "id" in body
        assert "email" in body or "username" in body

    def test_login_wrong_password_returns_401(self):
        r = _login("login@example.com", "WrongPassword!")
        assert r.status_code == 401

    def test_login_unknown_email_returns_401(self):
        r = _login("nobody@example.com", "IrrelevantPass1!")
        assert r.status_code == 401

    def test_login_error_detail_does_not_leak_which_field_is_wrong(self):
        """Both wrong-password and unknown-email must return the same detail string
        so an attacker cannot enumerate valid accounts."""
        wrong_pw = _login("login@example.com", "WrongPass1!")
        unknown = _login("nobody2@example.com", "WrongPass1!")
        assert wrong_pw.json()["detail"] == unknown.json()["detail"]

    def test_login_empty_password_returns_401(self):
        r = client.post("/api/login", json={"username": "login@example.com", "password": ""})
        assert r.status_code == 401

    def test_login_missing_fields_returns_401(self):
        r = client.post("/api/login", json={})
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/logout
# ---------------------------------------------------------------------------

class TestLogout:
    def test_logout_returns_200(self):
        token = valid_session_cookie("logout@example.com", password="LogOut123!")
        r = client.post("/api/logout", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 200

    def test_logout_clears_cookie(self):
        token = valid_session_cookie("logout@example.com", password="LogOut123!")
        r = client.post("/api/logout", cookies={SESSION_COOKIE_NAME: token})
        # FastAPI delete_cookie sets the cookie to empty with max-age=0.
        cookie_value = r.cookies.get(SESSION_COOKIE_NAME, "")
        assert cookie_value == ""

    def test_logout_invalidates_session(self):
        token = valid_session_cookie("logout@example.com", password="LogOut123!")
        client.post("/api/logout", cookies={SESSION_COOKIE_NAME: token})
        # Previously valid token must now return 401.
        r = client.get("/api/me", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 401

    def test_logout_without_cookie_is_harmless(self):
        """Logging out with no active session must not blow up."""
        r = client.post("/api/logout")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/me
# ---------------------------------------------------------------------------

class TestGetMe:
    def test_me_with_valid_session(self):
        token = valid_session_cookie("me@example.com", password="MePass123!")
        r = client.get("/api/me", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 200

    def test_me_without_cookie_returns_401(self):
        r = client.get("/api/me")
        assert r.status_code == 401

    def test_me_with_fake_cookie_returns_401(self):
        r = client.get("/api/me", cookies={SESSION_COOKIE_NAME: "not_a_real_session_id"})
        assert r.status_code == 401

    def test_me_with_expired_session_returns_401(self):
        token = valid_session_cookie("me@example.com", password="MePass123!")

        # Manually expire the session in the DB.
        db = make_db()
        row = db.query(UserSession).filter(UserSession.id == token).first()
        assert row is not None
        row.expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()

        r = client.get("/api/me", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 401

    def test_me_contains_no_password_hash(self):
        token = valid_session_cookie("me@example.com", password="MePass123!")
        body = client.get("/api/me", cookies={SESSION_COOKIE_NAME: token}).json()
        assert "password_hash" not in body
        assert "password" not in body


# ---------------------------------------------------------------------------
# require_admin
# ---------------------------------------------------------------------------

class TestRequireAdmin:
    def test_admin_can_access_users_list(self):
        token = valid_session_cookie("admin@example.com", password="Admin123!", role="admin")
        r = client.get("/api/users", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 200

    def test_non_admin_gets_403_on_users_list(self):
        token = valid_session_cookie("nonadmin@example.com", password="User1234!", role="user")
        r = client.get("/api/users", cookies={SESSION_COOKIE_NAME: token})
        assert r.status_code == 403

    def test_unauthenticated_gets_401_on_users_list(self):
        r = client.get("/api/users")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/setup/first-admin
# ---------------------------------------------------------------------------

class TestFirstAdminSetup:
    def test_setup_blocked_when_users_exist(self):
        """If any user already exists the endpoint must return 404."""
        # The DB already has users from earlier tests.
        r = client.post(
            "/api/setup/first-admin",
            json={"username": "new@example.com", "password": "Setup123!"},
        )
        assert r.status_code == 404

    def test_setup_first_admin_on_empty_db(self):
        """Use a fresh in-memory DB to test the happy path."""
        # StaticPool ensures all connections share the same in-memory SQLite
        # instance so tables created by metadata.create_all() are visible to
        # the session used inside the request handler.
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool
        from stowge.models import Base

        engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)

        def override_get_db():
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        try:
            r = client.post(
                "/api/setup/first-admin",
                json={
                    "username": "firstadmin@example.com",
                    "firstname": "First",
                    "lastname": "Admin",
                    "password": "AdminPass1!",
                },
            )
            assert r.status_code == 200
            body = r.json()
            assert body.get("role") == "admin"
            assert SESSION_COOKIE_NAME in r.cookies
        finally:
            app.dependency_overrides.pop(get_db, None)
