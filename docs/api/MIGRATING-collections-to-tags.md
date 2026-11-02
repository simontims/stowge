# Migrating from collections to tags (Stowge 0.12.0)

Stowge 0.12.0 replaces collections with tags. An item can have several tags, and tags are optional.
The external API (`/external-api/v1`) was changed with **no alias**: the old calls stop working, so
update scripts, Home Assistant configuration and anything else that calls the API before you upgrade.

What happens to your data on upgrade is automatic and one-way:

- Every collection becomes a tag with the **same id, name, icon, colour and description**.
  Names that differ only by upper/lower case (for example `Tools` and `tools`) are merged into the
  one created first.
- Every item gets the tag that matches its old collection (`"collection": "Tools"` becomes
  `"tags": ["Tools"]`).
- API keys with `collections.*` scopes are rewritten to the matching `tags.*` scopes, so existing keys
  keep working. The key value does not change.
- A copy of the database is written next to it first (`stowge.db.pre-tags-<timestamp>`).

## Old to new

| Before (0.11 and earlier) | Now |
|---|---|
| `GET /v1/collections` | `GET /v1/tags` |
| `GET /v1/collections/{id}` | `GET /v1/tags/{id}` |
| `POST /v1/collections` | `POST /v1/tags` |
| `PATCH /v1/collections/{id}` | `PATCH /v1/tags/{id}` |
| `DELETE /v1/collections/{id}?move_to_collection_id=...` | `DELETE /v1/tags/{id}` (items lose the tag; no move option) |
| `GET /v1/collections/{id}/items` | `GET /v1/items?tag=<tag name>` |
| `GET /v1/items?collection=Tools` | `GET /v1/items?tag=Tools` (repeat `tag` to require several; `__none` = untagged) |
| item `"collection": "Tools"` (read) | item `"tags": ["Tools"]` |
| item `"collection": "Tools"` (create or update) | `"tags": ["Tools"]` (the list replaces the item's tags) |
| item `"collection": ""` to clear | `"tags": []` |
| scopes `collections.read`, `collections.write`, `collections.delete` | `tags.read`, `tags.write`, `tags.delete` |
| collection field `ai_hint` | removed from tags: AI hints are now a separate list, managed in Settings |
| `move_to_collection_id` | removed |

Things to know:

- A request body that still contains `collection` is rejected with HTTP 400
  `{"detail": "collection is no longer supported; use tags"}`. It is not ignored, so a script that has
  not been updated fails visibly instead of silently losing the tag.
- Tag names in `tags` are matched ignoring case (`"tools"` finds `Tools`). A name that does not exist
  is HTTP 400; **tags are never created automatically** by item calls. Create the tag first with
  `POST /v1/tags`.
- Tag names are unique ignoring case, so `POST /v1/tags` with `tools` fails if `Tools` exists.
- Deleting a tag removes it from every item and returns `{"ok": true, "items_untagged": n}`. The items
  stay. Pinned menu entries and "Add" screen defaults that used the tag are removed for all users.
- `/v1/collections*` return 404.

## Examples

### curl

```bash
# before
curl -H "Authorization: Bearer $KEY" "$BASE/external-api/v1/items?collection=Tools"
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name": "Socket Set", "collection": "Tools"}' "$BASE/external-api/v1/items"

# after
curl -H "Authorization: Bearer $KEY" "$BASE/external-api/v1/items?tag=Tools"
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"name": "Socket Set", "tags": ["Tools", "To Sell"]}' "$BASE/external-api/v1/items"
```

### Python

```python
import requests

BASE = "https://stowge.example.com/external-api/v1"
HEADERS = {"Authorization": f"Bearer {KEY}"}

# list the tags (formerly collections); each has item_count
tags = requests.get(f"{BASE}/tags", headers=HEADERS).json()

# items that have BOTH tags
items = requests.get(f"{BASE}/items", params=[("tag", "Electronics"), ("tag", "To Sell")], headers=HEADERS).json()

# retag an item: the list replaces the old one
requests.patch(f"{BASE}/items/{item_id}", json={"tags": ["Electronics"]}, headers=HEADERS).raise_for_status()
```

### Home Assistant (REST sensor / rest_command)

```yaml
# before
sensor:
  - platform: rest
    name: Stowge tools
    resource: https://stowge.example.com/external-api/v1/items?collection=Tools
    headers:
      Authorization: !secret stowge_bearer
    value_template: "{{ value_json | length }}"

# after
sensor:
  - platform: rest
    name: Stowge tools
    resource: https://stowge.example.com/external-api/v1/items?tag=Tools
    headers:
      Authorization: !secret stowge_bearer
    value_template: "{{ value_json | length }}"

rest_command:
  stowge_add_item:
    url: https://stowge.example.com/external-api/v1/items
    method: post
    headers:
      Authorization: !secret stowge_bearer
      Content-Type: application/json
    # before: '{"name": "{{ name }}", "collection": "Tools"}'
    payload: '{"name": "{{ name }}", "tags": ["Tools"]}'
```

The `items` endpoint returns at most 50 items per page by default (`limit` up to 200, `offset` to page);
a sensor that counts `value_json | length` only counts the current page.

## Checklist

1. Replace `/v1/collections*` calls with `/v1/tags*`.
2. Replace `collection` in item bodies with `tags` (a list of names) and in query strings with `tag`.
3. Replace `collections.*` scopes on any key you create from now on with `tags.*` (existing keys were
   converted for you).
4. Look for places that read `collection` from an item response and read `tags` (a list of names) instead.
