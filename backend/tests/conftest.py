import os
import secrets
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

os.environ.setdefault("JWT_SECRET_KEY", secrets.token_urlsafe(32))
os.environ.setdefault("ENCRYPTION_KEY", secrets.token_urlsafe(32))
os.environ.setdefault("DATABASE_URL", "sqlite:///./test.db")

from app.database import Base, get_db
from app.main import app
from app.models import User, UserRole, Role, RolePermission, Permission
from app.utils.security import hash_password

SQLALCHEMY_DATABASE_URL = os.environ["DATABASE_URL"]
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def create_role_with_permission(db, role_name, permission_name, module_name="General"):
    role = Role(role_name=role_name, status="Active")
    db.add(role)
    db.flush()

    perm = Permission(
        permission_name=permission_name,
        module_name=module_name,
        status="Active",
    )
    db.add(perm)
    db.flush()

    rp = RolePermission(role_id=role.id, permission_id=perm.id)
    db.add(rp)
    db.flush()

    return role, perm


def create_user(db, username="testuser", password="TestPass123!", roles=None):
    user = User(
        username=username,
        full_name=f"Test {username}",
        email=f"{username}@test.com",
        password_hash=hash_password(password),
        status="Active",
    )
    db.add(user)
    db.flush()

    if roles:
        for role in roles:
            ur = UserRole(user_id=user.id, role_id=role.id)
            db.add(ur)
        db.flush()

    return user
