"""
Health endpoint tests.

/healthz  — liveness:  always 200, no deps
/readyz   — readiness: 200 when DB is reachable, 503 otherwise
/health   — diagnostics: always 200, structured payload
"""
from fastapi.testclient import TestClient
from stowge.main import app

client = TestClient(app)


# ---------------------------------------------------------------------------
# /healthz
# ---------------------------------------------------------------------------

def test_healthz_always_succeeds():
    """Liveness endpoint must return 200 regardless of dependencies."""
    response = client.get("/healthz")
    assert response.status_code == 200


def test_healthz_returns_status_ok():
    response = client.get("/healthz")
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# /readyz
# ---------------------------------------------------------------------------

def test_readyz_ok_when_db_reachable():
    """Readiness endpoint returns 200 when the database is accessible."""
    response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

def test_health_always_returns_200():
    """Diagnostic endpoint must never return a 5xx status."""
    response = client.get("/health")
    assert response.status_code == 200


def test_health_has_required_fields():
    response = client.get("/health")
    data = response.json()
    assert "status" in data
    assert "version" in data
    assert "database" in data


def test_health_status_values_are_valid():
    response = client.get("/health")
    data = response.json()
    assert data["status"] in ("ok", "degraded")
    assert data["database"] in ("ok", "unavailable")


def test_health_database_ok_when_db_reachable():
    response = client.get("/health")
    data = response.json()
    assert data["database"] == "ok"
    assert data["status"] == "ok"


def test_health_version_is_string():
    response = client.get("/health")
    assert isinstance(response.json()["version"], str)
