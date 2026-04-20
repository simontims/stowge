"""
Tests for the quantity field on items.

Covers:
  - POST /api/items  — quantity defaults to 1 when omitted
  - POST /api/items  — explicit quantity is stored
  - POST /api/items  — quantity < 1 is clamped to 1
  - GET  /api/items        — quantity present in list response
  - GET  /api/items/{id}   — quantity present in detail response
  - PATCH /api/items/{id}  — quantity can be updated
  - PATCH /api/items/{id}  — quantity < 1 rejected with 400
  - PATCH /api/items/{id}  — non-integer quantity rejected with 400
"""
from conftest import (
    client,
    auth_cookies,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_item(cookies: dict, **overrides) -> dict:
    """Create an item and return its full detail response."""
    payload = {"name": "Test Widget", **overrides}
    r = client.post("/api/items", json=payload, cookies=cookies)
    assert r.status_code == 200, r.text
    item_id = r.json()["id"]
    r2 = client.get(f"/api/items/{item_id}", cookies=cookies)
    assert r2.status_code == 200, r2.text
    return r2.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestQuantityCreate:
    def setup_method(self):
        self.cookies = auth_cookies("qty_test@example.com", role="admin")

    def test_default_quantity_is_one(self):
        item = _create_item(self.cookies)
        assert item["quantity"] == 1

    def test_explicit_quantity_stored(self):
        item = _create_item(self.cookies, quantity=5)
        assert item["quantity"] == 5

    def test_zero_quantity_clamped_to_one(self):
        item = _create_item(self.cookies, quantity=0)
        assert item["quantity"] == 1

    def test_negative_quantity_clamped_to_one(self):
        item = _create_item(self.cookies, quantity=-3)
        assert item["quantity"] == 1


class TestQuantityRead:
    def setup_method(self):
        self.cookies = auth_cookies("qty_test_read@example.com", role="admin")

    def test_quantity_in_list_response(self):
        _create_item(self.cookies, name="List Qty Widget", quantity=7)
        r = client.get("/api/items", cookies=self.cookies)
        assert r.status_code == 200
        items = r.json()
        match = next((i for i in items if i["name"] == "List Qty Widget"), None)
        assert match is not None
        assert match["quantity"] == 7

    def test_quantity_in_detail_response(self):
        item = _create_item(self.cookies, name="Detail Qty Widget", quantity=3)
        r = client.get(f"/api/items/{item['id']}", cookies=self.cookies)
        assert r.status_code == 200
        assert r.json()["quantity"] == 3


class TestQuantityUpdate:
    def setup_method(self):
        self.cookies = auth_cookies("qty_test_update@example.com", role="admin")

    def test_patch_updates_quantity(self):
        item = _create_item(self.cookies, quantity=1)
        r = client.patch(
            f"/api/items/{item['id']}",
            json={"quantity": 10},
            cookies=self.cookies,
        )
        assert r.status_code == 200
        r2 = client.get(f"/api/items/{item['id']}", cookies=self.cookies)
        assert r2.json()["quantity"] == 10

    def test_patch_zero_quantity_clamped_to_one(self):
        item = _create_item(self.cookies, quantity=5)
        r = client.patch(
            f"/api/items/{item['id']}",
            json={"quantity": 0},
            cookies=self.cookies,
        )
        assert r.status_code == 200
        r2 = client.get(f"/api/items/{item['id']}", cookies=self.cookies)
        assert r2.json()["quantity"] == 1

    def test_patch_negative_quantity_clamped_to_one(self):
        item = _create_item(self.cookies, quantity=5)
        r = client.patch(
            f"/api/items/{item['id']}",
            json={"quantity": -3},
            cookies=self.cookies,
        )
        assert r.status_code == 200
        r2 = client.get(f"/api/items/{item['id']}", cookies=self.cookies)
        assert r2.json()["quantity"] == 1

    def test_patch_non_integer_quantity_returns_400(self):
        item = _create_item(self.cookies)
        r = client.patch(
            f"/api/items/{item['id']}",
            json={"quantity": "many"},
            cookies=self.cookies,
        )
        assert r.status_code == 400

    def test_patch_without_quantity_leaves_it_unchanged(self):
        item = _create_item(self.cookies, quantity=4)
        r = client.patch(
            f"/api/items/{item['id']}",
            json={"name": "Renamed Widget"},
            cookies=self.cookies,
        )
        assert r.status_code == 200
        r2 = client.get(f"/api/items/{item['id']}", cookies=self.cookies)
        assert r2.json()["quantity"] == 4
