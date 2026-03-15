FROM node:20-alpine AS ui_builder

WORKDIR /ui-src

# Install front-end dependencies first for better layer caching.
COPY ui-src/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Build React app to a local dist directory inside this stage.
COPY ui-src/ ./
RUN npx tsc && npx vite build --outDir dist

FROM python:3.12-slim

# Prevent Python buffering + speed up installs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (Pillow, bcrypt)
RUN apt-get update && apt-get install -y \
    build-essential \
    libjpeg-dev \
    zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps first (layer caching)
COPY backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# App code
COPY backend/stowge /app/stowge

# Front-end static files from the React build stage.
COPY --from=ui_builder /ui-src/dist /app/ui

# Default paths
ENV ASSETS_DIR=/assets
ENV UI_DIR=/app/ui

EXPOSE 8000

CMD ["uvicorn", "stowge.main:app", "--host", "0.0.0.0", "--port", "8000"]