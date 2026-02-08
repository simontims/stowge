FROM python:3.12-slim

# Prevent Python buffering + speed up installs
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# System deps (Pillow, bcrypt, psycopg)
RUN apt-get update && apt-get install -y \
    build-essential \
    libjpeg-dev \
    zlib1g-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Python deps first (layer caching)
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend /app/kete
COPY ui /app/ui

# Default paths
ENV ASSETS_DIR=/assets
ENV UI_DIR=/app/ui

EXPOSE 8000

CMD ["uvicorn", "kete.main:app", "--host", "0.0.0.0", "--port", "8000"]