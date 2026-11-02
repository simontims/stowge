# External API changelog

Changes to the versioned external API (`/external-api`, Swagger at `/external-api/docs`).
The generated reference in this folder (`openapi.json`, `endpoints.md`) says *what* exists;
this file says *what changed*, per release: added, changed, deprecated, removed.

Stowge is on 0.x, so breaking changes can happen in any minor release. They are always listed
here first. Unreleased changes sit under "Unreleased" until a release is tagged.

## Unreleased

No changes to the external API.

Internal (not part of the external API, listed for information): the signed-in user's profile
(`/api/me`) gains `whats_new` (latest note number, unseen notes, whether the welcome tour is pending)
and shortcut filters gain optional `icon` and `color`. New endpoints: `GET /api/whats-new` (release
notes), `POST /api/me/whats-new/seen` and `POST /api/me/welcome/seen`.

The AI identify response's `collection` value is no longer forced into a fixed electronics list: it
is passed through lower-cased, and is `unknown` when missing or blank.
