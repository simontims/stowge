# Deployment

This guide covers running and maintaining Stowge with Docker Compose. The repository's [docker-compose.prod.yml](../docker-compose.prod.yml) is the reference configuration.

## Image tags

The `simontims/stowge` image is published for `linux/amd64` and `linux/arm64`:

- `latest` is the latest stable release and is recommended for most installations.
- `edge` follows the latest commit on `main`.
- Semantic version tags such as `1`, `1.2`, and `1.2.3` are published for releases.

Pin a full version tag when upgrades must be explicitly controlled.

## Persistent storage

Stowge needs two persistent paths:

- `/data` contains the SQLite database.
- `/assets` contains item images and backup archives.

Update both host paths in the compose file before starting the container. The paths may use different storage devices, including network storage for assets.

## Configuration

The production compose file documents the supported core settings:

- `DATABASE_DIR` sets the database directory and defaults to `/data` in the container.
- `ASSETS_DIR` sets the image and backup directory and defaults to `/assets`.
- `IMAGE_URL_SECRET` signs image URLs and must be replaced with a strong random secret.
- `SESSION_LIFETIME_MINUTES` controls session duration and defaults to 1440 minutes.
- `SESSION_COOKIE_SECURE` should be `true` when Stowge is served over HTTPS.
- `CORS_ORIGINS` accepts a comma-separated list when the UI is hosted on another origin.
- `LOG_HTTP=true` enables full HTTP access logs.

Do not commit deployment secrets to the repository.

## Start Stowge

From the directory containing the production compose file, run:

```bash
docker compose -f docker-compose.prod.yml up -d
```

The reference configuration publishes Stowge at <http://localhost:18090/> and includes a container health check.

## HTTPS and reverse proxies

For a network-accessible deployment, place Stowge behind a reverse proxy that terminates HTTPS and set `SESSION_COOKIE_SECURE` to `true`. Forward traffic to port `18090` on the Docker host, or to port `8000` when the proxy shares the container network.

## Upgrade

Pull the configured image tag and recreate the container:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Back up Stowge before upgrading, especially when moving between release versions.

When upgrading to the Site/Area/Location schema, Stowge automatically creates a `Home` Site and `General` Area, then assigns existing Locations to that Area. Existing Location IDs, names, and item assignments are preserved.

## Backup and restore

Use `System > Status > Maintenance` to create, inspect, download, validate, and restore backups. Archives are stored in `/assets/backups` with names in this format:

```text
stowge_YYYY-MM-DD_HH-MM-SS-ffffff.tar.gz
```

Each archive contains `manifest.json`, `db/stowge.db`, and optionally referenced files under `assets/`.

Restore overwrites the current database, deletes existing assets before replacement, and invalidates all active sessions when complete. Keep an independent copy of important backups outside the container's storage.

## Recover administrator access

Run the Stowge CLI in the Docker host, replacing `{container-name}` with your actual container name:

```bash
docker exec -it {container-name} stowge users list
docker exec -it {container-name} stowge reset-password --email admin@example.com
docker exec -it {container-name} stowge admin create --email admin@example.com
```

The password commands prompt for the new password and confirmation.