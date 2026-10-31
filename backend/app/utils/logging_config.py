"""Application logging with secret redaction.

Never log credentials, tokens, cookies, 2FA secrets or database URLs. The
filter below is a safety net for accidental inclusion; call sites should still
log identifiers, not secrets.
"""

from __future__ import annotations

import logging
import re
import sys

REDACTED = "***REDACTED***"

# (compiled pattern, replacement) pairs applied in order.
_REDACTIONS: list[tuple[re.Pattern[str], str]] = [
    # key=value / "key": "value" for common secret names. Only the value is
    # replaced so operators keep the surrounding diagnostic context.
    (
        re.compile(
            r"(?i)\b(password|passwd|pwd|secret|refresh_token|access_token|authorization|"
            r"api[_-]?key|client_secret|totp_secret|otp|backup_code|private[_-]?key)"
            r"(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&}\]]+)"
        ),
        r"\1\2" + REDACTED,
    ),
    (re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"), "Bearer " + REDACTED),
    (
        re.compile(r"(?i)(postgres(?:ql)?(?:\+\w+)?://[^:\s]+:)([^@\s]+)(@)"),
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
    # Uvicorn installs its own handlers; make sure records they emit still get
    # the redaction formatter by clearing propagated duplicate handlers.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(name)
        logger.handlers = []
        logger.propagate = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
