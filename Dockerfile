FROM node:24-alpine AS ui_builder

WORKDIR /ui

# Install front-end dependencies first for better layer caching.
COPY ui/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Build React app to a local dist directory inside this stage.
COPY ui/ ./
RUN npx tsc && npx vite build --outDir dist

FROM python:3.12-slim

# Build argument for application version (set by CI/CD, defaults to 0.1.0 for local builds)
ARG APP_VERSION=0.1.0

# Prevent Python buffering + speed up installs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

# System deps (Pillow, bcrypt, curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  libjpeg-dev \
  zlib1g-dev \
  curl \
  && rm -rf /var/lib/apt/lists/*

# Python deps first (layer caching)
COPY api/requirements.txt /app/requirements.txt
COPY api/constraints.txt /app/constraints.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# App code
COPY api/stowge /app/stowge

# License notices included in the runtime image.
COPY LICENSE /licenses/LICENSE
COPY THIRD_PARTY_LICENSES.md /licenses/THIRD_PARTY_LICENSES.md

# Install the stowge CLI wrapper so it is available as `stowge` in the container shell.
RUN printf '#!/bin/sh\ncd /app && exec python -m stowge.cli "$@"\n' > /usr/local/bin/stowge \
    && chmod +x /usr/local/bin/stowge

# Front-end static files from the React build stage.
COPY --from=ui_builder /ui/dist /app/ui

# Default paths
ENV ASSETS_DIR=/assets
ENV UI_DIR=/app/ui

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/healthz || exit 1

CMD ["sh", "-c", "if [ \"$LOG_HTTP\" = 'true' ]; then exec uvicorn stowge.main:app --host 0.0.0.0 --port 8000 --access-log; else exec uvicorn stowge.main:app --host 0.0.0.0 --port 8000 --no-access-log; fi"]
