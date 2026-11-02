"""/api/status/tags: per-tag item, image and disk metrics."""
from pathlib import Path

import pytest
from conftest import auth_cookies_isolated

from stowge.models import ItemTag, Part, PartImage, Tag


@pytest.fixture
def world(isolated_client, isolated_db, tmp_path, monkeypatch):
    monkeypatch.setenv("ASSETS_DIR", str(tmp_path))
    cookies = auth_cookies_isolated(isolated_db, "status_tags@example.com", role="admin")
    db = isolated_db()
    try:
        tools, camping, unused = Tag(name="Tools", icon="wrench", color="#111111"), Tag(name="Camping"), Tag(name="Unused")
        db.add_all([tools, camping, unused])
        db.flush()

        def item(name, tag_list, sizes, deleted=0):
            part = Part(name=name, is_deleted=deleted, status="draft", quantity=1)
            db.add(part)
            db.flush()
            for tag in tag_list:
                db.add(ItemTag(item_id=part.id, tag_id=tag.id))
            for n, size in enumerate(sizes):
                image_id = f"{name}-{n}"
                (Path(tmp_path) / image_id).mkdir(parents=True, exist_ok=True)
                (Path(tmp_path) / image_id / "thumb.webp").write_bytes(b"x" * size)
                db.add(PartImage(id=image_id, part_id=part.id, path_thumb=f"{image_id}/thumb.webp",
                                 path_display=f"{image_id}/thumb.webp", is_primary=1 if n == 0 else 0))
            return part

        item("hammer", [tools], [100])
        item("tent", [camping], [10, 10])
        item("lantern", [tools, camping], [1000])  # two tags: counts once per tag
        item("loose", [], [5])
        item("binned", [tools], [7000], deleted=1)
        db.commit()
    finally:
        db.close()
    return isolated_client, cookies


def test_each_tag_has_item_asset_and_disk_numbers_and_an_item_counts_once_per_tag(world):
    client, cookies = world
    data = client.get("/api/status/tags", cookies=cookies).json()
    rows = {r["name"]: r for r in data["tags"]}
    assert set(rows) == {"Tools", "Camping", "Unused"}
    assert rows["Tools"]["item_count"] == 2 and rows["Tools"]["asset_count"] == 2 and rows["Tools"]["disk_bytes"] == 1100
    assert rows["Camping"]["item_count"] == 2 and rows["Camping"]["asset_count"] == 3 and rows["Camping"]["disk_bytes"] == 1020
    assert rows["Unused"] == {"id": rows["Unused"]["id"], "name": "Unused", "icon": None, "color": None,
                              "item_count": 0, "asset_count": 0, "disk_bytes": 0}
    assert rows["Tools"]["icon"] == "wrench" and rows["Tools"]["color"] == "#111111"


def test_untagged_items_are_grouped_as_no_tag(world):
    client, cookies = world
    data = client.get("/api/status/tags", cookies=cookies).json()
    assert data["untagged"] == {"name": "No tag", "item_count": 1, "asset_count": 1, "disk_bytes": 5}


def test_totals_count_each_item_and_file_once_not_once_per_tag(world):
    client, cookies = world
    data = client.get("/api/status/tags", cookies=cookies).json()
    # 4 distinct active items (hammer, tent, lantern, loose) + 1 in the recycle bin
    assert data["totals"]["item_count"] == 4 + 1
    # 5 active images + 1 binned
    assert data["totals"]["asset_count"] == 5 + 1
    assert data["totals"]["disk_bytes"] == 100 + 10 + 10 + 1000 + 5 + 7000
    # the per-tag rows alone add up to more (the lantern is in two tags): the total must not be that sum
    per_tag_items = sum(r["item_count"] for r in data["tags"]) + data["untagged"]["item_count"]
    assert per_tag_items == 5
    per_tag_bytes = sum(r["disk_bytes"] for r in data["tags"]) + data["untagged"]["disk_bytes"]
    assert per_tag_bytes == 1100 + 1020 + 5
    assert data["totals"]["disk_bytes"] - data["recycle_bin"]["disk_bytes"] == per_tag_bytes - 1000


def test_recycle_bin_is_reported_separately_and_excluded_from_tag_rows(world):
    client, cookies = world
    data = client.get("/api/status/tags", cookies=cookies).json()
    assert data["recycle_bin"] == {"item_count": 1, "asset_count": 1, "disk_bytes": 7000}
    rows = {r["name"]: r for r in data["tags"]}
    assert rows["Tools"]["disk_bytes"] == 1100  # the 7000 bytes of the binned tool are not in the tag


def test_no_collection_keys_and_login_required(world, isolated_client):
    client, cookies = world
    data = client.get("/api/status/tags", cookies=cookies).json()
    assert "collections" not in data and "uncollected" not in data
    assert isolated_client.get("/api/status/tags").status_code == 401
