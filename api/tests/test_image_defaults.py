"""Tests for shared image default configuration behavior."""

from fastapi.testclient import TestClient

from stowge.auth import SESSION_COOKIE_NAME, create_session, hash_password
from stowge.db import get_db
from stowge.images import DEFAULT_IMAGE_CONFIG
from stowge.main import app
from stowge.models import ImageSettings, User


client = TestClient(app, raise_server_exceptions=True)


def _make_db():
    return next(get_db())


def _get_or_create_admin(username: str = "image_defaults_admin@example.com") -> User:
    db = _make_db()
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            first_name="Image",
            last_name="Defaults",
            password_hash=hash_password("Secret123!"),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def _auth_cookies() -> dict:
    user = _get_or_create_admin()
    db = _make_db()
    token = create_session(user, db)
    return {SESSION_COOKIE_NAME: token}


def test_image_settings_get_uses_shared_defaults_when_row_missing():
    db = _make_db()
    db.query(ImageSettings).filter(ImageSettings.id == "singleton").delete()
    db.commit()

    response = client.get("/api/admin/settings/images", cookies=_auth_cookies())
    assert response.status_code == 200, response.text

    assert response.json() == {
        "store_original": DEFAULT_IMAGE_CONFIG.store_original,
        "output_format": DEFAULT_IMAGE_CONFIG.output_format,
        "display_max_edge": DEFAULT_IMAGE_CONFIG.display_max_edge,
        "display_quality": DEFAULT_IMAGE_CONFIG.display_quality,
        "thumb_max_edge": DEFAULT_IMAGE_CONFIG.thumb_max_edge,
        "thumb_quality": DEFAULT_IMAGE_CONFIG.thumb_quality,
    }
