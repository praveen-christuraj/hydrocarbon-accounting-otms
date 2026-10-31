from datetime import datetime, timedelta, timezone
import secrets

from fastapi import HTTPException
import jwt

from app.config import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    JWT_ALGORITHM,
    JWT_AUDIENCE,
    JWT_ISSUER,
    JWT_LEEWAY_SECONDS,
    JWT_SECRET_KEY,
    REFRESH_TOKEN_EXPIRE_DAYS,
)


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    token_data = data.copy()
    now = datetime.now(timezone.utc)

    if expires_delta is None:
        expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    else:
        expire = now + expires_delta

    token_data.update(
        {
            "exp": expire,
            "iat": now,
            "nbf": now,
            "token_type": "access",
            "jti": secrets.token_urlsafe(16),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        }
    )

    encoded_jwt = jwt.encode(
        token_data,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )

    return encoded_jwt


def create_refresh_token(data: dict, expires_delta: timedelta | None = None):
    token_data = data.copy()
    now = datetime.now(timezone.utc)

    if expires_delta is None:
        expire = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    else:
        expire = now + expires_delta

    token_data.update(
        {
            "exp": expire,
            "iat": now,
            "nbf": now,
            "token_type": "refresh",
            "jti": secrets.token_urlsafe(16),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
        }
    )

    encoded_jwt = jwt.encode(
        token_data,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )

    return encoded_jwt


def decode_access_token(token: str):
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
            leeway=JWT_LEEWAY_SECONDS,
            options={
                "require": ["exp", "iat", "nbf", "token_type", "user_id", "jti", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_aud": True,
                "verify_iss": True,
            },
        )
        if payload.get("token_type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        return payload
    except HTTPException:
        raise
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )


def decode_refresh_token(token: str):
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
            leeway=JWT_LEEWAY_SECONDS,
            options={
                "require": ["exp", "iat", "nbf", "token_type", "user_id", "jti", "iss", "aud"],
                "verify_signature": True,
                "verify_exp": True,
                "verify_nbf": True,
                "verify_iat": True,
                "verify_aud": True,
                "verify_iss": True,
            },
        )

        if payload.get("token_type") != "refresh":
            raise HTTPException(
                status_code=401,
                detail="Invalid token type",
            )

        return payload
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired refresh token",
        )
