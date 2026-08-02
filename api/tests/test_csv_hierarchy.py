import csv
import io

from conftest import auth_cookies_isolated


def _csv_text(rows: list[dict[str, str]]) -> str:
    fieldnames = ["name", "description", "collection", "site", "area", "location", "status", "quantity"]
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buf.getvalue()


def test_export_csv_includes_site_area_columns(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "csv-admin@example.com", role="admin")

    site_resp = isolated_client.post("/api/sites", json={"name": "Home"}, cookies=admin_cookies)
    assert site_resp.status_code == 200, site_resp.text
    site_id = site_resp.json()["id"]

    area_resp = isolated_client.post(
        "/api/areas",
        json={"name": "Garage", "site_id": site_id},
        cookies=admin_cookies,
    )
    assert area_resp.status_code == 200, area_resp.text
    area_id = area_resp.json()["id"]

    location_resp = isolated_client.post(
        "/api/locations",
        json={"name": "Shelf A", "area_id": area_id},
        cookies=admin_cookies,
    )
    assert location_resp.status_code == 200, location_resp.text
    location_id = location_resp.json()["id"]

    collection_resp = isolated_client.post(
        "/api/collections",
        json={"name": "Tools"},
        cookies=admin_cookies,
    )
    assert collection_resp.status_code == 200, collection_resp.text

    item_resp = isolated_client.post(
        "/api/items",
        json={
            "name": "Socket Set",
            "description": "Metric",
            "collection": "Tools",
            "location_id": location_id,
            "status": "confirmed",
            "quantity": 2,
        },
        cookies=admin_cookies,
    )
    assert item_resp.status_code == 200, item_resp.text

    export_resp = isolated_client.get("/api/export/csv", cookies=admin_cookies)
    assert export_resp.status_code == 200, export_resp.text

    text = export_resp.text
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    assert "site" in reader.fieldnames
    assert "area" in reader.fieldnames
    assert "location" in reader.fieldnames
    assert len(rows) == 1
    assert rows[0]["site"] == "Home"
    assert rows[0]["area"] == "Garage"
    assert rows[0]["location"] == "Shelf A"


def test_import_csv_preview_and_confirm_support_site_area(isolated_client, isolated_db):
    admin_cookies = auth_cookies_isolated(isolated_db, "csv-admin-2@example.com", role="admin")

    csv_text = _csv_text([
        {
            "name": "Battery Pack",
            "description": "12V",
            "collection": "Electrics",
            "site": "Boat",
            "area": "Cabin",
            "location": "Port Locker",
            "status": "confirmed",
            "quantity": "3",
        }
    ])

    preview_resp = isolated_client.post(
        "/api/import/csv/preview",
        files={"file": ("import.csv", csv_text, "text/csv")},
        cookies=admin_cookies,
    )
    assert preview_resp.status_code == 200, preview_resp.text
    preview = preview_resp.json()

    assert preview["item_count"] == 1
    assert "Electrics" in preview["missing_collections"]
    assert "Boat" in preview["missing_sites"]
    assert "Cabin" in preview["missing_areas"]
    assert "Port Locker" in preview["missing_locations"]

    confirm_resp = isolated_client.post(
        "/api/import/csv/confirm?create_collections=true&create_sites=true&create_areas=true&create_locations=true",
        files={"file": ("import.csv", csv_text, "text/csv")},
        cookies=admin_cookies,
    )
    assert confirm_resp.status_code == 200, confirm_resp.text
    result = confirm_resp.json()

    assert result["imported"] == 1
    assert result["collections_created"] == 1
    assert result["sites_created"] == 1
    assert result["areas_created"] == 1
    assert result["locations_created"] == 1

    locations_resp = isolated_client.get("/api/locations", cookies=admin_cookies)
    assert locations_resp.status_code == 200, locations_resp.text
    locations = locations_resp.json()

    imported_location = next((row for row in locations if row["name"] == "Port Locker"), None)
    assert imported_location is not None
    assert imported_location["site_name"] == "Boat"
    assert imported_location["area_name"] == "Cabin"
