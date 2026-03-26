# Stowge

Easy inventory with a brilliant user experience and AI-assist

- Self-hosted with Docker
- No cloud dependencies
- Mobile and desktop friendly
- Add items quickly, photo first from mobile with AI assist
- Add items slowly and old-skool, you do you

Custom Collections
- Electronic parts (the original inspiration)
- Arts and Craft bits
- Big household items for insurance listings
- LEGO Minifigs
- RC car spare parts
- Artisan keyboard keycaps
- Random cables (mystery box of 'probably important someday')

Custom Locations
- Garge 
- Garage
- Shed
- Loft
- Box 7 under the spare bed


Tech

- UI (PWA) served at `/`
- API served under `/api`
- OpenAPI spec: `/openapi.json`
- Swagger UI: `/docs`

## Deploy (Docker host)
### 1) Create persistent folders
```bash
mkdir -p /local/path/to/stowage/{data,assets}
```

### 2) Create `.env`
Copy `.env.example` to `.env` and fill in values.

### 3) Start
```bash
docker compose up -d
```
### 4) First login
Visit the UI; on first run you'll be asked to create an admin user and password.

### 5) Configure AI models in app (optional)
Go to `System > AI` and add one or more LLM providers/models,
set API keys, and choose a default model for `Add`.

### 6) Add Collections and Locations (optional)
Visit the Collections and Locations area and experiment

### 7) Start adding items!

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
