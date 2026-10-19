import hashlib
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TokenBlacklist, User
from app.utils.jwt import decode_access_token


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def is_token_blacklisted(token: str, db: Session) -> bool:
    token_hash = hash_token(token)
    return (
        db.query(TokenBlacklist)
        .filter(
            TokenBlacklist.token_hash == token_hash,
            TokenBlacklist.expires_at > datetime.now(timezone.utc),
        )
        .first()
        is not None
    )


def get_current_user_from_token(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
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

    # Check blacklist before decoding
    if is_token_blacklisted(token, db):
        raise HTTPException(
            status_code=401,
            detail="Token has been revoked. Please login again.",
        )

    payload = decode_access_token(token)

    # Refresh tokens are separately signed but carry the same subject fields.
    # Never accept them as bearer access tokens, or a 30-day refresh credential
    # becomes a long-lived API credential.
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
            detail="User not found",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    # Tokens issued before the user's last password change are revoked. This
    # ends every open session when an administrator resets a password or the
    # user rotates it (change-password hands back a fresh token pair).
    # Legacy tokens without an "iat" claim are tolerated until they expire.
    token_issued_at = payload.get("iat")
    password_changed_at = getattr(user, "password_changed_at", None)
    if token_issued_at is not None and password_changed_at is not None:
        if password_changed_at.tzinfo is None:
            changed_ts = password_changed_at.replace(tzinfo=timezone.utc).timestamp()
        else:
            changed_ts = password_changed_at.timestamp()
        if float(token_issued_at) + 60 < changed_ts:
            raise HTTPException(
                status_code=401,
                detail="Credentials changed since this session started. Please sign in again.",
            )

    return user
