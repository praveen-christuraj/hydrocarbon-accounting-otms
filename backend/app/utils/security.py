import base64
import hashlib

import bcrypt
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.config import ENCRYPTION_KEY, SECURITY_KDF_SALT

_fernet_instance = None
_legacy_fernet_instance = None
KDF_ITERATIONS = 600_000
KDF_CIPHERTEXT_PREFIX = "v2:"


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
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=SECURITY_KDF_SALT.encode("utf-8"),
            iterations=KDF_ITERATIONS,
        )
        key = base64.urlsafe_b64encode(kdf.derive(ENCRYPTION_KEY.encode("utf-8")))
        _fernet_instance = Fernet(key)
    return _fernet_instance


def get_legacy_fernet():
    """Read ciphertext written before the PBKDF2 migration."""
    global _legacy_fernet_instance
    if _legacy_fernet_instance is None:
        key = base64.urlsafe_b64encode(hashlib.sha256(ENCRYPTION_KEY.encode("utf-8")).digest())
        _legacy_fernet_instance = Fernet(key)
    return _legacy_fernet_instance


def encrypt_security_value(value: str | None):
    if value is None:
        return None
    token = get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{KDF_CIPHERTEXT_PREFIX}{token}"


def decrypt_security_value(value: str | None):
    if not value:
        return None
    try:
        encoded = str(value)
        if encoded.startswith(KDF_CIPHERTEXT_PREFIX):
            token = encoded[len(KDF_CIPHERTEXT_PREFIX):]
            return get_fernet().decrypt(token.encode("utf-8")).decode("utf-8")
        return get_legacy_fernet().decrypt(encoded.encode("utf-8")).decode("utf-8")
    except Exception:
        return None
