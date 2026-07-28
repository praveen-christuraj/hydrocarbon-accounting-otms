from datetime import date

import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def _disable_db_setup():
    yield


from app.routers.export_operations import (
    build_delete_blocker_error,
    is_quarter_expired,
    validate_permit_limit,
)


def test_validate_permit_limit_blocks_without_override():
    with pytest.raises(HTTPException) as exc:
        validate_permit_limit(
            required_volume=50,
            remaining_volume=40,
            permit_number="P-001",
            block_code="B-1",
            override=False,
        )
    assert "insufficient remaining volume" in str(exc.value.detail).lower()


def test_validate_permit_limit_allows_with_override():
    assert validate_permit_limit(
        required_volume=50,
        remaining_volume=40,
        permit_number="P-001",
        block_code="B-1",
        override=True,
    ) is None


def test_build_delete_blocker_error_for_entity_with_active_blocks():
    with pytest.raises(HTTPException) as exc:
        build_delete_blocker_error("entity", has_active_blocks=True)
    assert "active blocks" in str(exc.value.detail).lower()


def test_build_delete_blocker_error_for_location_with_active_entities():
    with pytest.raises(HTTPException) as exc:
        build_delete_blocker_error("location", has_active_entities=True)
    assert "active entities" in str(exc.value.detail).lower()


def test_is_quarter_expired_for_past_quarter():
    assert is_quarter_expired("Q1_2024", as_of_date=None) is True


def test_is_quarter_expired_for_current_quarter():
    today = date.today()
    current_year = today.year
    current_quarter = f"Q{((today.month - 1) // 3) + 1}_{current_year}"
    assert is_quarter_expired(current_quarter, as_of_date=today) is False
    future_quarter = f"Q{((today.month - 1) // 3) + 2 if ((today.month - 1) // 3) + 2 <= 4 else 1}_{current_year if ((today.month - 1) // 3) + 2 <= 4 else current_year + 1}"
    assert is_quarter_expired(future_quarter, as_of_date=today) is False
