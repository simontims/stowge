"""CSV export/import with tags."""
import csv
import io

from conftest import auth_cookies_isolated


def _admin(isolated_db, name="csv_tags@example.com"):
    return auth_cookies_isolated(isolated_db, name, role="admin")


def _tag(client, cookies, name):
    return client.post("/api/tags", json={"name": name}, cookies=cookies).json()["id"]


def _item(client, cookies, name, tag_ids=()):
    r = client.post("/api/items", json={"name": name, "tag_ids": list(tag_ids)}, cookies=cookies)
    assert r.status_code == 200, r.text


def _rows(response):
    assert response.status_code == 200, response.text
    reader = csv.DictReader(io.StringIO(response.text))
    return reader.fieldnames, list(reader)


def _csv(header, rows):
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    writer.writerows(rows)
    return buf.getvalue()


def _preview(client, cookies, text):
    r = client.post("/api/import/csv/preview", files={"file": ("in.csv", text, "text/csv")}, cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()


def _confirm(client, cookies, text, query=""):
    return client.post(f"/api/import/csv/confirm{query}", files={"file": ("in.csv", text, "text/csv")}, cookies=cookies)


# ------------------------------ export ------------------------------

def test_export_has_a_tags_column_instead_of_collection_joined_with_semicolons(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    elec, sale = _tag(isolated_client, cookies, "Electronics"), _tag(isolated_client, cookies, "To Sell")
    _item(isolated_client, cookies, "Multimeter", [sale, elec])
    _item(isolated_client, cookies, "Loose bolt")
    fields, rows = _rows(isolated_client.get("/api/export/csv", cookies=cookies))
    assert "tags" in fields and "collection" not in fields
    by_name = {r["name"]: r for r in rows}
    assert by_name["Multimeter"]["tags"] == "Electronics; To Sell"  # ordered by tag name
    assert by_name["Loose bolt"]["tags"] == ""


def test_export_tag_filter_is_repeatable_and_ands(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    a, b = _tag(isolated_client, cookies, "Aaa"), _tag(isolated_client, cookies, "Bbb")
    _item(isolated_client, cookies, "Both", [a, b])
    _item(isolated_client, cookies, "OnlyA", [a])
    _item(isolated_client, cookies, "Neither")
    _f, rows = _rows(isolated_client.get("/api/export/csv?tag=aaa", cookies=cookies))
    assert sorted(r["name"] for r in rows) == ["Both", "OnlyA"]
    _f, rows = _rows(isolated_client.get("/api/export/csv?tag=Aaa&tag=Bbb", cookies=cookies))
    assert [r["name"] for r in rows] == ["Both"]
    _f, rows = _rows(isolated_client.get("/api/export/csv?tag=__none", cookies=cookies))
    assert [r["name"] for r in rows] == ["Neither"]
    _f, rows = _rows(isolated_client.get("/api/export/csv?tag=Ghost", cookies=cookies))
    assert rows == []


def test_the_old_collection_filter_parameter_no_longer_filters(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    a = _tag(isolated_client, cookies, "Aaa")
    _item(isolated_client, cookies, "Tagged", [a])
    _item(isolated_client, cookies, "Other")
    _f, rows = _rows(isolated_client.get("/api/export/csv?collection=Aaa", cookies=cookies))
    assert len(rows) == 2


def test_export_then_import_round_trips_the_tags(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    elec, sale = _tag(isolated_client, cookies, "Electronics"), _tag(isolated_client, cookies, "To Sell")
    _item(isolated_client, cookies, "Multimeter", [elec, sale])
    exported = isolated_client.get("/api/export/csv", cookies=cookies).text
    assert _preview(isolated_client, cookies, exported)["missing_tags"] == []
    r = _confirm(isolated_client, cookies, exported)
    assert r.status_code == 200, r.text
    items = isolated_client.get("/api/items?tag=Electronics&tag=To%20Sell", cookies=cookies).json()
    assert len(items) == 2


# ------------------------------ import ------------------------------

def test_import_splits_tags_on_semicolons_only_and_reports_missing_ones(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    _tag(isolated_client, cookies, "Electronics")
    text = _csv(["name", "tags"], [["One", "Electronics; Brand New"], ["Two", "brand new; Spare parts, misc"], ["Three", ""]])
    preview = _preview(isolated_client, cookies, text)
    assert preview["missing_tags"] == ["Brand New", "Spare parts, misc"]  # case-insensitive de-dup, existing one excluded
    assert "missing_collections" not in preview
    assert preview["item_count"] == 3


def test_import_without_create_tags_is_refused_and_imports_nothing(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    text = _csv(["name", "tags"], [["One", "Fresh tag"]])
    r = _confirm(isolated_client, cookies, text)
    assert r.status_code == 400
    assert "Missing tags: Fresh tag" in r.json()["detail"] and "create_tags=true" in r.json()["detail"]
    assert isolated_client.get("/api/items", cookies=cookies).json() == []
    assert isolated_client.get("/api/tags", cookies=cookies).json() == []


def test_import_with_create_tags_creates_them_and_tags_the_items(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    existing = _tag(isolated_client, cookies, "Electronics")
    text = _csv(["name", "tags"], [["One", "electronics; To Sell"], ["Two", "To Sell; Spare"]])
    r = _confirm(isolated_client, cookies, text, "?create_tags=true")
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 2 and r.json()["tags_created"] == 2 and "collections_created" not in r.json()
    tags = {t["name"]: t for t in isolated_client.get("/api/tags", cookies=cookies).json()}
    assert set(tags) == {"Electronics", "To Sell", "Spare"}  # "electronics" reused the existing tag, not duplicated
    assert tags["Electronics"]["id"] == existing and tags["Electronics"]["item_count"] == 1
    assert tags["To Sell"]["item_count"] == 2
    one = [i for i in isolated_client.get("/api/items", cookies=cookies).json() if i["name"] == "One"][0]
    assert [t["name"] for t in one["tags"]] == ["Electronics", "To Sell"]


def test_import_reads_the_collection_column_of_an_old_file_as_one_tag(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    text = _csv(["name", "collection"], [["Old row", "Electronics; not split"]])
    preview = _preview(isolated_client, cookies, text)
    assert preview["missing_tags"] == ["Electronics; not split"]  # one tag, the cell is not split
    r = _confirm(isolated_client, cookies, text, "?create_tags=true")
    assert r.status_code == 200
    item = isolated_client.get("/api/items", cookies=cookies).json()[0]
    assert [t["name"] for t in item["tags"]] == ["Electronics; not split"]


def test_import_with_both_columns_combines_them_without_duplicates(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    text = _csv(["name", "tags", "collection"], [["Row", "Alpha; Beta", "alpha"]])
    _confirm(isolated_client, cookies, text, "?create_tags=true")
    item = isolated_client.get("/api/items", cookies=cookies).json()[0]
    assert [t["name"] for t in item["tags"]] == ["Alpha", "Beta"]


def test_create_collections_parameter_is_gone(isolated_client, isolated_db):
    cookies = _admin(isolated_db)
    text = _csv(["name", "tags"], [["Row", "Needed"]])
    r = _confirm(isolated_client, cookies, text, "?create_collections=true")
    assert r.status_code == 400  # the old flag does not create tags


def test_a_tag_name_with_a_comma_survives_export_and_import(isolated_client, isolated_db):
    cookies = _admin(isolated_db, "csv_comma@example.com")
    cables, tools = _tag(isolated_client, cookies, "Cables, misc"), _tag(isolated_client, cookies, "Tools")
    _item(isolated_client, cookies, "Spool", [cables, tools])
    exported = isolated_client.get("/api/export/csv", cookies=cookies).text
    preview = _preview(isolated_client, cookies, exported)
    assert preview["missing_tags"] == []  # "Cables, misc" was not split into "Cables" and "misc"
