"""Generate code-driven external API docs from FastAPI OpenAPI schema.

Writes:
- docs/api/openapi.json
- docs/api/endpoints.md
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _method_order(method: str) -> int:
    order = {"get": 1, "post": 2, "put": 3, "patch": 4, "delete": 5, "options": 6, "head": 7}
    return order.get(method.lower(), 99)


def _format_tags(operation: dict) -> str:
    tags = operation.get("tags") or []
    if not tags:
        return ""
    return ", ".join(str(tag) for tag in tags)


def _render_endpoints_markdown(openapi: dict) -> str:
    title = str((openapi.get("info") or {}).get("title") or "Stowge API")
    version = str((openapi.get("info") or {}).get("version") or "unknown")
    paths = openapi.get("paths") or {}

    lines: list[str] = []
    lines.append(f"# {title} Endpoints")
    lines.append("")
    lines.append(f"Version: {version}")
    lines.append("")
    lines.append("Generated from FastAPI OpenAPI schema.")
    lines.append("")
    lines.append("| Method | Path | Tags | Summary |")
    lines.append("|---|---|---|---|")

    rows: list[tuple[str, str, str, str]] = []
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, operation in methods.items():
            if method.lower() not in {"get", "post", "put", "patch", "delete", "options", "head"}:
                continue
            op = operation if isinstance(operation, dict) else {}
            tags = _format_tags(op)
            summary = str(op.get("summary") or "")
            rows.append((method.upper(), str(path), tags, summary))

    rows.sort(key=lambda item: (item[1], _method_order(item[0].lower())))

    for method, path, tags, summary in rows:
        safe_summary = summary.replace("|", "\\|")
        safe_tags = tags.replace("|", "\\|")
        lines.append(f"| {method} | {path} | {safe_tags} | {safe_summary} |")

    lines.append("")
    return "\n".join(lines)


def main() -> int:
    repo_root = _repo_root()
    api_path = repo_root / "api"
    docs_api_path = repo_root / "docs" / "api"
    docs_api_path.mkdir(parents=True, exist_ok=True)

    sys.path.insert(0, str(api_path))
    from stowge.external_api import external_api_app  # noqa: WPS433

    openapi = external_api_app.openapi()

    openapi_path = docs_api_path / "openapi.json"
    openapi_path.write_text(json.dumps(openapi, indent=2), encoding="utf-8")

    endpoints_markdown = _render_endpoints_markdown(openapi)
    endpoints_path = docs_api_path / "endpoints.md"
    endpoints_path.write_text(endpoints_markdown, encoding="utf-8")

    print(f"Wrote {openapi_path}")
    print(f"Wrote {endpoints_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
