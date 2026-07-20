from datetime import datetime, timedelta
import hashlib
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.database import get_db, SessionLocal
from app.models import User, BackupSettings, BackupJob, BackupRestoreRequest, BackupRestoreValidation
from app.schemas import (
    BackupSettingsUpdate,
    BackupSettingsResponse,
    BackupManualCreate,
    BackupJobResponse,
    BackupRestoreRequestCreate,
    BackupRestoreRequestAction,
    BackupRestoreExecuteRequest,
    BackupRestoreRequestResponse,
    BackupRestoreValidationResponse,
)
from app.dependencies.auth import get_current_user_from_token
from app.dependencies.permissions import require_user_permission, user_has_permission
from app.services.audit_service import create_audit_log
from app.utils.helpers import clean_optional_text, normalize_yes_no, get_current_user_display_name

router = APIRouter(prefix="/backup", tags=["Backup & Restore"])

BACKUP_SCHEDULE_MODES = {"Minutes", "Hours", "Daily", "Weekly"}
BACKUP_JOB_RUNNING_STATUSES = {"Pending", "Running"}
backup_scheduler_started = False
backup_scheduler_lock = threading.Lock()
restore_execution_lock = threading.Lock()
restore_maintenance_state = {
    "active": False,
    "started_at": None,
    "message": None,
    "request_number": None,
}


def get_default_backup_directory():
    configured = clean_optional_text(os.getenv("BACKUP_DIRECTORY"))
    if configured:
        return Path(configured)
    return Path.cwd() / "backups"


def backup_bool_to_yes_no(value):
    return "Yes" if bool(value) else "No"


def backup_yes_no_to_bool(value):
    return str(value or "").strip().lower() in {"yes", "true", "1"}


def generate_backup_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"BKP-{today}"
    existing_count = (
        db.query(BackupJob)
        .filter(BackupJob.backup_number.ilike(f"{prefix}%"))
        .count()
    )
    return f"{prefix}-{existing_count + 1:04d}"


def generate_backup_restore_request_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"BRR-{today}"
    existing_count = (
        db.query(BackupRestoreRequest)
        .filter(BackupRestoreRequest.request_number.ilike(f"{prefix}%"))
        .count()
    )
    return f"{prefix}-{existing_count + 1:04d}"


def generate_backup_restore_validation_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"BRV-{today}"
    existing_count = (
        db.query(BackupRestoreValidation)
        .filter(BackupRestoreValidation.validation_number.ilike(f"{prefix}%"))
        .count()
    )
    return f"{prefix}-{existing_count + 1:04d}"


def get_backup_database_name():
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        return None
    try:
        parsed = make_url(database_url)
        return parsed.database
    except Exception:
        return None


def calculate_next_backup_run(settings: BackupSettings, from_time: datetime | None = None):
    if not backup_yes_no_to_bool(settings.enabled):
        return None

    now = from_time or datetime.now()
    mode = str(settings.schedule_mode or "Daily").strip().title()
    interval_value = max(1, int(settings.interval_value or 1))

    if mode == "Minutes":
        return now + timedelta(minutes=interval_value)
    if mode == "Hours":
        return now + timedelta(hours=interval_value)
    if mode == "Weekly":
        return now + timedelta(days=7)

    run_time = str(settings.run_time or "02:00")[:5]
    try:
        hour, minute = [int(part) for part in run_time.split(":")]
    except Exception:
        hour, minute = 2, 0

    next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if next_run <= now:
        next_run = next_run + timedelta(days=1)
    return next_run


def get_or_create_backup_settings(db: Session):
    settings = (
        db.query(BackupSettings)
        .filter(BackupSettings.status == "Active")
        .order_by(BackupSettings.id.asc())
        .first()
    )
    if settings:
        return settings

    settings = BackupSettings(
        enabled="No",
        schedule_mode="Daily",
        interval_value=24,
        run_time="02:00",
        retention_days=30,
        keep_minimum=5,
        backup_directory=str(get_default_backup_directory()),
        compression_enabled="Yes",
        status="Active",
    )
    settings.next_run_at = calculate_next_backup_run(settings)
    db.add(settings)
    db.flush()
    return settings


def build_backup_settings_response(settings: BackupSettings):
    return {
        "id": settings.id,
        "enabled": backup_yes_no_to_bool(settings.enabled),
        "schedule_mode": settings.schedule_mode,
        "interval_value": settings.interval_value,
        "run_time": settings.run_time,
        "retention_days": settings.retention_days,
        "keep_minimum": settings.keep_minimum,
        "backup_directory": settings.backup_directory,
        "compression_enabled": backup_yes_no_to_bool(settings.compression_enabled),
        "status": settings.status,
        "next_run_at": settings.next_run_at,
        "last_run_at": settings.last_run_at,
        "created_at": settings.created_at,
        "updated_at": settings.updated_at,
    }


def build_backup_job_response(job: BackupJob):
    return {
        "id": job.id,
        "backup_number": job.backup_number,
        "backup_type": job.backup_type,
        "trigger_source": job.trigger_source,
        "status": job.status,
        "description": job.description,
        "file_name": job.file_name,
        "file_size_bytes": job.file_size_bytes,
        "checksum_sha256": job.checksum_sha256,
        "database_name": job.database_name,
        "backup_format": job.backup_format,
        "requested_by_user_id": job.requested_by_user_id,
        "requested_by_display": job.requested_by_display,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "error_message": job.error_message,
        "metadata_json": job.metadata_json,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def build_backup_restore_request_response(row: BackupRestoreRequest):
    return {
        "id": row.id,
        "request_number": row.request_number,
        "backup_job_id": row.backup_job_id,
        "backup_number": row.backup_number,
        "status": row.status,
        "reason": row.reason,
        "business_impact": row.business_impact,
        "requested_by_user_id": row.requested_by_user_id,
        "requested_by_display": row.requested_by_display,
        "requested_at": row.requested_at,
        "approved_by_user_id": row.approved_by_user_id,
        "approved_by_display": row.approved_by_display,
        "approved_at": row.approved_at,
        "rejected_by_user_id": row.rejected_by_user_id,
        "rejected_by_display": row.rejected_by_display,
        "rejected_at": row.rejected_at,
        "cancelled_by_user_id": row.cancelled_by_user_id,
        "cancelled_by_display": row.cancelled_by_display,
        "cancelled_at": row.cancelled_at,
        "action_remarks": row.action_remarks,
        "metadata_json": row.metadata_json,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def build_backup_restore_validation_response(row: BackupRestoreValidation):
    return {
        "id": row.id,
        "validation_number": row.validation_number,
        "restore_request_id": row.restore_request_id,
        "backup_job_id": row.backup_job_id,
        "backup_number": row.backup_number,
        "status": row.status,
        "validation_database_name": row.validation_database_name,
        "started_by_user_id": row.started_by_user_id,
        "started_by_display": row.started_by_display,
        "started_at": row.started_at,
        "completed_at": row.completed_at,
        "error_message": row.error_message,
        "table_counts_json": row.table_counts_json,
        "validation_report_json": row.validation_report_json,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def validate_backup_settings_payload(payload: BackupSettingsUpdate):
    mode = str(payload.schedule_mode or "").strip().title()
    if mode not in BACKUP_SCHEDULE_MODES:
        raise HTTPException(status_code=400, detail="Invalid backup schedule mode")
    if int(payload.interval_value or 0) < 1:
        raise HTTPException(status_code=400, detail="Interval value must be at least 1")
    if int(payload.retention_days or 0) < 1:
        raise HTTPException(status_code=400, detail="Retention days must be at least 1")
    if int(payload.keep_minimum or 0) < 1:
        raise HTTPException(status_code=400, detail="Keep minimum must be at least 1")
    run_time = str(payload.run_time or "02:00")[:5]
    try:
        datetime.strptime(run_time, "%H:%M")
    except ValueError:
        raise HTTPException(status_code=400, detail="Run time must be in HH:MM format")
    return mode, run_time


def ensure_no_backup_running(db: Session):
    running_job = (
        db.query(BackupJob)
        .filter(BackupJob.status.in_(list(BACKUP_JOB_RUNNING_STATUSES)))
        .order_by(BackupJob.created_at.desc())
        .first()
    )
    if running_job:
        raise HTTPException(
            status_code=409,
            detail=f"Backup job {running_job.backup_number} is already {running_job.status}",
        )


def resolve_backup_directory(settings: BackupSettings | None = None):
    configured = clean_optional_text(settings.backup_directory if settings else None)
    backup_dir = Path(configured) if configured else get_default_backup_directory()
    backup_dir.mkdir(parents=True, exist_ok=True)
    return backup_dir


def calculate_file_sha256(path: Path):
    digest = hashlib.sha256()
    with path.open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_backup_file_path_or_404(job: BackupJob):
    file_path = clean_optional_text(job.file_path)
    if not file_path:
        raise HTTPException(status_code=404, detail="Backup file path is not recorded")
    path = Path(file_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Backup file not found on server")
    return path


def verify_backup_job_checksum(
    db: Session,
    job: BackupJob,
    current_user: User | None,
    request_path: str,
):
    if job.status != "Completed":
        raise HTTPException(status_code=400, detail="Only completed backups can be verified")
    if not clean_optional_text(job.checksum_sha256):
        raise HTTPException(status_code=400, detail="Backup checksum is not recorded")

    path = get_backup_file_path_or_404(job)
    actual_checksum = calculate_file_sha256(path)
    expected_checksum = str(job.checksum_sha256 or "").strip()
    matched = actual_checksum == expected_checksum
    old_status = job.status

    if not matched:
        job.status = "Checksum Mismatch"
        job.error_message = "Backup checksum verification failed"
        job.updated_at = datetime.now()

    metadata = dict(job.metadata_json or {})
    metadata["last_checksum_verification"] = {
        "verified_at": datetime.now().isoformat(),
        "expected_checksum": expected_checksum,
        "actual_checksum": actual_checksum,
        "matched": matched,
    }
    job.metadata_json = metadata
    job.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Verify Backup Checksum",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=job.id,
        entity_label=job.backup_number,
        old_status=old_status,
        new_status=job.status,
        remarks="Backup checksum verified" if matched else "Backup checksum mismatch",
        request_path=request_path,
        details={
            "file_name": job.file_name,
            "expected_checksum": expected_checksum,
            "actual_checksum": actual_checksum,
            "matched": matched,
        },
    )
    db.commit()
    db.refresh(job)
    return {
        "backup_id": job.id,
        "backup_number": job.backup_number,
        "matched": matched,
        "expected_checksum": expected_checksum,
        "actual_checksum": actual_checksum,
        "status": job.status,
    }


def get_validation_database_url():
    validation_url = clean_optional_text(os.getenv("BACKUP_VALIDATION_DATABASE_URL"))
    if not validation_url:
        raise HTTPException(
            status_code=500,
            detail=(
                "BACKUP_VALIDATION_DATABASE_URL is not configured. "
                "Create a separate validation database and set this environment variable."
            ),
        )

    production_url = clean_optional_text(os.getenv("DATABASE_URL"))
    try:
        validation_parsed = make_url(validation_url)
        production_parsed = make_url(production_url) if production_url else None
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid validation database URL")

    if production_parsed:
        same_host = validation_parsed.host == production_parsed.host
        same_port = validation_parsed.port == production_parsed.port
        same_database = validation_parsed.database == production_parsed.database
        same_username = validation_parsed.username == production_parsed.username
        if same_host and same_port and same_database and same_username:
            raise HTTPException(
                status_code=400,
                detail="Validation database URL cannot point to the production database",
            )

    return validation_url, validation_parsed


def collect_validation_table_counts(validation_database_url: str):
    validation_engine = create_engine(validation_database_url)
    critical_tables = [
        "users",
        "roles",
        "permissions",
        "locations",
        "asset_types",
        "assets",
        "operation_types",
        "operation_templates",
        "operation_transactions",
        "operation_transaction_values",
        "audit_logs",
        "backup_jobs",
    ]
    counts = {}
    try:
        with validation_engine.connect() as connection:
            for table_name in critical_tables:
                exists_result = connection.execute(
                    text(
                        """
                        SELECT EXISTS (
                            SELECT 1
                            FROM information_schema.tables
                            WHERE table_schema = 'public'
                              AND table_name = :table_name
                        )
                        """
                    ),
                    {"table_name": table_name},
                ).scalar()
                if not exists_result:
                    counts[table_name] = {
                        "exists": False,
                        "row_count": None,
                    }
                    continue
                row_count = connection.execute(text(f'SELECT COUNT(*) FROM "{table_name}"')).scalar()
                counts[table_name] = {
                    "exists": True,
                    "row_count": int(row_count or 0),
                }
    finally:
        validation_engine.dispose()
    return counts


def run_restore_validation(
    db: Session,
    restore_request: BackupRestoreRequest,
    job: BackupJob,
    current_user: User,
):
    validation_url, validation_parsed = get_validation_database_url()
    if shutil.which("pg_restore") is None:
        raise HTTPException(
            status_code=500,
            detail="pg_restore is not available on this server. Install PostgreSQL client tools.",
        )

    path = get_backup_file_path_or_404(job)
    validation = BackupRestoreValidation(
        validation_number=generate_backup_restore_validation_number(db),
        restore_request_id=restore_request.id,
        backup_job_id=job.id,
        backup_number=job.backup_number,
        status="Running",
        validation_database_name=validation_parsed.database,
        started_by_user_id=current_user.id,
        started_by_display=get_current_user_display_name(current_user),
        started_at=datetime.now(),
    )
    db.add(validation)
    db.flush()

    old_request_status = restore_request.status
    restore_request.status = "Validation Running"
    restore_request.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Start Restore Validation",
        current_user=current_user,
        entity_type="BackupRestoreValidation",
        entity_id=validation.id,
        entity_label=validation.validation_number,
        old_status="Pending",
        new_status=validation.status,
        remarks="Restore validation started against separate validation database",
        request_path=f"/backup-restore-requests/{restore_request.id}/validate",
        details={
            "restore_request_id": restore_request.id,
            "request_number": restore_request.request_number,
            "backup_job_id": job.id,
            "backup_number": job.backup_number,
            "validation_database_name": validation_parsed.database,
            "production_restore_executed": False,
        },
    )
    db.commit()

    command = [
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        validation_url,
        str(path),
    ]

    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "pg_restore validation failed").strip())

        table_counts = collect_validation_table_counts(validation_url)
        missing_tables = [
            table_name
            for table_name, info in table_counts.items()
            if not info.get("exists")
        ]
        report = {
            "validated_at": datetime.now().isoformat(),
            "validation_database_name": validation_parsed.database,
            "backup_number": job.backup_number,
            "backup_file_name": job.file_name,
            "backup_checksum_sha256": job.checksum_sha256,
            "missing_critical_tables": missing_tables,
            "production_restore_executed": False,
            "result": "Passed" if len(missing_tables) == 0 else "Passed With Warnings",
        }
        validation.status = "Passed" if len(missing_tables) == 0 else "Passed With Warnings"
        validation.completed_at = datetime.now()
        validation.table_counts_json = table_counts
        validation.validation_report_json = report
        validation.updated_at = datetime.now()

        restore_request.status = "Validated"
        restore_request.updated_at = datetime.now()
        metadata = dict(restore_request.metadata_json or {})
        metadata["latest_validation"] = {
            "validation_id": validation.id,
            "validation_number": validation.validation_number,
            "status": validation.status,
            "validated_at": validation.completed_at.isoformat(),
            "validation_database_name": validation.validation_database_name,
        }
        restore_request.metadata_json = metadata

        create_audit_log(
            db=db,
            module_name="Backup Recovery",
            action="Complete Restore Validation",
            current_user=current_user,
            entity_type="BackupRestoreValidation",
            entity_id=validation.id,
            entity_label=validation.validation_number,
            old_status="Running",
            new_status=validation.status,
            remarks="Restore validation completed without touching production",
            request_path=f"/backup-restore-requests/{restore_request.id}/validate",
            details={
                "restore_request_id": restore_request.id,
                "request_number": restore_request.request_number,
                "backup_number": job.backup_number,
                "validation_status": validation.status,
                "missing_critical_tables": missing_tables,
                "production_restore_executed": False,
            },
        )
        db.commit()
        db.refresh(validation)
        return validation
    except Exception as exc:
        validation.status = "Failed"
        validation.completed_at = datetime.now()
        validation.error_message = str(exc)
        validation.updated_at = datetime.now()

        restore_request.status = "Validation Failed"
        restore_request.updated_at = datetime.now()
        metadata = dict(restore_request.metadata_json or {})
        metadata["latest_validation"] = {
            "validation_id": validation.id,
            "validation_number": validation.validation_number,
            "status": validation.status,
            "failed_at": validation.completed_at.isoformat(),
            "error": str(exc),
            "production_restore_executed": False,
        }
        restore_request.metadata_json = metadata

        create_audit_log(
            db=db,
            module_name="Backup Recovery",
            action="Fail Restore Validation",
            current_user=current_user,
            entity_type="BackupRestoreValidation",
            entity_id=validation.id,
            entity_label=validation.validation_number,
            old_status="Running",
            new_status="Failed",
            remarks="Restore validation failed",
            request_path=f"/backup-restore-requests/{restore_request.id}/validate",
            details={
                "restore_request_id": restore_request.id,
                "request_number": restore_request.request_number,
                "backup_number": job.backup_number,
                "error": str(exc),
                "production_restore_executed": False,
            },
        )
        db.commit()
        raise


def get_production_database_url():
    database_url = clean_optional_text(os.getenv("DATABASE_URL"))
    if not database_url:
        raise HTTPException(status_code=500, detail="DATABASE_URL is missing")
    return database_url


def run_production_restore(
    backup_path: Path,
    request_number: str,
):
    if shutil.which("pg_restore") is None:
        raise RuntimeError(
            "pg_restore is not available on this server. Install PostgreSQL client tools."
        )

    database_url = get_production_database_url()
    restore_maintenance_state["active"] = True
    restore_maintenance_state["started_at"] = datetime.now().isoformat()
    restore_maintenance_state["request_number"] = request_number
    restore_maintenance_state["message"] = (
        "Production restore is running. Normal application actions are temporarily blocked."
    )

    command = [
        "pg_restore",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        database_url,
        str(backup_path),
    ]
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "pg_restore failed").strip())


def write_post_restore_audit(
    request_snapshot: dict,
    job_snapshot: dict,
    pre_restore_backup_snapshot: dict | None,
    current_user: User,
    status: str,
    error_message: str | None = None,
):
    post_db = SessionLocal()
    try:
        post_row = None
        try:
            post_row = (
                post_db.query(BackupRestoreRequest)
                .filter(BackupRestoreRequest.request_number == request_snapshot["request_number"])
                .first()
            )
            if post_row:
                post_row.status = status
                post_row.action_remarks = request_snapshot.get("action_remarks")
                post_row.updated_at = datetime.now()
                metadata = dict(post_row.metadata_json or {})
                metadata["restore_execution"] = {
                    "status": status,
                    "executed_at": datetime.now().isoformat(),
                    "backup_number": job_snapshot.get("backup_number"),
                    "pre_restore_backup_number": (
                        pre_restore_backup_snapshot or {}
                    ).get("backup_number"),
                    "production_restore_executed": status == "Restored",
                    "error": error_message,
                }
                post_row.metadata_json = metadata
        except Exception:
            post_db.rollback()
            post_row = None

        create_audit_log(
            db=post_db,
            module_name="Backup Recovery",
            action="Complete Backup Restore" if status == "Restored" else "Fail Backup Restore",
            current_user=current_user,
            entity_type="BackupRestoreRequest",
            entity_id=(post_row.id if post_row else request_snapshot.get("id")),
            entity_label=request_snapshot.get("request_number"),
            old_status="Restore Running",
            new_status=status,
            remarks=request_snapshot.get("action_remarks") or error_message,
            request_path=f"/backup-restore-requests/{request_snapshot.get('id')}/execute",
            details={
                "request_number": request_snapshot.get("request_number"),
                "backup_job_id": job_snapshot.get("id"),
                "backup_number": job_snapshot.get("backup_number"),
                "backup_file_name": job_snapshot.get("file_name"),
                "backup_checksum_sha256": job_snapshot.get("checksum_sha256"),
                "pre_restore_backup": pre_restore_backup_snapshot,
                "production_restore_executed": status == "Restored",
                "error": error_message,
            },
        )
        post_db.commit()
    finally:
        post_db.close()


def execute_backup_job(
    db: Session,
    job: BackupJob,
    settings: BackupSettings | None,
    current_user: User | None = None,
):
    database_url = os.getenv("DATABASE_URL")

    backup_dir = resolve_backup_directory(settings)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    file_name = f"{job.backup_number}_{timestamp}.dump"
    file_path = backup_dir / file_name

    job.status = "Running"
    job.started_at = datetime.now()
    job.file_name = file_name
    job.file_path = str(file_path)
    job.database_name = get_backup_database_name()
    job.updated_at = datetime.now()
    db.commit()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Start Backup",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=job.id,
        entity_label=job.backup_number,
        old_status="Pending",
        new_status="Running",
        remarks=job.description,
        request_path="/backups/manual" if job.trigger_source == "Manual" else "/backups/scheduler",
        details={
            "backup_type": job.backup_type,
            "trigger_source": job.trigger_source,
            "file_name": file_name,
            "database_name": job.database_name,
        },
    )
    db.commit()

    command = [
        "pg_dump",
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        str(file_path),
        database_url,
    ]

    try:
        if not database_url:
            raise RuntimeError("DATABASE_URL is missing")

        if shutil.which("pg_dump") is None:
            raise RuntimeError(
                "pg_dump is not available on this server. Install PostgreSQL client tools."
            )

        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=3600,
            check=False,
        )

        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "pg_dump failed").strip())

        file_size = file_path.stat().st_size
        checksum = calculate_file_sha256(file_path)
        job.status = "Completed"
        job.file_size_bytes = file_size
        job.checksum_sha256 = checksum
        job.completed_at = datetime.now()
        job.error_message = None
        job.metadata_json = {
            "pg_dump_format": "custom",
            "compression": "pg_dump custom format",
            "file_size_bytes": file_size,
            "checksum_sha256": checksum,
        }
        job.updated_at = datetime.now()

        if settings:
            settings.last_run_at = job.completed_at
            settings.next_run_at = calculate_next_backup_run(settings, job.completed_at)
            settings.updated_at = datetime.now()

        create_audit_log(
            db=db,
            module_name="Backup Recovery",
            action="Complete Backup",
            current_user=current_user,
            entity_type="BackupJob",
            entity_id=job.id,
            entity_label=job.backup_number,
            old_status="Running",
            new_status="Completed",
            remarks=job.description,
            request_path="/backups/manual" if job.trigger_source == "Manual" else "/backups/scheduler",
            details={
                "backup_type": job.backup_type,
                "trigger_source": job.trigger_source,
                "file_name": job.file_name,
                "file_size_bytes": file_size,
                "checksum_sha256": checksum,
                "database_name": job.database_name,
            },
        )
        db.commit()
        db.refresh(job)
        return job
    except Exception as exc:
        job.status = "Failed"
        job.completed_at = datetime.now()
        job.error_message = str(exc)
        job.updated_at = datetime.now()
        if file_path.exists():
            try:
                file_path.unlink()
            except Exception:
                pass
        if settings:
            settings.next_run_at = calculate_next_backup_run(settings, datetime.now())
            settings.updated_at = datetime.now()
        create_audit_log(
            db=db,
            module_name="Backup Recovery",
            action="Fail Backup",
            current_user=current_user,
            entity_type="BackupJob",
            entity_id=job.id,
            entity_label=job.backup_number,
            old_status="Running",
            new_status="Failed",
            remarks=job.description,
            request_path="/backups/manual" if job.trigger_source == "Manual" else "/backups/scheduler",
            details={
                "backup_type": job.backup_type,
                "trigger_source": job.trigger_source,
                "error": str(exc),
                "database_name": job.database_name,
            },
        )
        db.commit()
        raise


def create_backup_job_record(
    db: Session,
    backup_type: str,
    trigger_source: str,
    description: str | None,
    current_user: User | None = None,
):
    ensure_no_backup_running(db)
    requested_by_display = get_current_user_display_name(current_user) if current_user else "System Scheduler"
    job = BackupJob(
        backup_number=generate_backup_number(db),
        backup_type=backup_type,
        trigger_source=trigger_source,
        status="Pending",
        description=clean_optional_text(description),
        backup_format="custom",
        requested_by_user_id=current_user.id if current_user else None,
        requested_by_display=requested_by_display,
        database_name=get_backup_database_name(),
    )
    db.add(job)
    db.flush()
    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Create Backup Job",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=job.id,
        entity_label=job.backup_number,
        new_status="Pending",
        remarks=job.description,
        request_path="/backups/manual" if trigger_source == "Manual" else "/backups/scheduler",
        details={
            "backup_type": backup_type,
            "trigger_source": trigger_source,
            "database_name": job.database_name,
        },
    )
    db.commit()
    db.refresh(job)
    return job


def run_scheduled_backup_once():
    db = SessionLocal()
    try:
        settings = get_or_create_backup_settings(db)
        now = datetime.now()
        if not backup_yes_no_to_bool(settings.enabled):
            return
        if settings.next_run_at is None:
            settings.next_run_at = calculate_next_backup_run(settings, now)
            db.commit()
            return
        if settings.next_run_at > now:
            return
        try:
            job = create_backup_job_record(
                db=db,
                backup_type="Scheduled",
                trigger_source="Scheduler",
                description="Automatic scheduled backup",
                current_user=None,
            )
            execute_backup_job(db, job, settings, current_user=None)
        except HTTPException:
            db.rollback()
            settings.next_run_at = calculate_next_backup_run(settings, now)
            settings.updated_at = datetime.now()
            db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()


def backup_scheduler_loop():
    while True:
        try:
            run_scheduled_backup_once()
        except Exception:
            pass
        time.sleep(60)


def start_backup_scheduler():
    global backup_scheduler_started
    with backup_scheduler_lock:
        if backup_scheduler_started:
            return
        backup_scheduler_started = True
        scheduler_thread = threading.Thread(
            target=backup_scheduler_loop,
            name="backup-scheduler",
            daemon=True,
        )
        scheduler_thread.start()


@router.get("/settings", response_model=BackupSettingsResponse)
def get_backup_settings(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Backup", db)
    settings = get_or_create_backup_settings(db)
    db.commit()
    db.refresh(settings)
    return build_backup_settings_response(settings)


@router.put("/settings", response_model=BackupSettingsResponse)
def update_backup_settings(
    payload: BackupSettingsUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Backup Settings", db)
    mode, run_time = validate_backup_settings_payload(payload)
    settings = get_or_create_backup_settings(db)
    old_details = build_backup_settings_response(settings)

    backup_directory = clean_optional_text(payload.backup_directory) or str(get_default_backup_directory())
    settings.enabled = backup_bool_to_yes_no(payload.enabled)
    settings.schedule_mode = mode
    settings.interval_value = int(payload.interval_value)
    settings.run_time = run_time
    settings.retention_days = int(payload.retention_days)
    settings.keep_minimum = int(payload.keep_minimum)
    settings.backup_directory = backup_directory
    settings.compression_enabled = backup_bool_to_yes_no(payload.compression_enabled)
    settings.updated_by_user_id = current_user.id
    settings.updated_at = datetime.now()
    settings.next_run_at = calculate_next_backup_run(settings)

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Update Backup Settings",
        current_user=current_user,
        entity_type="BackupSettings",
        entity_id=settings.id,
        entity_label="Active Backup Settings",
        old_status="Enabled" if old_details["enabled"] else "Disabled",
        new_status="Enabled" if payload.enabled else "Disabled",
        remarks="Backup schedule settings updated",
        request_path="/backup-settings",
        details={
            "before": old_details,
            "after": {
                "enabled": payload.enabled,
                "schedule_mode": mode,
                "interval_value": int(payload.interval_value),
                "run_time": run_time,
                "retention_days": int(payload.retention_days),
                "keep_minimum": int(payload.keep_minimum),
                "backup_directory": backup_directory,
                "compression_enabled": payload.compression_enabled,
                "next_run_at": settings.next_run_at,
            },
        },
    )
    db.commit()
    db.refresh(settings)
    return build_backup_settings_response(settings)


@router.get("", response_model=list[BackupJobResponse])
def get_backup_jobs(
    status: str | None = None,
    backup_type: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Backup", db)
    query = db.query(BackupJob)
    cleaned_status = clean_optional_text(status)
    cleaned_type = clean_optional_text(backup_type)
    if cleaned_status:
        query = query.filter(BackupJob.status == cleaned_status)
    if cleaned_type:
        query = query.filter(BackupJob.backup_type == cleaned_type)
    jobs = query.order_by(BackupJob.created_at.desc(), BackupJob.id.desc()).limit(500).all()
    return [build_backup_job_response(job) for job in jobs]


@router.post("/cleanup")
def cleanup_backup_files(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Run Backup Cleanup", db)
    settings = get_or_create_backup_settings(db)
    retention_days = max(1, int(settings.retention_days or 30))
    keep_minimum = max(1, int(settings.keep_minimum or 5))
    cutoff = datetime.now() - timedelta(days=retention_days)

    completed_jobs = (
        db.query(BackupJob)
        .filter(BackupJob.status == "Completed")
        .order_by(BackupJob.completed_at.desc(), BackupJob.id.desc())
        .all()
    )
    protected_ids = {job.id for job in completed_jobs[:keep_minimum]}
    candidates = [
        job
        for job in completed_jobs[keep_minimum:]
        if job.completed_at and job.completed_at < cutoff and job.id not in protected_ids
    ]

    deleted_rows = []
    skipped_rows = []

    for job in candidates:
        old_status = job.status
        try:
            path = get_backup_file_path_or_404(job)
            path.unlink()
            job.status = "Deleted"
            job.error_message = None
            job.updated_at = datetime.now()
            metadata = dict(job.metadata_json or {})
            metadata["deleted_by_cleanup_at"] = datetime.now().isoformat()
            metadata["deleted_file_name"] = job.file_name
            job.metadata_json = metadata
            deleted_rows.append({
                "backup_id": job.id,
                "backup_number": job.backup_number,
                "file_name": job.file_name,
                "old_status": old_status,
                "new_status": job.status,
            })
        except HTTPException as exc:
            skipped_rows.append({
                "backup_id": job.id,
                "backup_number": job.backup_number,
                "reason": exc.detail,
            })

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Run Backup Cleanup",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=None,
        entity_label="Backup Retention Cleanup",
        remarks="Backup retention cleanup executed",
        request_path="/backups/cleanup",
        details={
            "retention_days": retention_days,
            "keep_minimum": keep_minimum,
            "cutoff": cutoff,
            "deleted_count": len(deleted_rows),
            "skipped_count": len(skipped_rows),
            "deleted": deleted_rows,
            "skipped": skipped_rows,
        },
    )
    db.commit()

    return {
        "deleted_count": len(deleted_rows),
        "skipped_count": len(skipped_rows),
        "deleted": deleted_rows,
        "skipped": skipped_rows,
        "retention_days": retention_days,
        "keep_minimum": keep_minimum,
    }


@router.post("/manual", response_model=BackupJobResponse)
def create_manual_backup(
    payload: BackupManualCreate | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Manual Backup", db)
    settings = get_or_create_backup_settings(db)
    job = create_backup_job_record(
        db=db,
        backup_type="Manual",
        trigger_source="Manual",
        description=payload.description if payload else "Manual backup",
        current_user=current_user,
    )
    try:
        completed_job = execute_backup_job(db, job, settings, current_user=current_user)
        return build_backup_job_response(completed_job)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}")


@router.post("/{backup_id}/verify-checksum")
def verify_backup_checksum(
    backup_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Verify Backup Checksum", db)
    job = db.query(BackupJob).filter(BackupJob.id == backup_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Backup job not found")
    return verify_backup_job_checksum(
        db=db,
        job=job,
        current_user=current_user,
        request_path=f"/backups/{backup_id}/verify-checksum",
    )


@router.get("/{backup_id}/download")
def download_backup_file(
    backup_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Download Backup", db)
    job = db.query(BackupJob).filter(BackupJob.id == backup_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Backup job not found")
    if job.status != "Completed":
        raise HTTPException(status_code=400, detail="Only completed backups can be downloaded")

    verification = verify_backup_job_checksum(
        db=db,
        job=job,
        current_user=current_user,
        request_path=f"/backups/{backup_id}/download",
    )
    if not verification["matched"]:
        raise HTTPException(status_code=400, detail="Backup checksum mismatch. Download blocked.")

    path = get_backup_file_path_or_404(job)
    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Download Backup",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=job.id,
        entity_label=job.backup_number,
        old_status=job.status,
        new_status=job.status,
        remarks="Backup file downloaded",
        request_path=f"/backups/{backup_id}/download",
        details={
            "file_name": job.file_name,
            "file_size_bytes": job.file_size_bytes,
            "checksum_sha256": job.checksum_sha256,
        },
    )
    db.commit()
    return FileResponse(
        path=str(path),
        filename=job.file_name or path.name,
        media_type="application/octet-stream",
    )


@router.delete("/{backup_id}", response_model=BackupJobResponse)
def delete_backup_file(
    backup_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Delete Backup", db)
    job = db.query(BackupJob).filter(BackupJob.id == backup_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Backup job not found")
    if job.status in BACKUP_JOB_RUNNING_STATUSES:
        raise HTTPException(status_code=400, detail="Running or pending backups cannot be deleted")
    if job.status == "Deleted":
        raise HTTPException(status_code=400, detail="Backup file is already deleted")

    old_status = job.status
    deleted_file = None
    try:
        path = get_backup_file_path_or_404(job)
        deleted_file = path.name
        path.unlink()
    except HTTPException as exc:
        if old_status == "Completed":
            raise exc

    job.status = "Deleted"
    job.error_message = None
    job.updated_at = datetime.now()
    metadata = dict(job.metadata_json or {})
    metadata["deleted_at"] = datetime.now().isoformat()
    metadata["deleted_by"] = get_current_user_display_name(current_user)
    metadata["deleted_file_name"] = deleted_file or job.file_name
    job.metadata_json = metadata

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Delete Backup",
        current_user=current_user,
        entity_type="BackupJob",
        entity_id=job.id,
        entity_label=job.backup_number,
        old_status=old_status,
        new_status=job.status,
        remarks="Backup file deleted; job history retained",
        request_path=f"/backups/{backup_id}",
        details={
            "file_name": job.file_name,
            "deleted_file_name": deleted_file,
            "file_size_bytes": job.file_size_bytes,
        },
    )
    db.commit()
    db.refresh(job)
    return build_backup_job_response(job)


@router.get("/restore-requests", response_model=list[BackupRestoreRequestResponse])
def get_backup_restore_requests(
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Backup", db)
    query = db.query(BackupRestoreRequest)
    cleaned_status = clean_optional_text(status)
    if cleaned_status:
        query = query.filter(BackupRestoreRequest.status == cleaned_status)
    rows = (
        query.order_by(BackupRestoreRequest.created_at.desc(), BackupRestoreRequest.id.desc())
        .limit(500)
        .all()
    )
    return [build_backup_restore_request_response(row) for row in rows]


@router.post("/restore-requests", response_model=BackupRestoreRequestResponse)
def create_backup_restore_request(
    payload: BackupRestoreRequestCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Request Backup Restore", db)
    reason = clean_optional_text(payload.reason)
    if not reason:
        raise HTTPException(status_code=400, detail="Restore request reason is required")

    job = db.query(BackupJob).filter(BackupJob.id == payload.backup_job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Backup job not found")
    if job.status != "Completed":
        raise HTTPException(status_code=400, detail="Only completed backups can be requested for restore approval")

    verification = verify_backup_job_checksum(
        db=db,
        job=job,
        current_user=current_user,
        request_path="/backup-restore-requests",
    )
    if not verification["matched"]:
        raise HTTPException(status_code=400, detail="Backup checksum mismatch. Restore request blocked.")

    existing = (
        db.query(BackupRestoreRequest)
        .filter(
            BackupRestoreRequest.backup_job_id == job.id,
            BackupRestoreRequest.status.in_(
                ["Pending Approval", "Approved", "Validation Running", "Validated"]
            ),
        )
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail=f"Restore request {existing.request_number} is already {existing.status} for this backup",
        )

    row = BackupRestoreRequest(
        request_number=generate_backup_restore_request_number(db),
        backup_job_id=job.id,
        backup_number=job.backup_number,
        status="Pending Approval",
        reason=reason,
        business_impact=clean_optional_text(payload.business_impact),
        requested_by_user_id=current_user.id,
        requested_by_display=get_current_user_display_name(current_user),
        requested_at=datetime.now(),
        metadata_json={
            "backup_file_name": job.file_name,
            "backup_checksum_sha256": job.checksum_sha256,
            "backup_file_size_bytes": job.file_size_bytes,
            "database_name": job.database_name,
            "restore_execution_enabled": False,
        },
    )
    db.add(row)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Request Backup Restore",
        current_user=current_user,
        entity_type="BackupRestoreRequest",
        entity_id=row.id,
        entity_label=row.request_number,
        new_status=row.status,
        remarks=reason,
        request_path="/backup-restore-requests",
        details={
            "backup_job_id": job.id,
            "backup_number": job.backup_number,
            "business_impact": row.business_impact,
            "restore_execution_enabled": False,
        },
    )
    db.commit()
    db.refresh(row)
    return build_backup_restore_request_response(row)


@router.post("/restore-requests/{request_id}/approve", response_model=BackupRestoreRequestResponse)
def approve_backup_restore_request(
    request_id: int,
    payload: BackupRestoreRequestAction | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Approve Backup Restore", db)
    row = db.query(BackupRestoreRequest).filter(BackupRestoreRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Backup restore request not found")
    if row.status != "Pending Approval":
        raise HTTPException(status_code=400, detail="Only Pending Approval restore requests can be approved")

    job = db.query(BackupJob).filter(BackupJob.id == row.backup_job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Linked backup job not found")
    if job.status != "Completed":
        raise HTTPException(status_code=400, detail="Linked backup is no longer completed")
    verification = verify_backup_job_checksum(
        db=db,
        job=job,
        current_user=current_user,
        request_path=f"/backup-restore-requests/{request_id}/approve",
    )
    if not verification["matched"]:
        raise HTTPException(status_code=400, detail="Backup checksum mismatch. Approval blocked.")

    old_status = row.status
    row.status = "Approved"
    row.approved_by_user_id = current_user.id
    row.approved_by_display = get_current_user_display_name(current_user)
    row.approved_at = datetime.now()
    row.action_remarks = clean_optional_text(payload.remarks if payload else None)
    row.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Approve Backup Restore",
        current_user=current_user,
        entity_type="BackupRestoreRequest",
        entity_id=row.id,
        entity_label=row.request_number,
        old_status=old_status,
        new_status=row.status,
        remarks=row.action_remarks,
        request_path=f"/backup-restore-requests/{request_id}/approve",
        details={
            "backup_job_id": row.backup_job_id,
            "backup_number": row.backup_number,
            "restore_execution_enabled": False,
        },
    )
    db.commit()
    db.refresh(row)
    return build_backup_restore_request_response(row)


@router.post("/restore-requests/{request_id}/reject", response_model=BackupRestoreRequestResponse)
def reject_backup_restore_request(
    request_id: int,
    payload: BackupRestoreRequestAction | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Reject Backup Restore", db)
    row = db.query(BackupRestoreRequest).filter(BackupRestoreRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Backup restore request not found")
    if row.status != "Pending Approval":
        raise HTTPException(status_code=400, detail="Only Pending Approval restore requests can be rejected")

    remarks = clean_optional_text(payload.remarks if payload else None)
    if not remarks:
        raise HTTPException(status_code=400, detail="Rejection remarks are required")

    old_status = row.status
    row.status = "Rejected"
    row.rejected_by_user_id = current_user.id
    row.rejected_by_display = get_current_user_display_name(current_user)
    row.rejected_at = datetime.now()
    row.action_remarks = remarks
    row.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Reject Backup Restore",
        current_user=current_user,
        entity_type="BackupRestoreRequest",
        entity_id=row.id,
        entity_label=row.request_number,
        old_status=old_status,
        new_status=row.status,
        remarks=remarks,
        request_path=f"/backup-restore-requests/{request_id}/reject",
        details={
            "backup_job_id": row.backup_job_id,
            "backup_number": row.backup_number,
        },
    )
    db.commit()
    db.refresh(row)
    return build_backup_restore_request_response(row)


@router.post("/restore-requests/{request_id}/cancel", response_model=BackupRestoreRequestResponse)
def cancel_backup_restore_request(
    request_id: int,
    payload: BackupRestoreRequestAction | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    row = db.query(BackupRestoreRequest).filter(BackupRestoreRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Backup restore request not found")
    if row.status != "Pending Approval":
        raise HTTPException(status_code=400, detail="Only Pending Approval restore requests can be cancelled")
    if row.requested_by_user_id != current_user.id and not user_has_permission(current_user, "Approve Backup Restore", db):
        raise HTTPException(status_code=403, detail="Only requester or restore approver can cancel this request")

    old_status = row.status
    row.status = "Cancelled"
    row.cancelled_by_user_id = current_user.id
    row.cancelled_by_display = get_current_user_display_name(current_user)
    row.cancelled_at = datetime.now()
    row.action_remarks = clean_optional_text(payload.remarks if payload else None)
    row.updated_at = datetime.now()

    create_audit_log(
        db=db,
        module_name="Backup Recovery",
        action="Cancel Backup Restore",
        current_user=current_user,
        entity_type="BackupRestoreRequest",
        entity_id=row.id,
        entity_label=row.request_number,
        old_status=old_status,
        new_status=row.status,
        remarks=row.action_remarks,
        request_path=f"/backup-restore-requests/{request_id}/cancel",
        details={
            "backup_job_id": row.backup_job_id,
            "backup_number": row.backup_number,
        },
    )
    db.commit()
    db.refresh(row)
    return build_backup_restore_request_response(row)


@router.get(
    "/restore-requests/{request_id}/validations",
    response_model=list[BackupRestoreValidationResponse],
)
def get_backup_restore_validations(
    request_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Backup", db)
    restore_request = (
        db.query(BackupRestoreRequest)
        .filter(BackupRestoreRequest.id == request_id)
        .first()
    )
    if not restore_request:
        raise HTTPException(status_code=404, detail="Backup restore request not found")
    rows = (
        db.query(BackupRestoreValidation)
        .filter(BackupRestoreValidation.restore_request_id == request_id)
        .order_by(BackupRestoreValidation.created_at.desc(), BackupRestoreValidation.id.desc())
        .all()
    )
    return [build_backup_restore_validation_response(row) for row in rows]


@router.post(
    "/restore-requests/{request_id}/validate",
    response_model=BackupRestoreValidationResponse,
)
def validate_backup_restore_request(
    request_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Validate Backup Restore", db)
    restore_request = (
        db.query(BackupRestoreRequest)
        .filter(BackupRestoreRequest.id == request_id)
        .first()
    )
    if not restore_request:
        raise HTTPException(status_code=404, detail="Backup restore request not found")
    if restore_request.status not in ["Approved", "Validation Failed"]:
        raise HTTPException(
            status_code=400,
            detail="Only Approved or Validation Failed restore requests can be validated",
        )

    running_validation = (
        db.query(BackupRestoreValidation)
        .filter(
            BackupRestoreValidation.restore_request_id == request_id,
            BackupRestoreValidation.status == "Running",
        )
        .first()
    )
    if running_validation:
        raise HTTPException(
            status_code=409,
            detail=f"Validation {running_validation.validation_number} is already running",
        )

    job = db.query(BackupJob).filter(BackupJob.id == restore_request.backup_job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Linked backup job not found")
    if job.status != "Completed":
        raise HTTPException(status_code=400, detail="Linked backup is no longer completed")

    verification = verify_backup_job_checksum(
        db=db,
        job=job,
        current_user=current_user,
        request_path=f"/backup-restore-requests/{request_id}/validate",
    )
    if not verification["matched"]:
        raise HTTPException(status_code=400, detail="Backup checksum mismatch. Validation blocked.")

    try:
        validation = run_restore_validation(
            db=db,
            restore_request=restore_request,
            job=job,
            current_user=current_user,
        )
        return build_backup_restore_validation_response(validation)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Restore validation failed: {exc}")


@router.post(
    "/restore-requests/{request_id}/execute",
    response_model=BackupRestoreRequestResponse,
)
def execute_backup_restore_request(
    request_id: int,
    payload: BackupRestoreExecuteRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Execute Backup Restore", db)
    if not restore_execution_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Another restore execution is already running")

    request_snapshot = None
    job_snapshot = None
    pre_restore_backup_snapshot = None
    try:
        restore_request = (
            db.query(BackupRestoreRequest)
            .filter(BackupRestoreRequest.id == request_id)
            .first()
        )
        if not restore_request:
            raise HTTPException(status_code=404, detail="Backup restore request not found")
        if restore_request.status != "Validated":
            raise HTTPException(
                status_code=400,
                detail="Only Validated restore requests can be executed",
            )

        expected_confirmation = f"EXECUTE RESTORE {restore_request.request_number}"
        if clean_optional_text(payload.confirmation_text) != expected_confirmation:
            raise HTTPException(
                status_code=400,
                detail=f"Confirmation text must exactly match: {expected_confirmation}",
            )

        job = db.query(BackupJob).filter(BackupJob.id == restore_request.backup_job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Linked backup job not found")
        if job.status != "Completed":
            raise HTTPException(status_code=400, detail="Linked backup is no longer completed")

        verification = verify_backup_job_checksum(
            db=db,
            job=job,
            current_user=current_user,
            request_path=f"/backup-restore-requests/{request_id}/execute",
        )
        if not verification["matched"]:
            raise HTTPException(status_code=400, detail="Backup checksum mismatch. Restore blocked.")

        backup_path = get_backup_file_path_or_404(job)
        settings = get_or_create_backup_settings(db)
        pre_restore_job = create_backup_job_record(
            db=db,
            backup_type="Before Restore",
            trigger_source="Restore Safety",
            description=f"Automatic safety backup before restore request {restore_request.request_number}",
            current_user=current_user,
        )
        pre_restore_job = execute_backup_job(
            db=db,
            job=pre_restore_job,
            settings=settings,
            current_user=current_user,
        )
        pre_restore_backup_snapshot = {
            "id": pre_restore_job.id,
            "backup_number": pre_restore_job.backup_number,
            "file_name": pre_restore_job.file_name,
            "file_size_bytes": pre_restore_job.file_size_bytes,
            "checksum_sha256": pre_restore_job.checksum_sha256,
            "completed_at": pre_restore_job.completed_at.isoformat()
            if pre_restore_job.completed_at
            else None,
        }

        old_status = restore_request.status
        remarks = clean_optional_text(payload.remarks)
        restore_request.status = "Restore Running"
        restore_request.action_remarks = remarks
        restore_request.updated_at = datetime.now()
        metadata = dict(restore_request.metadata_json or {})
        metadata["restore_execution"] = {
            "status": "Restore Running",
            "started_at": datetime.now().isoformat(),
            "executed_by": get_current_user_display_name(current_user),
            "pre_restore_backup": pre_restore_backup_snapshot,
            "confirmation_text_matched": True,
            "production_restore_executed": False,
        }
        restore_request.metadata_json = metadata

        create_audit_log(
            db=db,
            module_name="Backup Recovery",
            action="Start Backup Restore",
            current_user=current_user,
            entity_type="BackupRestoreRequest",
            entity_id=restore_request.id,
            entity_label=restore_request.request_number,
            old_status=old_status,
            new_status=restore_request.status,
            remarks=remarks,
            request_path=f"/backup-restore-requests/{request_id}/execute",
            details={
                "backup_job_id": job.id,
                "backup_number": job.backup_number,
                "backup_file_name": job.file_name,
                "backup_checksum_sha256": job.checksum_sha256,
                "pre_restore_backup": pre_restore_backup_snapshot,
                "confirmation_text_matched": True,
                "production_restore_executed": False,
            },
        )
        db.commit()
        db.refresh(restore_request)

        request_snapshot = build_backup_restore_request_response(restore_request)
        job_snapshot = build_backup_job_response(job)
        db.close()

        run_production_restore(
            backup_path=backup_path,
            request_number=restore_request.request_number,
        )

        restored_response = dict(request_snapshot)
        restored_response["status"] = "Restored"
        restored_response["updated_at"] = datetime.now()
        restored_metadata = dict(restored_response.get("metadata_json") or {})
        restored_metadata["restore_execution"] = {
            "status": "Restored",
            "completed_at": datetime.now().isoformat(),
            "executed_by": get_current_user_display_name(current_user),
            "pre_restore_backup": pre_restore_backup_snapshot,
            "production_restore_executed": True,
        }
        restored_response["metadata_json"] = restored_metadata

        try:
            write_post_restore_audit(
                request_snapshot=request_snapshot,
                job_snapshot=job_snapshot,
                pre_restore_backup_snapshot=pre_restore_backup_snapshot,
                current_user=current_user,
                status="Restored",
            )
        except Exception:
            pass

        return restored_response
    except HTTPException:
        raise
    except Exception as exc:
        if request_snapshot and job_snapshot:
            try:
                write_post_restore_audit(
                    request_snapshot=request_snapshot,
                    job_snapshot=job_snapshot,
                    pre_restore_backup_snapshot=pre_restore_backup_snapshot,
                    current_user=current_user,
                    status="Restore Failed",
                    error_message=str(exc),
                )
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Backup restore failed: {exc}")
    finally:
        restore_maintenance_state["active"] = False
        restore_maintenance_state["started_at"] = None
        restore_maintenance_state["message"] = None
        restore_maintenance_state["request_number"] = None
        restore_execution_lock.release()
