from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.models import User
from app.utils.helpers import normalize_yes_no


def validate_password_policy(new_password: str, current_password: str | None = None):
    password = str(new_password or "")
    if len(password) < 12:
        raise HTTPException(status_code=400, detail="Password must be at least 12 characters long")
    if current_password is not None and password == current_password:
        raise HTTPException(status_code=400, detail="New password must be different from current password")
    if not any(ch.isupper() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not any(ch.islower() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")
    if not any(not ch.isalnum() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one special character")


def is_password_expired(user: User):
    if normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes":
        return False
    changed_at = getattr(user, "password_changed_at", None)
    if not changed_at:
        return False
    expiry_days = int(getattr(user, "password_expiry_days", 30) or 30)
    return datetime.now(timezone.utc) >= changed_at.replace(tzinfo=timezone.utc) + timedelta(days=expiry_days)


def build_security_flags(user: User):
    return {
        "force_password_change": normalize_yes_no(getattr(user, "force_password_change", "No")) == "Yes",
        "password_expired": is_password_expired(user),
        "totp_enabled": normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes",
        "force_2fa": normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes",
    }
