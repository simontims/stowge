# Stowge

*Pronounced /ˈstoʊɪdʒ/ — rhymes with "stowage"*

Easy inventory with a brilliant user experience and AI-assist

- Self-hosted with Docker
- No cloud dependencies
- Mobile and desktop friendly
- Add items quickly, photo first from mobile with AI assist, or add items slowly and old-skool, you do you

Unlimited custom collections
- Electronic parts (the original inspiration)
- Arts and Craft bits
- Big household items for insurance listings
- LEGO Minifigs
- RC car spare parts
- Artisan keyboard keycaps
- Random cables (mystery box of 'probably important someday')

Unlimited custom locations
- Garge 
- Garage
- Shed
- Loft
- Box 7 under the spare bed


## Quick Start (Docker host)
### 1) Create persistent folders
You'll need a location for the database and another to save the asset files (only photos right now).
They might be in the same place, or you might use a local M.2 drive for the database and a remote NAS path for the images.

### 2) Copy the compose file and edit for your use
https://github.com/simontims/stowge/blob/main/docker-compose.prod.yml

The compose file uses the `simontims/stowge` image. Two tags are available:
- `:latest` — latest stable release (recommended)
- `:edge` — latest commit on `main`, built automatically on every push

Set `IMAGE_URL_SECRET` in the compose file to a strong random secret.
The other settings should be self-explanatory.

### 3) First login
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
.\scripts\run.ps1
```

Or with CMD:

```bat
scripts\run.cmd
```

Optional flags:
- `-SkipInstall` to skip `pip install`
- `-SkipUiBuild` to skip UI build
- `-Reload` to run uvicorn with auto-reload
- `-FreshSetup` to reset local `data/stowge.db` so first-run admin setup is shown again

### Unix/macOS one-command run
From the repository root:

```bash
chmod +x ./scripts/run.sh
./scripts/run.sh
```

Optional flags:
- `--skip-install` to skip `pip install`
- `--skip-ui-build` to skip UI build
- `--reload` to run uvicorn with auto-reload
- `--fresh-setup` to reset local `data/stowge.db` so first-run admin setup is shown again

### Frontend hot-reload dev
Run the api and frontend separately for hot-reload:

```bash
# Terminal 1 — api
./scripts/run.sh --skip-ui-build

# Terminal 2 — frontend (proxies /api to :18090)
cd ui && npm run dev
```

Then open: http://localhost:5173/

### Cross-platform Docker dev
```bash
docker compose up -d --build
```
Then open: http://localhost:18090/

The local run scripts automatically:
- create a default `.env` if missing
- generate `JWT_SECRET` if it is missing, placeholder, or too short
- create `api/.venv` if missing
- install api dependencies
- install/build UI from `ui/` to `ui/dist`
- start FastAPI on `http://localhost:18090`