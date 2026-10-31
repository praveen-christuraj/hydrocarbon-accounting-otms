import os
import secrets
from urllib.parse import urlparse

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()


def _load_cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "").strip()
    if not configured:
        if ENVIRONMENT == "production":
            raise ValueError("CORS_ORIGINS must list trusted origins in production")
        return ["http://localhost:5173", "http://127.0.0.1:5173"]

    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    if not origins or "*" in origins:
        raise ValueError("CORS_ORIGINS cannot be empty or contain '*' when credentials are enabled")
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
            raise ValueError(f"Invalid CORS origin: {origin}")
        if ENVIRONMENT == "production" and parsed.scheme != "https":
            raise ValueError("Production CORS origins must use HTTPS")
    return origins


allowed_origins = _load_cors_origins()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    if ENVIRONMENT == "production":
        raise ValueError("JWT_SECRET_KEY must be set in production")
    JWT_SECRET_KEY = secrets.token_urlsafe(64)

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    if ENVIRONMENT == "production":
        raise ValueError("ENCRYPTION_KEY must be set in production")
    ENCRYPTION_KEY = secrets.token_urlsafe(64)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "1"))

SECURITY_KDF_SALT = os.getenv("SECURITY_KDF_SALT", "").strip()
if not SECURITY_KDF_SALT:
    if ENVIRONMENT == "production":
        raise ValueError("SECURITY_KDF_SALT must be set in production")
    SECURITY_KDF_SALT = "hydrocarbon-development-kdf-salt-v1"
if len(SECURITY_KDF_SALT.encode("utf-8")) < 16:
    raise ValueError("SECURITY_KDF_SALT must contain at least 16 bytes")

AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "hydrocarbon_refresh")
AUTH_COOKIE_SECURE = os.getenv(
    "AUTH_COOKIE_SECURE", "true" if ENVIRONMENT == "production" else "false"
).strip().lower() in {"1", "true", "yes"}
AUTH_COOKIE_PATH = os.getenv("AUTH_COOKIE_PATH", "/") or "/"

APPROVED_TRANSACTION_STATUS = "Approved"
CORRECTION_HOLD_STATUS = "Pending Admin Review"
APPROVED_CORRECTION_WINDOW_HOURS = 24
