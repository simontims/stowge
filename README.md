# Stowge
Self-hosted inventory system for mobile and desktop, configurable for multiple categories and powered by an AI-assisted "Add Item" flow.

Stowge is designed for people who want full control of their inventory data while still getting modern UX: camera-first capture, AI suggestions, and fast editing/search across collections.

- UI (PWA) served at `/`
- API served under `/api`
- OpenAPI spec: `/openapi.json`
- Swagger UI: `/docs`

## Features (MVP)
- Works across multiple inventory domains (electronics, tools, marine, clothing, and more)
- Category/location structure is configurable in-app
- PWA UI optimized for mobile capture and desktop management
- First-run setup: create initial admin user
- Bearer token auth (login returns JWT)
- Add Item flow on mobile:
  - take/pick up to 5 photos
  - submit for AI identification (1 best guess)
  - optionally retry for 5 candidates
  - accept → create a Draft item in the DB
- Items list + basic search + edit/confirm
- Image ingest pipeline:
  - generates display + thumbnail variants
  - optional "store original" setting
  - images served via the API (auth-protected)

## Deploy (Docker host)
### 1) Create persistent folders
```bash
mkdir -p /local/path/to/stowage/{data,assets}
```

### 2) Create `.env`
Copy `.env.example` to `.env` and fill in values.

### 3) Start
```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### 4) Configure AI models in app
After first login, go to `Settings / AI` and add one or more LLM providers/models,
set API keys, and choose a default model for `Add`.

Then configure Nginx Proxy Manager:
- `stowge.my.domain` → `http://host.ip.address:18090`
- Enable HTTPS (camera access on Android requires HTTPS)

## Local Dev Quickstart

### Windows one-command run
From the repository root:

```powershell
.\run.ps1
```

Or with CMD:

```bat
run.cmd
```

Optional flags:
- `-SkipInstall` to skip `pip install`
- `-SkipUiBuild` to skip UI build
- `-Reload` to run uvicorn with auto-reload
- `-FreshSetup` to reset local `data/stowge.db` so first-run admin setup is shown again

### Unix/macOS one-command run
From the repository root:

```bash
chmod +x ./run.sh
./run.sh
```

Optional flags:
- `--skip-install` to skip `pip install`
- `--skip-ui-build` to skip UI build
- `--reload` to run uvicorn with auto-reload
- `--fresh-setup` to reset local `data/stowge.db` so first-run admin setup is shown again

### Cross-platform Docker dev
```bash
docker compose --env-file .env up -d --build
```
Then open: http://localhost:18090/

The local run scripts automatically:
- create `.env` from `.env.example` if missing
- generate `JWT_SECRET` if it is missing, placeholder, or too short
- create `backend/.venv` if missing
- install backend dependencies
- install/build UI from `ui-src` to `ui`
- start FastAPI on `http://localhost:18090`

## Notes
- Uses a local SQL database (SQLite) stored in the mounted `data` path.
- Images are stored under the host-mounted `/mnt/data/docker/stowge/assets` volume.
