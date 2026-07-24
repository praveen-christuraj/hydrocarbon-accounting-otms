import os
import secrets

cors_origins_env = os.getenv("CORS_ORIGINS", "*")
if cors_origins_env == "*":
    # "*" = allow any origin. Starlette echoes back the Origin header,
    # which is compatible with allow_credentials=True.
    allowed_origins = ["*"]
else:
    allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")
if not JWT_SECRET_KEY:
    if os.getenv("ENVIRONMENT", "development") == "production":
        raise ValueError("JWT_SECRET_KEY must be set in production")
    JWT_SECRET_KEY = secrets.token_urlsafe(64)

ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY:
    if os.getenv("ENVIRONMENT", "development") == "production":
        raise ValueError("ENCRYPTION_KEY must be set in production")
    ENCRYPTION_KEY = secrets.token_urlsafe(64)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

APPROVED_TRANSACTION_STATUS = "Approved"
CORRECTION_HOLD_STATUS = "Pending Admin Review"
APPROVED_CORRECTION_WINDOW_HOURS = 24
