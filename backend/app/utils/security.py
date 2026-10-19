import base64
import hashlib
import secrets
import string

import bcrypt
from cryptography.fernet import Fernet

from app.config import ENCRYPTION_KEY

_fernet_instance = None


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


def generate_secure_password(length: int = 16) -> str:
    """Generate a password that satisfies the policy by construction.

    Used when an administrator chooses "generate secure temporary password"
    instead of typing one. The result always contains uppercase, lowercase,
    digit and special characters.
    """
    length = max(16, int(length or 16))
    alphabet = string.ascii_letters + string.digits + "!@#$%&*+-_=?"
    while True:
        # Guarantee one character from each required class, then fill randomly.
        characters = [
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.digits),
            secrets.choice("!@#$%&*+-_=?"),
        ]
        characters.extend(secrets.choice(alphabet) for _ in range(length - len(characters)))
        secrets.SystemRandom().shuffle(characters)
        password = "".join(characters)
        if (
            any(ch.isupper() for ch in password)
            and any(ch.islower() for ch in password)
            and any(ch.isdigit() for ch in password)
            and any(not ch.isalnum() for ch in password)
        ):
            return password


def generate_security_stamp() -> str:
    """Opaque value embedded in JWTs to revoke every existing session.

    Rotating it invalidates all access and refresh tokens that carry the old
    stamp (password changes, administrator reset, forced sign-out).
    """
    return secrets.token_hex(32)


def get_fernet():
    global _fernet_instance
    if _fernet_instance is None:
        key = base64.urlsafe_b64encode(hashlib.sha256(ENCRYPTION_KEY.encode("utf-8")).digest())
        _fernet_instance = Fernet(key)
    return _fernet_instance


def encrypt_security_value(value: str | None):
    if value is None:
        return None
    return get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_security_value(value: str | None):
    if not value:
        return None
    try:
        return get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except Exception:
        return None
