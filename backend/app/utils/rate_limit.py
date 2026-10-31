"""In-process sliding-window rate limiting for authentication endpoints.

The limiter is deliberately dependency-free: it protects a single API process
without Redis or extra infrastructure. Deployment guidance:

* Run one Uvicorn worker per container (the default Dockerfile command) so the
  counters are authoritative for that instance, or
* front the API with a reverse proxy / WAF that also applies the same limits,
  and set ``RATE_LIMIT_ENABLED=false`` only if that edge enforces them.

Counters are keyed by a salted hash, bounded, and pruned on every write, so an
attacker cannot grow process memory without bound.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections import deque

from fastapi import HTTPException

from app.config import RATE_LIMIT_ENABLED

_MAX_TRACKED_KEYS = 50_000
_lock = threading.Lock()
_buckets: dict[str, deque[float]] = {}
_FAILURE_COUNTERS: dict[str, int] = {}


def _now() -> float:
    return time.monotonic()


def _prune_bucket(bucket: deque[float], window_seconds: int) -> None:
    cutoff = _now() - window_seconds
    while bucket and bucket[0] <= cutoff:
        bucket.popleft()


def _prune_store() -> None:
    """Drop empty buckets and hard-cap the number of tracked keys."""
    if len(_buckets) <= _MAX_TRACKED_KEYS:
        return
    for key in [key for key, bucket in _buckets.items() if not bucket]:
        _buckets.pop(key, None)
    if len(_buckets) <= _MAX_TRACKED_KEYS:
        return
    # Evict the oldest keys deterministically rather than growing forever.
    for key in list(_buckets.keys())[: len(_buckets) - _MAX_TRACKED_KEYS]:
        _buckets.pop(key, None)


def reset_rate_limits() -> None:
    """Clear every bucket. Used by tests and by an administrator emergency stop."""
    with _lock:
        _buckets.clear()
        _FAILURE_COUNTERS.clear()


def _key(scope: str, identifier: str | None) -> str:
    digest = hashlib.sha256(f"{scope}:{identifier or 'unknown'}".encode("utf-8")).hexdigest()
    return f"{scope}:{digest[:32]}"


def _hit(key: str, window_seconds: int) -> int:
    """Record one event and return the number of events inside the window."""
    with _lock:
        bucket = _buckets.setdefault(key, deque())
        _prune_bucket(bucket, window_seconds)
        bucket.append(_now())
        _prune_store()
        return len(bucket)


def _count(key: str, window_seconds: int) -> int:
    with _lock:
        bucket = _buckets.get(key)
        if not bucket:
            return 0
        _prune_bucket(bucket, window_seconds)
        return len(bucket)


def _retry_after(key: str, window_seconds: int) -> int:
    with _lock:
        bucket = _buckets.get(key)
        if not bucket:
            return window_seconds
        return max(1, int(window_seconds - (_now() - bucket[0])) + 1)


def _raise_limited(detail: str, retry_after: int) -> None:
    raise HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(max(1, retry_after))},
    )


def enforce_rate_limit(
    *,
    scope: str,
    identifier: str | None,
    limit: int,
    window_seconds: int,
    detail: str = "Too many requests. Please try again later.",
    record: bool = True,
) -> None:
    """Raise HTTP 429 when ``identifier`` exceeded ``limit`` events in the window.

    ``record=False`` performs a read-only check (useful before a sensitive
    action that is allowed to fail without consuming budget).
    """
    if not RATE_LIMIT_ENABLED or limit <= 0:
        return
    key = _key(scope, identifier)
    count = _hit(key, window_seconds) if record else _count(key, window_seconds)
    if count > limit:
        _raise_limited(detail, _retry_after(key, window_seconds))


def record_failure(*, scope: str, identifier: str | None, limit: int, window_seconds: int, detail: str = "Too many failed attempts. Please try again later.") -> None:
    """Record a failed attempt and raise when the failure budget is exhausted."""
    enforce_rate_limit(
        scope=scope,
        identifier=identifier,
        limit=limit,
        window_seconds=window_seconds,
        detail=detail,
        record=True,
    )


def clear_failures(*, scope: str, identifier: str | None) -> None:
    with _lock:
        _buckets.pop(_key(scope, identifier), None)


def count_events(*, scope: str, identifier: str | None, window_seconds: int) -> int:
    return _count(_key(scope, identifier), window_seconds)
