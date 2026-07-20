from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import jwt

from app.config import JWT_SECRET_KEY, JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    token_data = data.copy()
    now = datetime.now(timezone.utc)

    if expires_delta is None:
        expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    else:
        expire = now + expires_delta

    token_data.update({"exp": expire, "token_type": "access"})

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

    token_data.update({"exp": expire, "token_type": "refresh"})

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
        )

        return payload
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
