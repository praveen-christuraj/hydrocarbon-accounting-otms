from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AssetAssignment, Asset, Location, User
from app.schemas import AssetAssignmentCreate, AssetAssignmentResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/asset-assignments", tags=["Asset Assignments"])


def _batch_load_references(db: Session, assignments: list):
    asset_codes = {a.asset_code for a in assignments}
    location_codes = {a.assignment_location_code for a in assignments}
    user_names = {a.assigned_to for a in assignments if a.assigned_to_type == "User"}

    assets = {
        a.asset_code: a
        for a in db.query(Asset).filter(Asset.asset_code.in_(asset_codes)).all()
    }
    locations = {
        l.location_code: l
        for l in db.query(Location).filter(Location.location_code.in_(location_codes)).all()
    }
    users = {}
    if user_names:
        users = {
            u.username: u
            for u in db.query(User).filter(User.username.in_(user_names)).all()
        }
    return assets, locations, users


def build_asset_assignment_response(assignment: AssetAssignment, assets: dict, locations: dict, users: dict):
    asset = assets.get(assignment.asset_code)
    location = locations.get(assignment.assignment_location_code)
    assigned_to_display = assignment.assigned_to
    if assignment.assigned_to_type == "User":
        assigned_user = users.get(assignment.assigned_to)
        if assigned_user:
            assigned_to_display = f"{assigned_user.full_name} ({assigned_user.username})"
    return {
        "id": assignment.id,
        "asset_code": assignment.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "asset_scope": assignment.asset_scope,
        "assignment_location_code": assignment.assignment_location_code,
        "assignment_location_name": location.location_name if location else "",
        "assigned_to_type": assignment.assigned_to_type,
        "assigned_to": assignment.assigned_to,
        "assigned_to_display": assigned_to_display,
        "assignment_date": assignment.assignment_date,
        "return_date": assignment.return_date,
        "remarks": assignment.remarks,
        "status": assignment.status,
        "created_at": assignment.created_at,
        "updated_at": assignment.updated_at,
    }


def build_asset_assignment_audit_snapshot(assignment: AssetAssignment, assets: dict, locations: dict, users: dict):
    asset = assets.get(assignment.asset_code)
    location = locations.get(assignment.assignment_location_code)
    assigned_user_display = None
    if assignment.assigned_to_type == "User":
        assigned_user = users.get(assignment.assigned_to)
        if assigned_user:
            assigned_user_display = f"{assigned_user.full_name} ({assigned_user.username})"
    return {
        "id": assignment.id,
        "asset_code": assignment.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "asset_scope": assignment.asset_scope,
        "assignment_location_code": assignment.assignment_location_code,
        "assignment_location_name": location.location_name if location else "",
        "assigned_to_type": assignment.assigned_to_type,
        "assigned_to": assignment.assigned_to,
        "assigned_to_display": assigned_user_display or assignment.assigned_to,
        "assignment_date": str(assignment.assignment_date) if assignment.assignment_date else None,
        "return_date": str(assignment.return_date) if assignment.return_date else None,
        "remarks": assignment.remarks,
        "status": assignment.status,
    }


def validate_asset_assignment(
    assignment: AssetAssignmentCreate,
    db: Session,
    assignment_id: int | None = None,
):
    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(assignment.asset_code))
        .first()
    )

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    if asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active assets can be assigned",
        )

    if asset.asset_scope != assignment.asset_scope:
        raise HTTPException(
            status_code=400,
            detail="Selected asset scope does not match Asset Master",
        )

    location = (
        db.query(Location)
        .filter(
            Location.location_code.ilike(
                assignment.assignment_location_code
            )
        )
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=400,
            detail="Assignment location not found",
        )

    if location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active locations can be used for assignment",
        )

    if assignment.assigned_to_type not in ["User", "Location", "External"]:
        raise HTTPException(
            status_code=400,
            detail="Assigned To Type must be User, Location, or External",
        )

    if assignment.assigned_to.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Assigned To is required",
        )

    if assignment.assigned_to_type == "User":
        assigned_user = (
            db.query(User)
            .filter(User.username.ilike(assignment.assigned_to))
            .first()
        )

        if not assigned_user:
            raise HTTPException(
                status_code=400,
                detail="Assigned user not found",
            )

        if assigned_user.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active users can be assigned",
            )

    if assignment.assigned_to_type == "Location":
        assigned_location = (
            db.query(Location)
            .filter(Location.location_code.ilike(assignment.assigned_to))
            .first()
        )

        if not assigned_location:
            raise HTTPException(
                status_code=400,
                detail="Assigned location not found",
            )

        if assigned_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active locations can be assigned",
            )

    active_assignment_query = db.query(AssetAssignment).filter(
        AssetAssignment.asset_code.ilike(assignment.asset_code),
        AssetAssignment.status == "Active",
    )

    if assignment_id is not None:
        active_assignment_query = active_assignment_query.filter(
            AssetAssignment.id != assignment_id
        )

    active_assignment = active_assignment_query.first()

    if active_assignment and assignment.status == "Active":
        raise HTTPException(
            status_code=400,
            detail="This asset already has an active assignment",
        )


@router.get("", response_model=list[AssetAssignmentResponse])
def get_asset_assignments(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Assignment",
        db,
    )

    assignments = (
        db.query(AssetAssignment)
        .order_by(AssetAssignment.id)
        .all()
    )

    assets, locations, users = _batch_load_references(db, assignments)

    return [
        build_asset_assignment_response(assignment, assets, locations, users)
        for assignment in assignments
    ]


@router.post("", response_model=AssetAssignmentResponse)
def create_asset_assignment(
    assignment: AssetAssignmentCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Assignment",
        db,
    )

    validate_asset_assignment(assignment, db)

    new_assignment = AssetAssignment(
        asset_code=assignment.asset_code.strip(),
        asset_scope=assignment.asset_scope,
        assignment_location_code=assignment.assignment_location_code.strip(),
        assigned_to_type=assignment.assigned_to_type,
        assigned_to=assignment.assigned_to.strip(),
        assignment_date=assignment.assignment_date,
        return_date=assignment.return_date,
        remarks=clean_optional_text(assignment.remarks),
        status=assignment.status,
    )

    db.add(new_assignment)
    db.flush()

    assets, locations, users = _batch_load_references(db, [new_assignment])
    after_data = build_asset_assignment_audit_snapshot(new_assignment, assets, locations, users)

    create_audit_log(
        db=db,
        module_name="Asset Assignment",
        action="Create Asset Assignment",
        current_user=current_user,
        entity_type="AssetAssignment",
        entity_id=new_assignment.id,
        entity_label=f"{after_data.get('asset_name','')} ({new_assignment.asset_code})",
        remarks="Asset assignment created",
        request_path="/asset-assignments",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_assignment)

    assets, locations, users = _batch_load_references(db, [new_assignment])
    return build_asset_assignment_response(new_assignment, assets, locations, users)


@router.put("/{assignment_id}", response_model=AssetAssignmentResponse)
def update_asset_assignment(
    assignment_id: int,
    assignment: AssetAssignmentCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Assignment",
        db,
    )

    existing_assignment = (
        db.query(AssetAssignment)
        .filter(AssetAssignment.id == assignment_id)
        .first()
    )

    if not existing_assignment:
        raise HTTPException(
            status_code=404,
            detail="Asset assignment not found",
        )

    assets, locations, users = _batch_load_references(db, [existing_assignment])
    before_data = build_asset_assignment_audit_snapshot(existing_assignment, assets, locations, users)

    validate_asset_assignment(assignment, db, assignment_id)

    existing_assignment.asset_code = assignment.asset_code.strip()
    existing_assignment.asset_scope = assignment.asset_scope
    existing_assignment.assignment_location_code = (
        assignment.assignment_location_code.strip()
    )
    existing_assignment.assigned_to_type = assignment.assigned_to_type
    existing_assignment.assigned_to = assignment.assigned_to.strip()
    existing_assignment.assignment_date = assignment.assignment_date
    existing_assignment.return_date = assignment.return_date
    existing_assignment.remarks = clean_optional_text(assignment.remarks)
    existing_assignment.status = assignment.status

    db.flush()

    assets, locations, users = _batch_load_references(db, [existing_assignment])
    after_data = build_asset_assignment_audit_snapshot(existing_assignment, assets, locations, users)

    create_audit_log(
        db=db,
        module_name="Asset Assignment",
        action="Update Asset Assignment",
        current_user=current_user,
        entity_type="AssetAssignment",
        entity_id=existing_assignment.id,
        entity_label=f"{after_data.get('asset_name','')} ({existing_assignment.asset_code})",
        remarks="Asset assignment updated",
        request_path=f"/asset-assignments/{assignment_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_assignment)

    assets, locations, users = _batch_load_references(db, [existing_assignment])
    return build_asset_assignment_response(existing_assignment, assets, locations, users)


@router.delete("/{assignment_id}")
def delete_asset_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Assignment",
        db,
    )

    existing_assignment = (
        db.query(AssetAssignment)
        .filter(AssetAssignment.id == assignment_id)
        .first()
    )

    if not existing_assignment:
        raise HTTPException(
            status_code=404,
            detail="Asset assignment not found",
        )

    assets, locations, users = _batch_load_references(db, [existing_assignment])
    deleted_data = build_asset_assignment_audit_snapshot(existing_assignment, assets, locations, users)

    create_audit_log(
        db=db,
        module_name="Asset Assignment",
        action="Delete Asset Assignment",
        current_user=current_user,
        entity_type="AssetAssignment",
        entity_id=existing_assignment.id,
        entity_label=f"{deleted_data.get('asset_name','')} ({existing_assignment.asset_code})",
        remarks="Asset assignment deleted",
        request_path=f"/asset-assignments/{assignment_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_assignment)
    db.commit()

    return {
        "message": "Asset assignment deleted successfully"
    }