# Performance maintenance (branch `maintenance-performance`)

A measured pass over the database, API and UI. Every change below was benchmarked before and
after, has a test, and was reviewed by an independent specialist for its area. Nothing changes
what the API returns: response bodies and status codes are byte-identical for 14 endpoints
(checked against the previous commit on the same data).

Benchmark data: a read-only copy of the live database scaled up to 20,000 items, about 60,000
images, 200 tags and up to 5,000 locations. Numbers are medians of several runs on one machine
(local ext4), so read them as relative gains, not promises. The scripts to rerun them are in
`scripts/perf/{db,api,ui}/`.

## Database

| Change | Effect |
|---|---|
| `synchronous=NORMAL` (only when WAL is really active), `cache_size` 16 MB, `temp_store=MEMORY`, 30 s busy timeout | A WAL commit 2.63 ms to 0.012 ms. Scans with no hits 202 ms to 70 ms. No more "database is locked" when a write meets VACUUM, a backup or a restore (was 5 s). |
| Connection pool 10 + 30 (was 5 + 10) | 40 concurrent requests 1.53 s to about 0.5 s. Connections open lazily, so no cost when idle. |
| Covering index `ix_parts_location_deleted_id(location_id, is_deleted, id)` added to existing databases at start; superseded `ix_parts_location_id` and the dead `ix_parts_collection` dropped | Items-in-a-location and in-use checks 2.6 ms to 0.34 ms. Per-location counts 19.6 ms to 9.6 ms. |
| `ANALYZE` once if statistics are missing, then `PRAGMA optimize` at start | A database with no statistics picked a plan 4x slower for tag counts (190 ms vs 50 ms). Costs about 10 ms. |

Safety notes
- `synchronous=NORMAL` in WAL can lose the last few commits on a power cut but cannot corrupt the
  file. If WAL is refused (some network mounts) the setting stays at FULL.
- The index step is best-effort: a read-only or locked database logs a warning and starts anyway.
  The old location index is only dropped when its replacement exists.
- Idempotent: a second start changes nothing. Rolling back to an older image is safe, queries
  just lose the speed-up.
- Verified on a copy of the live database: row counts unchanged, integrity check ok.

## API

| Change | Effect |
|---|---|
| Item lists batch-load images (was one query per item) and skip unused AI columns | `/api/items` 106 to 59 ms and 207 to 7 queries. Search 155 to 104 ms. |
| Locations and bootstrap: one join instead of a lookup per location | 58 to 23 ms, 139 to 4 queries. |
| Session auth in one joined query; `last_seen_at` written at most every 60 s (`SESSION_TOUCH_INTERVAL_SECONDS`, 0 = every request as before) | About 3.5 ms off every signed-in request and one fewer write transaction per request. |
| `tags_by_item_id` no longer uses the join SQLite planned badly | 4.8 s to 0.55 s for 20,000 ids. |
| CSV export streams in 64 KB chunks | 8.4 s to 1.4 s for 20,000 items. |
| gzip for JSON, CSV, HTML, JS, CSS (not images, zips or the live-update stream) | `/api/items` 125 KB to 34 KB, CSV 4.6 MB to 526 KB, `/api/tags` 28 KB to 6.5 KB. |
| `Cache-Control: immutable` (1 year) on `/assets/*` (Vite hashed files); `index.html` stays `no-store` | Hashed files are no longer revalidated on every load. |
| Image endpoint answers `If-None-Match` / `If-Modified-Since` with 304, only after the signature check | Repeat views of the same image URL send no body. |
| Fix: an `Authorization` header on an image request returned 500 | Now 200 with a session cookie, 401 without. Existed before this branch. |
| VACUUM waits up to 30 s for a lock (was 5 s) | No spurious failure while a write is running. |

Risks
- `last_seen_at` has 60 s resolution. Sessions expire at a fixed time, so this does not change when a session ends.
- gzip adds `Vary: Accept-Encoding`. All of `/assets` is assumed to be content-hashed (true for Vite output).

## UI

| Change | Effect |
|---|---|
| Add, Edit, System, Settings and Release notes load on demand; the tour library loads only when a tour starts | First JavaScript 761 kB to 324 kB (gzip 209 to 97 kB). |
| Tabler icons are split into small pieces by name; only the icons on screen are fetched | The Items page no longer downloads the whole 2.6 MB icon catalogue when a tag has an icon (about 7 small requests instead). The icon picker still has every icon. |
| Shared in-flight GETs (`apiGetShared`), cleared around any save | First `/items` load: 4 `/api/tags` and 4 `/api/me` down to 1 and 2. |
| Thumbnails load lazily with width and height | Image requests on first load of 64 rows 62 to 31. |
| Table rows are memoised | Typing in the search box over 2,000 rows re-rendered 6,000 rows, now under 2,000. |
| Chunk-load recovery: one automatic reload at most per minute, plus an error screen with a Reload button that clears when you navigate | After an update (Watchtower) an open tab no longer goes blank. |

## Looked at and left alone
- `parts(is_deleted, name)` index: faster default list but slower sorting by location, two-tag filters and no-hit search.
- Full-text search: would change substring behaviour and needs sync triggers.
- `mmap_size`: unsafe on network mounts. `foreign_keys=ON`: changes behaviour.
- Throttling `last_used_at` for API keys: observable and tested, kept as is.
- Stable signed image URLs for browser caching: would show stale images after a rotate.
- Search debounce already exists (300 ms). lucide-react is already imported per icon.

## Known follow-ups (not in this branch)
- Signed thumbnail URLs change on every list fetch, so the browser cannot reuse them across loads. Needs a versioned URL scheme that survives rotate.
- `/api/items` returns the whole list (capped at 200 per request): paging or windowing would help very large inventories.
- `/api/items/bootstrap` repeats data in `/api/tags` and `/api/locations`.
- Search with text is a `LIKE` scan; the tag match is a correlated subquery that could become an `IN`.
- JSON endpoints have no ETag (gzip only).
- Existing, not caused by this work: editing an item sends no live-update event to other open tabs; a tag typed into the Add form but not chosen from the list is dropped silently.

## QA
Run on the two previews (blank database and a copy of real data): all pages without console
errors, icons including aliases, create/edit/delete/restore, search, CSV export and backup,
304 on images, gzip and cache headers, live-update stream still streaming, logout and tampered
cookie rejected, 360 px phone layout, a stale-tab simulation (blocked chunk shows the error
screen, not a blank page), and the upgrade of a real database (66 items intact, integrity ok,
new index present). Tests: 397 API, 244 UI, ruff, tsc and build clean.
