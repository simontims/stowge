"""Icon and colour on shortcut filters."""
import json

from stowge.models import User

from conftest import auth_cookies, client, make_db


def _patch_filters(cookies, filters):
    return client.patch("/api/me", cookies=cookies, json={"shortcut_filters": filters})


def _filter(**overrides):
    base = {"id": "f1", "name": "Low stock", "query": "", "pinned": True}
    base.update(overrides)
    return base


class TestShortcutIconColor:
    def test_icon_and_color_round_trip(self):
        cookies = auth_cookies("ss_roundtrip@example.com")
        r = _patch_filters(cookies, [_filter(icon="box", color="#38BDF8")])
        assert r.status_code == 200
        row = r.json()["shortcut_filters"][0]
        assert row["icon"] == "box"
        assert row["color"] == "#38bdf8"  # stored lower-case
        again = client.get("/api/me", cookies=cookies).json()["shortcut_filters"][0]
        assert again["icon"] == "box"
        assert again["color"] == "#38bdf8"

    def test_old_filters_without_icon_or_color_get_null_defaults(self):
        cookies = auth_cookies("ss_old@example.com")
        r = _patch_filters(cookies, [_filter()])
        assert r.status_code == 200
        row = r.json()["shortcut_filters"][0]
        assert row["icon"] is None
        assert row["color"] is None

    def test_filter_stored_before_this_release_still_loads(self):
        cookies = auth_cookies("ss_legacy@example.com")
        legacy = [{
            "id": "old1", "name": "Legacy", "query": "cable", "collection": None,
            "statuses": ["confirmed"], "status": "confirmed", "site_id": None, "area_id": None,
            "location_id": None, "quantity_min": 1, "quantity_max": None, "pinned": True,
        }]
        db = make_db()
        user = db.query(User).filter(User.username == "ss_legacy@example.com").first()
        user.shortcut_filters = json.dumps(legacy)
        db.commit()
        row = client.get("/api/me", cookies=cookies).json()["shortcut_filters"][0]
        assert row["name"] == "Legacy"
        assert row["statuses"] == ["confirmed"]
        assert row["quantity_min"] == 1
        assert row["icon"] is None and row["color"] is None
        assert row["pinned"] is True

    def test_saving_an_old_filter_back_keeps_working(self):
        cookies = auth_cookies("ss_resave@example.com")
        r = _patch_filters(cookies, [_filter(statuses=["draft"])])
        assert r.status_code == 200
        r2 = _patch_filters(cookies, r.json()["shortcut_filters"])
        assert r2.status_code == 200
        assert r2.json()["shortcut_filters"][0]["statuses"] == ["draft"]

    def test_empty_values_clear_them(self):
        cookies = auth_cookies("ss_clear@example.com")
        _patch_filters(cookies, [_filter(icon="box", color="#112233")])
        r = _patch_filters(cookies, [_filter(icon="", color=None)])
        row = r.json()["shortcut_filters"][0]
        assert row["icon"] is None and row["color"] is None

    def test_short_and_alpha_hex_colours_are_accepted(self):
        cookies = auth_cookies("ss_hex@example.com")
        for color in ("#abc", "#aabbcc", "#aabbccdd"):
            assert _patch_filters(cookies, [_filter(color=color)]).status_code == 200

    def test_bad_colour_is_rejected(self):
        cookies = auth_cookies("ss_badcolor@example.com")
        for color in ("red", "#12", "#12345g", "38bdf8", "javascript:alert(1)"):
            r = _patch_filters(cookies, [_filter(color=color)])
            assert r.status_code == 400, color
            assert "color" in r.json()["detail"]

    def test_bad_icon_is_rejected(self):
        cookies = auth_cookies("ss_badicon@example.com")
        for icon in ("has space", "../x", "<b>", "a" * 65, "-lead"):
            r = _patch_filters(cookies, [_filter(icon=icon)])
            assert r.status_code == 400, icon
            assert "icon" in r.json()["detail"]

    def test_tampered_stored_values_are_dropped_not_served(self):
        cookies = auth_cookies("ss_tamper@example.com")
        db = make_db()
        user = db.query(User).filter(User.username == "ss_tamper@example.com").first()
        user.shortcut_filters = json.dumps([_filter(icon="<script>", color="expression(1)")])
        db.commit()
        row = client.get("/api/me", cookies=cookies).json()["shortcut_filters"][0]
        assert row["icon"] is None and row["color"] is None
