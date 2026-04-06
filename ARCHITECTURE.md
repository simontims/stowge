# Architecture Overview

This document is the working architecture reference for Stowge. It captures how the system is currently built and operated, and should be updated as implementation changes.

## 1. Project Structure

Stowge is a monorepo containing a FastAPI backend, a React frontend source tree, and generated frontend build artifacts.

```
stowge/
├── backend/
│   ├── requirements.txt
│   └── stowge/
│       ├── main.py              # FastAPI app and routes
│       ├── models.py            # SQLAlchemy models
│       ├── db.py                # DB engine/session wiring
│       ├── auth.py              # Session-based auth and role checks
│       ├── images.py            # Image processing and storage helpers
│       ├── image_signing.py     # Signed image URL generation/verification
│       └── openai_id.py         # AI identify prompt/adapter layer
├── ui-src/
│   ├── package.json
│   ├── src/
│   │   ├── pages/               # Route pages (Add, Items, Locations, etc.)
│   │   ├── components/          # Reusable UI pieces
│   │   ├── lib/api.ts           # Frontend API utility
│   │   └── config/nav.ts        # Navigation configuration
│   └── public/
├── ui/                          # Built frontend assets served by backend
├── data/                        # Runtime data volume (DB and app state)
├── Dockerfile
├── docker-compose.yml
├── docker-compose.prod.yml
├── run.ps1 / run.sh / run.cmd
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
	 |            \---> [AI Provider APIs (OpenAI-compatible)]
	 |
	 +---> [SQLite Database]
	 |
	 +---> [File Storage (assets image variants)]
```

## 3. Core Components

### 3.1 Frontend Application

- Name: Stowge Web UI (PWA-capable)
- Description: Main user interface for authentication, inventory management, Add Item workflows (AI-assisted and manual), collections, locations, users, and AI settings.
- Technologies: React, TypeScript, Vite, Tailwind-style utility CSS, lucide-react icons.
- Runtime/Deployment: Built in ui-src, output to ui, served by backend as static files.

### 3.2 Backend API Service

- Name: Stowge API
- Description: Handles auth, authorization, CRUD operations, AI identify orchestration, image storage/signing, and user/admin settings.
- Technologies: Python 3, FastAPI, SQLAlchemy, bcrypt, Pillow for image processing.
- Auth mechanism: Server-managed sessions via HTTP-only `stowge_session` cookie (SameSite=Lax). No JWT in the browser auth path.
- Runtime/Deployment: Docker container (single service in current deployment model).

### 3.3 AI Identification Module

- Name: Identify Pipeline
- Description: Converts one to five uploaded photos into AI candidate suggestions and evidence/context with optional collection hinting.
- Technologies: OpenAI-compatible chat completion pattern via configured provider/model keys.
- Notes: As currently implemented, identify processing is in-memory. Photo files are persisted only on item save.

## 4. Data Stores

### 4.1 Primary Database

- Name: Application DB
- Type: SQLite (current local and compose defaults)
- Purpose: Persistent state for users, items, images, collections, locations, and AI config metadata.
- Key tables: users, sessions, parts, part_images, collections, locations, llm_configs.
- Stub tables (schema present, no routes yet): external_identities, api_keys.

### 4.2 File Storage

- Name: Image Asset Store
- Type: Local filesystem directory (configurable via ASSETS_DIR)
- Purpose: Stores generated image variants for saved item photos.
- Stored variants: thumb, display, optional original.

## 5. External Integrations / APIs

- AI Providers (OpenAI-compatible endpoints)
	- Purpose: Item photo identification and candidate generation.
	- Integration method: HTTPS REST requests via backend.
	- Supported provider metadata includes OpenAI, Anthropic, Gemini, Azure OpenAI, Groq, Mistral, xAI, and OpenRouter.

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
	- POST /api/items
	- GET /api/items/{id}
	- PATCH /api/items/{id}
	- DELETE /api/items/{id}
	- GET /api/collections
	- GET /api/locations
	- POST /api/identify
	- POST /api/images/store
	- POST /api/images/discard
	- GET /api/events/items        → SSE stream (authenticated via session cookie)

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

- Quick start scripts: run.ps1, run.sh, run.cmd
- Compose support: docker-compose.yml
- Frontend development/build source: ui-src
- Backend app code: backend/stowge

### 8.2 Production-Oriented Deployment

- Dockerfile builds frontend and backend into one deployable image.
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
- preferred_add_collection_id
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
- collection
- location_id
- status (draft or confirmed)
- ai_primary
- ai_alternatives
- ai_chosen_index
- created_at
- updated_at

### Collection

- id
- name
- icon
- description
- ai_hint

### Location

- id
- name
- description
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

- Terminology is standardized on Collection/Collections (legacy Category naming removed from active routes and UI).
- Item photos are persisted only at save time to avoid orphan storage from abandoned Add flows.
- Backend currently remains a single FastAPI service (no microservice split).
- SQLite is the default persistence layer in current deployment patterns.

## 11. Future Considerations

- Evaluate periodic garbage collection for any orphan image directories created by unexpected process termination.
- Consider database options for larger multi-user installations.
- Consider separating frontend hosting from API service if scale or delivery constraints evolve.

## 12. Project Identification

- Project Name: Stowge
- Repository URL: https://github.com/simontims/stowge
- Primary Image Registry: https://hub.docker.com/r/simontims/stowge
- Date of Last Update: 2026-03-24

## 13. Glossary

- Collection: Domain grouping for items (for example Electronic Parts, Sailing Gear, Houseplants).
- Item: Inventory record; represented by Part model/table in backend.
- Identify: AI-assisted suggestion flow based on uploaded photos.
- Stored Image: Persisted image variant set attached to an item after save.
