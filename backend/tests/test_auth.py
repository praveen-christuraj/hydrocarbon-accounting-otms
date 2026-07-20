from tests.conftest import create_role_with_permission, create_user


def test_login_success(client, db):
    role, _ = create_role_with_permission(db, "Admin", "View Users")
    create_user(db, "admin", "AdminPass123!", roles=[role])
    db.commit()

    response = client.post("/auth/login", json={
        "username": "admin",
        "password": "AdminPass123!",
    })

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client, db):
    role, _ = create_role_with_permission(db, "Admin", "View Users")
    create_user(db, "admin", "AdminPass123!", roles=[role])
    db.commit()

    response = client.post("/auth/login", json={
        "username": "admin",
        "password": "WrongPassword!",
    })

    assert response.status_code in (400, 401)


def test_login_nonexistent_user(client):
    response = client.post("/auth/login", json={
        "username": "nobody",
        "password": "SomePass123!",
    })

    assert response.status_code in (400, 401)


def test_protected_endpoint_no_token(client):
    response = client.get("/users")
    assert response.status_code == 401


def test_protected_endpoint_valid_token(client, db):
    role, _ = create_role_with_permission(db, "Admin", "View Users")
    user = create_user(db, "admin", "AdminPass123!", roles=[role])
    db.commit()

    login_resp = client.post("/auth/login", json={
        "username": "admin",
        "password": "AdminPass123!",
    })
    token = login_resp.json()["access_token"]

    response = client.get(
        "/users",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
