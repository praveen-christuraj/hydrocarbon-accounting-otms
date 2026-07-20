from contextlib import asynccontextmanager
from datetime import datetime, timedelta, date, time as datetime_time
from zoneinfo import ZoneInfo
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import JSONResponse
import os
from pathlib import Path

from fastapi.middleware.cors import CORSMiddleware

from app.config import allowed_origins

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import Base, engine, get_db
from app.models import (
    Asset, AuthLoginChallenge, AssetAssignment, PrimeMoverTankerLink,
    AssetCalibrationData, AssetCalibrationTable, AssetType,
    CalibrationTemplate, CalibrationTemplateColumn, Location,
    LocationAccountingDaySetting, LocationOperationAvailability,
    OperationTemplate, OperationTemplateField, OperationTemplateLayout,
    OperationTemplateLayoutSection, OperationTemplateLayoutItem,
    OperationTransaction, OperationTransactionValue,
    OperationTransactionStatusHistory, OperationType, TankOperation,
    VesselOperation, VesselStockLedger, MovementMapping, MovementMappingItem,
    MovementMappingComparison, TankStockLedger, TankerReceiptAcknowledgement,
    MaterialBalanceTemplate, MaterialBalanceTemplateColumn, Permission, Role,
    RolePermission, SystemNotification, SystemNotificationReceipt,
    BackupSettings, BackupJob, BackupRestoreRequest, BackupRestoreValidation,
    User, PasswordResetRequest, UserRole, OperationWorkflowPolicy,
    OperationWorkflowPolicyRole, OperationWorkflowPolicyUser, OperationTask,
    OperationTaskEvent, ApprovedTransactionCorrectionRequest, Table11Factor,
    BargeSealMaster, FlowmeterConfig, FlowmeterRecord, FlowmeterConfigHistory,
    CompanyReportProfile, DashboardConfig, DashboardVersion, DashboardDataSource,
    AuditLog, Trip, TripEvent, TripComparison, ShuttleVoyage, FSOVoyage,
)

from app.utils.db_migrations import (
    ensure_user_security_columns,
    ensure_operation_ticket_number_column,
    ensure_operation_template_layout_columns,
    ensure_tank_stock_ledger_accounting_columns,
    ensure_tank_stock_ledger_stock_snapshot_columns,
    ensure_vessel_operation_show_in_column,
    ensure_flowmeter_stream_columns,
    ensure_barge_event_type_template_field,
    ensure_operation_workflow_policy_tables,
    ensure_operation_task_tables,
    migrate_boolean_columns,
    seed_default_permissions,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_user_security_columns()
    ensure_operation_ticket_number_column()
    ensure_operation_template_layout_columns()
    ensure_tank_stock_ledger_accounting_columns()
    ensure_tank_stock_ledger_stock_snapshot_columns()
    ensure_vessel_operation_show_in_column()
    ensure_flowmeter_stream_columns()
    ensure_barge_event_type_template_field()
    ensure_operation_workflow_policy_tables()
    ensure_operation_task_tables()
    migrate_boolean_columns()
    seed_default_permissions()

    from app.routers.backup_restore import start_backup_scheduler
    start_backup_scheduler()

    yield


app = FastAPI(
    title="Hydrocarbon Accounting API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from app.routers import (
    asset_assignments, asset_calibration_tables, asset_types, assets,
    audit_logs, auth, backup_restore, barge_seal_master, barge_trip_tracking,
    calibration_templates, company_report_profiles, correction_requests, dashboard,
    flowmeter_configs_records, location_operation_availability, locations,
    material_balance_templates, movement_mappings, operation_entries,
    operation_tasks, operation_templates, operation_transactions, operation_types,
    permissions, prime_mover_tanker_links, reports, role_permissions, roles,
    shuttle_fso_voyages, system_notifications, table11_factors, tank_operations,
    tank_stock_ledger, tanker_tracking, user_roles, users, vessel_operations,
    vessel_stock_ledger, workflow_policies,
)

app.include_router(asset_assignments.router)
app.include_router(asset_calibration_tables.router)
app.include_router(asset_types.router)
app.include_router(assets.router)
app.include_router(audit_logs.router)
app.include_router(auth.router)
app.include_router(backup_restore.router)
app.include_router(barge_seal_master.router)
app.include_router(barge_trip_tracking.router)
app.include_router(calibration_templates.router)
app.include_router(company_report_profiles.router)
app.include_router(correction_requests.router)
app.include_router(dashboard.router)
app.include_router(flowmeter_configs_records.router)
app.include_router(location_operation_availability.router)
app.include_router(locations.router)
app.include_router(material_balance_templates.router)
app.include_router(movement_mappings.router)
app.include_router(operation_entries.router)
app.include_router(operation_tasks.router)
app.include_router(operation_templates.router)
app.include_router(operation_templates.layout_detail_router)
app.include_router(operation_transactions.router)
app.include_router(operation_types.router)
app.include_router(permissions.router)
app.include_router(prime_mover_tanker_links.router)
app.include_router(reports.router)
app.include_router(role_permissions.router)
app.include_router(roles.router)
app.include_router(shuttle_fso_voyages.router)
app.include_router(system_notifications.router)
app.include_router(table11_factors.router)
app.include_router(tank_operations.router)
app.include_router(tank_stock_ledger.router)
app.include_router(tanker_tracking.router)
app.include_router(user_roles.router)
app.include_router(users.router)
app.include_router(vessel_operations.router)
app.include_router(vessel_stock_ledger.router)
app.include_router(workflow_policies.router)


@app.get("/")
def root():
    return {"message": "Hydrocarbon Accounting API is running"}


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-test")
def database_test(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"database": "connected"}
