# External API changelog

Changes to the versioned external API (`/external-api`, Swagger at `/external-api/docs`).
The generated reference in this folder (`openapi.json`, `endpoints.md`) says *what* exists;
this file says *what changed*, per release: added, changed, deprecated, removed.

Stowge is on 0.x, so breaking changes can happen in any minor release. They are always listed
here first. Unreleased changes sit under "Unreleased" until a release is tagged.

## Unreleased

Release 0.12.0 replaces collections with tags. This is a **breaking change** with no alias: scripts and
integrations that use collections must move to tags. See
[MIGRATING-collections-to-tags.md](MIGRATING-collections-to-tags.md) for the old to new mapping.

### Removed

- `GET/POST /v1/collections`, `GET/PATCH/DELETE /v1/collections/{id}` and
  `GET /v1/collections/{id}/items`. They now return 404.
- The `collection` field on items (read and write) and the `collection` filter on `GET /v1/items`.
  A request body that contains `collection` is rejected with HTTP 400
  `"collection is no longer supported; use tags"` (it is not silently ignored).
- The `collections.read`, `collections.write` and `collections.delete` API key scopes. Creating a key
  with one of them fails with `Unsupported scope`.

### Added

- `GET/POST /v1/tags`, `GET/PATCH/DELETE /v1/tags/{id}`. A tag has `id`, `name`, `icon`, `color`,
  `description` and `item_count` (soft-deleted items are not counted). Tag names are unique,
  ignoring case. Deleting a tag removes it from its items (the items stay) and returns
  `{"ok": true, "items_untagged": n}`. There is no move-to option.
- `tags` on items: a list of tag names (for example `["Electronics", "To Sell"]`). On `POST` and
  `PATCH` the list replaces the item's tags; an unknown tag name is HTTP 400 (names are never created
  automatically; name matching ignores case); duplicates are ignored.
- `tag` filter on `GET /v1/items` (repeatable, all must match; `__none` means untagged; an unknown name
  returns an empty list). `q` also matches tag names.
- `tags.read`, `tags.write` and `tags.delete` API key scopes.

### Changed

- Existing API keys are migrated automatically on first start: `collections.read|write|delete` become
  `tags.read|write|delete` (the stored scope list is rewritten and de-duplicated), so keys keep working.
- Existing collections became tags with the **same ids and names**, and each item carries the tag that
  matches its old collection.

Internal (not part of the external API, listed for information): the signed-in user's profile
(`/api/me`) gains `whats_new` (latest note number, unseen notes, whether the welcome tour is pending,
and `tags_migration` with the converted collection count) and shortcut filters gain optional `icon` and
`color`. `/api/me` loses `preferred_add_collection_id`, `last_open_collection` and `collection_nav_order`
and gains `preferred_add_hint_id`, `preferred_add_tag_ids` and `last_open_tag`; shortcut filters use
`tag_id` instead of `collection`. New endpoints: `/api/tags`, `/api/hints` (replacing `/api/collections`),
`GET /api/status/tags` (replacing `/api/status/collections`), `GET /api/whats-new` (release notes),
`POST /api/me/whats-new/seen` and `POST /api/me/welcome/seen`. `POST /api/identify` and the item rescan
take `hint_id` instead of `collection_id`. CSV export has a `tags` column and a repeatable `tag` filter;
CSV import reads `tags` (and an old `collection` column as one tag) and `create_tags` replaces
`create_collections`.

The AI identify response no longer has a `collection` value.
