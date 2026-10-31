"""Password lifecycle policy: composition, reuse, expiry and history.

This module is the single source of truth for every password decision in the
backend. The frontend mirror in ``frontend/src/utils/passwordPolicy.js`` exists
only for instant feedback; the backend is always authoritative.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.config import (
    ADMIN_PASSWORD_EXPIRY_DAYS,
    DEFAULT_PASSWORD_EXPIRY_DAYS,
    MAX_PASSWORD_EXPIRY_DAYS,
    PASSWORD_HISTORY_COUNT,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
)
from app.models import User
from app.utils.helpers import normalize_yes_no
from app.utils.security import verify_password

# Frequent/leaked passwords and application-specific terms. Compared
# case-insensitively after stripping digits/symbols at the edges ("P@ssw0rd!"
# is caught by the canonical form check below).
COMMON_PASSWORDS = {
    "password", "passw0rd", "pass1234", "password1", "password12", "password123",
    "password1234", "p@ssword", "p@ssw0rd", "letmein", "welcome", "welcome1",
    "admin", "admin123", "administrator", "root", "toor", "qwerty", "qwerty123",
    "abc123", "iloveyou", "monkey", "dragon", "sunshine", "princess", "football",
    "baseball", "master", "shadow", "superman", "batman", "trustno1", "hello123",
    "changeme", "change-me", "default", "secret", "secret123", "complexpassword",
    "company", "company123", "terminal", "oilterminal", "hydrocarbon",
    "hydrocarbon1", "oilgas", "petroleum", "refinery", "tanker", "shuttle",
    "summer2024", "summer2025", "winter2024", "winter2025", "spring2025",
    "autumn2025", "january2025", "february2025", "march2025", "april2025",
    "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "asdfghjkl", "zxcvbnm",
}

_SEQUENCES = (
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
)


def _canonical(value: str) -> str:
    """Lowercase and strip non-alphanumerics at the edges for common-password checks."""
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold().strip()
    return re.sub(r"^[^a-z0-9]+|[^a-z0-9]+$", "", normalized)


def _has_long_run(value: str, length: int = 4) -> bool:
    lowered = value.casefold()
    for index in range(len(lowered) - length + 1):
        chunk = lowered[index : index + length]
        if len(set(chunk)) == 1:
            return True
    return False


def _has_sequence(value: str, length: int = 4) -> bool:
    lowered = value.casefold()
    for sequence in _SEQUENCES:
        for index in range(len(sequence) - length + 1):
            forward = sequence[index : index + length]
            if forward in lowered or forward[::-1] in lowered:
                return True
    return False


def _contains_identity(password: str, identity: str | None) -> bool:
    cleaned = re.sub(r"[^a-z0-9]", "", str(identity or "").casefold())
    if len(cleaned) < 3:
        return False
    return cleaned in re.sub(r"[^a-z0-9]", "", password.casefold())


def password_policy_violations(
    new_password: str,
    current_password: str | None = None,
    username: str | None = None,
    full_name: str | None = None,
    email: str | None = None,
    history_hashes: list[str] | None = None,
) -> list[str]:
    """Return every policy violation (empty list = password acceptable)."""
    password = str(new_password or "")
    violations: list[str] = []

    if len(password) < PASSWORD_MIN_LENGTH:
        violations.append(f"Password must be at least {PASSWORD_MIN_LENGTH} characters long")
    if len(password) > PASSWORD_MAX_LENGTH:
        violations.append(f"Password must be at most {PASSWORD_MAX_LENGTH} characters long")
    if password != password.strip():
        violations.append("Password must not start or end with whitespace")
    if any(ord(character) < 32 or ord(character) == 127 for character in password):
        violations.append("Password must not contain control characters")
    if not any(character.isupper() for character in password):
        violations.append("Password must contain at least one uppercase letter")
    if not any(character.islower() for character in password):
        violations.append("Password must contain at least one lowercase letter")
    if not any(character.isdigit() for character in password):
        violations.append("Password must contain at least one number")
    if not any(not character.isalnum() for character in password):
        violations.append("Password must contain at least one special character")

    for identity in (username, full_name, email):
        if _contains_identity(password, identity):
            violations.append("Password must not contain your name, username or email address")
            break

    canonical = _canonical(password)
    leet_canonical = canonical.translate(str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i"}))
    if canonical in COMMON_PASSWORDS or leet_canonical in COMMON_PASSWORDS:
        violations.append("Password is too common or easily guessed")
    if canonical and any(canonical.startswith(common) and len(canonical) - len(common) <= 2 for common in COMMON_PASSWORDS):
        violations.append("Password is a predictable variation of a common password")
    if _has_long_run(password):
        violations.append("Password must not contain 4 or more repeated characters")
    if _has_sequence(password):
        violations.append("Password must not contain a 4-character keyboard or numeric sequence")

    if current_password is not None and password == current_password:
        violations.append("New password must be different from current password")

    if history_hashes:
        for previous_hash in history_hashes[-max(PASSWORD_HISTORY_COUNT, 1):]:
            if previous_hash and verify_password(password, str(previous_hash)):
                violations.append(
                    f"Password was used recently. Choose a password that differs from your last "
                    f"{PASSWORD_HISTORY_COUNT} passwords."
                )
                break

    return violations


def validate_password_policy(
    new_password: str,
    current_password: str | None = None,
    username: str | None = None,
    full_name: str | None = None,
    email: str | None = None,
    history_hashes: list[str] | None = None,
):
    violations = password_policy_violations(
        new_password,
        current_password=current_password,
        username=username,
        full_name=full_name,
        email=email,
        history_hashes=history_hashes,
    )
    if violations:
        raise HTTPException(status_code=400, detail=violations[0])


def password_history_for(user: User) -> list[str]:
    history = getattr(user, "password_history_json", None) or []
    if not isinstance(history, list):
        return []
    return [str(item) for item in history if item]


def record_new_password(user: User, new_password_hash: str, *, changed_at: datetime) -> None:
    """Record a completed password change (history + timestamps + counters)."""
    previous_hash = getattr(user, "password_hash", None)
    history = password_history_for(user)
    if previous_hash:
        history.append(str(previous_hash))
    user.password_history_json = history[-max(PASSWORD_HISTORY_COUNT, 1):]
    user.password_hash = new_password_hash
    user.password_changed_at = changed_at


def as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def effective_password_expiry_days(user: User) -> int:
    try:
        days = int(getattr(user, "password_expiry_days", DEFAULT_PASSWORD_EXPIRY_DAYS) or DEFAULT_PASSWORD_EXPIRY_DAYS)
    except (TypeError, ValueError):
        days = DEFAULT_PASSWORD_EXPIRY_DAYS
    return max(1, min(days, MAX_PASSWORD_EXPIRY_DAYS))


def is_password_expired(user: User) -> bool:
    if normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes":
        return False
    changed_at = as_utc(getattr(user, "password_changed_at", None))
    # Legacy rows without a timestamp are governed by the startup backfill; a
    # missing value must not lock an account out of the service.
    if changed_at is None:
        return False
    return datetime.now(timezone.utc) >= changed_at + timedelta(days=effective_password_expiry_days(user))


def password_expires_at(user: User) -> datetime | None:
    if normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes":
        return None
    changed_at = as_utc(getattr(user, "password_changed_at", None))
    if changed_at is None:
        return None
    return changed_at + timedelta(days=effective_password_expiry_days(user))


def is_password_change_required(user: User) -> tuple[bool, str | None]:
    """Whether the account must rotate its password before using the API."""
    if normalize_yes_no(getattr(user, "force_password_change", "No")) == "Yes":
        return True, "administrator_required_change"
    if is_password_expired(user):
        return True, "password_expired"
    return False, None


def validate_expiry_days_for_actor(value: int, *, is_admin: bool) -> int:
    try:
        days = int(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Password expiry days must be a number")
    if days < 1 or days > MAX_PASSWORD_EXPIRY_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Password expiry days must be between 1 and {MAX_PASSWORD_EXPIRY_DAYS}",
        )
    if is_admin and days > ADMIN_PASSWORD_EXPIRY_DAYS:
        raise HTTPException(
            status_code=400,
            detail=f"Administrator passwords must expire within {ADMIN_PASSWORD_EXPIRY_DAYS} days",
        )
    return days


def build_security_flags(user: User):
    expires_at = password_expires_at(user)
    changed_at = as_utc(getattr(user, "password_changed_at", None))
    return {
        "force_password_change": normalize_yes_no(getattr(user, "force_password_change", "No")) == "Yes",
        "password_expired": is_password_expired(user),
        "password_change_required": is_password_change_required(user)[0],
        "password_changed_at": changed_at.isoformat() if changed_at else None,
        "password_expires_at": expires_at.isoformat() if expires_at else None,
        "password_expiry_days": effective_password_expiry_days(user),
        "password_never_expires": normalize_yes_no(getattr(user, "password_never_expires", "No")) == "Yes",
        "totp_enabled": normalize_yes_no(getattr(user, "totp_enabled", "No")) == "Yes",
        "force_2fa": normalize_yes_no(getattr(user, "force_2fa", "No")) == "Yes",
    }


def password_policy_payload() -> dict:
    """Machine-readable policy for the browser checklist (no secrets)."""
    return {
        "min_length": PASSWORD_MIN_LENGTH,
        "max_length": PASSWORD_MAX_LENGTH,
        "require_uppercase": True,
        "require_lowercase": True,
        "require_digit": True,
        "require_special": True,
        "forbid_username": True,
        "forbid_name_or_email": True,
        "forbid_common_passwords": True,
        "forbid_repeated_runs": 4,
        "forbid_sequences": 4,
        "history_count": PASSWORD_HISTORY_COUNT,
        "default_expiry_days": DEFAULT_PASSWORD_EXPIRY_DAYS,
        "admin_max_expiry_days": ADMIN_PASSWORD_EXPIRY_DAYS,
        "max_expiry_days": MAX_PASSWORD_EXPIRY_DAYS,
    }
