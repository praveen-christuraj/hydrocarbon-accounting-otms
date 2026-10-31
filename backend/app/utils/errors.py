"""Client-safe error messages.

Internal exception text (database drivers, PostgreSQL CLI stderr, file paths)
must never reach the browser. Log the full detail server-side; return a short,
actionable message plus the request id from the response header.
"""

from __future__ import annotations

import logging

from fastapi import HTTPException

logger = logging.getLogger("app.errors")

def safe_client_error(context: str) -> str:
    return f"{context} failed. Check the server log with the request id shown in the response header."


def stored_error_message(context: str, exc: Exception) -> str:
    """Short, non-sensitive text safe to persist in the database."""
    if isinstance(exc, HTTPException):
        return str(exc.detail)[:500]
    # Exception text from drivers and PostgreSQL CLI tools can embed hosts,
    # users, SQL and file paths. Persist only the type; the full traceback is
    # written to the server log by the caller.
    return f"{context} failed ({type(exc).__name__}). Full detail is in the server log."


def log_exception(context: str, exc: Exception, *, request_id: str | None = None) -> None:
    logger.exception(
        "%s failed: %s",
        context,
        type(exc).__name__,
        extra={"request_id": request_id or "-"},
    )
