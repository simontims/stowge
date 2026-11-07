"""Identify and rescan take hint_id; the hint text is the only context sent to the model."""
from io import BytesIO

import pytest
from conftest import auth_cookies_isolated

from stowge import openai_id
from stowge.ai_hints import DEFAULT_HINT_TEXT
from stowge.models import LLMConfig


@pytest.fixture
def setup(isolated_client, isolated_db, monkeypatch):
    cookies = auth_cookies_isolated(isolated_db, "hint_identify@example.com", role="admin")
    db = isolated_db()
    try:
        llm = LLMConfig(name="AI", provider="openai", model="openai/gpt-4o-mini", api_key="secret",
                        api_base="https://api.openai.com/v1", is_default=1)
        db.add(llm)
        db.commit()
    finally:
        db.close()

    calls: list[dict] = []

    def fake_identify(b64s, llm_config, mode, include_evidence, hint_context=None):
        calls.append({"hint_context": hint_context, "mode": mode})
        return {"candidates": [{"name": "Widget", "confidence": 0.9}]}

    monkeypatch.setattr("stowge.routes.ai_settings.process_for_identify", lambda images, max_edge=1600, quality=85: ["ZmFrZQ=="])
    monkeypatch.setattr("stowge.routes.ai_settings.openai_identify", fake_identify)
    monkeypatch.setattr("stowge.routes.items.openai_identify", fake_identify)
    monkeypatch.setattr("stowge.routes.items.b64_from_stored_paths", lambda paths, max_edge=1600, quality=85: ["ZmFrZQ=="])
    return cookies, calls


def _identify(client, cookies, query=""):
    return client.post(
        f"/api/identify?mode=one{query}",
        cookies=cookies,
        files={"images": ("photo.jpg", BytesIO(b"fake"), "image/jpeg")},
    )


def _hint(client, cookies, name, text):
    r = client.post("/api/hints", json={"name": name, "text": text}, cookies=cookies)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_without_hint_id_the_default_hint_text_is_sent(isolated_client, setup):
    cookies, calls = setup
    assert _identify(isolated_client, cookies).status_code == 200
    assert calls[-1]["hint_context"] == f"Hint: {DEFAULT_HINT_TEXT}"


def test_blank_hint_id_means_default(isolated_client, setup):
    cookies, calls = setup
    assert _identify(isolated_client, cookies, "&hint_id=").status_code == 200
    assert calls[-1]["hint_context"] == f"Hint: {DEFAULT_HINT_TEXT}"


def test_an_edited_default_text_is_what_gets_sent(isolated_client, setup):
    cookies, calls = setup
    default = next(h for h in isolated_client.get("/api/hints", cookies=cookies).json() if h["is_default"])
    isolated_client.patch(f"/api/hints/{default['id']}", json={"text": "Mostly camping gear."}, cookies=cookies)
    _identify(isolated_client, cookies)
    assert calls[-1]["hint_context"] == "Hint: Mostly camping gear."


def test_a_chosen_hint_replaces_the_default_not_adds_to_it(isolated_client, setup):
    cookies, calls = setup
    hint_id = _hint(isolated_client, cookies, "Electronics", "Small electronic parts and dev boards.")
    assert _identify(isolated_client, cookies, f"&hint_id={hint_id}").status_code == 200
    assert calls[-1]["hint_context"] == "Hint: Small electronic parts and dev boards."
    assert "General household" not in calls[-1]["hint_context"]


def test_no_tag_names_or_collection_text_are_ever_sent(isolated_client, setup):
    cookies, calls = setup
    isolated_client.post("/api/tags", json={"name": "SecretTagName"}, cookies=cookies)
    _identify(isolated_client, cookies)
    assert "SecretTagName" not in calls[-1]["hint_context"]
    assert "ollection" not in calls[-1]["hint_context"]


def test_a_blank_hint_text_sends_nothing(isolated_client, setup):
    cookies, calls = setup
    default = next(h for h in isolated_client.get("/api/hints", cookies=cookies).json() if h["is_default"])
    isolated_client.patch(f"/api/hints/{default['id']}", json={"text": ""}, cookies=cookies)
    _identify(isolated_client, cookies)
    assert calls[-1]["hint_context"] is None
    empty = _hint(isolated_client, cookies, "Empty", "")
    _identify(isolated_client, cookies, f"&hint_id={empty}")
    assert calls[-1]["hint_context"] is None


def test_unknown_hint_id_is_400_and_the_model_is_not_called(isolated_client, setup):
    cookies, calls = setup
    r = _identify(isolated_client, cookies, "&hint_id=does-not-exist")
    assert r.status_code == 400
    assert r.json()["detail"] == "Invalid hint_id"
    assert calls == []


def test_collection_id_is_no_longer_an_input(isolated_client, setup):
    cookies, calls = setup
    assert _identify(isolated_client, cookies, "&collection_id=anything").status_code == 200
    assert calls[-1]["hint_context"] == f"Hint: {DEFAULT_HINT_TEXT}"


def _item_with_image(isolated_client, cookies):
    r = isolated_client.post("/api/items", cookies=cookies, json={
        "name": "Existing", "stored_images": [{"id": "img1", "path_thumb": "t.webp", "path_display": "d.webp"}],
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_rescan_uses_the_default_hint_unless_hint_id_is_given(isolated_client, setup):
    cookies, calls = setup
    tag = isolated_client.post("/api/tags", json={"name": "Camping"}, cookies=cookies).json()
    item = _item_with_image(isolated_client, cookies)
    isolated_client.patch(f"/api/items/{item}", json={"tag_ids": [tag["id"]]}, cookies=cookies)

    assert isolated_client.post(f"/api/items/{item}/rescan", cookies=cookies).status_code == 200
    assert calls[-1]["hint_context"] == f"Hint: {DEFAULT_HINT_TEXT}"  # the item's tags do not matter

    hint_id = _hint(isolated_client, cookies, "Garage", "Garage clutter.")
    assert isolated_client.post(f"/api/items/{item}/rescan?hint_id={hint_id}", cookies=cookies).status_code == 200
    assert calls[-1]["hint_context"] == "Hint: Garage clutter."


def test_rescan_with_an_unknown_hint_is_400(isolated_client, setup):
    cookies, calls = setup
    item = _item_with_image(isolated_client, cookies)
    r = isolated_client.post(f"/api/items/{item}/rescan?hint_id=nope", cookies=cookies)
    assert r.status_code == 400 and r.json()["detail"] == "Invalid hint_id"
    assert calls == []


def test_the_hint_reaches_the_model_prompt(monkeypatch):
    sent: dict = {}

    class _Msg:
        content = '{"unknown": false, "name": "Drill", "description": "d", "confidence": 0.9}'

    class _Resp:
        choices = [type("C", (), {"message": _Msg()})()]

    def fake_completion(**kwargs):
        sent.update(kwargs)
        return _Resp()

    monkeypatch.setattr(openai_id, "completion", fake_completion)
    out = openai_id.identify(["ZmFrZQ=="], {"model": "m", "api_key": "k"}, mode="one", hint_context="Hint: Garage clutter.")
    user_text = sent["messages"][1]["content"][0]["text"]
    assert "Hint: Garage clutter." in user_text
    assert "collection" not in user_text.lower()
    assert out["name"] == "Drill" and "collection" not in out

    sent.clear()
    openai_id.identify(["ZmFrZQ=="], {"model": "m", "api_key": "k"}, mode="one", hint_context=None)
    assert "Hint:" not in sent["messages"][1]["content"][0]["text"]
