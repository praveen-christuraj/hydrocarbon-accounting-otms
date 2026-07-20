from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, SystemNotification, SystemNotificationReceipt, UserRole, AssetAssignment
from app.schemas import (
    SystemNotificationCreate,
    SystemNotificationUpdate,
    SystemNotificationActionRequest,
    SystemNotificationResponse,
    SystemNotificationReceiptResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, normalize_yes_no, get_current_user_display_name

router = APIRouter(prefix="/system-notifications", tags=["System Notifications"])

SYSTEM_NOTIFICATION_TYPES = {"Info", "Warning", "Critical", "Success", "Maintenance", "Circular"}
SYSTEM_NOTIFICATION_PRIORITIES = {"Low", "Normal", "High", "Critical"}
SYSTEM_NOTIFICATION_DELIVERY_MODES = {
    "Banner",
    "Popup",
    "Inbox",
    "Banner + Inbox",
    "Popup + Inbox",
}
SYSTEM_NOTIFICATION_TARGET_SCOPES = {
    "All Users",
    "Roles",
    "Specific Users",
    "Locations",
    "Roles + Locations",
}
SYSTEM_NOTIFICATION_STATUSES = {"Draft", "Published", "Scheduled", "Expired", "Deactivated"}


def bool_to_yes_no(value):
    return "Yes" if bool(value) else "No"


def yes_no_to_bool(value):
    return normalize_yes_no(value) == "Yes"


def generate_system_notification_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"NOTIF-{today}"
    count = (
        db.query(SystemNotification)
        .filter(SystemNotification.notification_number.ilike(f"{prefix}%"))
        .count()
    )
    return f"{prefix}-{count + 1:04d}"


def validate_system_notification_payload(payload):
    title = clean_optional_text(payload.title)
    message = clean_optional_text(payload.message)
    if not title:
        raise HTTPException(status_code=400, detail="Notification title is required")
    if not message:
        raise HTTPException(status_code=400, detail="Notification message is required")

    notification_type = clean_optional_text(payload.notification_type) or "Info"
    priority = clean_optional_text(payload.priority) or "Normal"
    delivery_mode = clean_optional_text(payload.delivery_mode) or "Banner + Inbox"
    target_scope = clean_optional_text(payload.target_scope) or "All Users"

    if notification_type not in SYSTEM_NOTIFICATION_TYPES:
        raise HTTPException(status_code=400, detail="Invalid notification type")
    if priority not in SYSTEM_NOTIFICATION_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid notification priority")
    if delivery_mode not in SYSTEM_NOTIFICATION_DELIVERY_MODES:
        raise HTTPException(status_code=400, detail="Invalid delivery mode")
    if target_scope not in SYSTEM_NOTIFICATION_TARGET_SCOPES:
        raise HTTPException(status_code=400, detail="Invalid target scope")

    display_from = payload.display_from
    display_until = payload.display_until
    if display_from and display_until and display_from > display_until:
        raise HTTPException(status_code=400, detail="Display From cannot be later than Display Until")

    auto_dismiss_seconds = payload.auto_dismiss_seconds
    if auto_dismiss_seconds is not None and auto_dismiss_seconds < 0:
        raise HTTPException(status_code=400, detail="Auto dismiss seconds cannot be negative")

    target_role_ids = list(payload.target_role_ids or [])
    target_user_ids = list(payload.target_user_ids or [])
    target_location_codes = [
        str(code).strip()
        for code in (payload.target_location_codes or [])
        if str(code).strip() != ""
    ]

    if target_scope == "Roles" and not target_role_ids:
        raise HTTPException(status_code=400, detail="At least one role is required for role-targeted notification")
    if target_scope == "Specific Users" and not target_user_ids:
        raise HTTPException(status_code=400, detail="At least one user is required for user-targeted notification")
    if target_scope in {"Locations", "Roles + Locations"} and not target_location_codes:
        raise HTTPException(status_code=400, detail="At least one location is required for location-targeted notification")

    return {
        "title": title,
        "message": message,
        "notification_type": notification_type,
        "priority": priority,
        "delivery_mode": delivery_mode,
        "target_scope": target_scope,
        "target_role_ids": target_role_ids,
        "target_user_ids": target_user_ids,
        "target_location_codes": target_location_codes,
        "display_from": display_from,
        "display_until": display_until,
        "requires_acknowledgement": bool(payload.requires_acknowledgement),
        "popup_enabled": bool(payload.popup_enabled),
        "banner_enabled": bool(payload.banner_enabled),
        "auto_dismiss_seconds": auto_dismiss_seconds,
    }


def get_user_location_codes(db: Session, user: User):
    username = str(user.username or "").strip()
    full_name = str(user.full_name or "").strip()
    candidates = [value for value in {username, full_name} if value]
    if not candidates:
        return set()

    rows = (
        db.query(AssetAssignment.assignment_location_code)
        .filter(
            AssetAssignment.status == "Active",
            AssetAssignment.assigned_to.in_(candidates),
        )
        .all()
    )
    return {str(row[0] or "").strip() for row in rows if str(row[0] or "").strip()}


def get_user_role_id(db: Session, user: User):
    row = db.query(UserRole).filter(UserRole.user_id == user.id).first()
    return row.role_id if row else None


def notification_targets_user(db: Session, notification: SystemNotification, user: User):
    target_scope = notification.target_scope or "All Users"
    if target_scope == "All Users":
        return True

    target_user_ids = set(notification.target_user_ids_json or [])
    if target_scope == "Specific Users":
        return user.id in target_user_ids

    target_role_ids = set(notification.target_role_ids_json or [])
    user_role_id = get_user_role_id(db, user)
    role_match = user_role_id in target_role_ids if user_role_id else False

    target_location_codes = {
        str(code or "").strip()
        for code in (notification.target_location_codes_json or [])
        if str(code or "").strip()
    }
    user_location_codes = get_user_location_codes(db, user)
    location_match = bool(target_location_codes.intersection(user_location_codes))

    if target_scope == "Roles":
        return role_match
    if target_scope == "Locations":
        return location_match
    if target_scope == "Roles + Locations":
        return role_match and location_match

    return False


def is_notification_display_active(notification: SystemNotification, now: datetime | None = None):
    current_time = now or datetime.now()
    if notification.status not in {"Published", "Scheduled"}:
        return False
    if notification.display_from and notification.display_from > current_time:
        return False
    if notification.display_until and notification.display_until < current_time:
        return False
    return True


def get_or_create_notification_receipt(db: Session, notification: SystemNotification, user: User):
    receipt = (
        db.query(SystemNotificationReceipt)
        .filter(
            SystemNotificationReceipt.notification_id == notification.id,
            SystemNotificationReceipt.user_id == user.id,
        )
        .first()
    )
    if receipt:
        return receipt

    receipt = SystemNotificationReceipt(
        notification_id=notification.id,
        user_id=user.id,
        username=user.username,
        delivered_at=datetime.now(),
        status="Unread",
    )
    db.add(receipt)
    db.flush()
    return receipt


def touch_notification_seen(receipt: SystemNotificationReceipt):
    now = datetime.now()
    if not receipt.first_seen_at:
        receipt.first_seen_at = now
    receipt.last_seen_at = now
    if receipt.status == "Unread":
        receipt.status = "Seen"
    receipt.updated_at = now


def build_system_notification_response(
    notification: SystemNotification,
    db: Session,
    receipt: SystemNotificationReceipt | None = None,
):
    base_receipt_query = db.query(SystemNotificationReceipt).filter(
        SystemNotificationReceipt.notification_id == notification.id
    )
    delivery_count = base_receipt_query.count()
    seen_count = base_receipt_query.filter(
        SystemNotificationReceipt.first_seen_at != None
    ).count()
    acknowledged_count = base_receipt_query.filter(
        SystemNotificationReceipt.acknowledged_at != None
    ).count()
    dismissed_count = base_receipt_query.filter(
        SystemNotificationReceipt.dismissed_at != None
    ).count()

    return {
        "id": notification.id,
        "notification_number": notification.notification_number,
        "title": notification.title,
        "message": notification.message,
        "notification_type": notification.notification_type,
        "priority": notification.priority,
        "delivery_mode": notification.delivery_mode,
        "target_scope": notification.target_scope,
        "target_role_ids": notification.target_role_ids_json or [],
        "target_user_ids": notification.target_user_ids_json or [],
        "target_location_codes": notification.target_location_codes_json or [],
        "display_from": notification.display_from,
        "display_until": notification.display_until,
        "requires_acknowledgement": yes_no_to_bool(notification.requires_acknowledgement),
        "popup_enabled": yes_no_to_bool(notification.popup_enabled),
        "banner_enabled": yes_no_to_bool(notification.banner_enabled),
        "auto_dismiss_seconds": notification.auto_dismiss_seconds,
        "status": notification.status,
        "created_by_user_id": notification.created_by_user_id,
        "created_by_display": notification.created_by_display,
        "published_at": notification.published_at,
        "deactivated_at": notification.deactivated_at,
        "deactivation_reason": notification.deactivation_reason,
        "created_at": notification.created_at,
        "updated_at": notification.updated_at,
        "receipt_status": receipt.status if receipt else None,
        "first_seen_at": receipt.first_seen_at if receipt else None,
        "dismissed_at": receipt.dismissed_at if receipt else None,
        "acknowledged_at": receipt.acknowledged_at if receipt else None,
        "delivery_count": delivery_count,
        "seen_count": seen_count,
        "acknowledged_count": acknowledged_count,
        "dismissed_count": dismissed_count,
    }


def get_target_users_for_notification(db: Session, notification: SystemNotification):
    users = db.query(User).filter(User.status == "Active").order_by(User.id.asc()).all()
    return [user for user in users if notification_targets_user(db, notification, user)]


def ensure_notification_can_be_changed(notification: SystemNotification):
    if notification.status in {"Deactivated", "Expired"}:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change {notification.status} notification",
        )


@router.get("", response_model=list[SystemNotificationResponse])
def get_system_notifications(
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View System Notification", db)
    query = db.query(SystemNotification)
    cleaned_status = clean_optional_text(status)
    if cleaned_status and cleaned_status != "ALL":
        query = query.filter(SystemNotification.status == cleaned_status)
    rows = query.order_by(SystemNotification.created_at.desc(), SystemNotification.id.desc()).all()
    return [build_system_notification_response(row, db) for row in rows]


@router.post("", response_model=SystemNotificationResponse)
def create_system_notification(
    payload: SystemNotificationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage System Notification", db)
    data = validate_system_notification_payload(payload)
    status = clean_optional_text(getattr(payload, "status", None)) or "Draft"
    if status not in {"Draft", "Scheduled"}:
        status = "Draft"

    notification = SystemNotification(
        notification_number=generate_system_notification_number(db),
        title=data["title"],
        message=data["message"],
        notification_type=data["notification_type"],
        priority=data["priority"],
        delivery_mode=data["delivery_mode"],
        target_scope=data["target_scope"],
        target_role_ids_json=data["target_role_ids"],
        target_user_ids_json=data["target_user_ids"],
        target_location_codes_json=data["target_location_codes"],
        display_from=data["display_from"],
        display_until=data["display_until"],
        requires_acknowledgement=bool_to_yes_no(data["requires_acknowledgement"]),
        popup_enabled=bool_to_yes_no(data["popup_enabled"]),
        banner_enabled=bool_to_yes_no(data["banner_enabled"]),
        auto_dismiss_seconds=data["auto_dismiss_seconds"],
        status=status,
        created_by_user_id=current_user.id,
        created_by_display=get_current_user_display_name(current_user),
    )
    db.add(notification)
    db.flush()

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Create System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        new_status=notification.status,
        remarks=notification.title,
        request_path="/system-notifications",
        details=data,
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db)


@router.put("/{notification_id}", response_model=SystemNotificationResponse)
def update_system_notification(
    notification_id: int,
    payload: SystemNotificationUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage System Notification", db)
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="System notification not found")
    if notification.status == "Published":
        raise HTTPException(status_code=400, detail="Published notifications cannot be edited. Deactivate and create a new circular if needed.")
    ensure_notification_can_be_changed(notification)

    data = validate_system_notification_payload(payload)
    old_status = notification.status
    requested_status = clean_optional_text(getattr(payload, "status", None))
    if requested_status in SYSTEM_NOTIFICATION_STATUSES and requested_status != "Published":
        notification.status = requested_status

    notification.title = data["title"]
    notification.message = data["message"]
    notification.notification_type = data["notification_type"]
    notification.priority = data["priority"]
    notification.delivery_mode = data["delivery_mode"]
    notification.target_scope = data["target_scope"]
    notification.target_role_ids_json = data["target_role_ids"]
    notification.target_user_ids_json = data["target_user_ids"]
    notification.target_location_codes_json = data["target_location_codes"]
    notification.display_from = data["display_from"]
    notification.display_until = data["display_until"]
    notification.requires_acknowledgement = bool_to_yes_no(data["requires_acknowledgement"])
    notification.popup_enabled = bool_to_yes_no(data["popup_enabled"])
    notification.banner_enabled = bool_to_yes_no(data["banner_enabled"])
    notification.auto_dismiss_seconds = data["auto_dismiss_seconds"]
    notification.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Update System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        old_status=old_status,
        new_status=notification.status,
        remarks=notification.title,
        request_path=f"/system-notifications/{notification_id}",
        details=data,
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db)


@router.post("/{notification_id}/publish", response_model=SystemNotificationResponse)
def publish_system_notification(
    notification_id: int,
    payload: SystemNotificationActionRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Publish System Notification", db)
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="System notification not found")
    ensure_notification_can_be_changed(notification)
    if notification.status == "Published":
        return build_system_notification_response(notification, db)

    old_status = notification.status
    notification.status = "Scheduled" if notification.display_from and notification.display_from > datetime.now() else "Published"
    notification.published_at = datetime.now()
    notification.updated_at = datetime.now()

    target_users = get_target_users_for_notification(db, notification)
    for user in target_users:
        get_or_create_notification_receipt(db, notification, user)

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Publish System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        old_status=old_status,
        new_status=notification.status,
        remarks=payload.remarks if payload else notification.title,
        request_path=f"/system-notifications/{notification_id}/publish",
        details={
            "target_user_count": len(target_users),
            "target_scope": notification.target_scope,
            "delivery_mode": notification.delivery_mode,
            "priority": notification.priority,
        },
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db)


@router.post("/{notification_id}/deactivate", response_model=SystemNotificationResponse)
def deactivate_system_notification(
    notification_id: int,
    payload: SystemNotificationActionRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Deactivate System Notification", db)
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="System notification not found")
    if notification.status == "Deactivated":
        return build_system_notification_response(notification, db)

    old_status = notification.status
    remarks = clean_optional_text(payload.remarks if payload else None) or "Notification deactivated"
    notification.status = "Deactivated"
    notification.deactivated_at = datetime.now()
    notification.deactivated_by_user_id = current_user.id
    notification.deactivation_reason = remarks
    notification.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Deactivate System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        old_status=old_status,
        new_status=notification.status,
        remarks=remarks,
        request_path=f"/system-notifications/{notification_id}/deactivate",
        details={"title": notification.title},
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db)


@router.get("/my", response_model=list[SystemNotificationResponse])
def get_my_system_notifications(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    notifications = (
        db.query(SystemNotification)
        .filter(SystemNotification.status.in_(["Published", "Scheduled"]))
        .order_by(SystemNotification.created_at.desc(), SystemNotification.id.desc())
        .all()
    )
    output = []
    for notification in notifications:
        if not notification_targets_user(db, notification, current_user):
            continue
        receipt = get_or_create_notification_receipt(db, notification, current_user)
        output.append(build_system_notification_response(notification, db, receipt))
    db.commit()
    return output


@router.get("/active", response_model=list[SystemNotificationResponse])
def get_active_system_notifications(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    notifications = (
        db.query(SystemNotification)
        .filter(SystemNotification.status.in_(["Published", "Scheduled"]))
        .order_by(SystemNotification.priority.desc(), SystemNotification.created_at.desc())
        .all()
    )
    output = []
    for notification in notifications:
        if not is_notification_display_active(notification):
            continue
        if not notification_targets_user(db, notification, current_user):
            continue
        receipt = get_or_create_notification_receipt(db, notification, current_user)
        if receipt.status in {"Dismissed", "Acknowledged"} and not yes_no_to_bool(notification.requires_acknowledgement):
            continue
        touch_notification_seen(receipt)
        output.append(build_system_notification_response(notification, db, receipt))
    db.commit()
    return output


@router.post("/{notification_id}/dismiss", response_model=SystemNotificationResponse)
def dismiss_system_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification or not notification_targets_user(db, notification, current_user):
        raise HTTPException(status_code=404, detail="System notification not found")
    if yes_no_to_bool(notification.requires_acknowledgement):
        raise HTTPException(status_code=400, detail="This notification requires acknowledgement and cannot be dismissed")

    receipt = get_or_create_notification_receipt(db, notification, current_user)
    old_status = receipt.status
    receipt.status = "Dismissed"
    receipt.dismissed_at = datetime.now()
    receipt.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Dismiss System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        old_status=old_status,
        new_status=receipt.status,
        remarks=notification.title,
        request_path=f"/system-notifications/{notification_id}/dismiss",
        details={"receipt_id": receipt.id},
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db, receipt)


@router.post("/{notification_id}/acknowledge", response_model=SystemNotificationResponse)
def acknowledge_system_notification(
    notification_id: int,
    payload: SystemNotificationActionRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification or not notification_targets_user(db, notification, current_user):
        raise HTTPException(status_code=404, detail="System notification not found")

    receipt = get_or_create_notification_receipt(db, notification, current_user)
    old_status = receipt.status
    receipt.status = "Acknowledged"
    receipt.acknowledged_at = datetime.now()
    receipt.acknowledgement_remarks = clean_optional_text(payload.remarks if payload else None)
    receipt.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="System Notification",
        action="Acknowledge System Notification",
        current_user=current_user,
        entity_type="SystemNotification",
        entity_id=notification.id,
        entity_label=notification.notification_number,
        old_status=old_status,
        new_status=receipt.status,
        remarks=notification.title,
        request_path=f"/system-notifications/{notification_id}/acknowledge",
        details={"receipt_id": receipt.id, "remarks": receipt.acknowledgement_remarks},
    )
    db.commit()
    db.refresh(notification)
    return build_system_notification_response(notification, db, receipt)


@router.get("/{notification_id}/delivery-report", response_model=list[SystemNotificationReceiptResponse])
def get_system_notification_delivery_report(
    notification_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View System Notification Delivery Report", db)
    notification = db.query(SystemNotification).filter(SystemNotification.id == notification_id).first()
    if not notification:
        raise HTTPException(status_code=404, detail="System notification not found")
    return (
        db.query(SystemNotificationReceipt)
        .filter(SystemNotificationReceipt.notification_id == notification_id)
        .order_by(SystemNotificationReceipt.delivered_at.desc(), SystemNotificationReceipt.id.desc())
        .all()
    )
