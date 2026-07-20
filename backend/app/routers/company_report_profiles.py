from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CompanyReportProfile, User
from app.schemas import CompanyReportProfileCreate, CompanyReportProfileResponse
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text

router = APIRouter(prefix="/company-report-profiles", tags=["Company Report Profiles"])

VALID_COMPANY_REPORT_PROFILE_STATUSES = [
    "Active",
    "Inactive",
    "Blocked",
]


def build_company_report_profile_response(profile: CompanyReportProfile):
    return {
        "id": profile.id,
        "profile_name": profile.profile_name,
        "company_name": profile.company_name,
        "system_name": profile.system_name,
        "report_subtitle": profile.report_subtitle,
        "logo_data_url": profile.logo_data_url,
        "logo_text": profile.logo_text,
        "footer_formula": profile.footer_formula,
        "footer_note": profile.footer_note,
        "status": profile.status,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
    }


def validate_company_report_profile(
    profile: CompanyReportProfileCreate,
):
    if profile.profile_name.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Profile Name is required",
        )

    if profile.company_name.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Company Name is required",
        )

    if profile.system_name.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="System Name is required",
        )

    if profile.report_subtitle.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Report Subtitle is required",
        )

    if profile.logo_text.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Logo placeholder text is required",
        )

    if profile.status not in VALID_COMPANY_REPORT_PROFILE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail="Status must be Active, Inactive, or Blocked",
        )

    if profile.logo_data_url:
        logo_value = profile.logo_data_url.strip()

        if not (
            logo_value.startswith("data:image/png;base64,")
            or logo_value.startswith("data:image/jpeg;base64,")
            or logo_value.startswith("data:image/jpg;base64,")
        ):
            raise HTTPException(
                status_code=400,
                detail="Logo must be a PNG, JPG, or JPEG data URL",
            )

        max_logo_length = 2_000_000

        if len(logo_value) > max_logo_length:
            raise HTTPException(
                status_code=400,
                detail="Logo image is too large. Please upload a smaller PNG/JPG/JPEG file.",
            )


@router.get("", response_model=list[CompanyReportProfileResponse])
def get_company_report_profiles(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Company Report Profile",
        db,
    )

    profiles = (
        db.query(CompanyReportProfile)
        .order_by(CompanyReportProfile.profile_name.asc())
        .all()
    )

    return [
        build_company_report_profile_response(profile)
        for profile in profiles
    ]


@router.post("", response_model=CompanyReportProfileResponse)
def create_company_report_profile(
    profile: CompanyReportProfileCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Company Report Profile",
        db,
    )

    validate_company_report_profile(profile)

    existing_profile = (
        db.query(CompanyReportProfile)
        .filter(CompanyReportProfile.profile_name.ilike(profile.profile_name.strip()))
        .first()
    )

    if existing_profile:
        raise HTTPException(
            status_code=400,
            detail="Report profile name already exists",
        )

    new_profile = CompanyReportProfile(
        profile_name=profile.profile_name.strip(),
        company_name=profile.company_name.strip(),
        system_name=profile.system_name.strip(),
        report_subtitle=profile.report_subtitle.strip(),
        logo_data_url=clean_optional_text(profile.logo_data_url),
        logo_text=profile.logo_text.strip(),
        footer_formula=clean_optional_text(profile.footer_formula),
        footer_note=clean_optional_text(profile.footer_note),
        status=profile.status,
    )

    db.add(new_profile)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Company Report Profile",
        action="Create Company Report Profile",
        current_user=current_user,
        entity_type="CompanyReportProfile",
        entity_id=new_profile.id,
        entity_label=new_profile.profile_name,
        remarks="Company report profile created",
        request_path="/company-report-profiles",
        details={
            "profile_name": new_profile.profile_name,
            "company_name": new_profile.company_name,
            "system_name": new_profile.system_name,
            "report_subtitle": new_profile.report_subtitle,
            "logo_uploaded": bool(new_profile.logo_data_url),
            "logo_text": new_profile.logo_text,
            "footer_formula_available": bool(new_profile.footer_formula),
            "footer_note_available": bool(new_profile.footer_note),
            "status": new_profile.status,
        },
    )

    db.commit()
    db.refresh(new_profile)

    return build_company_report_profile_response(new_profile)


@router.put("/{profile_id}", response_model=CompanyReportProfileResponse)
def update_company_report_profile(
    profile_id: int,
    profile: CompanyReportProfileCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Company Report Profile",
        db,
    )

    existing_profile = (
        db.query(CompanyReportProfile)
        .filter(CompanyReportProfile.id == profile_id)
        .first()
    )

    if not existing_profile:
        raise HTTPException(
            status_code=404,
            detail="Company report profile not found",
        )

    validate_company_report_profile(profile)

    duplicate_profile = (
        db.query(CompanyReportProfile)
        .filter(
            CompanyReportProfile.profile_name.ilike(profile.profile_name.strip()),
            CompanyReportProfile.id != profile_id,
        )
        .first()
    )

    if duplicate_profile:
        raise HTTPException(
            status_code=400,
            detail="Report profile name already exists",
        )

    old_profile_data = {
        "profile_name": existing_profile.profile_name,
        "company_name": existing_profile.company_name,
        "system_name": existing_profile.system_name,
        "report_subtitle": existing_profile.report_subtitle,
        "logo_uploaded": bool(existing_profile.logo_data_url),
        "logo_text": existing_profile.logo_text,
        "footer_formula_available": bool(existing_profile.footer_formula),
        "footer_note_available": bool(existing_profile.footer_note),
        "status": existing_profile.status,
    }

    existing_profile.profile_name = profile.profile_name.strip()
    existing_profile.company_name = profile.company_name.strip()
    existing_profile.system_name = profile.system_name.strip()
    existing_profile.report_subtitle = profile.report_subtitle.strip()
    existing_profile.logo_data_url = clean_optional_text(profile.logo_data_url)
    existing_profile.logo_text = profile.logo_text.strip()
    existing_profile.footer_formula = clean_optional_text(profile.footer_formula)
    existing_profile.footer_note = clean_optional_text(profile.footer_note)
    existing_profile.status = profile.status
    existing_profile.updated_at = datetime.now()

    new_profile_data = {
        "profile_name": existing_profile.profile_name,
        "company_name": existing_profile.company_name,
        "system_name": existing_profile.system_name,
        "report_subtitle": existing_profile.report_subtitle,
        "logo_uploaded": bool(existing_profile.logo_data_url),
        "logo_text": existing_profile.logo_text,
        "footer_formula_available": bool(existing_profile.footer_formula),
        "footer_note_available": bool(existing_profile.footer_note),
        "status": existing_profile.status,
    }

    create_audit_log(
        db=db,
        module_name="Company Report Profile",
        action="Update Company Report Profile",
        current_user=current_user,
        entity_type="CompanyReportProfile",
        entity_id=existing_profile.id,
        entity_label=existing_profile.profile_name,
        remarks="Company report profile updated",
        request_path=f"/company-report-profiles/{profile_id}",
        details={
            "before": old_profile_data,
            "after": new_profile_data,
        },
    )

    db.commit()
    db.refresh(existing_profile)

    return build_company_report_profile_response(existing_profile)


@router.delete("/{profile_id}")
def delete_company_report_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Company Report Profile",
        db,
    )

    existing_profile = (
        db.query(CompanyReportProfile)
        .filter(CompanyReportProfile.id == profile_id)
        .first()
    )

    if not existing_profile:
        raise HTTPException(
            status_code=404,
            detail="Company report profile not found",
        )

    deleted_profile_data = {
        "profile_name": existing_profile.profile_name,
        "company_name": existing_profile.company_name,
        "system_name": existing_profile.system_name,
        "report_subtitle": existing_profile.report_subtitle,
        "logo_uploaded": bool(existing_profile.logo_data_url),
        "logo_text": existing_profile.logo_text,
        "footer_formula_available": bool(existing_profile.footer_formula),
        "footer_note_available": bool(existing_profile.footer_note),
        "status": existing_profile.status,
    }

    create_audit_log(
        db=db,
        module_name="Company Report Profile",
        action="Delete Company Report Profile",
        current_user=current_user,
        entity_type="CompanyReportProfile",
        entity_id=existing_profile.id,
        entity_label=existing_profile.profile_name,
        remarks="Company report profile deleted",
        request_path=f"/company-report-profiles/{profile_id}",
        details={
            "deleted_profile": deleted_profile_data,
        },
    )

    db.delete(existing_profile)
    db.commit()

    return {
        "message": "Company report profile deleted successfully",
    }
