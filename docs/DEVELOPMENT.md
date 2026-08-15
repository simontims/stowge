# Development

This guide covers local Stowge development on Windows, Linux, and macOS. For the system design, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## Prerequisites

Local development requires:

- Python 3
- Node.js and npm
- Git

Docker is optional and is only required for the container-based workflow.

## Windows

From the repository root, run:

```powershell
.\scripts\run.ps1
```

Or with Command Prompt:

```bat
scripts\run.cmd
```

PowerShell options:

- `-SkipInstall` skips Python dependency installation.
- `-SkipUiBuild` skips the UI build.
- `-Reload` runs Uvicorn with automatic reload.
- `-FreshSetup` removes the local `data/stowge.db` so first-run admin setup is shown again.

## Linux and macOS

From the repository root, run:

```bash
chmod +x ./scripts/run.sh
./scripts/run.sh
```

Options:

- `--skip-install` skips Python dependency installation.
- `--skip-ui-build` skips the UI build.
- `--reload` runs Uvicorn with automatic reload.
- `--fresh-setup` removes the local `data/stowge.db` so first-run admin setup is shown again.

## What the launchers do

The local launch scripts:

- create a default `.env` if one is missing
- generate the required local secret if it is missing, a placeholder, or too short
- create `api/.venv` if it is missing
- install API dependencies
- install and build the UI from `ui/` to `ui/dist/`
- start FastAPI at <http://localhost:18090>

## Frontend hot reload

Run the API and frontend separately when working on the UI:

```bash
# Terminal 1: API
./scripts/run.sh --skip-ui-build

# Terminal 2: frontend, with /api proxied to port 18090
cd ui
npm run dev
```

On Windows, use `.\scripts\run.ps1 -SkipUiBuild` in the first terminal. Open <http://localhost:5173/> for the Vite development server.

## Docker development

To build and run the current checkout in Docker:

```bash
docker compose up -d --build
```

Open <http://localhost:18090/>.

## Validation

Run API tests and linting from the repository root:

```bash
cd api
python -m pytest tests
ruff check --config ruff.toml
```

Run UI checks from `ui/`:

```bash
npm run lint
npm run build
npm run test
```

## Generated API documentation

The external API schema is generated from code. Regenerate review and CI artifacts after changing that API:

```powershell
C:/dev/stowge/api/.venv/Scripts/python.exe scripts/generate_api_docs.py
```

Or with Python on `PATH`:

```bash
python scripts/generate_api_docs.py
```

The command updates:

- `docs/api/openapi.json`
- `docs/api/endpoints.md`

Pull request CI verifies that these files are current.

## UI conventions

Follow [ui/UI_CONVENTIONS.md](../ui/UI_CONVENTIONS.md) when changing frontend actions, colors, or button styles.