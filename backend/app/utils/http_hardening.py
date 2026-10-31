"""ASGI middleware that is independent of FastAPI's request handling order."""

from __future__ import annotations

import json
import re
import uuid

from fastapi import HTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.config import (
    ENFORCE_HTTPS,
    IS_PRODUCTION,
    MAX_REQUEST_BODY_BYTES,
    TRUST_PROXY_HEADERS,
)


# Correlation ids are echoed back only in this shape (no spaces, quotes or
# control characters that could forge a log line).
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._-]{8,64}")


class RequestBodyLimitMiddleware:
    """Reject oversized request bodies before they are buffered in memory.

    Covers the common ``Content-Length`` case and enforces the same ceiling on
    chunked uploads by counting received bytes.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_REQUEST_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                await self._send_error(send, 400, "Invalid Content-Length header")
                return
            if declared > self.max_bytes:
                await self._send_error(send, 413, "Request body is too large")
                return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b"") or b"")
                if received > self.max_bytes:
                    # Raised while the route reads the body, so FastAPI's own
                    # HTTPException handler turns it into a clean 413 JSON
                    # response. Nothing past the ceiling is ever buffered.
                    raise HTTPException(
                        status_code=413,
                        detail="Request body is too large",
                    )
            return message

        await self.app(scope, limited_receive, send)

    @staticmethod
    async def _send_error(send: Send, status: int, detail: str) -> None:
        body = json.dumps({"detail": detail}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


class RequestContextMiddleware:
    """Attach a request id and enforce HTTPS when the deployment requires it."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        scope.setdefault("state", {})
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        # Echo a caller-supplied correlation id when it is well formed, so
        # reverse proxies and IT ticketing systems can trace one request end
        # to end. Anything else is replaced with a fresh UUID to prevent log
        # injection through the header.
        incoming = headers.get(b"x-request-id", b"").decode("latin-1").strip()
        request_id = incoming if _REQUEST_ID_RE.fullmatch(incoming) else str(uuid.uuid4())
        scope["state"]["request_id"] = request_id

        if ENFORCE_HTTPS:
            scheme = scope.get("scheme", "http")
            forwarded_scheme = None
            if TRUST_PROXY_HEADERS:
                forwarded_scheme = headers.get(b"x-forwarded-proto", b"").decode("latin-1").split(",")[0].strip()
            effective_scheme = forwarded_scheme or scheme
            if effective_scheme != "https":
                host = headers.get(b"host", b"").decode("latin-1")
                if host:
                    location = f"https://{host}{scope.get('raw_path', b'/').decode('latin-1')}"
                    await send(
                        {
                            "type": "http.response.start",
                            "status": 308,
                            "headers": [(b"location", location.encode("latin-1"))],
                        }
                    )
                    await send({"type": "http.response.body", "body": b""})
                    return

        async def send_with_request_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode("ascii")))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_request_id)


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
        "object-src 'none'; media-src 'none'; frame-src 'none'; worker-src 'self'; "
        "manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    ),
}

if IS_PRODUCTION:
    SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
