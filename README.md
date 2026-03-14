# Stowge
Self-hosted electronic parts inventory with an AI-assisted mobile-first "Add Item" flow.

- UI (PWA) served at `/`
- API served under `/api`
- OpenAPI spec: `/openapi.json`
- Swagger UI: `/docs`

## Features (MVP)
- First-run setup: create initial admin user
- Bearer token auth (login returns JWT)
- Add Item flow on mobile:
  - take/pick up to 5 photos
  - submit for AI ID (1 best guess)
  - optionally retry for 5 candidates
  - accept → create a Draft part in the DB
- Parts list + basic search + edit/confirm
- Image ingest pipeline:
  - generates display + thumbnail variants
  - optional "store original" setting
  - images served via the API (auth-protected)

## Deploy (Docker host)
### 1) Create persistent folders
```bash
mkdir -p /mnt/data/docker/stowge/{config/postgres,assets}
```

### 2) Create `.env`
Copy `.env.example` to `.env` and fill in values.

### 3) Start
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Then configure Nginx Proxy Manager:
- `stowge.my.domain` → `http://192.168.1.45:18090`
- Enable HTTPS (camera access on Android requires HTTPS)

## Local dev (optional)
```bash
docker compose --env-file .env up -d --build
```
Then open: http://localhost:18090/

## Notes
- Postgres is internal-only (no host port).
- Images are stored under the host-mounted `/mnt/data/docker/stowge/assets` volume.
