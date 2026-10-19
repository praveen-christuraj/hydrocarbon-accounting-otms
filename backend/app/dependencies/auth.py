import hashlib

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import TokenBlacklist, User
from app.utils.jwt import decode_access_token
from app.utils.time import utcnow


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def is_token_blacklisted(token: str, db: Session) -> bool:
    token_hash = hash_token(token)
    return (
        db.query(TokenBlacklist)
        .filter(
            TokenBlacklist.token_hash == token_hash,
            TokenBlacklist.expires_at > utcnow(),
        )
        .first()
        is not None
    )


# Endpoints a user may still call while a security prerequisite is
# outstanding (temporary/expired password or mandatory 2FA enrolment).
SECURITY_PREREQUISITE_PATHS = {
    "/auth/change-password",
    "/auth/me",
    "/auth/logout",
    "/auth/refresh",
    "/auth/password-policy",
    "/auth/2fa/setup/start",
    "/auth/2fa/setup/verify",
    "/auth/2fa/disable",
    "/auth/2fa/backup-codes/regenerate",
    "/auth/my/reset-requests",
    "/auth/my/security-activity",
}


def get_current_user_from_token(
    request: Request = None,
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

    if str(user.status or "").strip().lower() != "active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    # Session revocation: a token that carries a stamp must match the account's
    # current stamp. Tokens issued before the security-stamp upgrade carry no
    # stamp and are left to expire naturally (maximum 8 hours).
    token_stamp = payload.get("stamp")
    if token_stamp and user.security_stamp and token_stamp != user.security_stamp:
        raise HTTPException(
            status_code=401,
            detail="Session has been revoked. Please login again.",
        )

    # Server-side enforcement of the security prerequisites. The UI shows a
    # blocking screen, but the API must refuse to serve business data until the
    # user changes the temporary/expired password or enrols the mandatory
    # authenticator.
    from app.utils.password_policy import security_change_required

    if request is not None and security_change_required(user):
        path = request.url.path.rstrip("/") or "/"
        allowed = {item.rstrip("/") for item in SECURITY_PREREQUISITE_PATHS}
        if path not in allowed:
            from app.utils.helpers import normalize_yes_no

            if normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes" and normalize_yes_no(
                getattr(user, "totp_enabled", "No")
            ) != "Yes":
                detail = (
                    "Two-factor authentication enrolment is required before you can "
                    "continue. Open Profile & Security to enrol your authenticator."
                )
            else:
                detail = (
                    "A password change is required before you can continue. "
                    "Open Profile & Security to set a new password."
                )
            raise HTTPException(status_code=403, detail=detail)

    return user
