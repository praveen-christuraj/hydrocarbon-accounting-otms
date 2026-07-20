import base64
import hashlib

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
