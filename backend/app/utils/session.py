"""Session-revocation helpers.

A per-user ``session_epoch`` counter is embedded in every access and refresh
token. Revoking a user's sessions increments the counter, so every token minted
earlier is rejected on the next request *and* when it is presented for refresh,
without relying on wall-clock comparisons (which are only second-accurate and
would otherwise race with tokens issued in the same second).
"""

from datetime import datetime, timezone

from app.models import User


def utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def current_session_epoch(user: User) -> int:
    try:
        return int(getattr(user, "session_epoch", 0) or 0)
    except (TypeError, ValueError):
        return 0


def revoke_user_sessions(user: User, when: datetime | None = None) -> int:
    """Invalidate every token issued for ``user`` so far.

    Returns the new epoch. The caller is responsible for committing.
    """
    user.session_revoked_at = when or utc_now_naive()
    user.session_epoch = current_session_epoch(user) + 1
    return user.session_epoch
