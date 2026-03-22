#!/usr/bin/env bash
set -euo pipefail

SKIP_INSTALL=0
SKIP_UI_BUILD=0
RELOAD=0
FRESH_SETUP=0

for arg in "$@"; do
  case "$arg" in
    --skip-install)
      SKIP_INSTALL=1
      ;;
    --skip-ui-build)
      SKIP_UI_BUILD=1
      ;;
    --reload)
      RELOAD=1
      ;;
    --fresh-setup)
      FRESH_SETUP=1
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./run.sh [options]

Options:
  --skip-install   Skip Python dependency installation
  --skip-ui-build  Skip UI build step
  --reload         Run uvicorn with auto-reload
  --fresh-setup    Remove local data/stowge.db before start
  -h, --help       Show this help
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run ./run.sh --help for usage." >&2
      exit 1
      ;;
  esac
done

step() {
  echo
  echo "==> $1"
}

require_cmd() {
  local name="$1"
  local hint="$2"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Required command '$name' is not available. $hint" >&2
    exit 1
  fi
}

new_random_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
    return
  fi

  python3 - <<'PY'
import base64
import os
s = base64.b64encode(os.urandom(48)).decode('ascii')
print(s.replace('+', '-').replace('/', '_').rstrip('='))
PY
}

upsert_env_value() {
  local path="$1"
  local key="$2"
  local value="$3"

  if [[ ! -f "$path" ]]; then
    printf "%s=%s\n" "$key" "$value" >"$path"
    return
  fi

  if grep -qE "^${key}=" "$path"; then
    sed -i.bak -E "s|^${key}=.*$|${key}=${value}|" "$path"
    rm -f "$path.bak"
  else
    printf "\n%s=%s\n" "$key" "$value" >>"$path"
  fi
}

get_db_user_count() {
  local python_exe="$1"
  local db_path="$2"

  if [[ ! -f "$db_path" ]]; then
    echo 0
    return
  fi

  "$python_exe" - "$db_path" <<'PY'
import sqlite3
import sys

db_path = sys.argv[1]
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
if cur.fetchone() is None:
    print(0)
else:
    cur.execute("SELECT COUNT(*) FROM users")
    print(cur.fetchone()[0])
conn.close()
PY
}

invoke_pip_filtered() {
  local python_exe="$1"
  shift

  set +e
  local output
  output=$("$python_exe" -m pip "$@" 2>&1)
  local exit_code=$?
  set -e

  while IFS= read -r line; do
    if [[ "$line" == Requirement\ already\ satisfied:* ]]; then
      continue
    fi
    echo "$line"
  done <<<"$output"

  if [[ $exit_code -ne 0 ]]; then
    echo "pip command failed with exit code $exit_code" >&2
    exit $exit_code
  fi
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend_dir="$repo_root/backend"
venv_dir="$backend_dir/.venv"
python_exe="$venv_dir/bin/python"
requirements_file="$backend_dir/requirements.txt"
ui_src_dir="$repo_root/ui-src"
ui_out_dir="$repo_root/ui"
assets_dir="$repo_root/assets"
data_dir="$repo_root/data"
db_file="$data_dir/stowge.db"
env_file="$repo_root/.env"
env_example="$repo_root/.env.example"

step "Preparing environment"
if [[ ! -f "$env_file" ]]; then
  if [[ ! -f "$env_example" ]]; then
    echo "Missing .env and .env.example in repository root." >&2
    exit 1
  fi
  cp "$env_example" "$env_file"
  echo "Created .env from .env.example"
fi

jwt_value=""
if grep -qE '^JWT_SECRET=' "$env_file"; then
  jwt_value="$(grep -E '^JWT_SECRET=' "$env_file" | tail -n1 | cut -d'=' -f2-)"
fi

if [[ -z "$jwt_value" || "$jwt_value" == "change_me" || "$jwt_value" == "change_me_to_a_long_random_string" || ${#jwt_value} -lt 32 ]]; then
  step "Generating JWT secret in .env"
  upsert_env_value "$env_file" "JWT_SECRET" "$(new_random_secret)"
fi

step "Loading .env values"
set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

step "Checking required tools"
require_cmd npm "Install Node.js (includes npm) from https://nodejs.org/"
if ! command -v python3 >/dev/null 2>&1 && ! command -v python >/dev/null 2>&1; then
  echo "Python is required. Install Python 3.12+ and ensure 'python3' or 'python' is on PATH." >&2
  exit 1
fi

if [[ ! -d "$venv_dir" ]]; then
  step "Creating backend virtual environment"
  if command -v python3 >/dev/null 2>&1; then
    python3 -m venv "$venv_dir"
  else
    python -m venv "$venv_dir"
  fi
fi

if [[ ! -x "$python_exe" ]]; then
  echo "Python executable not found in venv: $python_exe" >&2
  exit 1
fi

if [[ $SKIP_INSTALL -eq 0 ]]; then
  step "Installing backend dependencies"
  invoke_pip_filtered "$python_exe" install --upgrade pip
  invoke_pip_filtered "$python_exe" install -r "$requirements_file"
fi

if [[ $SKIP_UI_BUILD -eq 0 ]]; then
  step "Installing UI dependencies (if needed)"
  pushd "$ui_src_dir" >/dev/null
  if [[ ! -d "$ui_src_dir/node_modules" ]]; then
    if [[ -f "$ui_src_dir/package-lock.json" ]]; then
      npm ci
    else
      npm install
    fi
  fi

  step "Building UI"
  npm run build
  popd >/dev/null
fi

step "Preparing local data folders"
mkdir -p "$assets_dir" "$data_dir"

if [[ $FRESH_SETUP -eq 1 && -f "$db_file" ]]; then
  step "Fresh setup requested: removing local database"
  rm -f "$db_file"
fi

export UI_DIR="$ui_out_dir"
export ASSETS_DIR="$assets_dir"
if [[ -z "${DATABASE_URL:-}" ]]; then
  export DATABASE_URL="sqlite:///$db_file"
fi
if [[ -z "${JWT_ISSUER:-}" ]]; then
  export JWT_ISSUER="stowge"
fi

existing_users="$(get_db_user_count "$python_exe" "$db_file")"
if [[ "$existing_users" =~ ^[0-9]+$ ]] && [[ "$existing_users" -gt 0 ]]; then
  echo "Found $existing_users existing user(s) in local DB. Login mode will be shown."
  echo "Use --fresh-setup to reset only the local SQLite DB and show first-run admin setup again."
else
  echo "No users found in local DB. First-run admin setup will be shown."
fi

step "Starting Stowge at http://localhost:18090"
pushd "$backend_dir" >/dev/null

uvicorn_args=("-m" "uvicorn" "stowge.main:app" "--host" "0.0.0.0" "--port" "18090")
if [[ $RELOAD -eq 1 ]]; then
  uvicorn_args+=("--reload")
fi

"$python_exe" "${uvicorn_args[@]}"
popd >/dev/null
