"""Central password policy for the whole application.

Rules are enforced server-side on every path that writes a password: self
service, User Master, bulk import (through the same create endpoint), admin
reset and reset-request approval. The frontend mirrors the rules for instant
feedback but is never trusted.
"""

from datetime import timedelta

from fastapi import HTTPException

from app.config import PASSWORD_HISTORY_COUNT
from app.models import User
from app.utils.helpers import normalize_yes_no
from app.utils.security import verify_password
from app.utils.time import to_utc_naive, utcnow

PASSWORD_MIN_LENGTH = 12
# bcrypt silently truncates inputs longer than 72 bytes; reject instead.
PASSWORD_MAX_BYTES = 72

# Small list of passwords that are common in credential-stuffing lists. It is
# intentionally short: the length + character-class + identity rules already
# carry most of the weight and we do not want to block legitimate passphrases.
COMMON_PASSWORDS = {
    "password123!",
    "password1234",
    "passw0rd123!",
    "welcome123!",
    "welcome1234",
    "admin123456!",
    "administrator1",
    "changeme123!",
    "qwerty123456",
    "letmein12345",
    "iloveyou1234",
    "company12345",
    "hydrocarbon1",
    "oilandgas123",
    "terminal1234",
}


def password_policy_rules() -> dict:
    """Machine-readable policy used by the UI to render the checklist."""
    return {
        "min_length": PASSWORD_MIN_LENGTH,
        "max_length": PASSWORD_MAX_BYTES,
        "require_uppercase": True,
        "require_lowercase": True,
        "require_number": True,
        "require_special": True,
        "forbid_current_password": True,
        "forbid_identity": True,
        "history_count": PASSWORD_HISTORY_COUNT,
        "message": (
            f"Use at least {PASSWORD_MIN_LENGTH} characters with uppercase, "
            "lowercase, number and special character. Do not reuse a recent "
            "password or include your username/name."
        ),
    }


def _identity_fragments(user: User | None) -> set[str]:
    if user is None:
        return set()
    fragments: set[str] = set()
    username = str(getattr(user, "username", "") or "").strip().casefold()
    email = str(getattr(user, "email", "") or "").strip().casefold()
    full_name = str(getattr(user, "full_name", "") or "").strip().casefold()
    if len(username) >= 3:
        fragments.add(username)
    if email and "@" in email:
        local_part = email.split("@", 1)[0]
        if len(local_part) >= 3:
            fragments.add(local_part)
    for part in full_name.replace(".", " ").replace("-", " ").split():
        if len(part) >= 4:
            fragments.add(part)
    return fragments


def password_is_reused(user: User | None, new_password: str) -> bool:
    """Check the current password and the retained password history."""
    if user is None:
        return False

    password = str(new_password or "")
    current_hash = getattr(user, "password_hash", None)
    if current_hash and verify_password(password, current_hash):
        return True

    history = list(getattr(user, "password_history_json", None) or [])
    for password_hash in history[:PASSWORD_HISTORY_COUNT]:
        if isinstance(password_hash, str) and password_hash and verify_password(password, password_hash):
            return True
    return False


def remember_password_hash(user: User, previous_hash: str | None) -> None:
    """Push the previous password hash onto the bounded history list.

    Call this *before* assigning the new hash. Only hashes are stored, never
    plaintext, and the list is capped so the table cannot grow unbounded.
    """
    if not previous_hash:
        return
    history = [
        value
        for value in list(getattr(user, "password_history_json", None) or [])
        if isinstance(value, str) and value
    ]
    history.insert(0, previous_hash)
    user.password_history_json = history[: max(1, PASSWORD_HISTORY_COUNT)]


def validate_password_policy(
    new_password: str,
    current_password: str | None = None,
    user: User | None = None,
) -> None:
    """Raise ``HTTPException(400)`` when the password breaks the policy."""
    password = str(new_password or "")

    if len(password) < PASSWORD_MIN_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {PASSWORD_MIN_LENGTH} characters long",
        )
    if len(password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at most {PASSWORD_MAX_BYTES} bytes long",
        )
    if not any(ch.isupper() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one uppercase letter")
    if not any(ch.islower() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one lowercase letter")
    if not any(ch.isdigit() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")
    if not any(not ch.isalnum() for ch in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one special character")
    if password.strip() == "":
        raise HTTPException(status_code=400, detail="Password cannot contain only whitespace")

    normalised = password.casefold()
    if normalised in COMMON_PASSWORDS:
        raise HTTPException(status_code=400, detail="This password is too common. Choose a different one.")

    identity_fragments = _identity_fragments(user)
    for fragment in identity_fragments:
        if fragment and fragment in normalised:
            raise HTTPException(
                status_code=400,
                detail="Password must not contain your username, email name or full name",
            )

    if current_password is not None and password == current_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from current password",
        )

    if user is not None and password_is_reused(user, password):
        raise HTTPException(
            status_code=400,
            detail=f"Password was used recently. Choose a password not used in your last {PASSWORD_HISTORY_COUNT} passwords.",
        )


def password_expiry_at(user: User):
    if normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes":
        return None
    changed_at = to_utc_naive(getattr(user, "password_changed_at", None))
    if changed_at is None:
        return None
    expiry_days = getattr(user, "password_expiry_days", None)
    if expiry_days is None:
        expiry_days = 30
    if int(expiry_days) <= 0:
        return None
    return changed_at + timedelta(days=int(expiry_days))


def is_password_expired(user: User) -> bool:
    expires_at = password_expiry_at(user)
    return expires_at is not None and utcnow() >= expires_at


def password_is_forced(user: User) -> bool:
    return normalize_yes_no(getattr(user, "force_password_change", "No")) == "Yes"


def password_change_required(user: User) -> bool:
    return password_is_forced(user) or is_password_expired(user)


def build_security_flags(user: User):
    """Non-sensitive security state returned to the signed-in user."""
    expires_at = password_expiry_at(user)
    remaining_days = None
    if expires_at is not None:
        remaining_days = max(0, (expires_at - utcnow()).days)

    backup_codes = list(getattr(user, "backup_codes_hash_json", None) or [])
    totp_enabled = normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes"
    force_2fa = normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes"
    forced_change = password_is_forced(user)
    expired = is_password_expired(user)

    return {
        "force_password_change": forced_change,
        "password_expired": expired,
        "password_change_required": forced_change or expired,
        "password_changed_at": getattr(user, "password_changed_at", None),
        "password_expires_at": expires_at,
        "password_days_remaining": remaining_days,
        "password_never_expires": normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes",
        "totp_enabled": totp_enabled,
        "force_2fa": force_2fa,
        "two_factor_enrollment_required": force_2fa and not totp_enabled,
        "two_factor_confirmed_at": getattr(user, "totp_confirmed_at", None),
        "backup_codes_remaining": len(backup_codes),
        "failed_login_count": int(getattr(user, "failed_login_count", 0) or 0),
        "locked_until": getattr(user, "locked_until", None),
        "is_locked": bool(
            getattr(user, "locked_until", None)
            and to_utc_naive(user.locked_until) > utcnow()
        ),
        "last_login_at": getattr(user, "last_login_at", None),
    }


def security_change_required(user: User) -> bool:
    """True when the account must resolve a security prerequisite first.

    Enforced by the authentication dependency: a user with a temporary/expired
    password, or a mandatory 2FA policy without an enrolled authenticator, can
    only reach the endpoints needed to fix the problem.
    """
    if password_change_required(user):
        return True
    force_2fa = normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes"
    totp_enabled = normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes"
    return force_2fa and not totp_enabled
