"""Session revocation and per-session family (``sid``) helpers.

Two revocation layers work together:
1. Per-session family tracking in ``auth_sessions`` (``UserSession``): every
   interactive login, 2FA verification, or password change mints a fresh
   ``sid`` claim carried by both the access and refresh JWTs and preserved
   across ``/auth/refresh`` rotations. Logging out revokes that ``UserSession``
   row immediately so ANY token ever minted or rotated within that session
   family becomes invalid on both ``/auth/refresh`` and protected API routes,
   without disturbing independent sessions on other devices.
2. Account-wide ``session_epoch`` + ``session_revoked_at`` on ``User``:
   incremented whenever ALL sessions of an account must end (password change,
   administrative password reset, administrative session revoke, ``/auth/logout-all``,
   refresh-token reuse detection, or logout of a legacy ``sid``-less token).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session, object_session

from app.config import REFRESH_TOKEN_EXPIRE_DAYS
from app.models import User, UserSession


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _as_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def current_session_epoch(user: User) -> int:
    return int(getattr(user, "session_epoch", 0) or 0)


def session_token_data(user: User, *, session_id: str | None = None) -> dict:
    """Standard JWT identity claims for access and refresh tokens."""
    claims = {
        "user_id": user.id,
        "username": user.username,
        "session_epoch": current_session_epoch(user),
    }
    if session_id:
        claims["sid"] = str(session_id)
    return claims


def create_user_session(
    db: Session,
    user: User,
    *,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> UserSession:
    """Create and persist an active server-side session family for ``user``."""
    now = utc_now_naive()
    session_row = UserSession(
        session_id=secrets.token_urlsafe(32),
        user_id=user.id,
        status="Active",
        ip_address=(ip_address or "")[:80] or None,
        user_agent=(user_agent or "")[:500] or None,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session_row)
    db.flush()
    return session_row


def touch_user_session(db: Session, session_id: str | None) -> UserSession | None:
    """Extend ``last_seen_at`` / ``expires_at`` on refresh rotation."""
    if not session_id:
        return None
    session_row = (
        db.query(UserSession)
        .filter(UserSession.session_id == str(session_id))
        .first()
    )
    if not session_row:
        return None
    now = utc_now_naive()
    session_row.last_seen_at = now
    session_row.expires_at = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    return session_row


def is_session_active(
    db: Session,
    session_id: str | None,
    *,
    user_id: int | None = None,
) -> bool:
    """Return True iff ``session_id`` refers to a live, unrevoked session."""
    if not session_id:
        return False
    session_row = (
        db.query(UserSession)
        .filter(UserSession.session_id == str(session_id))
        .first()
    )
    if not session_row:
        return False
    if user_id is not None and int(session_row.user_id) != int(user_id):
        return False
    if session_row.status != "Active" or session_row.revoked_at is not None:
        return False
    expires_at = _as_naive_utc(session_row.expires_at)
    if expires_at is None or expires_at < utc_now_naive():
        return False
    return True


def revoke_session_family(
    db: Session,
    session_id: str | None,
    *,
    reason: str = "Logout",
) -> bool:
    """Revoke every token belonging to ``session_id`` (including prior rotations)."""
    if not session_id:
        return False
    session_row = (
        db.query(UserSession)
        .filter(UserSession.session_id == str(session_id))
        .first()
    )
    if not session_row:
        return False
    if session_row.status != "Revoked" or session_row.revoked_at is None:
        session_row.status = "Revoked"
        session_row.revoked_at = utc_now_naive()
        session_row.revoke_reason = (reason or "Logout")[:120]
    return True


def revoke_user_sessions(
    user: User,
    when: datetime | None = None,
    *,
    db: Session | None = None,
    reason: str = "All Sessions Revoked",
) -> int:
    """Invalidate every token issued for ``user`` so far.

    Advances ``session_epoch`` and revokes every active ``UserSession`` row for
    ``user``. Returns the new epoch; the caller is responsible for committing.
    """
    now = when or utc_now_naive()
    user.session_revoked_at = now
    user.session_epoch = current_session_epoch(user) + 1
    session = db or object_session(user)
    if session is not None and getattr(user, "id", None) is not None:
        active_rows = (
            session.query(UserSession)
            .filter(
                UserSession.user_id == user.id,
                UserSession.status == "Active",
            )
            .all()
        )
        for row in active_rows:
            row.status = "Revoked"
            row.revoked_at = now
            row.revoke_reason = (reason or "All Sessions Revoked")[:120]
    return user.session_epoch


def token_predates_session_epoch(payload: dict, user: User) -> bool:
    """Return True if the JWT payload was minted before the latest revocation."""
    user_epoch = current_session_epoch(user)
    token_epoch = payload.get("session_epoch")
    if token_epoch is not None:
        try:
            return int(token_epoch) < user_epoch
        except (TypeError, ValueError):
            return True

    if user_epoch > 0:
        # Tokens minted before session_epoch existed carry no claim; once the
        # account has been revoked at least once they are no longer valid.
        return True

    revoked_at = _as_naive_utc(getattr(user, "session_revoked_at", None))
    if revoked_at is None:
        return False

    iat = payload.get("iat")
    if iat is None:
        return True
    try:
        issued_at = datetime.fromtimestamp(float(iat), tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError, OSError):
        return True

    # ``iat`` has whole-second resolution; allow a small negative skew ONLY for
    # legacy tokens without ``session_epoch``.
    return issued_at + timedelta(seconds=1) < revoked_at
