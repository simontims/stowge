# Architecture Overview

This document is the working architecture reference for Stowge. It captures how the system is currently built and operated, and should be updated as implementation changes.

## 1. Project Structure

Stowge is a monorepo containing a FastAPI api and a React frontend.

```
stowge/
├── api/
│   ├── requirements.txt
│   └── stowge/
│       ├── main.py              # FastAPI app and routes
│       ├── models.py            # SQLAlchemy models
│       ├── db.py                # DB engine/session wiring
│       ├── auth.py              # Session-based auth and role checks
│       ├── images.py            # Image processing and storage helpers
│       ├── image_signing.py     # Signed image URL generation/verification
│       └── openai_id.py         # AI identify prompt/adapter layer
├── ui/                          # React/TypeScript frontend source
│   ├── package.json
│   ├── vite.config.ts
│   ├── src/
│   │   ├── pages/               # Route pages (Add, Items, Locations, etc.)
│   │   ├── components/          # Reusable UI pieces
│   │   ├── lib/api.ts           # Frontend API utility
│   │   └── config/nav.ts        # Navigation configuration
│   ├── public/
│   └── dist/                    # Build output (gitignored) — served by api
├── scripts/
│   ├── run.sh                   # Unix/macOS dev launcher
│   ├── run.ps1                  # Windows PowerShell dev launcher
│   └── run.cmd                  # Windows CMD launcher
├── data/                        # Runtime data volume (DB and app state)
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── README.md
└── ARCHITECTURE.md
```

## 2. High-Level System Diagram

```
[User Browser / PWA]
				|
				| HTTPS (REST + static assets)
				v
[FastAPI Backend]
	 |           \
	 |            \---> [AI Provider APIs]
	 |
	 +---> [SQLite Database]
	 |
	 +---> [File Storage (assets image variants)]
```

## 3. Core Components

### 3.1 Frontend Application

- Name: Stowge Web UI (PWA-capable)
- Description: Main user interface for authentication, inventory management, Add Item workflows (AI-assisted and manual), tags, AI hints, locations, users, and AI settings.
- Technologies: React, TypeScript, Vite, Tailwind-style utility CSS, lucide-react icons.
- Runtime/Deployment: Source in `ui/`, builds to `ui/dist/`, served by api as static files.

### 3.2 Backend API Service

- Name: Stowge API
- Description: Handles auth, authorization, CRUD operations, AI identify orchestration, image storage/signing, and user/admin settings.
- Technologies: Python 3, FastAPI, SQLAlchemy, bcrypt, Pillow for image processing.
- Auth mechanism: Server-managed sessions via HTTP-only `stowge_session` cookie (SameSite=Lax). No JWT in the browser auth path.
- Runtime/Deployment: Docker container (single service in current deployment model).

### 3.3 AI Identification Module

- Name: Identify Pipeline
- Description: Converts one to five uploaded photos into AI candidate suggestions and evidence/context with an optional AI hint (one hint per run; the built-in Default hint when none is chosen).
- Technologies: OpenAI-compatible chat completion pattern via configured provider/model keys.
- Notes: As currently implemented, identify processing is in-memory. Photo files are persisted only on item save.
- Model discovery: Admins can explicitly submit unsaved provider credentials to the api to list available models before saving an AI configuration. Credentials remain server-side for the provider request and are not persisted by discovery or returned to the browser. Azure deployment discovery remains manual because it requires management-plane credentials beyond the inference API key.

## 4. Data Stores

### 4.1 Primary Database

- Name: Application DB
- Type: SQLite (current local and compose defaults)
- Purpose: Persistent state for users, items, images, tags, AI hints, hierarchical locations, and AI config metadata.
- Key tables: users, sessions, parts, item_contents, maintenance_schedules, part_images, tags, item_tags, ai_hints, sites, areas, locations, llm_configs, app_meta.
- Legacy tables kept (unread and unwritten) for roll-back safety until a cleanup release: `collections`, `parts.collection`, and the `users` collection columns.
- Schema changes run in `api/stowge/main.py` (`_run_startup_migrations`). The release 2 collections-to-tags migration lives in `api/stowge/tags_migration.py` (see section 12a).
- Stub tables (schema present, no routes yet): external_identities, api_keys.

### 4.2 File Storage

- Name: Image Asset Store
- Type: Local filesystem directory (configurable via ASSETS_DIR)
- Purpose: Stores generated image variants for saved item photos.
- Stored variants: thumb, display, optional original.

## 5. External Integrations / APIs

- AI Providers
	- Purpose: Item photo identification and candidate generation.
	- Integration method: HTTPS REST requests via api.
	- Supported provider metadata includes OpenAI, Anthropic, Gemini, Azure OpenAI, Groq, Mistral, xAI, and OpenRouter.
	- Model discovery uses OpenAI-compatible model endpoints where available and native Anthropic/Gemini endpoints. Discovered models known by LiteLLM to support vision are prioritized; unknown models remain selectable but require normal inference validation.

## 6. API Design (Current)

- Base path: /api
- Auth: HTTP-only `stowge_session` cookie (set by POST /api/login, cleared by POST /api/logout).
  Authorization is enforced server-side on every request from live database state (role column on User).
- Representative endpoints:
	- GET /api/status
	- POST /api/setup/first-admin
	- POST /api/login              → sets stowge_session cookie, returns user object
	- POST /api/logout             → deletes session, clears cookie
	- GET /api/me
	- GET /api/items
	- GET /api/items/bootstrap
	- POST /api/items
	- GET /api/items/{id}
	- PATCH /api/items/{id}
	- DELETE /api/items/{id}
	- GET /api/tags, POST /api/tags, PATCH /api/tags/{id}, DELETE /api/tags/{id}  → tag CRUD (any signed-in user)
	- GET /api/hints, POST /api/hints, PATCH /api/hints/{id}, DELETE /api/hints/{id}  → AI hint CRUD (Default cannot be deleted or renamed)
	- GET /api/status/tags         → per-tag item/image/disk metrics (items without tags grouped as "No tag")
	- GET /api/sites
	- GET /api/areas
	- GET /api/locations
	- POST /api/admin/settings/ai/models/discover → list models using unsaved provider credentials (admin, no persistence)
	- POST /api/identify          → optional `hint_id` (blank = Default hint; unknown = 400)
	- POST /api/images/store
	- POST /api/images/discard
	- GET /api/events/items        → SSE stream (authenticated via session cookie)
	- GET /api/export/csv          → CSV download (admin, supports scope/tag/location filters; `tag` is repeatable, columns include `tags` joined with `; `)
	- POST /api/import/csv/preview → Parse CSV and report missing tags/locations, plus `invalid_tags` (admin)
	- POST /api/import/csv/confirm → Import items from CSV, optionally creating missing tags/locations (admin); reads `tags` (split on `;` only; names may contain commas) and, for old files, a `collection` column as one tag; tags to be created must pass the same name rules as hand-made ones (min length, no `;`) or the import is refused with 400

## 7. Security Considerations

- Authentication: HTTP-only session cookie (`stowge_session`, SameSite=Lax). No tokens in localStorage.
- Authorization: Role-based controls enforced server-side from live database state. Role is never trusted from client input or token claims.
- Session management: Sessions stored in the `sessions` table with an expiry timestamp. Expired sessions are pruned lazily on each new login. Sessions are immediately invalidated on logout.
- Image access: Signed image URLs with expiry and HMAC signature verification (key: IMAGE_URL_SECRET).
- Password handling: bcrypt + SHA-256 pre-hash (72-byte bcrypt limit mitigation).
- Transport: Intended to run behind HTTPS in production deployments (set SESSION_COOKIE_SECURE=true).
- CSRF: SameSite=Lax cookie policy is sufficient for same-origin self-hosted deployments.

### Auth Design — Separation of Concerns

- **Authentication** (who is the user?): Answered by the session cookie lookup → resolves to a User row.
- **Authorization** (what can they do?): Answered by the `role` column on User, read from the database on each request. Role decisions are never based solely on session or token claims.
- **Future API keys**: `api_keys` table stub is in place. When implemented, API key auth will be a parallel path to session auth — not a replacement.
- **Future OIDC**: `external_identities` table stub is in place. When Google/Microsoft login is added, the external identity will map to a local User row so that Stowge authorization remains database-driven.

## 8. Development and Deployment

### 8.1 Local Development

- Quick start scripts: scripts/run.sh, scripts/run.ps1, scripts/run.cmd
- Compose support: docker-compose.yml
- Frontend dev: `cd ui && npm run dev` (Vite proxy to :18090 for API calls)
- Frontend source: ui/ → builds to ui/dist/
- Backend app code: api/stowge

### 8.2 Production-Oriented Deployment

- Dockerfile builds frontend and api into one deployable image.
- Compose prod workflow: docker-compose.prod.yml
- Container image published to Docker Hub: simontims/stowge

## 9. Data Model Summary

### User

- id
- email (username)
- first_name
- last_name
- role (admin or user)
- theme
- preferred_add_hint_id (sticky AI hint on Add; null = Default)
- preferred_add_tag_ids (JSON array of sticky tag ids on Add)
- preferred_add_location_id
- last_open_tag (name of the tag last opened; post-login route)
- shortcut_filters (JSON array of user-defined item filter shortcuts; `tag_id` is a tag id, `__none` for untagged, or null; max 100)
- last_seen_note / welcome_seen_version (What's New cursor, welcome tour)
- legacy, unread and unwritten: preferred_add_collection_id, last_open_collection, collection_nav_order
- password_hash (bcrypt)

### Session (sessions table)

- id (opaque 32-byte hex token)
- user_id (FK → users)
- created_at
- last_seen_at
- expires_at

### ExternalIdentity (stub — external_identities table)

For future OAuth/OIDC provider links (Google, Microsoft, etc.).

- id
- user_id (FK → users)
- provider (e.g. 'google' | 'microsoft')
- external_id (subject from provider)
- email
- created_at

### ApiKey (stub — api_keys table)

For future user-managed API keys for scripts and automation.

- id
- user_id (FK → users)
- name
- key_prefix (first 8 chars, display only)
- key_hash (SHA-256 of full key)
- created_at
- last_used_at
- expires_at

### Item (parts table)

- id
- name
- description
- tags (many, through item_tags)
- location_id
- status (draft or confirmed)
- ai_primary
- ai_alternatives
- ai_chosen_index
- created_at
- updated_at

### Item Contents Entry (item_contents table)

- id
- item_id (FK -> parts.id)
- name
- quantity
- note
- sort_order
- created_at

### Maintenance Schedule (maintenance_schedules table)

- task_key
- enabled
- cron_expression
- next_run_at
- last_run_at
- last_duration_ms
- last_status
- last_error
- updated_at

### Tag (tags table)

- id (migrated tags keep their collection id)
- name (case-insensitively unique: unique index on lower(name))
- icon
- color
- description
- created_at / updated_at
- Item counts are computed (soft-deleted items excluded), never stored.

### Item Tag (item_tags table)

- item_id (FK -> parts.id)
- tag_id (FK -> tags.id)
- primary key (item_id, tag_id); index on tag_id

### AI Hint (ai_hints table)

- id
- name (case-insensitively unique)
- text (may be empty; sent to the model as `Hint: <text>`)
- is_default (exactly one row, the built-in "Default": cannot be deleted or renamed, text is editable)
- created_at / updated_at

### Collection (legacy, collections table)

Kept unread and unwritten since the tags release. Removed in a later cleanup release.

- id, name, icon, color, description, ai_hint

### Site

- id
- name
- description

### Area

- id
- name
- description
- site_id

### Location

- id
- name
- description
- area_id
- photo_path

### Item Image (part_images table)

- id
- part_id
- path_thumb
- path_display
- path_original
- mime
- width
- height

## 10. Known Architectural Decisions

- Items are grouped by optional, many-per-item Tags (release 0.12.0). Collections no longer exist in the API or UI; the legacy table and `parts.collection` column remain, unwritten, until a cleanup release.
- AI hints are a separate list (name + text) with a built-in Default; Identify uses exactly one hint per run. Tags carry no AI hint.
- The external API made a clean break: `/v1/collections*`, the item `collection` field and `collections.*` scopes were removed; see `docs/api/MIGRATING-collections-to-tags.md`.
- Item photos are persisted only at save time to avoid orphan storage from abandoned Add flows.
- Backend currently remains a single FastAPI service (no microservice split).
- SQLite is the default persistence layer in current deployment patterns.
- Location hierarchy uses three tiers (Site -> Area -> Location) while items remain directly assigned to Location.
- Backward compatibility is preserved for existing Location endpoints and payload keys; hierarchy fields are additive.

## 11. Future Considerations

- Evaluate periodic garbage collection for any orphan image directories created by unexpected process termination.
- Consider database options for larger multi-user installations.
- Consider separating frontend hosting from API service if scale or delivery constraints evolve.
- If duplicate location names across Areas/Sites are needed later, versioned API changes should be used to preserve existing name-based integrations.

## 12. Location Hierarchy Migration

- Existing installations are migrated automatically at startup.
- A default Site (`Home`) and default Area (`General`) are created if missing.
- Existing Locations are backfilled to the default Area when area linkage is missing.
- Existing Location IDs, names, and item-to-location assignments are preserved.
- UI pickers collapse hierarchy levels when only one Site/Area exists to keep simple setups fast.

## 12a. Collections to Tags Migration (release 0.12.0)

`api/stowge/tags_migration.py`, called at the end of `_run_startup_migrations`. One-way, automatic, runs once (flag `tags_migration_v1` in `app_meta`) in a single transaction, after `create_all` has made the new tables.

1. If the database has users or items, a consistent copy is written first (SQLite backup API) as `<db>.pre-tags-<UTC timestamp>` (mode 0600). If that fails, the partial file is removed, the migration aborts, the flag stays unset and startup raises.
2. The Default hint is created. Each collection with a non-empty `ai_hint` becomes an `ai_hints` row named after it (identical texts share one row; a clashing name gets ` (2)`, ` (3)`, ...).
3. Each collection becomes a tag with the same id, name, icon, colour and description. Names that differ only by case merge into the first by `created_at`; their items move to the survivor. `;` in a name (the CSV separator) becomes `,` (repeated spaces collapsed; a clash gets ` (2)`, ...) and is logged; ids and item matching keep using the original collection name.
4. Items get `item_tags` rows by matching the old `parts.collection` name case-insensitively.
5. Per user: pinned shortcut filters are created for each tag (in `collection_nav_order`, the rest in creation order) and placed before the user's own filters, capped at 100 (the overflow is counted in `tags_migration_filters_skipped`, never an error); old filters with `collection` switch to `tag_id`; `preferred_add_collection_id` becomes `preferred_add_hint_id` plus `preferred_add_tag_ids`; `last_open_collection` becomes `last_open_tag`.
6. API key scopes `collections.*` become `tags.*`.
7. `tags_migration_collections_converted` (count before merging) feeds the What's New tour via `/api/me` `whats_new.tags_migration`.

Restoring an older backup runs it again (restore calls `init_db`). `validate_backup_database_schema` does not require the new tables, so older backups remain restorable.

## 13. Project Identification

- Project Name: Stowge
- Repository URL: https://github.com/simontims/stowge
- Primary Image Registry: https://hub.docker.com/r/simontims/stowge
- Date of Last Update: 2026-11-02

## 14. Glossary

- Tag: Optional label on an item; an item can have several (for example Electronics, To Sell). Pinned shortcut filters put favourite tags in the menu.
- AI hint: Named text sent to the AI with each photo; pick one on the Add screen (Default when none).
- Item: Inventory record; represented by Part model/table in api.
- Identify: AI-assisted suggestion flow based on uploaded photos.
- Stored Image: Persisted image variant set attached to an item after save.
