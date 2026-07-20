from tests.conftest import create_role_with_permission, create_user


def get_auth_header(client, db, username="admin", password="AdminPass123!"):
    role, _ = create_role_with_permission(db, "Admin", "Manage Users")
    create_user(db, username, password, roles=[role])
    db.commit()

    login_resp = client.post("/auth/login", json={
        "username": username,
        "password": password,
    })
    token = login_resp.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_list_users_empty(client, db):
    headers = get_auth_header(client, db)
    response = client.get("/users", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert data["total"] >= 0


def test_create_user(client, db):
    headers = get_auth_header(client, db)
    response = client.post("/users", headers=headers, json={
        "username": "newuser",
        "full_name": "New User",
        "email": "new@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    })
    assert response.status_code in (200, 201)
    data = response.json()
    assert data["username"] == "newuser"
    assert data["full_name"] == "New User"


def test_create_user_duplicate_username(client, db):
    headers = get_auth_header(client, db)
    payload = {
        "username": "dupuser",
        "full_name": "Dup User",
        "email": "dup@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    }
    client.post("/users", headers=headers, json=payload)
    response = client.post("/users", headers=headers, json=payload)
    assert response.status_code in (400, 409)


def test_get_user_by_id(client, db):
    headers = get_auth_header(client, db)
    create_resp = client.post("/users", headers=headers, json={
        "username": "fetchuser",
        "full_name": "Fetch User",
        "email": "fetch@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    })
    user_id = create_resp.json()["id"]

    response = client.get(f"/users/{user_id}", headers=headers)
    assert response.status_code == 200
    assert response.json()["username"] == "fetchuser"


def test_update_user(client, db):
    headers = get_auth_header(client, db)
    create_resp = client.post("/users", headers=headers, json={
        "username": "updateme",
        "full_name": "Old Name",
        "email": "update@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    })
    user_id = create_resp.json()["id"]

    response = client.put(f"/users/{user_id}", headers=headers, json={
        "username": "updateme",
        "full_name": "New Name",
        "email": "update@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    })
    assert response.status_code == 200
    assert response.json()["full_name"] == "New Name"


def test_delete_user(client, db):
    headers = get_auth_header(client, db)
    create_resp = client.post("/users", headers=headers, json={
        "username": "deleteme",
        "full_name": "Delete Me",
        "email": "delete@test.com",
        "password": "StrongPass123!",
        "status": "Active",
    })
    user_id = create_resp.json()["id"]

    response = client.delete(f"/users/{user_id}", headers=headers)
    assert response.status_code == 200
