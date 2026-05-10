from conftest import auth_cookies, client, make_db

from stowge.models import ImageSettings


def _reset_row():
    db = make_db()
    db.query(ImageSettings).filter(ImageSettings.id == "singleton").delete()
    db.add(ImageSettings(id="singleton"))
    db.commit()


def test_patch_quality_zero_is_normalized_to_one():
    _reset_row()
    cookies = auth_cookies("img_quality_zero@example.com", role="admin")

    response = client.patch(
        "/api/admin/settings/images",
        json={"display_quality": 0, "thumb_quality": 0},
        cookies=cookies,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_quality"] == 1
    assert body["thumb_quality"] == 1


def test_patch_quality_null_is_normalized_to_one():
    _reset_row()
    cookies = auth_cookies("img_quality_null@example.com", role="admin")

    response = client.patch(
        "/api/admin/settings/images",
        json={"display_quality": None, "thumb_quality": None},
        cookies=cookies,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_quality"] == 1
    assert body["thumb_quality"] == 1


def test_patch_quality_over_100_rejected():
    _reset_row()
    cookies = auth_cookies("img_quality_101@example.com", role="admin")

    response = client.patch(
        "/api/admin/settings/images",
        json={"display_quality": 101},
        cookies=cookies,
    )

    assert response.status_code == 400
    assert "display_quality must be 1-100" in response.text
