"""Tests for shared image default configuration behavior."""

from stowge.images import DEFAULT_IMAGE_CONFIG
from stowge.models import ImageSettings
from conftest import (
    client,
    make_db,
    auth_cookies,
)


def test_image_settings_get_uses_shared_defaults_when_row_missing():
    db = make_db()
    db.query(ImageSettings).filter(ImageSettings.id == "singleton").delete()
    db.commit()

    response = client.get("/api/admin/settings/images", cookies=auth_cookies("img_defaults@example.com", role="admin"))
    assert response.status_code == 200, response.text

    assert response.json() == {
        "store_original": DEFAULT_IMAGE_CONFIG.store_original,
        "output_format": DEFAULT_IMAGE_CONFIG.output_format,
        "display_max_edge": DEFAULT_IMAGE_CONFIG.display_max_edge,
        "display_quality": DEFAULT_IMAGE_CONFIG.display_quality,
        "thumb_max_edge": DEFAULT_IMAGE_CONFIG.thumb_max_edge,
        "thumb_quality": DEFAULT_IMAGE_CONFIG.thumb_quality,
    }
