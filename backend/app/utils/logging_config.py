"""Application logging with a safety net for accidental secret disclosure.

Call sites should log identifiers and approved metadata, never credentials or
raw exception text. Redaction runs on the fully formatted record so it also
covers exception output.
"""

from __future__ import annotations

import logging
import os
import re
import sys

REDACTED = "***REDACTED***"

_COOKIE_NAME = re.escape(os.getenv("AUTH_COOKIE_NAME", "hydrocarbon_refresh").strip() or "hydrocarbon_refresh")
_SECRET_KEYS = (
    r"password|passwd|pwd|secret|token|refresh[_-]?token|access[_-]?token|auth[_-]?token|"
    r"authorization|api[_-]?key|client[_-]?secret|totp[_-]?secret|otp|backup[_-]?code|"
    r"private[_-]?key|INITIAL_ADMIN_PASSWORD|SECURITY_KDF_SALT|JWT_SECRET_KEY|"
    rf"ENCRYPTION_KEY|PGPASSWORD|DATABASE_URL|HYDROCARBON_REFRESH|{_COOKIE_NAME}"
)
_QUOTED_VALUE = r'\"[^\"]*\"|\'[^\']*\'|[^\s,;&}\]]+'

# Optional JSON/shell quotes around key names, including uppercase env names.
_KEY_VALUE = re.compile(
    rf"(?i)(?<![A-Za-z0-9])([\"']?(?:{_SECRET_KEYS})(?:[_-][A-Za-z0-9]+)*[\"']?)(\s*[=:]\s*)({_QUOTED_VALUE})"
)
_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    (_KEY_VALUE, r"\1\2" + REDACTED),
    # Cookie headers may use an operator-configured cookie name. Mask each
    # cookie value without disturbing attributes such as Path/SameSite.
    (re.compile(r"(?i)(set-cookie:\s*[^=;\s,]+=)[^;\s,]+"), r"\1" + REDACTED),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"), "Bearer " + REDACTED),
    (
        re.compile(r"(?i)(postgres(?:ql)?(?:\+\w+)?://[^:\s]+:)([^@\s]+)(@)"),
        r"\1" + REDACTED + r"\3",
    ),
    (
        re.compile(r"(?i)([A-Za-z][A-Za-z0-9+.-]*://[^:\s/@]+:)([^@\s]+)(@)"),
        r"\1" + REDACTED + r"\3",
    ),
    (
        re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b"),
        REDACTED,
    ),
]


def redact(value: str) -> str:
    text = str(value or "")
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # noqa: A003 - stdlib signature
        return redact(super().format(record))


class RequestIdLogFilter(logging.Filter):
    """Add request_id to every record, defaulting to '-' outside a request."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "-"
        return True


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    if any(getattr(handler, "_hydrocarbon_security", False) for handler in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler._hydrocarbon_security = True  # type: ignore[attr-defined]
    handler.addFilter(RequestIdLogFilter())
    handler.setFormatter(
        RedactingFormatter(
            "%(asctime)s %(levelname)s %(name)s [%(request_id)s] %(message)s",
            defaults={"request_id": "-"},
        )
    )
    root.handlers = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
