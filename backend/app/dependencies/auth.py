import hashlib
import math
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import TOKEN_ROTATION_GRACE_SECONDS
from app.database import get_db
from app.models import TokenBlacklist, User
from app.utils.jwt import decode_access_token
from app.utils.password_policy import is_password_change_required

# Endpoints an account with an expired/forced password may still call so it can
# satisfy the policy, sign out, or refresh its session. Every other route is
# refused until the password is rotated. This turns the "forced password
# change" flag into a server-enforced control instead of a UI suggestion.
PASSWORD_CHANGE_ALLOWED_PATHS = {
    "/auth/me",
    "/auth/change-password",
    "/auth/logout",
    "/auth/logout-all",
    "/auth/refresh",
    "/auth/password-policy",
    "/auth/2fa/setup/start",
    "/auth/2fa/setup/verify",
    "/auth/2fa/backup-codes/regenerate",
    "/auth/2fa/disable",
}


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def is_token_blacklisted(token: str, db: Session) -> bool:
    token_hash = hash_token(token)
    return (
        db.query(TokenBlacklist)
        .filter(
            TokenBlacklist.token_hash == token_hash,
            TokenBlacklist.expires_at > _naive_utc_now(),
        )
        .first()
        is not None
    )


def token_predates_revocation(payload: dict, user: User) -> bool:
    """True when the token belongs to a session epoch that has been revoked.

    Tokens carry a ``session_epoch`` claim that must equal the account's
    current epoch. Tokens minted before the claim existed (or before the
    column was introduced) fall back to comparing ``iat`` with the stored
    timestamp, with the revocation instant rounded up so a token minted in the
    same wall-clock second is still rejected. Unlike password changes there is
    deliberately no multi-second grace here: "revoke sessions" must bite at
    once.
    """
    current_epoch = int(getattr(user, "session_epoch", 0) or 0)
    token_epoch = payload.get("session_epoch")
    if token_epoch is not None:
        try:
            return int(token_epoch) < current_epoch
        except (TypeError, ValueError):
            return True

    revoked_at = as_naive_utc(getattr(user, "session_revoked_at", None))
    issued_at = payload.get("iat")
    if revoked_at is None or issued_at is None:
        return False
    revoked_ts = math.ceil(revoked_at.replace(tzinfo=timezone.utc).timestamp())
    return int(float(issued_at)) < revoked_ts


def token_predates_password_change(payload: dict, user: User) -> bool:
    changed_at = as_naive_utc(getattr(user, "password_changed_at", None))
    issued_at = payload.get("iat")
    if changed_at is None or issued_at is None:
        return False
    changed_ts = changed_at.replace(tzinfo=timezone.utc).timestamp()
    return float(issued_at) + TOKEN_ROTATION_GRACE_SECONDS < changed_ts


def get_current_user_from_token(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    request: Request = None,  # type: ignore[assignment]  # injected by FastAPI
):
    if authorization is None:
        raise HTTPException(
            status_code=401,
            detail="Authorization header is missing",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header",
        )

    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    # Check blacklist before decoding
    if is_token_blacklisted(token, db):
        raise HTTPException(
            status_code=401,
            detail="Token has been revoked. Please login again.",
        )

    payload = decode_access_token(token)

    # Refresh tokens are separately signed but carry the same subject fields.
    # Never accept them as bearer access tokens, or a long-lived refresh
    # credential becomes a long-lived API credential.
    if payload.get("token_type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user_id = payload.get("user_id")

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid token payload",
        )

    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    # A token issued before the user's last password change or before an
    # administrative "revoke all sessions" action is dead, even if its own
    # expiry has not passed.
    if token_predates_password_change(payload, user) or token_predates_revocation(payload, user):
        raise HTTPException(
            status_code=401,
            detail="Credentials changed since this session started. Please sign in again.",
        )

    # Server-side enforcement of forced/expired passwords. The front end shows
    # the same gate, but the API must not trust the browser to obey it.
    change_required, change_reason = is_password_change_required(user)
    if change_required and request is not None:
        # Compare against the routed path only (query strings are irrelevant).
        path = request.url.path.rstrip("/") or "/"
        if path not in PASSWORD_CHANGE_ALLOWED_PATHS:
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "PASSWORD_CHANGE_REQUIRED",
                    "reason": change_reason,
                    "message": (
                        "Your password must be changed before this action is allowed. "
                        "Sign in again and set a new password."
                    ),
                },
            )

    return user
