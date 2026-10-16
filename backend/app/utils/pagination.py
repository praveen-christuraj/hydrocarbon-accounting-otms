from typing import TypeVar, Generic, Optional
from pydantic import BaseModel

T = TypeVar("T")


class PaginationParams(BaseModel):
    skip: int = 0
    limit: int = 50
    search: Optional[str] = None


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    total: int
    skip: int
    limit: int
    has_more: bool


def paginate_query(query, skip: int = 0, limit: int = 50):
    total = query.count()
    items = query.offset(skip).limit(limit).all()
    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit,
        "has_more": (skip + limit) < total,
    }


# ---------------------------------------------------------------------------
# Bounded-loading defaults (performance)
# ---------------------------------------------------------------------------
# List/report endpoints must never stream an unbounded history to the
# browser. Plain list endpoints are capped with ``limit``; the transaction
# derived summaries additionally apply a default date window when the caller
# does not supply ``date_from`` -- only the most recent
# ``DEFAULT_REPORT_WINDOW_DAYS`` of data (relative to the newest matching
# record) is loaded up front, and older records are loaded by passing an
# explicit date range. This keeps first paint fast no matter how many years
# of history the database holds.

DEFAULT_LIST_LIMIT = 200
MAX_LIST_LIMIT = 1000

# Location list page sizes. ``SCOPED_PAGE_SIZE`` protects the Location Master
# grid; ``REFERENCE_PAGE_SIZE`` / ``MAX_LIST_LIMIT`` apply to the
# ``all_locations=true`` reference-data mode that fills the Origin /
# Destination / Sender / Receiver dropdowns of Operation Entry.
SCOPED_DEFAULT_PAGE_SIZE = 50
SCOPED_PAGE_SIZE = 200
REFERENCE_PAGE_SIZE = 200

DEFAULT_REPORT_WINDOW_DAYS = 90
DEFAULT_REPORT_PAGE_SIZE = 500
MAX_REPORT_PAGE_SIZE = 1000


def clamp_limit(value, default: int = DEFAULT_LIST_LIMIT, maximum: int = MAX_LIST_LIMIT) -> int:
    """Return ``value`` as an int clamped to ``[1, maximum]`` (default if unset/invalid)."""
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return min(max(parsed, 1), maximum)


def clamp_page(value) -> int:
    try:
        return max(int(value or 1), 1)
    except (TypeError, ValueError):
        return 1


def default_window_start(latest_date, days: int = DEFAULT_REPORT_WINDOW_DAYS):
    """First date of the default report window ending on ``latest_date``."""
    from datetime import timedelta

    if latest_date is None:
        return None
    return latest_date - timedelta(days=max(int(days), 1) - 1)
