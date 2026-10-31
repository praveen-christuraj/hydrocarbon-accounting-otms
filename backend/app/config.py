import os
import secrets
from urllib.parse import urlparse

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()
IS_PRODUCTION = ENVIRONMENT == "production"


def _env_int(name: str, default: int, minimum: int = 1, maximum: int | None = None) -> int:
    raw = os.getenv(name)
    try:
        value = int(raw) if raw not in (None, "") else int(default)
    except (TypeError, ValueError):
        raise ValueError(f"{name} must be an integer")
    if value < minimum:
        raise ValueError(f"{name} must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be at most {maximum}")
    return value


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _load_cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "").strip()
    if not configured:
        if IS_PRODUCTION:
            raise ValueError("CORS_ORIGINS must list trusted origins in production")
        return ["http://localhost:5173", "http://127.0.0.1:5173"]

    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    if not origins or "*" in origins:
        raise ValueError("CORS_ORIGINS cannot be empty or contain '*' when credentials are enabled")
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path not in {"", "/"}:
            raise ValueError(f"Invalid CORS origin: {origin}")
        if parsed.username or parsed.password:
            raise ValueError(f"CORS origin must not embed credentials: {origin}")
        if IS_PRODUCTION and parsed.scheme != "https":
            raise ValueError("Production CORS origins must use HTTPS")
    return origins


allowed_origins = _load_cors_origins()

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    if IS_PRODUCTION:
        raise ValueError("JWT_SECRET_KEY must be set in production")
    JWT_SECRET_KEY = secrets.token_urlsafe(64)
if len(JWT_SECRET_KEY) < 32:
    raise ValueError("JWT_SECRET_KEY must contain at least 32 characters")

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    if IS_PRODUCTION:
        raise ValueError("ENCRYPTION_KEY must be set in production")
    ENCRYPTION_KEY = secrets.token_urlsafe(64)
if len(ENCRYPTION_KEY) < 32:
    raise ValueError("ENCRYPTION_KEY must contain at least 32 characters")

JWT_ALGORITHM = "HS256"
JWT_ISSUER = os.getenv("JWT_ISSUER", "hydrocarbon-accounting").strip() or "hydrocarbon-accounting"
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "hydrocarbon-accounting-api").strip() or "hydrocarbon-accounting-api"
# Small clock-skew tolerance only. Session revocation uses exact comparisons.
JWT_LEEWAY_SECONDS = _env_int("JWT_LEEWAY_SECONDS", 10, minimum=0, maximum=120)

ACCESS_TOKEN_EXPIRE_MINUTES = _env_int("ACCESS_TOKEN_EXPIRE_MINUTES", 15, minimum=1, maximum=120)
REFRESH_TOKEN_EXPIRE_DAYS = _env_int("REFRESH_TOKEN_EXPIRE_DAYS", 1, minimum=1, maximum=30)
# Tokens issued in the same second as a credential change must keep working for
# the caller that just changed the password. Anything older is rejected.
TOKEN_ROTATION_GRACE_SECONDS = _env_int("TOKEN_ROTATION_GRACE_SECONDS", 2, minimum=0, maximum=60)

SECURITY_KDF_SALT = os.getenv("SECURITY_KDF_SALT", "").strip()
if not SECURITY_KDF_SALT:
    if IS_PRODUCTION:
        raise ValueError("SECURITY_KDF_SALT must be set in production")
    SECURITY_KDF_SALT = "hydrocarbon-development-kdf-salt-v1"
if len(SECURITY_KDF_SALT.encode("utf-8")) < 16:
    raise ValueError("SECURITY_KDF_SALT must contain at least 16 bytes")

AUTH_COOKIE_NAME = os.getenv("AUTH_COOKIE_NAME", "hydrocarbon_refresh")
AUTH_COOKIE_SECURE = _env_bool("AUTH_COOKIE_SECURE", IS_PRODUCTION)
AUTH_COOKIE_PATH = os.getenv("AUTH_COOKIE_PATH", "/") or "/"
AUTH_COOKIE_SAMESITE = "strict"
AUTH_COOKIE_DOMAIN = os.getenv("AUTH_COOKIE_DOMAIN", "").strip() or None

# ---------------------------------------------------------------------------
# Password lifecycle policy
# ---------------------------------------------------------------------------
PASSWORD_MIN_LENGTH = _env_int("PASSWORD_MIN_LENGTH", 12, minimum=12, maximum=64)
PASSWORD_MAX_LENGTH = _env_int("PASSWORD_MAX_LENGTH", 128, minimum=64, maximum=256)
DEFAULT_PASSWORD_EXPIRY_DAYS = _env_int("DEFAULT_PASSWORD_EXPIRY_DAYS", 30, minimum=1, maximum=365)
ADMIN_PASSWORD_EXPIRY_DAYS = _env_int("ADMIN_PASSWORD_EXPIRY_DAYS", 60, minimum=1, maximum=90)
MAX_PASSWORD_EXPIRY_DAYS = _env_int("MAX_PASSWORD_EXPIRY_DAYS", 365, minimum=30, maximum=730)
PASSWORD_HISTORY_COUNT = _env_int("PASSWORD_HISTORY_COUNT", 5, minimum=1, maximum=24)
# Never allow "password never expires" to be set for the reserved Admin account
# or any account holding the Admin role.
ADMIN_PASSWORD_NEVER_EXPIRES_ALLOWED = False

# ---------------------------------------------------------------------------
# Account lockout / throttling
# ---------------------------------------------------------------------------
MAX_FAILED_LOGIN_ATTEMPTS = _env_int("MAX_FAILED_LOGIN_ATTEMPTS", 5, minimum=3, maximum=20)
ACCOUNT_LOCK_MINUTES = _env_int("ACCOUNT_LOCK_MINUTES", 15, minimum=1, maximum=1440)
MAX_2FA_ATTEMPTS_PER_CHALLENGE = _env_int("MAX_2FA_ATTEMPTS_PER_CHALLENGE", 5, minimum=3, maximum=10)
TWO_FA_CHALLENGE_MINUTES = _env_int("TWO_FA_CHALLENGE_MINUTES", 5, minimum=1, maximum=15)

RATE_LIMIT_ENABLED = _env_bool("RATE_LIMIT_ENABLED", True)
LOGIN_IP_MAX_ATTEMPTS = _env_int("LOGIN_IP_MAX_ATTEMPTS", 20, minimum=5, maximum=200)
LOGIN_IP_WINDOW_SECONDS = _env_int("LOGIN_IP_WINDOW_SECONDS", 300, minimum=60, maximum=3600)
LOGIN_IDENTITY_MAX_ATTEMPTS = _env_int("LOGIN_IDENTITY_MAX_ATTEMPTS", 10, minimum=5, maximum=100)
LOGIN_IDENTITY_WINDOW_SECONDS = _env_int("LOGIN_IDENTITY_WINDOW_SECONDS", 900, minimum=60, maximum=86400)
TWO_FA_IP_MAX_ATTEMPTS = _env_int("TWO_FA_IP_MAX_ATTEMPTS", 20, minimum=5, maximum=200)
TWO_FA_USER_MAX_FAILURES = _env_int("TWO_FA_USER_MAX_FAILURES", 10, minimum=5, maximum=100)
TWO_FA_FAILURE_WINDOW_SECONDS = _env_int("TWO_FA_FAILURE_WINDOW_SECONDS", 900, minimum=60, maximum=86400)
FORGOT_PASSWORD_WINDOW_SECONDS = _env_int("FORGOT_PASSWORD_WINDOW_SECONDS", 900, minimum=60, maximum=86400)
FORGOT_PASSWORD_MAX_PER_WINDOW = _env_int("FORGOT_PASSWORD_MAX_PER_WINDOW", 3, minimum=1, maximum=20)
SENSITIVE_ACTION_MAX_PER_WINDOW = _env_int("SENSITIVE_ACTION_MAX_PER_WINDOW", 10, minimum=3, maximum=100)
SENSITIVE_ACTION_WINDOW_SECONDS = _env_int("SENSITIVE_ACTION_WINDOW_SECONDS", 300, minimum=60, maximum=3600)
REFRESH_MAX_PER_WINDOW = _env_int("REFRESH_MAX_PER_WINDOW", 120, minimum=10, maximum=1000)
REFRESH_WINDOW_SECONDS = _env_int("REFRESH_WINDOW_SECONDS", 300, minimum=60, maximum=3600)
ADMIN_SECURITY_MAX_PER_WINDOW = _env_int("ADMIN_SECURITY_MAX_PER_WINDOW", 30, minimum=5, maximum=500)
ALLOW_REFRESH_TOKEN_IN_BODY = _env_bool("ALLOW_REFRESH_TOKEN_IN_BODY", not IS_PRODUCTION)

# ---------------------------------------------------------------------------
# Transport / deployment boundaries
# ---------------------------------------------------------------------------
# Only trust X-Forwarded-* when the application is guaranteed to sit behind the
# listed reverse proxies. Empty list = never trust forwarded headers.
TRUSTED_PROXY_IPS = {
    entry.strip()
    for entry in os.getenv("TRUSTED_PROXY_IPS", "").split(",")
    if entry.strip()
}
TRUST_PROXY_HEADERS = _env_bool("TRUST_PROXY_HEADERS", False)
TRUSTED_HOSTS = [
    host.strip()
    for host in os.getenv("TRUSTED_HOSTS", "").split(",")
    if host.strip()
]
MAX_REQUEST_BODY_BYTES = _env_int("MAX_REQUEST_BODY_BYTES", 25 * 1024 * 1024, minimum=1024)
ENFORCE_HTTPS = _env_bool("ENFORCE_HTTPS", False)

APPROVED_TRANSACTION_STATUS = "Approved"
CORRECTION_HOLD_STATUS = "Pending Admin Review"
APPROVED_CORRECTION_WINDOW_HOURS = 24
