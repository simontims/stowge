from conftest import auth_cookies_isolated

from stowge.models import Tag


def _create_item(client, cookies: dict, **payload) -> str:
    response = client.post("/api/items", json={"name": "Searchable Item", **payload}, cookies=cookies)
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _create_tag(isolated_db, name: str) -> str:
    db = isolated_db()
    try:
        tag = Tag(name=name)
        db.add(tag)
        db.commit()
        return tag.id
    finally:
        db.close()


def test_items_search_matches_description_and_returns_description(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "items_search@example.com", role="admin")
    tools = _create_tag(isolated_db, "Tools")
    outdoors = _create_tag(isolated_db, "Outdoors")

    _create_item(
        isolated_client,
        cookies,
        name="Socket wrench",
        description="Metric deep socket set for engine work",
        tag_ids=[tools],
    )
    _create_item(
        isolated_client,
        cookies,
        name="Camping mug",
        description="Enamel cup for the van",
        tag_ids=[outdoors],
    )

    response = isolated_client.get("/api/items?q=engine", cookies=cookies)

    assert response.status_code == 200, response.text
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["name"] == "Socket wrench"
    assert payload[0]["description"] == "Metric deep socket set for engine work"


def test_items_search_keeps_existing_name_and_tag_matching(isolated_client, isolated_db):
    cookies = auth_cookies_isolated(isolated_db, "items_search_existing@example.com", role="admin")
    workshop = _create_tag(isolated_db, "Workshop")
    electronics = _create_tag(isolated_db, "Electronics")

    _create_item(
        isolated_client,
        cookies,
        name="Hex driver",
        description="Bench drawer",
        tag_ids=[workshop],
    )
    _create_item(
        isolated_client,
        cookies,
        name="Travel adapter",
        description="International plug kit",
        tag_ids=[electronics],
    )

    name_response = isolated_client.get("/api/items?q=driver", cookies=cookies)
    tag_response = isolated_client.get("/api/items?q=electronics", cookies=cookies)

    assert name_response.status_code == 200, name_response.text
    assert tag_response.status_code == 200, tag_response.text
    assert [item["name"] for item in name_response.json()] == ["Hex driver"]
    assert [item["name"] for item in tag_response.json()] == ["Travel adapter"]