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

    return user
