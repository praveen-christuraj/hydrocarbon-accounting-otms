from sqlalchemy.orm import Session

from app.models import Location, Asset, OperationTransaction, User


def normalize_code(value: str):
    return str(value or "").strip().upper()


def normalize_yes_no(value):
    normalized = str(value or "").strip().lower()
    if normalized in {"yes", "true", "1", "y"}:
        return "Yes"
    return "No"


def clean_optional_text(value):
    if value is None:
        return None

    cleaned_value = str(value).strip()

    if cleaned_value == "":
        return None

    return cleaned_value


def get_transaction_ticket_number(transaction: OperationTransaction):
    return transaction.operation_ticket_number or transaction.operation_number or ""


def get_current_user_display_name(current_user: User):
    full_name = str(current_user.full_name or "").strip()
    username = str(current_user.username or "").strip()
    if full_name and username:
        return f"{full_name} ({username})"
    if full_name:
        return full_name
    return username


def get_location_name_by_code(location_code: str | None, db: Session):
    location = get_location_by_code(location_code, db)
    return location.location_name if location else None


def get_location_by_code(location_code: str | None, db: Session):
    if not location_code:
        return None

    return db.query(Location).filter(
        Location.location_code == location_code
    ).first()


def safe_float(value, default_value: float = 0):
    try:
        if value is None:
            return default_value

        if str(value).strip() == "":
            return default_value

        return float(value)
    except (TypeError, ValueError):
        return default_value


def get_current_user_label(current_user: User):
    return get_current_user_display_name(current_user)


def get_asset_by_code(asset_code: str | None, db: Session):
    if not asset_code:
        return None

    return db.query(Asset).filter(
        Asset.asset_code == asset_code
    ).first()
