"""Operation Entry location dropdowns.

Operation Entry fills its Origin / Sender fields with the signed-in user's own
location, while Destination / Receiver must offer **every** location in the
system, because a ticket can be addressed to another terminal.

The page used to request the whole location master in one call
(``/locations?all_locations=true&limit=500``). The endpoint capped ``limit`` at
200 and answered 422; the frontend swallowed the failure, so
``allSystemLocations`` stayed empty and the Destination / Receiver dropdowns
silently fell back to the user's own (location-scoped) list.

These tests pin the contract so the regression cannot come back unnoticed.
"""

from app.models import Location, UserLocation
from app.utils.jwt import create_access_token
from app.utils.pagination import MAX_LIST_LIMIT, SCOPED_PAGE_SIZE
from tests.conftest import create_role_with_permission, create_user

VIEW_LOCATION = "View Location"


def _headers(user):
    token = create_access_token({"user_id": user.id, "username": user.username})
    return {"Authorization": f"Bearer {token}"}


def _seed_locations(db, extra_codes=()):
    db.add_all(
        [
            Location(location_code="AGGE", location_name="Agge Terminal", location_type="Terminal", status="Active"),
            Location(location_code="LEKKI", location_name="Lekki Terminal", location_type="Terminal", status="Active"),
            Location(location_code="BONNY", location_name="Bonny Terminal", location_type="Terminal", status="Active"),
            Location(location_code="OLD", location_name="Old Terminal", location_type="Terminal", status="Inactive"),
        ]
    )
    db.add_all(
        [
            Location(
                location_code=code,
                location_name=f"{code} Terminal",
                location_type="Terminal",
                status="Active",
            )
            for code in extra_codes
        ]
    )
    db.flush()


def _scoped_user(db, permission=VIEW_LOCATION, assigned=("AGGE",), username="entry_op"):
    """A single-location user - the exact profile that reported the problem."""
    role, _ = create_role_with_permission(db, f"Role {username}", permission, "Location Master")
    user = create_user(db, username=username, roles=[role])
    for code in assigned:
        db.add(UserLocation(user_id=user.id, location_code=code))
    db.flush()
    return user


def test_full_list_request_returns_every_location(client, db):
    """The request Operation Entry makes to fill Destination / Receiver."""
    _seed_locations(db)
    user = _scoped_user(db)
    db.commit()

    response = client.get(
        f"/locations?skip=0&limit=500&all_locations=true", headers=_headers(user)
    )

    assert response.status_code == 200, response.text
    codes = sorted(item["location_code"] for item in response.json()["items"])
    assert codes == ["AGGE", "BONNY", "LEKKI", "OLD"]


def test_paging_covers_every_location_beyond_one_page(client, db):
    """`getAllLocations()` pages until `has_more` is false - check it sees all."""
    extra = [f"TERM{i:03d}" for i in range(1, 260)]
    _seed_locations(db, extra_codes=extra)
    user = _scoped_user(db)
    db.commit()

    seen = []
    skip = 0
    while True:
        response = client.get(
            f"/locations?skip={skip}&limit=200&all_locations=true",
            headers=_headers(user),
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        seen.extend(item["location_code"] for item in payload["items"])
        if not payload["has_more"]:
            break
        skip += len(payload["items"])

    assert len(seen) == len(set(seen)) == 4 + len(extra)


def test_scoped_browsing_still_hides_other_locations(client, db):
    """Without `all_locations` the Location Master stays inside the user scope."""
    _seed_locations(db)
    user = _scoped_user(db)
    db.commit()

    response = client.get("/locations?skip=0&limit=200", headers=_headers(user))

    assert response.status_code == 200, response.text
    codes = sorted(item["location_code"] for item in response.json()["items"])
    assert codes == ["AGGE"]


def test_scoped_browsing_page_size_is_still_capped(client, db):
    """The reference-data mode may page large; scoped browsing keeps its cap."""
    extra = [f"TERM{i:03d}" for i in range(1, 260)]
    _seed_locations(db, extra_codes=extra)
    user = _scoped_user(db, assigned=("AGGE", *extra))
    db.commit()

    response = client.get("/locations?skip=0&limit=1000", headers=_headers(user))

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["limit"] == SCOPED_PAGE_SIZE
    assert len(payload["items"]) == SCOPED_PAGE_SIZE
    assert payload["has_more"] is True


def test_out_of_range_limit_is_clamped_not_rejected(client, db):
    _seed_locations(db)
    user = _scoped_user(db)
    db.commit()

    response = client.get(
        f"/locations?skip=0&limit={MAX_LIST_LIMIT + 500}&all_locations=true",
        headers=_headers(user),
    )

    assert response.status_code == 200, response.text
    assert response.json()["limit"] == MAX_LIST_LIMIT


def test_full_list_still_requires_view_location_permission(client, db):
    """Permission dependency behind the same symptom - documented, not assumed."""
    _seed_locations(db)
    user = _scoped_user(db, permission="Create Operation Entry", username="no_view_loc")
    db.commit()

    for endpoint in ("/locations?skip=0&limit=200", "/locations?skip=0&limit=200&all_locations=true"):
        response = client.get(endpoint, headers=_headers(user))
        assert response.status_code == 403, response.text
        assert "View Location" in response.json()["detail"]
