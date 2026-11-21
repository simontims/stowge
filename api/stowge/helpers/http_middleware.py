"""Pure-ASGI middleware for the app.

``BaseHTTPMiddleware`` (what ``@app.middleware("http")`` builds on) wraps every response in a
task and a memory stream, adding latency and buffering to each request including streamed ones
(CSV export, SSE). These classes touch only the response-start message instead.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self)",
}

# Vite emits content-hashed filenames under /assets, so a given URL never changes content.
HASHED_ASSET_PREFIX = "/assets/"
HASHED_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable"


class SecurityHeadersMiddleware:
    """Adds the security headers to every HTTP response and long-lived caching to /assets."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in _SECURITY_HEADERS.items():
                    headers[name] = value
                if (
                    path.startswith(HASHED_ASSET_PREFIX)
                    and message.get("status") in (200, 304)
                    and "cache-control" not in headers
                ):
                    headers["Cache-Control"] = HASHED_ASSET_CACHE_CONTROL
            await send(message)

        await self.app(scope, receive, send_wrapper)
