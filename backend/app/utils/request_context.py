"""Request-context helpers: client identity, origin checks, and safe logging."""

from __future__ import annotations

import ipaddress
from urllib.parse import urlparse

from fastapi import HTTPException, Request

from app.config import (
    AUTH_COOKIE_NAME,
    ENVIRONMENT,
    TRUST_PROXY_HEADERS,
    TRUSTED_PROXY_IPS,
)

_UNKNOWN_IP = "unknown"


def _is_trusted_proxy(peer_ip: str | None) -> bool:
    if not TRUST_PROXY_HEADERS:
        return False
    if "*" in TRUSTED_PROXY_IPS:
        return True
    if not peer_ip:
        return False
    try:
        peer = ipaddress.ip_address(peer_ip)
    except ValueError:
        return False
    for entry in TRUSTED_PROXY_IPS:
        try:
            if "/" in entry:
                if peer in ipaddress.ip_network(entry, strict=False):
                    return True
            elif peer == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    """Return the caller IP, honouring X-Forwarded-For only for trusted proxies.

    Trusting X-Forwarded-For unconditionally lets any client forge the value and
    bypass IP throttling or poison the audit trail, so the header is ignored
    unless the immediate peer is explicitly listed in TRUSTED_PROXY_IPS.
    """
    peer_ip = request.client.host if request.client else None
    if _is_trusted_proxy(peer_ip):
        forwarded = request.headers.get("x-forwarded-for") or ""
        # The left-most entry is the original client, but only the chain added
        # by *our* proxy is trusted; take the last hop added before ours.
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if hops:
            return hops[0]
        real_ip = (request.headers.get("x-real-ip") or "").strip()
        if real_ip:
            return real_ip
    return peer_ip or _UNKNOWN_IP


def get_request_origin(request: Request) -> str | None:
    origin = (request.headers.get("origin") or "").strip()
    if origin:
        return origin.rstrip("/")
    referer = (request.headers.get("referer") or "").strip()
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    return None


def assert_trusted_cookie_origin(request: Request, allowed_origins) -> None:
    """Reject cross-site cookie-authenticated requests (CSRF defence in depth).

    Browsers always send ``Origin`` on cross-site POSTs. SameSite=Strict already
    blocks the common cases; this check also covers clients/proxies that ignore
    SameSite and prevents a browser from silently replaying a refresh cookie.

    Requests with no Origin/Referer header (curl, server-to-server, tests) are
    allowed because no browser session cookie is being replayed cross-site.
    """
    origin = get_request_origin(request)
    if origin is None:
        return
    normalized = {str(entry).rstrip("/") for entry in (allowed_origins or [])}
    if origin in normalized:
        return
    raise HTTPException(
        status_code=403,
        detail="Cross-origin request rejected for a cookie-authenticated endpoint.",
    )


def has_refresh_cookie(request: Request) -> bool:
    return bool(request.cookies.get(AUTH_COOKIE_NAME))


def request_user_agent(request: Request) -> str:
    agent = str(request.headers.get("user-agent") or "").strip()
    return agent[:400]


def is_production() -> bool:
    return ENVIRONMENT == "production"
