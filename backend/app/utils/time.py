"""UTC time helpers.

The application stores timestamps in PostgreSQL ``TIMESTAMP WITHOUT TIME ZONE``
columns. SQLAlchemy therefore returns **naive** datetimes on read, while a lot
of the original code wrote timezone-aware ``datetime.now(timezone.utc)`` values.
Comparing the two raises ``TypeError`` (this was the root cause of the broken
2FA login challenge check).

Every security-related write/compare must go through these helpers so the
whole module uses one representation: naive UTC.
"""

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Current UTC time as a naive datetime (matches the database columns)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_utc_naive(value: datetime | None) -> datetime | None:
    """Normalise a datetime to naive UTC.

    Naive values are *assumed* to already be UTC (that is how this application
    writes them). Aware values are converted first so the wall-clock value is
    correct regardless of the original offset.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def utc_iso(value: datetime | None) -> str | None:
    """ISO string for a stored timestamp, always marked as UTC."""
    normalised = to_utc_naive(value)
    if normalised is None:
        return None
    return normalised.replace(tzinfo=timezone.utc).isoformat()
