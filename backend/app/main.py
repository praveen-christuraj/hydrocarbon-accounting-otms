from datetime import datetime, timedelta, date, time as datetime_time
from fastapi import Depends, FastAPI, HTTPException, Header
from fastapi.responses import StreamingResponse
import csv
import io
from jose import JWTError, jwt

from fastapi.middleware.cors import CORSMiddleware

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app = FastAPI(
    title="Hydrocarbon Accounting API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from passlib.context import CryptContext
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from pydantic import BaseModel
from fastapi.encoders import jsonable_encoder

from app.database import Base, engine, get_db
from app.models import (
    Asset,
    AssetAssignment,
    AssetCalibrationData,
    AssetCalibrationTable,
    AssetType,
    CalibrationTemplate,
    CalibrationTemplateColumn,
    Location,
    LocationAccountingDaySetting,
    LocationOperationAvailability,
    OperationTemplate,
    OperationTemplateField,
    OperationTransaction,
    OperationTransactionValue,
    OperationTransactionStatusHistory,
    OperationType,
    TankOperation,
    TankStockLedger,
    Permission,
    Role,
    RolePermission,
    User,
    UserRole,
    Table11Factor,
    BargeSealMaster,
    CompanyReportProfile,
    AuditLog,
    Trip,
    TripEvent,
    TripComparison,
)

from app.schemas import (
    AssetAssignmentCreate,
    AssetAssignmentResponse,
    AssetCalibrationTableCreate,
    AssetCalibrationTableResponse,
    AssetCreate,
    AssetResponse,
    AssetTypeCreate,
    AssetTypeResponse,
    CalibrationTemplateCreate,
    CalibrationTemplateResponse,
    LocationCreate,
    LocationResponse,
    LocationAccountingDaySettingCreate,
    LocationAccountingDaySettingResponse,
    LocationOperationAvailabilityCreate,
    LocationOperationAvailabilityResponse,
    OperationEntryCreate,
    OperationEntryResponse,
    OperationTemplateCreate,
    OperationTemplateResponse,
    OperationTransactionCreate,
    OperationTransactionResponse,
    OperationTransactionStatusUpdate,
    OperationTypeCreate,
    OperationTypeResponse,
    TankOperationCreate,
    TankOperationResponse,
    TankStockLedgerResponse,
    TankStockLedgerSummaryResponse,
    TankStockLedgerDailySummaryResponse,
    PermissionCreate,
    PermissionResponse,
    RoleCreate,
    RolePermissionResponse,
    RolePermissionSaveRequest,
    RoleResponse,
    UserCreate,
    UserResponse,
    UserRoleResponse,
    UserRoleSaveRequest,
    UserUpdate,
    Table11FactorBulkCreate,
    Table11FactorCreate,
    Table11FactorResponse,
    Table11LookupResponse,
    BargeSealMasterBulkSaveRequest,
    BargeSealMasterResponse,
    CompanyReportProfileCreate,
    CompanyReportProfileResponse,
    AuditLogResponse,
    TripCreate,
    TripResponse,
    TripEventCreate,
    TripEventResponse,
    TripComparisonCreate,
    TripComparisonResponse,
    ConvoyTrackerResponse,
)

password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_SECRET_KEY = "hydrocarbon-development-secret-key-change-later"
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480

class LoginRequest(BaseModel):
    username: str
    password: str


def hash_password(password: str):
    return password_context.hash(password)


def verify_password(plain_password: str, hashed_password: str):
    return password_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    token_data = data.copy()

    if expires_delta is None:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    else:
        expire = datetime.utcnow() + expires_delta

    token_data.update({"exp": expire})

    encoded_jwt = jwt.encode(
        token_data,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )

    return encoded_jwt


def decode_access_token(token: str):
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
        )

        return payload
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired token",
        )

def get_current_user_from_token(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    if authorization is None:
        raise HTTPException(
            status_code=401,
            detail="Authorization header is missing",
        )

    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization header",
        )

    token = authorization.replace("Bearer ", "").strip()

    payload = decode_access_token(token)

    user_id = payload.get("user_id")

    if user_id is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid token payload",
        )

    user = db.query(User).filter(User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    return user

def user_has_permission(
    user: User,
    permission_name: str,
    db: Session,
):
    user_role = (
        db.query(UserRole)
        .filter(UserRole.user_id == user.id)
        .first()
    )

    if not user_role:
        return False

    permission = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(
            RolePermission.role_id == user_role.role_id,
            Permission.permission_name == permission_name,
            Permission.status == "Active",
        )
        .first()
    )

    return permission is not None


def require_user_permission(
    user: User,
    permission_name: str,
    db: Session,
):
    if not user_has_permission(user, permission_name, db):
        raise HTTPException(
            status_code=403,
            detail=f"Permission required: {permission_name}",
        )

def get_required_permission_for_status_change(next_status: str):
    status_permission_map = {
        "Draft": "Submit Operation Transaction",
        "Submitted": "Submit Operation Transaction",
        "Approved": "Approve Operation Transaction",
        "Rejected": "Reject Operation Transaction",
        "Cancelled": "Cancel Operation Transaction",
    }

    return status_permission_map.get(next_status)

def build_logged_in_user_response(user: User, db: Session):
    user_role_assignment = (
        db.query(UserRole, Role)
        .join(Role, Role.id == UserRole.role_id)
        .filter(UserRole.user_id == user.id)
        .first()
    )

    role_data = None
    permissions_data = []

    if user_role_assignment:
        user_role, role = user_role_assignment

        role_data = {
            "id": role.id,
            "role_name": role.role_name,
            "description": role.description,
            "status": role.status,
        }

        permissions = (
            db.query(Permission)
            .join(RolePermission, RolePermission.permission_id == Permission.id)
            .filter(RolePermission.role_id == role.id)
            .order_by(Permission.module_name, Permission.permission_name)
            .all()
        )

        permissions_data = [
            {
                "id": permission.id,
                "permission_name": permission.permission_name,
                "module_name": permission.module_name,
                "description": permission.description,
                "status": permission.status,
            }
            for permission in permissions
        ]

    return {
        "id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "email": user.email,
        "phone": user.phone,
        "department": user.department,
        "designation": user.designation,
        "status": user.status,
        "role": role_data,
        "permissions": permissions_data,
    }


def clean_optional_text(value):
    if value is None:
        return None

    cleaned_value = str(value).strip()

    if cleaned_value == "":
        return None

    return cleaned_value

def ensure_operation_ticket_number_column():
    with engine.connect() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE operation_transactions
                ADD COLUMN IF NOT EXISTS operation_ticket_number VARCHAR(100);
                """
            )
        )

        connection.execute(
            text(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS
                ix_operation_transactions_operation_ticket_number
                ON operation_transactions(operation_ticket_number)
                WHERE operation_ticket_number IS NOT NULL;
                """
            )
        )

        connection.commit()


def ensure_operation_template_layout_columns():
    with engine.connect() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ADD COLUMN IF NOT EXISTS entry_layout_type VARCHAR(80);
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ADD COLUMN IF NOT EXISTS calculation_engine VARCHAR(100);
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE operation_templates
                SET entry_layout_type = 'Standard Form'
                WHERE entry_layout_type IS NULL OR TRIM(entry_layout_type) = '';
                """
            )
        )

        connection.execute(
            text(
                """
                UPDATE operation_templates
                SET calculation_engine = 'None'
                WHERE calculation_engine IS NULL OR TRIM(calculation_engine) = '';
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ALTER COLUMN entry_layout_type SET DEFAULT 'Standard Form';
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE operation_templates
                ALTER COLUMN calculation_engine SET DEFAULT 'None';
                """
            )
        )

        connection.commit()


def ensure_tank_stock_ledger_accounting_columns():
    with engine.connect() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_date DATE;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_start TIMESTAMP;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_end TIMESTAMP;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS accounting_day_setting_id INTEGER;
                """
            )
        )

        connection.commit()

def ensure_tank_stock_ledger_stock_snapshot_columns():
    with engine.connect() as connection:
        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_gsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_nsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_lt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS stock_mt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_gsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_nsv_bbl DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_lt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.execute(
            text(
                """
                ALTER TABLE tank_stock_ledger
                ADD COLUMN IF NOT EXISTS previous_stock_mt DOUBLE PRECISION DEFAULT 0;
                """
            )
        )

        connection.commit()

Base.metadata.create_all(bind=engine)
ensure_operation_ticket_number_column()
ensure_operation_template_layout_columns()
ensure_tank_stock_ledger_accounting_columns()
ensure_tank_stock_ledger_stock_snapshot_columns()


@app.get("/")
def root():
    return {
        "message": "Hydrocarbon Accounting API is running"
    }


@app.get("/health")
def health_check():
    return {
        "status": "ok"
    }


@app.get("/db-test")
def database_test(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))

    return {
        "database": "connected"
    }

# -------------------------
# Authentication APIs
# -------------------------

@app.post("/auth/login")
def login_user(
    login_request: LoginRequest,
    db: Session = Depends(get_db),
):
    username = login_request.username.strip()

    if username == "":
        raise HTTPException(
            status_code=400,
            detail="Username is required",
        )

    if login_request.password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Password is required",
        )

    user = (
        db.query(User)
        .filter(User.username.ilike(username))
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=403,
            detail="User is not Active",
        )

    if not verify_password(login_request.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Invalid username or password",
        )

    logged_in_user = build_logged_in_user_response(user, db)

    access_token = create_access_token(
        data={
            "user_id": user.id,
            "username": user.username,
        }
    )

    return {
        "message": "Login successful",
        "access_token": access_token,
        "token_type": "bearer",
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "permissions": logged_in_user["permissions"],
    }

@app.get("/auth/me")
def get_logged_in_user(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    logged_in_user = build_logged_in_user_response(current_user, db)

    return {
        "user": logged_in_user,
        "role": logged_in_user["role"],
        "permissions": logged_in_user["permissions"],
    }


class DevResetPasswordRequest(BaseModel):
    username: str
    new_password: str


@app.post("/auth/dev-reset-password")
def dev_reset_password(
    reset_request: DevResetPasswordRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # Dev endpoint: restrict it
    require_user_permission(
        current_user,
        "Manage User",
        db,
    )

    username = reset_request.username.strip()

    if username == "":
        raise HTTPException(
            status_code=400,
            detail="Username is required",
        )

    if reset_request.new_password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="New password is required",
        )

    user = (
        db.query(User)
        .filter(User.username.ilike(username))
        .first()
    )

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # Snapshot (do NOT log password)
    before_data = {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "status": user.status,
    }

    user.password_hash = hash_password(reset_request.new_password)
    db.flush()

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Dev Reset Password",
        current_user=current_user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})",
        remarks="Password reset via dev endpoint",
        request_path="/auth/dev-reset-password",
        details={
            "target_user": before_data,
            "password_reset": True,
        },
    )

    db.commit()

    return {
        "message": "Password reset successfully",
        "username": user.username,
    }


# -------------------------
# User APIs
# -------------------------

@app.get("/users", response_model=list[UserResponse])
def get_users(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View User",
        db,
    )

    users = db.query(User).order_by(User.id).all()
    return users


@app.post("/users", response_model=UserResponse)
def create_user(
    user: UserCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User",
        db,
    )

    existing_user = (
        db.query(User)
        .filter(User.username.ilike(user.username))
        .first()
    )

    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    if user.password.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Password is required",
        )

    new_user = User(
        full_name=user.full_name.strip(),
        username=user.username.strip(),
        email=user.email.strip(),
        phone=clean_optional_text(user.phone),
        department=clean_optional_text(user.department),
        designation=clean_optional_text(user.designation),
        password_hash=hash_password(user.password),
        status=user.status,
    )

    db.add(new_user)
    db.flush()  # get id for audit log

    after_data = {
        "full_name": new_user.full_name,
        "username": new_user.username,
        "email": new_user.email,
        "phone": new_user.phone,
        "department": new_user.department,
        "designation": new_user.designation,
        "status": new_user.status,
    }

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Create User",
        current_user=current_user,
        entity_type="User",
        entity_id=new_user.id,
        entity_label=f"{new_user.full_name} ({new_user.username})",
        remarks="User created",
        request_path="/users",
        details={
            "after": after_data,
            "password_set": True,
        },
    )

    db.commit()
    db.refresh(new_user)

    return new_user


@app.put("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user: UserUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    duplicate_user = (
        db.query(User)
        .filter(
            User.username.ilike(user.username),
            User.id != user_id,
        )
        .first()
    )

    if duplicate_user:
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    before_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

    password_changed = False

    existing_user.full_name = user.full_name.strip()
    existing_user.username = user.username.strip()
    existing_user.email = user.email.strip()
    existing_user.phone = clean_optional_text(user.phone)
    existing_user.department = clean_optional_text(user.department)
    existing_user.designation = clean_optional_text(user.designation)
    existing_user.status = user.status

    if user.password is not None and user.password.strip() != "":
        existing_user.password_hash = hash_password(user.password)
        password_changed = True

    after_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Update User",
        current_user=current_user,
        entity_type="User",
        entity_id=existing_user.id,
        entity_label=f"{existing_user.full_name} ({existing_user.username})",
        remarks="User updated",
        request_path=f"/users/{user_id}",
        details={
            "before": before_data,
            "after": after_data,
            "password_changed": password_changed,
        },
    )

    db.commit()
    db.refresh(existing_user)

    return existing_user


@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User",
        db,
    )

    existing_user = db.query(User).filter(User.id == user_id).first()

    if not existing_user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if existing_user.id == current_user.id:
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own logged-in user account",
        )

    assigned_role = (
        db.query(UserRole)
        .filter(UserRole.user_id == user_id)
        .first()
    )

    if assigned_role:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete user because a role is assigned. Remove user role assignment first.",
        )

    deleted_data = {
        "full_name": existing_user.full_name,
        "username": existing_user.username,
        "email": existing_user.email,
        "phone": existing_user.phone,
        "department": existing_user.department,
        "designation": existing_user.designation,
        "status": existing_user.status,
    }

    create_audit_log(
        db=db,
        module_name="User Master",
        action="Delete User",
        current_user=current_user,
        entity_type="User",
        entity_id=existing_user.id,
        entity_label=f"{existing_user.full_name} ({existing_user.username})",
        remarks="User deleted",
        request_path=f"/users/{user_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_user)
    db.commit()

    return {
        "message": "User deleted successfully"
    }


# -------------------------
# Role APIs
# -------------------------

@app.get("/roles", response_model=list[RoleResponse])
def get_roles(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Role",
        db,
    )

    roles = db.query(Role).order_by(Role.id).all()
    return roles


@app.post("/roles", response_model=RoleResponse)
def create_role(
    role: RoleCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = (
        db.query(Role)
        .filter(Role.role_name.ilike(role.role_name))
        .first()
    )

    if existing_role:
        raise HTTPException(
            status_code=400,
            detail="Role name already exists",
        )

    new_role = Role(
        role_name=role.role_name.strip(),
        description=clean_optional_text(role.description),
        status=role.status,
    )

    db.add(new_role)
    db.flush()  # get new_role.id before audit log

    role_data = {
        "role_name": new_role.role_name,
        "description": new_role.description,
        "status": new_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Create Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=new_role.id,
        entity_label=new_role.role_name,
        remarks="Role created",
        request_path="/roles",
        details={
            "after": role_data,
        },
    )

    db.commit()
    db.refresh(new_role)

    return new_role


@app.put("/roles/{role_id}", response_model=RoleResponse)
def update_role(
    role_id: int,
    role: RoleCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = db.query(Role).filter(Role.id == role_id).first()

    if not existing_role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    duplicate_role = (
        db.query(Role)
        .filter(
            Role.role_name.ilike(role.role_name),
            Role.id != role_id,
        )
        .first()
    )

    if duplicate_role:
        raise HTTPException(
            status_code=400,
            detail="Role name already exists",
        )

    old_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    existing_role.role_name = role.role_name.strip()
    existing_role.description = clean_optional_text(role.description)
    existing_role.status = role.status

    new_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Update Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=existing_role.id,
        entity_label=existing_role.role_name,
        remarks="Role updated",
        request_path=f"/roles/{role_id}",
        details={
            "before": old_role_data,
            "after": new_role_data,
        },
    )

    db.commit()
    db.refresh(existing_role)

    return existing_role


@app.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role",
        db,
    )

    existing_role = db.query(Role).filter(Role.id == role_id).first()

    if not existing_role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    user_role = db.query(UserRole).filter(UserRole.role_id == role_id).first()

    if user_role:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete role because it is assigned to users",
        )

    role_permission = (
        db.query(RolePermission)
        .filter(RolePermission.role_id == role_id)
        .first()
    )

    if role_permission:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete role because permissions are assigned to it",
        )

    deleted_role_data = {
        "role_name": existing_role.role_name,
        "description": existing_role.description,
        "status": existing_role.status,
    }

    create_audit_log(
        db=db,
        module_name="Role Master",
        action="Delete Role",
        current_user=current_user,
        entity_type="Role",
        entity_id=existing_role.id,
        entity_label=existing_role.role_name,
        remarks="Role deleted",
        request_path=f"/roles/{role_id}",
        details={
            "deleted": deleted_role_data,
        },
    )

    db.delete(existing_role)
    db.commit()

    return {
        "message": "Role deleted successfully"
    }

# -------------------------
# Permission APIs
# -------------------------

@app.get("/permissions", response_model=list[PermissionResponse])
def get_permissions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Permission",
        db,
    )

    permissions = db.query(Permission).order_by(Permission.id).all()
    return permissions


@app.post("/permissions", response_model=PermissionResponse)
def create_permission(
    permission: PermissionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(
            Permission.permission_name.ilike(permission.permission_name),
            Permission.module_name.ilike(permission.module_name),
        )
        .first()
    )

    if existing_permission:
        raise HTTPException(
            status_code=400,
            detail="Permission already exists for this module",
        )

    new_permission = Permission(
        permission_name=permission.permission_name.strip(),
        module_name=permission.module_name.strip(),
        description=clean_optional_text(permission.description),
        status=permission.status,
    )

    db.add(new_permission)
    db.flush()  # get new_permission.id before audit log

    after_data = {
        "permission_name": new_permission.permission_name,
        "module_name": new_permission.module_name,
        "description": new_permission.description,
        "status": new_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Create Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=new_permission.id,
        entity_label=f"{new_permission.module_name} - {new_permission.permission_name}",
        remarks="Permission created",
        request_path="/permissions",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_permission)

    return new_permission

@app.put("/permissions/{permission_id}", response_model=PermissionResponse)
def update_permission(
    permission_id: int,
    permission: PermissionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(Permission.id == permission_id)
        .first()
    )

    if not existing_permission:
        raise HTTPException(
            status_code=404,
            detail="Permission not found",
        )

    duplicate_permission = (
        db.query(Permission)
        .filter(
            Permission.permission_name.ilike(permission.permission_name),
            Permission.module_name.ilike(permission.module_name),
            Permission.id != permission_id,
        )
        .first()
    )

    if duplicate_permission:
        raise HTTPException(
            status_code=400,
            detail="Permission already exists for this module",
        )

    before_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    existing_permission.permission_name = permission.permission_name.strip()
    existing_permission.module_name = permission.module_name.strip()
    existing_permission.description = clean_optional_text(permission.description)
    existing_permission.status = permission.status

    after_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Update Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=existing_permission.id,
        entity_label=f"{existing_permission.module_name} - {existing_permission.permission_name}",
        remarks="Permission updated",
        request_path=f"/permissions/{permission_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_permission)

    return existing_permission


@app.delete("/permissions/{permission_id}")
def delete_permission(
    permission_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    existing_permission = (
        db.query(Permission)
        .filter(Permission.id == permission_id)
        .first()
    )

    if not existing_permission:
        raise HTTPException(
            status_code=404,
            detail="Permission not found",
        )

    role_permission = (
        db.query(RolePermission)
        .filter(RolePermission.permission_id == permission_id)
        .first()
    )

    if role_permission:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete permission because it is assigned to roles",
        )

    deleted_data = {
        "permission_name": existing_permission.permission_name,
        "module_name": existing_permission.module_name,
        "description": existing_permission.description,
        "status": existing_permission.status,
    }

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Delete Permission",
        current_user=current_user,
        entity_type="Permission",
        entity_id=existing_permission.id,
        entity_label=f"{existing_permission.module_name} - {existing_permission.permission_name}",
        remarks="Permission deleted",
        request_path=f"/permissions/{permission_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_permission)
    db.commit()

    return {
        "message": "Permission deleted successfully"
    }

# -------------------------
# Permission Seed API
# -------------------------

@app.post("/permissions/seed-standard")
def seed_standard_permissions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Permission",
        db,
    )

    standard_permissions = [
        # (keep your existing list unchanged)
        # User Management
        {
            "permission_name": "View User",
            "module_name": "User Master",
            "description": "Can view users",
        },
        {
            "permission_name": "Manage User",
            "module_name": "User Master",
            "description": "Can create, update, and delete users",
        },
        {
            "permission_name": "View Role",
            "module_name": "Role Master",
            "description": "Can view roles",
        },
        {
            "permission_name": "Manage Role",
            "module_name": "Role Master",
            "description": "Can create, update, and delete roles",
        },
        {
            "permission_name": "View Permission",
            "module_name": "Permission Master",
            "description": "Can view permissions",
        },
        {
            "permission_name": "Manage Permission",
            "module_name": "Permission Master",
            "description": "Can create, update, and delete permissions",
        },
        {
            "permission_name": "View Role Permission Assignment",
            "module_name": "Role Permission Assignment",
            "description": "Can view role permission assignments",
        },
        {
            "permission_name": "Manage Role Permission Assignment",
            "module_name": "Role Permission Assignment",
            "description": "Can assign permissions to roles",
        },
        {
            "permission_name": "View User Role Assignment",
            "module_name": "User Role Assignment",
            "description": "Can view user role assignments",
        },
        {
            "permission_name": "Manage User Role Assignment",
            "module_name": "User Role Assignment",
            "description": "Can assign roles to users",
        },
        {
            "permission_name": "View Access Summary",
            "module_name": "Access Summary",
            "description": "Can view final RBAC access summary",
        },

        # Master Data
        {
            "permission_name": "View Location",
            "module_name": "Location Master",
            "description": "Can view locations",
        },
        {
            "permission_name": "Manage Location",
            "module_name": "Location Master",
            "description": "Can create, update, and delete locations",
        },
        {
            "permission_name": "View Location Accounting Day Setting",
            "module_name": "Location Accounting Day Setting",
            "description": "Can view location-wise accounting day settings",
        },
        {
            "permission_name": "Manage Location Accounting Day Setting",
            "module_name": "Location Accounting Day Setting",
            "description": "Can create, update, and delete location-wise accounting day settings",
        },
        {
            "permission_name": "View Asset Type",
            "module_name": "Asset Type Master",
            "description": "Can view asset types",
        },
        {
            "permission_name": "Manage Asset Type",
            "module_name": "Asset Type Master",
            "description": "Can create, update, and delete asset types",
        },
        {
            "permission_name": "View Asset",
            "module_name": "Asset Master",
            "description": "Can view assets",
        },
        {
            "permission_name": "Manage Asset",
            "module_name": "Asset Master",
            "description": "Can create, update, and delete assets",
        },
        {
            "permission_name": "View Calibration Template",
            "module_name": "Calibration Template Master",
            "description": "Can view calibration templates",
        },
        {
            "permission_name": "Manage Calibration Template",
            "module_name": "Calibration Template Master",
            "description": "Can create, update, and delete calibration templates",
        },
        {
            "permission_name": "View Asset Calibration",
            "module_name": "Asset Calibration Table",
            "description": "Can view asset calibration tables",
        },
        {
            "permission_name": "Manage Asset Calibration",
            "module_name": "Asset Calibration Table",
            "description": "Can create, upload, update, and delete calibration data",
        },
        {
            "permission_name": "View Asset Assignment",
            "module_name": "Asset Assignment",
            "description": "Can view asset assignments",
        },
        {
            "permission_name": "Manage Asset Assignment",
            "module_name": "Asset Assignment",
            "description": "Can create, update, and delete asset assignments",
        },
        {
            "permission_name": "View Asset Assignment Summary",
            "module_name": "Asset Assignment Summary",
            "description": "Can view asset assignment summary",
        },

        # Operations
        {
            "permission_name": "View Operation Type",
            "module_name": "Operations",
            "description": "Can view operation type master",
        },
        {
            "permission_name": "Manage Operation Type",
            "module_name": "Operations",
            "description": "Can create, update, and delete operation types",
        },
        {
            "permission_name": "View Tank Operation",
            "module_name": "Operations",
            "description": "Can view location-wise tank operation master",
        },
        {
            "permission_name": "Manage Tank Operation",
            "module_name": "Operations",
            "description": "Can create, update, and delete location-wise tank operations",
        },
        {
            "permission_name": "View Tank Stock Ledger",
            "module_name": "Operations",
            "description": "Can view tank stock ledger and stock movement summary",
        },
        {
            "permission_name": "Manage Tank Stock Ledger",
            "module_name": "Operations",
            "description": "Can rebuild or manage tank stock ledger entries",
        },
        {
            "permission_name": "View Location Operation Availability",
            "module_name": "Operations",
            "description": "Can view location operation availability",
        },
        {
            "permission_name": "Manage Location Operation Availability",
            "module_name": "Operations",
            "description": "Can configure operation availability by location",
        },
        {
            "permission_name": "View Operation Template",
            "module_name": "Operations",
            "description": "Can view operation templates",
        },
        {
            "permission_name": "Manage Operation Template",
            "module_name": "Operations",
            "description": "Can create, update, and delete operation templates",
        },
        {
            "permission_name": "Create Operation Entry",
            "module_name": "Operations",
            "description": "Can create new operation tickets from Operation Entry",
        },
        {
            "permission_name": "View Operation Transaction",
            "module_name": "Operations",
            "description": "Can view operation transaction register and detail",
        },
        {
            "permission_name": "Submit Operation Transaction",
            "module_name": "Operations",
            "description": "Can submit draft operation tickets",
        },
        {
            "permission_name": "Approve Operation Transaction",
            "module_name": "Operations",
            "description": "Can approve submitted operation tickets",
        },
        {
            "permission_name": "Reject Operation Transaction",
            "module_name": "Operations",
            "description": "Can reject submitted operation tickets",
        },
        {
            "permission_name": "Cancel Operation Transaction",
            "module_name": "Operations",
            "description": "Can cancel draft or rejected operation tickets",
        },
        # Barge Seal Master
        {
            "permission_name": "View Barge Seal Master",
            "module_name": "Barge Seal Master",
            "description": "Can view barge seal master",
        },
        {
            "permission_name": "Manage Barge Seal Master",
            "module_name": "Barge Seal Master",
            "description": "Can create/update barge seal master",
        },
        # Company / Report Profiles
        {
            "permission_name": "View Company Report Profile",
            "module_name": "Company Report Profile",
            "description": "Can view company report profiles used for printable reports",
        },
        {
            "permission_name": "Manage Company Report Profile",
            "module_name": "Company Report Profile",
            "description": "Can create, update, and delete company report profiles",
        },

        # Audit Logs
        {
            "permission_name": "View Audit Log",
            "module_name": "Audit Log",
            "description": "Can view system audit logs",
        },

        # Reports / Admin Future
        {
            "permission_name": "View Reports",
            "module_name": "Reports",
            "description": "Can view reports",
        },
        {
            "permission_name": "Export Reports",
            "module_name": "Reports",
            "description": "Can export reports",
        },
        {
            "permission_name": "View Admin Settings",
            "module_name": "Admin",
            "description": "Can view admin settings",
        },
        {
            "permission_name": "Manage Admin Settings",
            "module_name": "Admin",
            "description": "Can manage admin settings",
        },
    ]

    created_count = 0
    existing_count = 0

    for permission_data in standard_permissions:
        existing_permission = (
            db.query(Permission)
            .filter(
                Permission.permission_name.ilike(permission_data["permission_name"]),
                Permission.module_name.ilike(permission_data["module_name"]),
            )
            .first()
        )

        if existing_permission:
            existing_count += 1
            continue

        new_permission = Permission(
            permission_name=permission_data["permission_name"],
            module_name=permission_data["module_name"],
            description=permission_data["description"],
            status="Active",
        )

        db.add(new_permission)
        created_count += 1

    create_audit_log(
        db=db,
        module_name="Permission Master",
        action="Seed Standard Permissions",
        current_user=current_user,
        entity_type="Permission",
        entity_id=None,
        entity_label="Standard Permission Seed",
        remarks="Seeded standard permissions",
        request_path="/permissions/seed-standard",
        details={
            "created_count": created_count,
            "existing_count": existing_count,
            "total_standard_permissions": len(standard_permissions),
        },
    )

    db.commit()

    return {
        "message": "Standard permissions seed completed",
        "created_count": created_count,
        "existing_count": existing_count,
        "total_standard_permissions": len(standard_permissions),
    }

# -------------------------
# Role Permission Assignment APIs
# -------------------------

def build_role_permission_response(
    role: Role,
    db: Session,
):
    assigned_permissions = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role.id)
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )

    return {
        "role_id": role.id,
        "role_name": role.role_name,
        "permissions": [
            {
                "id": permission.id,
                "permission_id": permission.id,
                "permission_name": permission.permission_name,
                "module_name": permission.module_name,
                "description": permission.description,
                "status": permission.status,
            }
            for permission in assigned_permissions
        ],
    }


@app.get("/role-permissions", response_model=list[RolePermissionResponse])
def get_all_role_permissions(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Role Permission Assignment",
        db,
    )

    roles = db.query(Role).order_by(Role.id).all()

    return [
        build_role_permission_response(role, db)
        for role in roles
    ]


@app.get("/role-permissions/{role_id}", response_model=RolePermissionResponse)
def get_role_permissions(
    role_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Role Permission Assignment",
        db,
    )

    role = db.query(Role).filter(Role.id == role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    return build_role_permission_response(role, db)


@app.post("/role-permissions/{role_id}", response_model=RolePermissionResponse)
def save_role_permissions(
    role_id: int,
    request: RolePermissionSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Role Permission Assignment",
        db,
    )

    role = db.query(Role).filter(Role.id == role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # --- BEFORE snapshot (current permissions for this role) ---
    before_assigned_permissions = (
        db.query(Permission)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .filter(RolePermission.role_id == role_id)
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )

    before_permission_ids = [p.id for p in before_assigned_permissions]

    before_permissions_info = [
        {
            "id": p.id,
            "permission_name": p.permission_name,
            "module_name": p.module_name,
            "status": p.status,
        }
        for p in before_assigned_permissions
    ]

    # Validate request: no duplicates
    if len(request.permission_ids) != len(set(request.permission_ids)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate permission IDs are not allowed",
        )

    # Validate request: all IDs exist
    permissions = (
        db.query(Permission)
        .filter(Permission.id.in_(request.permission_ids))
        .order_by(Permission.module_name, Permission.permission_name)
        .all()
    )

    if len(permissions) != len(request.permission_ids):
        raise HTTPException(
            status_code=400,
            detail="One or more permission IDs are invalid",
        )

    after_permission_ids = sorted(request.permission_ids)

    after_permissions_info = [
        {
            "id": p.id,
            "permission_name": p.permission_name,
            "module_name": p.module_name,
            "status": p.status,
        }
        for p in permissions
    ]

    before_set = set(before_permission_ids)
    after_set = set(after_permission_ids)

    added_permission_ids = sorted(list(after_set - before_set))
    removed_permission_ids = sorted(list(before_set - after_set))

    changed = (len(added_permission_ids) > 0) or (len(removed_permission_ids) > 0)

    # --- Apply change: replace all assignments ---
    db.query(RolePermission).filter(
        RolePermission.role_id == role_id
    ).delete()

    for permission_id in after_permission_ids:
        db.add(
            RolePermission(
                role_id=role_id,
                permission_id=permission_id,
            )
        )

    # --- Audit log (same transaction) ---
    create_audit_log(
        db=db,
        module_name="Role Permission Assignment",
        action="Update Role Permission Assignment",
        current_user=current_user,
        entity_type="Role",
        entity_id=role.id,
        entity_label=role.role_name,
        remarks=(
            "Role permissions updated"
            if changed
            else "Role permissions saved (no change)"
        ),
        request_path=f"/role-permissions/{role_id}",
        details={
            "role": {
                "id": role.id,
                "role_name": role.role_name,
            },
            "changed": changed,
            "before_permission_ids": sorted(before_permission_ids),
            "after_permission_ids": after_permission_ids,
            "added_permission_ids": added_permission_ids,
            "removed_permission_ids": removed_permission_ids,
            "before_permissions": before_permissions_info,
            "after_permissions": after_permissions_info,
            "counts": {
                "before": len(before_permission_ids),
                "after": len(after_permission_ids),
                "added": len(added_permission_ids),
                "removed": len(removed_permission_ids),
            },
        },
    )

    db.commit()

    return build_role_permission_response(role, db)


# -------------------------
# User Role Assignment APIs
# -------------------------

@app.get("/user-roles", response_model=list[UserRoleResponse])
def get_user_roles(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View User Role Assignment",
        db,
    )

    assignments = (
        db.query(UserRole, User, Role)
        .join(User, User.id == UserRole.user_id)
        .join(Role, Role.id == UserRole.role_id)
        .order_by(User.full_name, User.username)
        .all()
    )

    return [
        {
            "id": assignment.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "role_id": role.id,
            "role_name": role.role_name,
        }
        for assignment, user, role in assignments
    ]


@app.post("/user-roles", response_model=UserRoleResponse)
def save_user_role(
    request: UserRoleSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User Role Assignment",
        db,
    )

    user = db.query(User).filter(User.id == request.user_id).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    if user.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active users can be assigned roles",
        )

    role = db.query(Role).filter(Role.id == request.role_id).first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    if role.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active roles can be assigned to users",
        )

    existing_assignment = (
        db.query(UserRole)
        .filter(UserRole.user_id == request.user_id)
        .first()
    )

    # -------------------------
    # UPDATE existing assignment
    # -------------------------
    if existing_assignment:
        old_role = db.query(Role).filter(Role.id == existing_assignment.role_id).first()

        before_role = {
            "role_id": existing_assignment.role_id,
            "role_name": old_role.role_name if old_role else None,
        }

        after_role = {
            "role_id": role.id,
            "role_name": role.role_name,
        }

        changed = (before_role["role_id"] != after_role["role_id"])

        existing_assignment.role_id = request.role_id

        create_audit_log(
            db=db,
            module_name="User Role Assignment",
            action="Update User Role Assignment",
            current_user=current_user,
            entity_type="User",
            entity_id=user.id,
            entity_label=f"{user.full_name} ({user.username})",
            remarks="User role updated" if changed else "User role saved (no change)",
            request_path="/user-roles",
            details={
                "changed": changed,
                "assignment_id": existing_assignment.id,
                "user": {
                    "user_id": user.id,
                    "full_name": user.full_name,
                    "username": user.username,
                    "status": user.status,
                },
                "before_role": before_role,
                "after_role": after_role,
            },
        )

        db.commit()
        db.refresh(existing_assignment)

        return {
            "id": existing_assignment.id,
            "user_id": user.id,
            "full_name": user.full_name,
            "username": user.username,
            "role_id": role.id,
            "role_name": role.role_name,
        }

    # -------------------------
    # CREATE new assignment
    # -------------------------
    new_assignment = UserRole(
        user_id=request.user_id,
        role_id=request.role_id,
    )

    db.add(new_assignment)
    db.flush()  # get id before audit log

    create_audit_log(
        db=db,
        module_name="User Role Assignment",
        action="Create User Role Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=user.id,
        entity_label=f"{user.full_name} ({user.username})",
        remarks="User role assigned",
        request_path="/user-roles",
        details={
            "assignment_id": new_assignment.id,
            "user": {
                "user_id": user.id,
                "full_name": user.full_name,
                "username": user.username,
                "status": user.status,
            },
            "assigned_role": {
                "role_id": role.id,
                "role_name": role.role_name,
            },
        },
    )

    db.commit()
    db.refresh(new_assignment)

    return {
        "id": new_assignment.id,
        "user_id": user.id,
        "full_name": user.full_name,
        "username": user.username,
        "role_id": role.id,
        "role_name": role.role_name,
    }


@app.delete("/user-roles/{assignment_id}")
def delete_user_role(
    assignment_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage User Role Assignment",
        db,
    )

    assignment = db.query(UserRole).filter(UserRole.id == assignment_id).first()

    if not assignment:
        raise HTTPException(
            status_code=404,
            detail="User role assignment not found",
        )

    user = db.query(User).filter(User.id == assignment.user_id).first()
    role = db.query(Role).filter(Role.id == assignment.role_id).first()

    # Audit BEFORE delete
    create_audit_log(
        db=db,
        module_name="User Role Assignment",
        action="Delete User Role Assignment",
        current_user=current_user,
        entity_type="User",
        entity_id=assignment.user_id,
        entity_label=(
            f"{user.full_name} ({user.username})" if user else f"UserId={assignment.user_id}"
        ),
        remarks="User role assignment deleted",
        request_path=f"/user-roles/{assignment_id}",
        details={
            "assignment_id": assignment.id,
            "user": {
                "user_id": user.id if user else assignment.user_id,
                "full_name": user.full_name if user else None,
                "username": user.username if user else None,
                "status": user.status if user else None,
            },
            "removed_role": {
                "role_id": assignment.role_id,
                "role_name": role.role_name if role else None,
            },
        },
    )

    db.delete(assignment)
    db.commit()

    return {
        "message": "User role assignment deleted successfully"
    }

# -------------------------
# Location APIs
# -------------------------

@app.get("/locations", response_model=list[LocationResponse])
def get_locations(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Location",
        db,
    )

    locations = db.query(Location).order_by(Location.id).all()
    return locations


@app.post("/locations", response_model=LocationResponse)
def create_location(
    location: LocationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = (
        db.query(Location)
        .filter(Location.location_code.ilike(location.location_code))
        .first()
    )

    if existing_location:
        raise HTTPException(status_code=400, detail="Location code already exists")

    if location.parent_location_code:
        parent_location = (
            db.query(Location)
            .filter(Location.location_code.ilike(location.parent_location_code))
            .first()
        )

        if not parent_location:
            raise HTTPException(status_code=400, detail="Parent location not found")

    new_location = Location(
        location_name=location.location_name,
        location_code=location.location_code,
        location_type=location.location_type,
        parent_location_code=location.parent_location_code,
        description=location.description,
        status=location.status,
    )

    db.add(new_location)
    db.flush()  # get id before audit

    after_data = {
        "location_name": new_location.location_name,
        "location_code": new_location.location_code,
        "location_type": new_location.location_type,
        "parent_location_code": new_location.parent_location_code,
        "description": new_location.description,
        "status": new_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Create Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=new_location.id,
        entity_label=f"{new_location.location_name} ({new_location.location_code})",
        remarks="Location created",
        request_path="/locations",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_location)
    return new_location


@app.put("/locations/{location_id}", response_model=LocationResponse)
def update_location(
    location_id: int,
    location: LocationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = db.query(Location).filter(Location.id == location_id).first()

    if not existing_location:
        raise HTTPException(status_code=404, detail="Location not found")

    duplicate_location = (
        db.query(Location)
        .filter(
            Location.location_code.ilike(location.location_code),
            Location.id != location_id,
        )
        .first()
    )

    if duplicate_location:
        raise HTTPException(status_code=400, detail="Location code already exists")

    if (
        location.parent_location_code
        and location.parent_location_code.lower() == location.location_code.lower()
    ):
        raise HTTPException(status_code=400, detail="Location cannot be its own parent")

    if location.parent_location_code:
        parent_location = (
            db.query(Location)
            .filter(Location.location_code.ilike(location.parent_location_code))
            .first()
        )

        if not parent_location:
            raise HTTPException(status_code=400, detail="Parent location not found")

    before_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    existing_location.location_name = location.location_name
    existing_location.location_code = location.location_code
    existing_location.location_type = location.location_type
    existing_location.parent_location_code = location.parent_location_code
    existing_location.description = location.description
    existing_location.status = location.status

    after_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Update Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=existing_location.id,
        entity_label=f"{existing_location.location_name} ({existing_location.location_code})",
        remarks="Location updated",
        request_path=f"/locations/{location_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_location)
    return existing_location


@app.delete("/locations/{location_id}")
def delete_location(
    location_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Location", db)

    existing_location = db.query(Location).filter(Location.id == location_id).first()

    if not existing_location:
        raise HTTPException(status_code=404, detail="Location not found")

    child_location = (
        db.query(Location)
        .filter(Location.parent_location_code.ilike(existing_location.location_code))
        .first()
    )

    if child_location:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete location because it is used as a parent location",
        )

    deleted_data = {
        "location_name": existing_location.location_name,
        "location_code": existing_location.location_code,
        "location_type": existing_location.location_type,
        "parent_location_code": existing_location.parent_location_code,
        "description": existing_location.description,
        "status": existing_location.status,
    }

    create_audit_log(
        db=db,
        module_name="Location Master",
        action="Delete Location",
        current_user=current_user,
        entity_type="Location",
        entity_id=existing_location.id,
        entity_label=f"{existing_location.location_name} ({existing_location.location_code})",
        remarks="Location deleted",
        request_path=f"/locations/{location_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_location)
    db.commit()

    return {"message": "Location deleted successfully"}


# -------------------------
# Location Accounting Day Setting APIs
# -------------------------

def build_location_accounting_day_setting_response(
    setting: LocationAccountingDaySetting,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(setting.location_code))
        .first()
    )

    return {
        "id": setting.id,
        "location_code": setting.location_code,
        "location_name": location.location_name if location else "",
        "day_start_time": setting.day_start_time,
        "day_end_time": setting.day_end_time,
        "effective_from": setting.effective_from,
        "effective_to": setting.effective_to,
        "timezone_name": setting.timezone_name,
        "description": setting.description,
        "status": setting.status,
        "created_at": setting.created_at,
        "updated_at": setting.updated_at,
    }


def build_location_accounting_day_setting_audit_snapshot(
    setting: LocationAccountingDaySetting,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(setting.location_code))
        .first()
    )

    return {
        "id": setting.id,
        "location_code": setting.location_code,
        "location_name": location.location_name if location else "",
        "day_start_time": setting.day_start_time.strftime("%H:%M:%S")
        if setting.day_start_time
        else None,
        "day_end_time": setting.day_end_time.strftime("%H:%M:%S")
        if setting.day_end_time
        else None,
        "effective_from": str(setting.effective_from)
        if setting.effective_from
        else None,
        "effective_to": str(setting.effective_to)
        if setting.effective_to
        else None,
        "timezone_name": setting.timezone_name,
        "description": setting.description,
        "status": setting.status,
    }


def validate_location_accounting_day_setting(
    setting: LocationAccountingDaySettingCreate,
    db: Session,
    setting_id: int | None = None,
):
    location_code = str(setting.location_code or "").strip().upper()

    if location_code == "":
        raise HTTPException(
            status_code=400,
            detail="Location is required",
        )

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(location_code))
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=400,
            detail="Location not found",
        )

    if location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active locations can be configured",
        )

    if setting.effective_to is not None:
        if setting.effective_to < setting.effective_from:
            raise HTTPException(
                status_code=400,
                detail="Effective To cannot be earlier than Effective From",
            )

    timezone_name = str(setting.timezone_name or "").strip()

    if timezone_name == "":
        raise HTTPException(
            status_code=400,
            detail="Timezone is required",
        )

    if setting.day_start_time == setting.day_end_time:
        raise HTTPException(
            status_code=400,
            detail="Day Start Time and Day End Time cannot be same",
        )

    # Prevent overlapping active settings for the same location.
    # Treat NULL effective_to as open-ended far future.
    if setting.status == "Active":
        new_from = setting.effective_from
        new_to = setting.effective_to or date(9999, 12, 31)

        active_settings_query = db.query(LocationAccountingDaySetting).filter(
            LocationAccountingDaySetting.location_code.ilike(location_code),
            LocationAccountingDaySetting.status == "Active",
        )

        if setting_id is not None:
            active_settings_query = active_settings_query.filter(
                LocationAccountingDaySetting.id != setting_id
            )

        active_settings = active_settings_query.all()

        for existing in active_settings:
            existing_from = existing.effective_from
            existing_to = existing.effective_to or date(9999, 12, 31)

            overlaps = new_from <= existing_to and new_to >= existing_from

            if overlaps:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Another Active accounting day setting already exists "
                        "for this location within the selected effective period"
                    ),
                )

    return {
        "location_code": location_code,
        "timezone_name": timezone_name,
    }


@app.get(
    "/location-accounting-day-settings",
    response_model=list[LocationAccountingDaySettingResponse],
)
def get_location_accounting_day_settings(
    location_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Location Accounting Day Setting",
        db,
    )

    query = db.query(LocationAccountingDaySetting)

    cleaned_location_code = clean_optional_text(location_code)

    if cleaned_location_code:
        query = query.filter(
            LocationAccountingDaySetting.location_code.ilike(
                cleaned_location_code
            )
        )

    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(LocationAccountingDaySetting.status == cleaned_status)

    settings = (
        query.order_by(
            LocationAccountingDaySetting.location_code.asc(),
            LocationAccountingDaySetting.effective_from.desc(),
            LocationAccountingDaySetting.id.desc(),
        )
        .all()
    )

    return [
        build_location_accounting_day_setting_response(setting, db)
        for setting in settings
    ]


@app.post(
    "/location-accounting-day-settings",
    response_model=LocationAccountingDaySettingResponse,
)
def create_location_accounting_day_setting(
    setting: LocationAccountingDaySettingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    validated_data = validate_location_accounting_day_setting(
        setting=setting,
        db=db,
    )

    new_setting = LocationAccountingDaySetting(
        location_code=validated_data["location_code"],
        day_start_time=setting.day_start_time,
        day_end_time=setting.day_end_time,
        effective_from=setting.effective_from,
        effective_to=setting.effective_to,
        timezone_name=validated_data["timezone_name"],
        description=clean_optional_text(setting.description),
        status=setting.status,
    )

    db.add(new_setting)
    db.flush()

    after_data = build_location_accounting_day_setting_audit_snapshot(
        new_setting,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Create Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=new_setting.id,
        entity_label=(
            f"{new_setting.location_code} "
            f"{new_setting.day_start_time.strftime('%H:%M')} - "
            f"{new_setting.day_end_time.strftime('%H:%M')}"
        ),
        remarks="Location accounting day setting created",
        request_path="/location-accounting-day-settings",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_setting)

    return build_location_accounting_day_setting_response(new_setting, db)


@app.put(
    "/location-accounting-day-settings/{setting_id}",
    response_model=LocationAccountingDaySettingResponse,
)
def update_location_accounting_day_setting(
    setting_id: int,
    setting: LocationAccountingDaySettingCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    existing_setting = (
        db.query(LocationAccountingDaySetting)
        .filter(LocationAccountingDaySetting.id == setting_id)
        .first()
    )

    if not existing_setting:
        raise HTTPException(
            status_code=404,
            detail="Location Accounting Day Setting not found",
        )

    before_data = build_location_accounting_day_setting_audit_snapshot(
        existing_setting,
        db,
    )

    validated_data = validate_location_accounting_day_setting(
        setting=setting,
        db=db,
        setting_id=setting_id,
    )

    existing_setting.location_code = validated_data["location_code"]
    existing_setting.day_start_time = setting.day_start_time
    existing_setting.day_end_time = setting.day_end_time
    existing_setting.effective_from = setting.effective_from
    existing_setting.effective_to = setting.effective_to
    existing_setting.timezone_name = validated_data["timezone_name"]
    existing_setting.description = clean_optional_text(setting.description)
    existing_setting.status = setting.status
    existing_setting.updated_at = datetime.now()

    db.flush()

    after_data = build_location_accounting_day_setting_audit_snapshot(
        existing_setting,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Update Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=existing_setting.id,
        entity_label=(
            f"{existing_setting.location_code} "
            f"{existing_setting.day_start_time.strftime('%H:%M')} - "
            f"{existing_setting.day_end_time.strftime('%H:%M')}"
        ),
        remarks="Location accounting day setting updated",
        request_path=f"/location-accounting-day-settings/{setting_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_setting)

    return build_location_accounting_day_setting_response(existing_setting, db)


@app.delete("/location-accounting-day-settings/{setting_id}")
def delete_location_accounting_day_setting(
    setting_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Accounting Day Setting",
        db,
    )

    existing_setting = (
        db.query(LocationAccountingDaySetting)
        .filter(LocationAccountingDaySetting.id == setting_id)
        .first()
    )

    if not existing_setting:
        raise HTTPException(
            status_code=404,
            detail="Location Accounting Day Setting not found",
        )

    deleted_data = build_location_accounting_day_setting_audit_snapshot(
        existing_setting,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Location Accounting Day Setting",
        action="Delete Location Accounting Day Setting",
        current_user=current_user,
        entity_type="LocationAccountingDaySetting",
        entity_id=existing_setting.id,
        entity_label=(
            f"{existing_setting.location_code} "
            f"{existing_setting.day_start_time.strftime('%H:%M')} - "
            f"{existing_setting.day_end_time.strftime('%H:%M')}"
        ),
        remarks="Location accounting day setting deleted",
        request_path=f"/location-accounting-day-settings/{setting_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_setting)
    db.commit()

    return {
        "message": "Location Accounting Day Setting deleted successfully"
    }

# -------------------------
# Asset Type APIs
# -------------------------

@app.get("/asset-types", response_model=list[AssetTypeResponse])
def get_asset_types(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Type",
        db,
    )

    asset_types = db.query(AssetType).order_by(AssetType.id).all()
    return asset_types


@app.post("/asset-types", response_model=AssetTypeResponse)
def create_asset_type(
    asset_type: AssetTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset_type.asset_type_code)
    ).first()

    if existing_asset_type:
        raise HTTPException(status_code=400, detail="Asset Type Code already exists")

    new_asset_type = AssetType(
        asset_type_name=asset_type.asset_type_name,
        asset_type_code=asset_type.asset_type_code,
        description=asset_type.description,
        status=asset_type.status,
    )

    db.add(new_asset_type)
    db.flush()

    after_data = {
        "asset_type_name": new_asset_type.asset_type_name,
        "asset_type_code": new_asset_type.asset_type_code,
        "description": new_asset_type.description,
        "status": new_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Create Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=new_asset_type.id,
        entity_label=f"{new_asset_type.asset_type_name} ({new_asset_type.asset_type_code})",
        remarks="Asset type created",
        request_path="/asset-types",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_asset_type)
    return new_asset_type


@app.put("/asset-types/{asset_type_id}", response_model=AssetTypeResponse)
def update_asset_type(
    asset_type_id: int,
    asset_type: AssetTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.id == asset_type_id
    ).first()

    if not existing_asset_type:
        raise HTTPException(status_code=404, detail="Asset Type not found")

    duplicate_asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset_type.asset_type_code),
        AssetType.id != asset_type_id,
    ).first()

    if duplicate_asset_type:
        raise HTTPException(status_code=400, detail="Asset Type Code already exists")

    before_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    existing_asset_type.asset_type_name = asset_type.asset_type_name
    existing_asset_type.asset_type_code = asset_type.asset_type_code
    existing_asset_type.description = asset_type.description
    existing_asset_type.status = asset_type.status

    after_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Update Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=existing_asset_type.id,
        entity_label=f"{existing_asset_type.asset_type_name} ({existing_asset_type.asset_type_code})",
        remarks="Asset type updated",
        request_path=f"/asset-types/{asset_type_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_asset_type)
    return existing_asset_type


@app.delete("/asset-types/{asset_type_id}")
def delete_asset_type(
    asset_type_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Asset Type", db)

    existing_asset_type = db.query(AssetType).filter(
        AssetType.id == asset_type_id
    ).first()

    if not existing_asset_type:
        raise HTTPException(status_code=404, detail="Asset Type not found")

    used_asset = db.query(Asset).filter(
        Asset.asset_type_code.ilike(existing_asset_type.asset_type_code)
    ).first()

    if used_asset:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset type because it is already used by assets",
        )

    deleted_data = {
        "asset_type_name": existing_asset_type.asset_type_name,
        "asset_type_code": existing_asset_type.asset_type_code,
        "description": existing_asset_type.description,
        "status": existing_asset_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Type Master",
        action="Delete Asset Type",
        current_user=current_user,
        entity_type="AssetType",
        entity_id=existing_asset_type.id,
        entity_label=f"{existing_asset_type.asset_type_name} ({existing_asset_type.asset_type_code})",
        remarks="Asset type deleted",
        request_path=f"/asset-types/{asset_type_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_asset_type)
    db.commit()

    return {"message": "Asset Type deleted successfully"}

# -------------------------
# Asset APIs
# -------------------------

@app.get("/assets", response_model=list[AssetResponse])
def get_assets(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset",
        db,
    )

    assets = db.query(Asset).order_by(Asset.id).all()
    return assets


@app.post("/assets", response_model=AssetResponse)
def create_asset(
    asset: AssetCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.asset_code.ilike(asset.asset_code)
    ).first()

    if existing_asset:
        raise HTTPException(
            status_code=400,
            detail="Asset code already exists",
        )

    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if asset.asset_scope not in ["Local", "Global"]:
        raise HTTPException(
            status_code=400,
            detail="Asset scope must be Local or Global",
        )

    location_code = clean_optional_text(asset.location_code)

    if asset.asset_scope == "Local" and location_code is None:
        raise HTTPException(
            status_code=400,
            detail="Location is required for Local assets",
        )

    if asset.asset_scope == "Local":
        location = db.query(Location).filter(
            Location.location_code.ilike(location_code)
        ).first()

        if not location:
            raise HTTPException(
                status_code=400,
                detail="Location not found",
            )

        if location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active location can be used for Local assets",
            )

    new_asset = Asset(
        asset_name=asset.asset_name.strip(),
        asset_code=asset.asset_code.strip(),
        asset_scope=asset.asset_scope,
        asset_type_code=asset.asset_type_code.strip(),
        location_code=location_code if asset.asset_scope == "Local" else None,
        serial_number=clean_optional_text(asset.serial_number),
        manufacturer=clean_optional_text(asset.manufacturer),
        model=clean_optional_text(asset.model),
        commission_date=asset.commission_date,
        description=clean_optional_text(asset.description),
        status=asset.status,
    )

    db.add(new_asset)
    db.flush()  # IMPORTANT: get id before audit

    after_data = {
        "asset_name": new_asset.asset_name,
        "asset_code": new_asset.asset_code,
        "asset_scope": new_asset.asset_scope,
        "asset_type_code": new_asset.asset_type_code,
        "location_code": new_asset.location_code,
        "serial_number": new_asset.serial_number,
        "manufacturer": new_asset.manufacturer,
        "model": new_asset.model,
        "commission_date": str(new_asset.commission_date) if new_asset.commission_date else None,
        "description": new_asset.description,
        "status": new_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Create Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=new_asset.id,
        entity_label=f"{new_asset.asset_name} ({new_asset.asset_code})",
        remarks="Asset created",
        request_path="/assets",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_asset)

    return new_asset


@app.put("/assets/{asset_id}", response_model=AssetResponse)
def update_asset(
    asset_id: int,
    asset: AssetCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.id == asset_id
    ).first()

    if not existing_asset:
        raise HTTPException(
            status_code=404,
            detail="Asset not found",
        )

    duplicate_asset = db.query(Asset).filter(
        Asset.asset_code.ilike(asset.asset_code),
        Asset.id != asset_id,
    ).first()

    if duplicate_asset:
        raise HTTPException(
            status_code=400,
            detail="Asset code already exists",
        )

    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(asset.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if asset.asset_scope not in ["Local", "Global"]:
        raise HTTPException(
            status_code=400,
            detail="Asset scope must be Local or Global",
        )

    location_code = clean_optional_text(asset.location_code)

    if asset.asset_scope == "Local" and location_code is None:
        raise HTTPException(
            status_code=400,
            detail="Location is required for Local assets",
        )

    if asset.asset_scope == "Local":
        location = db.query(Location).filter(
            Location.location_code.ilike(location_code)
        ).first()

        if not location:
            raise HTTPException(
                status_code=400,
                detail="Location not found",
            )

        if location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active location can be used for Local assets",
            )

    before_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    existing_asset.asset_name = asset.asset_name.strip()
    existing_asset.asset_code = asset.asset_code.strip()
    existing_asset.asset_scope = asset.asset_scope
    existing_asset.asset_type_code = asset.asset_type_code.strip()
    existing_asset.location_code = (
        location_code if asset.asset_scope == "Local" else None
    )
    existing_asset.serial_number = clean_optional_text(asset.serial_number)
    existing_asset.manufacturer = clean_optional_text(asset.manufacturer)
    existing_asset.model = clean_optional_text(asset.model)
    existing_asset.commission_date = asset.commission_date
    existing_asset.description = clean_optional_text(asset.description)
    existing_asset.status = asset.status

    after_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Update Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=existing_asset.id,
        entity_label=f"{existing_asset.asset_name} ({existing_asset.asset_code})",
        remarks="Asset updated",
        request_path=f"/assets/{asset_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_asset)

    return existing_asset


@app.delete("/assets/{asset_id}")
def delete_asset(
    asset_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset",
        db,
    )

    existing_asset = db.query(Asset).filter(
        Asset.id == asset_id
    ).first()

    if not existing_asset:
        raise HTTPException(
            status_code=404,
            detail="Asset not found",
        )

    calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.asset_code.ilike(existing_asset.asset_code)
    ).first()

    if calibration_table:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset because calibration table exists for this asset",
        )

    assignment = db.query(AssetAssignment).filter(
        AssetAssignment.asset_code.ilike(existing_asset.asset_code)
    ).first()

    if assignment:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete asset because assignment history exists for this asset",
        )

    deleted_data = {
        "asset_name": existing_asset.asset_name,
        "asset_code": existing_asset.asset_code,
        "asset_scope": existing_asset.asset_scope,
        "asset_type_code": existing_asset.asset_type_code,
        "location_code": existing_asset.location_code,
        "serial_number": existing_asset.serial_number,
        "manufacturer": existing_asset.manufacturer,
        "model": existing_asset.model,
        "commission_date": str(existing_asset.commission_date) if existing_asset.commission_date else None,
        "description": existing_asset.description,
        "status": existing_asset.status,
    }

    create_audit_log(
        db=db,
        module_name="Asset Master",
        action="Delete Asset",
        current_user=current_user,
        entity_type="Asset",
        entity_id=existing_asset.id,
        entity_label=f"{existing_asset.asset_name} ({existing_asset.asset_code})",
        remarks="Asset deleted",
        request_path=f"/assets/{asset_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_asset)
    db.commit()

    return {"message": "Asset deleted successfully"}

# -------------------------
# Calibration Template APIs
# -------------------------

def build_calibration_template_response(
    template: CalibrationTemplate,
    db: Session,
):
    template_columns = (
        db.query(CalibrationTemplateColumn)
        .filter(CalibrationTemplateColumn.template_id == template.id)
        .order_by(
            CalibrationTemplateColumn.sort_order,
            CalibrationTemplateColumn.id,
        )
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "asset_type_code": template.asset_type_code,
        "calibration_type": template.calibration_type,
        "description": template.description,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "columns": [
            {
                "id": column.id,
                "column_name": column.column_name,
                "data_type": column.data_type,
                "unit": column.unit,
                "is_required": column.is_required,
                "interpolation_role": column.interpolation_role,
                "sort_order": column.sort_order,
            }
            for column in template_columns
        ],
    }


def validate_calibration_template(
    template: CalibrationTemplateCreate,
    db: Session,
):
    asset_type = db.query(AssetType).filter(
        AssetType.asset_type_code.ilike(template.asset_type_code)
    ).first()

    if not asset_type:
        raise HTTPException(
            status_code=400,
            detail="Asset type not found",
        )

    if len(template.columns) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one template column",
        )

    column_names = [
        column.column_name.strip().lower()
        for column in template.columns
    ]

    if len(column_names) != len(set(column_names)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate column names are not allowed in the same template",
        )

    input_x_exists = any(
        column.interpolation_role == "Input X"
        for column in template.columns
    )

    output_exists = any(
        column.interpolation_role == "Output"
        for column in template.columns
    )

    if not input_x_exists:
        raise HTTPException(
            status_code=400,
            detail="At least one column must have Interpolation Role as Input X",
        )

    if not output_exists:
        raise HTTPException(
            status_code=400,
            detail="At least one column must have Interpolation Role as Output",
        )


@app.get(
    "/calibration-templates",
    response_model=list[CalibrationTemplateResponse],
)
def get_calibration_templates(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Calibration Template",
        db,
    )

    templates = (
        db.query(CalibrationTemplate)
        .order_by(CalibrationTemplate.id)
        .all()
    )

    return [
        build_calibration_template_response(template, db)
        for template in templates
    ]


@app.post(
    "/calibration-templates",
    response_model=CalibrationTemplateResponse,
)
def create_calibration_template(
    template: CalibrationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.template_name.ilike(template.template_name)
    ).first()

    if existing_template:
        raise HTTPException(
            status_code=400,
            detail="Template name already exists",
        )

    validate_calibration_template(template, db)

    # Create template header (no commit yet)
    new_template = CalibrationTemplate(
        template_name=template.template_name.strip(),
        asset_type_code=template.asset_type_code.strip(),
        calibration_type=template.calibration_type.strip(),
        description=clean_optional_text(template.description),
        status=template.status,
    )

    db.add(new_template)
    db.flush()  # get new_template.id

    # Create template columns
    for index, column in enumerate(template.columns):
        new_column = CalibrationTemplateColumn(
            template_id=new_template.id,
            column_name=column.column_name.strip(),
            data_type=column.data_type,
            unit=clean_optional_text(column.unit),
            is_required=column.is_required,
            interpolation_role=column.interpolation_role,
            sort_order=column.sort_order or index + 1,
        )
        db.add(new_column)

    db.flush()

    after_data = build_calibration_template_response(new_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Create Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=new_template.id,
        entity_label=new_template.template_name,
        remarks="Calibration template created",
        request_path="/calibration-templates",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_template)

    return build_calibration_template_response(new_template, db)


@app.put(
    "/calibration-templates/{template_id}",
    response_model=CalibrationTemplateResponse,
)
def update_calibration_template(
    template_id: int,
    template: CalibrationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Calibration template not found",
        )

    duplicate_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.template_name.ilike(template.template_name),
        CalibrationTemplate.id != template_id,
    ).first()

    if duplicate_template:
        raise HTTPException(
            status_code=400,
            detail="Template name already exists",
        )

    validate_calibration_template(template, db)

    before_data = build_calibration_template_response(existing_template, db)

    # Update header
    existing_template.template_name = template.template_name.strip()
    existing_template.asset_type_code = template.asset_type_code.strip()
    existing_template.calibration_type = template.calibration_type.strip()
    existing_template.description = clean_optional_text(template.description)
    existing_template.status = template.status

    # Replace columns
    db.query(CalibrationTemplateColumn).filter(
        CalibrationTemplateColumn.template_id == template_id
    ).delete()

    for index, column in enumerate(template.columns):
        new_column = CalibrationTemplateColumn(
            template_id=template_id,
            column_name=column.column_name.strip(),
            data_type=column.data_type,
            unit=clean_optional_text(column.unit),
            is_required=column.is_required,
            interpolation_role=column.interpolation_role,
            sort_order=column.sort_order or index + 1,
        )
        db.add(new_column)

    db.flush()

    after_data = build_calibration_template_response(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Update Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Calibration template updated",
        request_path=f"/calibration-templates/{template_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_template)

    return build_calibration_template_response(existing_template, db)


@app.delete("/calibration-templates/{template_id}")
def delete_calibration_template(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Calibration Template",
        db,
    )

    existing_template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Calibration template not found",
        )

    used_calibration_table = (
        db.query(AssetCalibrationTable)
        .filter(AssetCalibrationTable.template_id == template_id)
        .first()
    )

    if used_calibration_table:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete calibration template because it is used by asset calibration tables",
        )

    deleted_data = build_calibration_template_response(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Calibration Template Master",
        action="Delete Calibration Template",
        current_user=current_user,
        entity_type="CalibrationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Calibration template deleted",
        request_path=f"/calibration-templates/{template_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.query(CalibrationTemplateColumn).filter(
        CalibrationTemplateColumn.template_id == template_id
    ).delete()

    db.delete(existing_template)
    db.commit()

    return {
        "message": "Calibration template deleted successfully"
    }

# -------------------------
# Asset Calibration Table APIs
# -------------------------

def build_asset_calibration_table_response(
    calibration_table: AssetCalibrationTable,
    db: Session,
):
    asset = db.query(Asset).filter(
        Asset.asset_code == calibration_table.asset_code
    ).first()

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()

    rows = (
        db.query(AssetCalibrationData)
        .filter(
            AssetCalibrationData.calibration_table_id == calibration_table.id
        )
        .order_by(AssetCalibrationData.row_number)
        .all()
    )

    return {
        "id": calibration_table.id,
        "calibration_name": calibration_table.calibration_name,
        "asset_code": calibration_table.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "template_id": calibration_table.template_id,
        "template_name": template.template_name if template else "",
        "effective_date": calibration_table.effective_date,
        "remarks": calibration_table.remarks,
        "status": calibration_table.status,
        "created_at": calibration_table.created_at,
        "updated_at": calibration_table.updated_at,
        "rows": [
            {
                "id": row.id,
                "row_number": row.row_number,
                "row_data": row.row_data,
            }
            for row in rows
        ],
    }


def validate_asset_calibration_table(
    calibration_table: AssetCalibrationTableCreate,
    db: Session,
):
    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(calibration_table.asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=400,
            detail="Calibration template not found",
        )

    if asset.asset_type_code.lower() != template.asset_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected template does not belong to this asset type",
        )

    if len(calibration_table.rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one calibration data row",
        )

    template_columns = (
        db.query(CalibrationTemplateColumn)
        .filter(CalibrationTemplateColumn.template_id == template.id)
        .order_by(CalibrationTemplateColumn.sort_order)
        .all()
    )

    required_columns = [
        column.column_name
        for column in template_columns
        if column.is_required == "Yes"
    ]

    def _norm_col(name: str) -> str:
        return str(name or "").strip().lower()

    # normalized template column -> exact template column name
    template_col_map = {
        _norm_col(col.column_name): col.column_name
        for col in template_columns
    }

    for row in calibration_table.rows:
        original = row.row_data or {}
        original_keys = list(original.keys())

        # Normalize uploaded headers to match template columns
        normalized_row_data = {}
        for k, v in original.items():
            nk = _norm_col(k)
            if nk in template_col_map:
                normalized_row_data[template_col_map[nk]] = v
            else:
                normalized_row_data[k] = v  # keep extra columns

        row.row_data = normalized_row_data

        normalized_keys = list(row.row_data.keys())
        row_keys_norm = {_norm_col(k) for k in row.row_data.keys()}

        for required_column in required_columns:
            rn = _norm_col(required_column)

            if rn not in row_keys_norm:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Required column missing: {required_column}. "
                        f"RowNumber={getattr(row, 'row_number', None)}. "
                        f"IncomingKeys={original_keys}. "
                        f"NormalizedKeys={normalized_keys}."
                    ),
                )

            template_key = template_col_map.get(rn, required_column)
            value = row.row_data.get(template_key)

            if value is None or str(value).strip() == "":
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Required column cannot be blank: {required_column}. "
                        f"RowNumber={getattr(row, 'row_number', None)}."
                    ),
                )


@app.get(
    "/asset-calibration-tables",
    response_model=list[AssetCalibrationTableResponse],
)
def get_asset_calibration_tables(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    calibration_tables = (
        db.query(AssetCalibrationTable)
        .order_by(AssetCalibrationTable.id)
        .all()
    )

    return [
        build_asset_calibration_table_response(calibration_table, db)
        for calibration_table in calibration_tables
    ]

def build_asset_calibration_table_audit_snapshot(
    calibration_table: AssetCalibrationTable,
    db: Session,
    max_rows: int = 50,
):
    asset = db.query(Asset).filter(
        Asset.asset_code == calibration_table.asset_code
    ).first()

    template = db.query(CalibrationTemplate).filter(
        CalibrationTemplate.id == calibration_table.template_id
    ).first()

    rows = (
        db.query(AssetCalibrationData)
        .filter(AssetCalibrationData.calibration_table_id == calibration_table.id)
        .order_by(AssetCalibrationData.row_number.asc())
        .all()
    )

    row_count = len(rows)

    preview_rows = rows[: max_rows]

    return {
        "id": calibration_table.id,
        "calibration_name": calibration_table.calibration_name,
        "asset_code": calibration_table.asset_code,
        "asset_name": asset.asset_name if asset else "",
        "template_id": calibration_table.template_id,
        "template_name": template.template_name if template else "",
        "effective_date": str(calibration_table.effective_date)
        if calibration_table.effective_date
        else None,
        "remarks": calibration_table.remarks,
        "status": calibration_table.status,
        "row_count": row_count,
        "row_numbers": [r.row_number for r in rows],
        "rows_preview_limit": max_rows,
        "rows_preview": [
            {
                "row_number": r.row_number,
                "row_data": r.row_data,
            }
            for r in preview_rows
        ],
    }

@app.post(
    "/asset-calibration-tables",
    response_model=AssetCalibrationTableResponse,
)
def create_asset_calibration_table(
    calibration_table: AssetCalibrationTableCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    validate_asset_calibration_table(calibration_table, db)

    new_calibration_table = AssetCalibrationTable(
        calibration_name=calibration_table.calibration_name.strip(),
        asset_code=calibration_table.asset_code.strip(),
        template_id=calibration_table.template_id,
        effective_date=calibration_table.effective_date,
        remarks=clean_optional_text(calibration_table.remarks),
        status=calibration_table.status,
    )

    db.add(new_calibration_table)
    db.flush()

    for index, row in enumerate(calibration_table.rows):
        new_row = AssetCalibrationData(
            calibration_table_id=new_calibration_table.id,
            row_number=row.row_number or index + 1,
            row_data=row.row_data,
        )
        db.add(new_row)

    db.flush()

    after_data = build_asset_calibration_table_audit_snapshot(
        new_calibration_table, db
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Create Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=new_calibration_table.id,
        entity_label=new_calibration_table.calibration_name,
        remarks="Asset calibration table created",
        request_path="/asset-calibration-tables",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_calibration_table)

    return build_asset_calibration_table_response(new_calibration_table, db)


@app.put(
    "/asset-calibration-tables/{calibration_table_id}",
    response_model=AssetCalibrationTableResponse,
)
def update_asset_calibration_table(
    calibration_table_id: int,
    calibration_table: AssetCalibrationTableCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    existing_calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.id == calibration_table_id
    ).first()

    if not existing_calibration_table:
        raise HTTPException(
            status_code=404,
            detail="Asset calibration table not found",
        )

    before_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, db
    )

    validate_asset_calibration_table(calibration_table, db)

    existing_calibration_table.calibration_name = (
        calibration_table.calibration_name.strip()
    )
    existing_calibration_table.asset_code = calibration_table.asset_code.strip()
    existing_calibration_table.template_id = calibration_table.template_id
    existing_calibration_table.effective_date = calibration_table.effective_date
    existing_calibration_table.remarks = clean_optional_text(
        calibration_table.remarks
    )
    existing_calibration_table.status = calibration_table.status

    db.query(AssetCalibrationData).filter(
        AssetCalibrationData.calibration_table_id == calibration_table_id
    ).delete()

    for index, row in enumerate(calibration_table.rows):
        new_row = AssetCalibrationData(
            calibration_table_id=calibration_table_id,
            row_number=row.row_number or index + 1,
            row_data=row.row_data,
        )
        db.add(new_row)

    db.flush()

    after_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, db
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Update Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=existing_calibration_table.id,
        entity_label=existing_calibration_table.calibration_name,
        remarks="Asset calibration table updated",
        request_path=f"/asset-calibration-tables/{calibration_table_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_calibration_table)

    return build_asset_calibration_table_response(existing_calibration_table, db)


@app.delete("/asset-calibration-tables/{calibration_table_id}")
def delete_asset_calibration_table(
    calibration_table_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    existing_calibration_table = db.query(AssetCalibrationTable).filter(
        AssetCalibrationTable.id == calibration_table_id
    ).first()

    if not existing_calibration_table:
        raise HTTPException(
            status_code=404,
            detail="Asset calibration table not found",
        )

    deleted_data = build_asset_calibration_table_audit_snapshot(
        existing_calibration_table, db
    )

    create_audit_log(
        db=db,
        module_name="Asset Calibration Table",
        action="Delete Asset Calibration Table",
        current_user=current_user,
        entity_type="AssetCalibrationTable",
        entity_id=existing_calibration_table.id,
        entity_label=existing_calibration_table.calibration_name,
        remarks="Asset calibration table deleted",
        request_path=f"/asset-calibration-tables/{calibration_table_id}",
        details={"deleted": deleted_data},
    )

    db.query(AssetCalibrationData).filter(
        AssetCalibrationData.calibration_table_id == calibration_table_id
    ).delete()

    db.delete(existing_calibration_table)
    db.commit()

    return {
        "message": "Asset calibration table deleted successfully"
    }


# -------------------------
# Asset Assignment APIs
# -------------------------

def build_asset_assignment_response(
    assignment: AssetAssignment,
    db: Session,
):
    asset = (
        db.query(Asset)
        .filter(Asset.asset_code.ilike(assignment.asset_code))
        .first()
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

    assigned_to_display = assignment.assigned_to

    if assignment.assigned_to_type == "User":
        assigned_user = (
            db.query(User)
            .filter(User.username.ilike(assignment.assigned_to))
            .first()
        )

        if assigned_user:
            assigned_to_display = (
                f"{assigned_user.full_name} ({assigned_user.username})"
            )

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


@app.get(
    "/asset-assignments",
    response_model=list[AssetAssignmentResponse],
)
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

    return [
        build_asset_assignment_response(assignment, db)
        for assignment in assignments
    ]

def build_asset_assignment_audit_snapshot(
    assignment: AssetAssignment,
    db: Session,
):
    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(assignment.asset_code)
    ).first()

    location = db.query(Location).filter(
        Location.location_code.ilike(assignment.assignment_location_code)
    ).first()

    assigned_user_display = None

    if assignment.assigned_to_type == "User":
        assigned_user = db.query(User).filter(
            User.username.ilike(assignment.assigned_to)
        ).first()

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

@app.post(
    "/asset-assignments",
    response_model=AssetAssignmentResponse,
)
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

    after_data = build_asset_assignment_audit_snapshot(new_assignment, db)

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

    return build_asset_assignment_response(new_assignment, db)


@app.put(
    "/asset-assignments/{assignment_id}",
    response_model=AssetAssignmentResponse,
)
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

    before_data = build_asset_assignment_audit_snapshot(existing_assignment, db)

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

    after_data = build_asset_assignment_audit_snapshot(existing_assignment, db)

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

    return build_asset_assignment_response(existing_assignment, db)


@app.delete("/asset-assignments/{assignment_id}")
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

    deleted_data = build_asset_assignment_audit_snapshot(existing_assignment, db)

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


# -------------------------
# Operation Type APIs
# -------------------------

@app.get("/operation-types", response_model=list[OperationTypeResponse])
def get_operation_types(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "View Operation Type", db)

    operation_types = db.query(OperationType).order_by(OperationType.id).all()
    return operation_types


@app.post("/operation-types", response_model=OperationTypeResponse)
def create_operation_type(
    operation_type: OperationTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.operation_type_code.ilike(operation_type.operation_type_code))
        .first()
    )
    if existing_operation_type:
        raise HTTPException(status_code=400, detail="Operation type code already exists")

    asset_type = (
        db.query(AssetType)
        .filter(AssetType.asset_type_code.ilike(operation_type.applicable_asset_type_code))
        .first()
    )
    if not asset_type:
        raise HTTPException(status_code=400, detail="Applicable asset type not found")

    new_operation_type = OperationType(
        operation_type_name=operation_type.operation_type_name.strip(),
        operation_type_code=operation_type.operation_type_code.strip(),
        operation_category=operation_type.operation_category,
        applicable_asset_type_code=operation_type.applicable_asset_type_code.strip(),
        requires_sender_location=operation_type.requires_sender_location,
        requires_receiver_location=operation_type.requires_receiver_location,
        requires_comparison=operation_type.requires_comparison,
        requires_approval=operation_type.requires_approval,
        description=clean_optional_text(operation_type.description),
        status=operation_type.status,
    )

    db.add(new_operation_type)
    db.flush()

    after_data = {
        "operation_type_name": new_operation_type.operation_type_name,
        "operation_type_code": new_operation_type.operation_type_code,
        "operation_category": new_operation_type.operation_category,
        "applicable_asset_type_code": new_operation_type.applicable_asset_type_code,
        "requires_sender_location": new_operation_type.requires_sender_location,
        "requires_receiver_location": new_operation_type.requires_receiver_location,
        "requires_comparison": new_operation_type.requires_comparison,
        "requires_approval": new_operation_type.requires_approval,
        "description": new_operation_type.description,
        "status": new_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=new_operation_type.id,
        entity_label=f"{new_operation_type.operation_type_name} ({new_operation_type.operation_type_code})",
        remarks="Operation type created",
        request_path="/operation-types",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_operation_type)
    return new_operation_type


@app.put("/operation-types/{operation_type_id}", response_model=OperationTypeResponse)
def update_operation_type(
    operation_type_id: int,
    operation_type: OperationTypeCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.id == operation_type_id)
        .first()
    )
    if not existing_operation_type:
        raise HTTPException(status_code=404, detail="Operation type not found")

    duplicate_operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(operation_type.operation_type_code),
            OperationType.id != operation_type_id,
        )
        .first()
    )
    if duplicate_operation_type:
        raise HTTPException(status_code=400, detail="Operation type code already exists")

    asset_type = (
        db.query(AssetType)
        .filter(AssetType.asset_type_code.ilike(operation_type.applicable_asset_type_code))
        .first()
    )
    if not asset_type:
        raise HTTPException(status_code=400, detail="Applicable asset type not found")

    before_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    existing_operation_type.operation_type_name = operation_type.operation_type_name.strip()
    existing_operation_type.operation_type_code = operation_type.operation_type_code.strip()
    existing_operation_type.operation_category = operation_type.operation_category
    existing_operation_type.applicable_asset_type_code = operation_type.applicable_asset_type_code.strip()
    existing_operation_type.requires_sender_location = operation_type.requires_sender_location
    existing_operation_type.requires_receiver_location = operation_type.requires_receiver_location
    existing_operation_type.requires_comparison = operation_type.requires_comparison
    existing_operation_type.requires_approval = operation_type.requires_approval
    existing_operation_type.description = clean_optional_text(operation_type.description)
    existing_operation_type.status = operation_type.status

    after_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=existing_operation_type.id,
        entity_label=f"{existing_operation_type.operation_type_name} ({existing_operation_type.operation_type_code})",
        remarks="Operation type updated",
        request_path=f"/operation-types/{operation_type_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_operation_type)
    return existing_operation_type


@app.delete("/operation-types/{operation_type_id}")
def delete_operation_type(
    operation_type_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Type", db)

    existing_operation_type = (
        db.query(OperationType)
        .filter(OperationType.id == operation_type_id)
        .first()
    )
    if not existing_operation_type:
        raise HTTPException(status_code=404, detail="Operation type not found")

    operation_template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.operation_type_code.ilike(existing_operation_type.operation_type_code))
        .first()
    )
    if operation_template:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation type because operation templates exist for it",
        )

    operation_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_type_code.ilike(existing_operation_type.operation_type_code))
        .first()
    )
    if operation_transaction:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation type because transactions exist for it",
        )

    deleted_data = {
        "operation_type_name": existing_operation_type.operation_type_name,
        "operation_type_code": existing_operation_type.operation_type_code,
        "operation_category": existing_operation_type.operation_category,
        "applicable_asset_type_code": existing_operation_type.applicable_asset_type_code,
        "requires_sender_location": existing_operation_type.requires_sender_location,
        "requires_receiver_location": existing_operation_type.requires_receiver_location,
        "requires_comparison": existing_operation_type.requires_comparison,
        "requires_approval": existing_operation_type.requires_approval,
        "description": existing_operation_type.description,
        "status": existing_operation_type.status,
    }

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Operation Type",
        current_user=current_user,
        entity_type="OperationType",
        entity_id=existing_operation_type.id,
        entity_label=f"{existing_operation_type.operation_type_name} ({existing_operation_type.operation_type_code})",
        remarks="Operation type deleted",
        request_path=f"/operation-types/{operation_type_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_operation_type)
    db.commit()

    return {"message": "Operation type deleted successfully"}


# -------------------------
# Tank Operation Master APIs
# -------------------------

VALID_TANK_OPERATION_CATEGORIES = [
    "OPENING",
    "RECEIPT",
    "PRODUCTION",
    "DISPATCH",
    "DRAINING",
    "CLOSING",
    "ADJUSTMENT",
]

VALID_TANK_OPERATION_SIGNS = [
    "SET",
    "IN",
    "OUT",
    "NEUTRAL",
]


def normalize_code(value: str):
    return str(value or "").strip().upper()


def build_tank_operation_response(
    tank_operation: TankOperation,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(tank_operation.location_code))
        .first()
    )

    return {
        "id": tank_operation.id,
        "location_code": tank_operation.location_code,
        "location_name": location.location_name if location else "",
        "operation_code": tank_operation.operation_code,
        "operation_label": tank_operation.operation_label,
        "operation_category": tank_operation.operation_category,
        "operation_sign": tank_operation.operation_sign,
        "sort_order": tank_operation.sort_order,
        "description": tank_operation.description,
        "status": tank_operation.status,
        "created_at": tank_operation.created_at,
        "updated_at": tank_operation.updated_at,
    }


def build_tank_operation_audit_snapshot(
    tank_operation: TankOperation,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(tank_operation.location_code))
        .first()
    )

    return {
        "id": tank_operation.id,
        "location_code": tank_operation.location_code,
        "location_name": location.location_name if location else "",
        "operation_code": tank_operation.operation_code,
        "operation_label": tank_operation.operation_label,
        "operation_category": tank_operation.operation_category,
        "operation_sign": tank_operation.operation_sign,
        "sort_order": tank_operation.sort_order,
        "description": tank_operation.description,
        "status": tank_operation.status,
    }


def validate_tank_operation(
    tank_operation: TankOperationCreate,
    db: Session,
    tank_operation_id: int | None = None,
):
    location_code = normalize_code(tank_operation.location_code)
    operation_code = normalize_code(tank_operation.operation_code)
    operation_label = str(tank_operation.operation_label or "").strip()
    operation_category = normalize_code(tank_operation.operation_category)
    operation_sign = normalize_code(tank_operation.operation_sign)

    if location_code == "":
        raise HTTPException(
            status_code=400,
            detail="Location is required",
        )

    if operation_code == "":
        raise HTTPException(
            status_code=400,
            detail="Operation Code is required",
        )

    if operation_label == "":
        raise HTTPException(
            status_code=400,
            detail="Operation Label is required",
        )

    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(location_code))
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=400,
            detail="Location not found",
        )

    if location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active locations can be used for Tank Operations",
        )

    if operation_category not in VALID_TANK_OPERATION_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid Operation Category. Allowed values are: "
                + ", ".join(VALID_TANK_OPERATION_CATEGORIES)
            ),
        )

    if operation_sign not in VALID_TANK_OPERATION_SIGNS:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid Operation Sign. Allowed values are: "
                + ", ".join(VALID_TANK_OPERATION_SIGNS)
            ),
        )

    duplicate_code_query = db.query(TankOperation).filter(
        TankOperation.location_code.ilike(location_code),
        TankOperation.operation_code.ilike(operation_code),
    )

    duplicate_label_query = db.query(TankOperation).filter(
        TankOperation.location_code.ilike(location_code),
        TankOperation.operation_label.ilike(operation_label),
    )

    if tank_operation_id is not None:
        duplicate_code_query = duplicate_code_query.filter(
            TankOperation.id != tank_operation_id
        )

        duplicate_label_query = duplicate_label_query.filter(
            TankOperation.id != tank_operation_id
        )

    duplicate_code = duplicate_code_query.first()

    if duplicate_code:
        raise HTTPException(
            status_code=400,
            detail="Operation Code already exists for this location",
        )

    duplicate_label = duplicate_label_query.first()

    if duplicate_label:
        raise HTTPException(
            status_code=400,
            detail="Operation Label already exists for this location",
        )

    return {
        "location_code": location_code,
        "operation_code": operation_code,
        "operation_label": operation_label,
        "operation_category": operation_category,
        "operation_sign": operation_sign,
    }


@app.get(
    "/tank-operations",
    response_model=list[TankOperationResponse],
)
def get_tank_operations(
    location_code: str | None = None,
    status: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Operation",
        db,
    )

    query = db.query(TankOperation)

    cleaned_location_code = clean_optional_text(location_code)

    if cleaned_location_code:
        query = query.filter(
            TankOperation.location_code.ilike(cleaned_location_code)
        )

    cleaned_status = clean_optional_text(status)

    if cleaned_status:
        query = query.filter(TankOperation.status == cleaned_status)

    tank_operations = (
        query.order_by(
            TankOperation.location_code.asc(),
            TankOperation.sort_order.asc(),
            TankOperation.operation_label.asc(),
        )
        .all()
    )

    return [
        build_tank_operation_response(tank_operation, db)
        for tank_operation in tank_operations
    ]


@app.post(
    "/tank-operations",
    response_model=TankOperationResponse,
)
def create_tank_operation(
    tank_operation: TankOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    validated_data = validate_tank_operation(tank_operation, db)

    new_tank_operation = TankOperation(
        location_code=validated_data["location_code"],
        operation_code=validated_data["operation_code"],
        operation_label=validated_data["operation_label"],
        operation_category=validated_data["operation_category"],
        operation_sign=validated_data["operation_sign"],
        sort_order=tank_operation.sort_order or 1,
        description=clean_optional_text(tank_operation.description),
        status=tank_operation.status,
    )

    db.add(new_tank_operation)
    db.flush()

    after_data = build_tank_operation_audit_snapshot(new_tank_operation, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=new_tank_operation.id,
        entity_label=(
            f"{new_tank_operation.location_code} - "
            f"{new_tank_operation.operation_label}"
        ),
        remarks="Tank operation created",
        request_path="/tank-operations",
        details={
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(new_tank_operation)

    return build_tank_operation_response(new_tank_operation, db)


@app.put(
    "/tank-operations/{tank_operation_id}",
    response_model=TankOperationResponse,
)
def update_tank_operation(
    tank_operation_id: int,
    tank_operation: TankOperationCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    existing_tank_operation = (
        db.query(TankOperation)
        .filter(TankOperation.id == tank_operation_id)
        .first()
    )

    if not existing_tank_operation:
        raise HTTPException(
            status_code=404,
            detail="Tank Operation not found",
        )

    before_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    validated_data = validate_tank_operation(
        tank_operation,
        db,
        tank_operation_id,
    )

    existing_tank_operation.location_code = validated_data["location_code"]
    existing_tank_operation.operation_code = validated_data["operation_code"]
    existing_tank_operation.operation_label = validated_data["operation_label"]
    existing_tank_operation.operation_category = validated_data[
        "operation_category"
    ]
    existing_tank_operation.operation_sign = validated_data["operation_sign"]
    existing_tank_operation.sort_order = tank_operation.sort_order or 1
    existing_tank_operation.description = clean_optional_text(
        tank_operation.description
    )
    existing_tank_operation.status = tank_operation.status
    existing_tank_operation.updated_at = datetime.now()

    db.flush()

    after_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=existing_tank_operation.id,
        entity_label=(
            f"{existing_tank_operation.location_code} - "
            f"{existing_tank_operation.operation_label}"
        ),
        remarks="Tank operation updated",
        request_path=f"/tank-operations/{tank_operation_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_tank_operation)

    return build_tank_operation_response(existing_tank_operation, db)


@app.delete("/tank-operations/{tank_operation_id}")
def delete_tank_operation(
    tank_operation_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Operation",
        db,
    )

    existing_tank_operation = (
        db.query(TankOperation)
        .filter(TankOperation.id == tank_operation_id)
        .first()
    )

    if not existing_tank_operation:
        raise HTTPException(
            status_code=404,
            detail="Tank Operation not found",
        )

    deleted_data = build_tank_operation_audit_snapshot(
        existing_tank_operation,
        db,
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Tank Operation",
        current_user=current_user,
        entity_type="TankOperation",
        entity_id=existing_tank_operation.id,
        entity_label=(
            f"{existing_tank_operation.location_code} - "
            f"{existing_tank_operation.operation_label}"
        ),
        remarks="Tank operation deleted",
        request_path=f"/tank-operations/{tank_operation_id}",
        details={
            "deleted": deleted_data,
        },
    )

    db.delete(existing_tank_operation)
    db.commit()

    return {
        "message": "Tank operation deleted successfully"
    }


# -------------------------
# Tank Stock Ledger APIs
# -------------------------

def build_tank_stock_ledger_response(
    ledger: TankStockLedger,
    db: Session,
):
    location = get_location_by_code(ledger.location_code, db)

    return {
        "id": ledger.id,
        "transaction_id": ledger.transaction_id,
        "ticket_number": ledger.ticket_number,
        "operation_number": ledger.operation_number,
        "location_code": ledger.location_code,
        "location_name": location.location_name if location else "",
        "tank_asset_code": ledger.tank_asset_code,
        "tank_asset_name": ledger.tank_asset_name,
        "operation_date": ledger.operation_date,
        "product_name": ledger.product_name,
        "accounting_date": ledger.accounting_date,
        "accounting_day_start": ledger.accounting_day_start,
        "accounting_day_end": ledger.accounting_day_end,
        "accounting_day_setting_id": ledger.accounting_day_setting_id,
        "tank_operation_code": ledger.tank_operation_code,
        "tank_operation_label": ledger.tank_operation_label,
        "tank_operation_category": ledger.tank_operation_category,
        "tank_operation_sign": ledger.tank_operation_sign,
        "movement_gsv_bbl": ledger.movement_gsv_bbl or 0,
        "movement_nsv_bbl": ledger.movement_nsv_bbl or 0,
        "movement_lt": ledger.movement_lt or 0,
        "movement_mt": ledger.movement_mt or 0,
        "stock_gsv_bbl": ledger.stock_gsv_bbl or 0,
        "stock_nsv_bbl": ledger.stock_nsv_bbl or 0,
        "stock_lt": ledger.stock_lt or 0,
        "stock_mt": ledger.stock_mt or 0,
        "previous_stock_gsv_bbl": ledger.previous_stock_gsv_bbl or 0,
        "previous_stock_nsv_bbl": ledger.previous_stock_nsv_bbl or 0,
        "previous_stock_lt": ledger.previous_stock_lt or 0,
        "previous_stock_mt": ledger.previous_stock_mt or 0,
        "running_balance_gsv_bbl": ledger.running_balance_gsv_bbl or 0,
        "running_balance_nsv_bbl": ledger.running_balance_nsv_bbl or 0,
        "running_balance_lt": ledger.running_balance_lt or 0,
        "running_balance_mt": ledger.running_balance_mt or 0,
        "status": ledger.status,
        "created_by": ledger.created_by,
        "remarks": ledger.remarks,
        "created_at": ledger.created_at,
        "updated_at": ledger.updated_at,
    }


def get_filtered_tank_stock_ledger_rows(
    db: Session,
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = None,
):
    query = db.query(TankStockLedger)

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_product_name = clean_optional_text(product_name)
    cleaned_status = clean_optional_text(status)

    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    if cleaned_product_name:
        query = query.filter(
            TankStockLedger.product_name.ilike(cleaned_product_name)
        )

    if date_from:
        query = query.filter(TankStockLedger.accounting_date >= date_from)

    if date_to:
        query = query.filter(TankStockLedger.accounting_date <= date_to)

    if cleaned_status:
        query = query.filter(TankStockLedger.status == cleaned_status)

    return (
        query.order_by(
            TankStockLedger.location_code.asc(),
            TankStockLedger.tank_asset_code.asc(),
            TankStockLedger.accounting_date.asc(),
            TankStockLedger.operation_date.asc(),
            TankStockLedger.id.asc(),
        )
        .all()
    )


def parse_date_filter(value: str | None, field_name: str):
    cleaned_value = clean_optional_text(value)

    if not cleaned_value:
        return None

    try:
        return date.fromisoformat(cleaned_value)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} must be in YYYY-MM-DD format",
        )


def build_date_range(start_date: date, end_date: date):
    if end_date < start_date:
        raise HTTPException(
            status_code=400,
            detail="Date To cannot be earlier than Date From",
        )

    dates = []
    current_date = start_date

    while current_date <= end_date:
        dates.append(current_date)
        current_date = current_date + timedelta(days=1)

    return dates


def get_tank_stock_rows_for_daily_summary(
    db: Session,
    location_code: str | None,
    tank_asset_code: str | None,
    product_name: str | None,
    date_to_value: date,
):
    query = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
        TankStockLedger.accounting_date != None,
        TankStockLedger.accounting_date <= date_to_value,
    )

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_product_name = clean_optional_text(product_name)

    if cleaned_location_code:
        query = query.filter(
            TankStockLedger.location_code.ilike(cleaned_location_code)
        )

    if cleaned_tank_asset_code:
        query = query.filter(
            TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code)
        )

    if cleaned_product_name:
        query = query.filter(
            TankStockLedger.product_name.ilike(cleaned_product_name)
        )

    return (
        query.order_by(
            TankStockLedger.location_code.asc(),
            TankStockLedger.tank_asset_code.asc(),
            TankStockLedger.product_name.asc(),
            TankStockLedger.accounting_date.asc(),
            TankStockLedger.operation_date.asc(),
            TankStockLedger.id.asc(),
        )
        .all()
    )


def build_tank_stock_daily_summary_rows(
    db: Session,
    ledger_rows: list[TankStockLedger],
    date_from_value: date,
    date_to_value: date,
):
    date_range = build_date_range(date_from_value, date_to_value)

    grouped_rows = {}

    for row in ledger_rows:
        key = (
            row.location_code,
            row.tank_asset_code,
            row.product_name or "",
        )

        if key not in grouped_rows:
            grouped_rows[key] = []

        grouped_rows[key].append(row)

    daily_summary_rows = []

    for key, rows in grouped_rows.items():
        location_code, tank_asset_code, product_name_value = key

        location = get_location_by_code(location_code, db)

        tank_asset_name = ""
        if rows:
            tank_asset_name = rows[-1].tank_asset_name or ""

        previous_closing_gsv = 0
        previous_closing_nsv = 0
        previous_closing_lt = 0
        previous_closing_mt = 0

        rows_before_period = [
            row
            for row in rows
            if row.accounting_date is not None
            and row.accounting_date < date_from_value
        ]

        if rows_before_period:
            last_before_period = rows_before_period[-1]
            previous_closing_gsv = safe_float(
                last_before_period.running_balance_gsv_bbl
            )
            previous_closing_nsv = safe_float(
                last_before_period.running_balance_nsv_bbl
            )
            previous_closing_lt = safe_float(
                last_before_period.running_balance_lt
            )
            previous_closing_mt = safe_float(
                last_before_period.running_balance_mt
            )

        for accounting_date_value in date_range:
            day_rows = [
                row
                for row in rows
                if row.accounting_date == accounting_date_value
            ]

            opening_gsv = previous_closing_gsv
            opening_nsv = previous_closing_nsv
            opening_lt = previous_closing_lt
            opening_mt = previous_closing_mt

            opening_set_rows = [
                row
                for row in day_rows
                if str(row.tank_operation_category or "").upper() == "OPENING"
                or (
                    str(row.tank_operation_sign or "").upper() == "SET"
                    and str(row.tank_operation_category or "").upper()
                    == "OPENING"
                )
            ]

            if opening_set_rows:
                opening_row = opening_set_rows[-1]
                opening_gsv = safe_float(opening_row.movement_gsv_bbl)
                opening_nsv = safe_float(opening_row.movement_nsv_bbl)
                opening_lt = safe_float(opening_row.movement_lt)
                opening_mt = safe_float(opening_row.movement_mt)

            total_in_gsv = 0
            total_in_nsv = 0
            total_in_lt = 0
            total_in_mt = 0

            total_out_gsv = 0
            total_out_nsv = 0
            total_out_lt = 0
            total_out_mt = 0

            for row in day_rows:
                sign = str(row.tank_operation_sign or "").upper()

                if sign == "IN":
                    total_in_gsv += safe_float(row.movement_gsv_bbl)
                    total_in_nsv += safe_float(row.movement_nsv_bbl)
                    total_in_lt += safe_float(row.movement_lt)
                    total_in_mt += safe_float(row.movement_mt)

                elif sign == "OUT":
                    total_out_gsv += safe_float(row.movement_gsv_bbl)
                    total_out_nsv += safe_float(row.movement_nsv_bbl)
                    total_out_lt += safe_float(row.movement_lt)
                    total_out_mt += safe_float(row.movement_mt)

            book_closing_gsv = opening_gsv + total_in_gsv - total_out_gsv
            book_closing_nsv = opening_nsv + total_in_nsv - total_out_nsv
            book_closing_lt = opening_lt + total_in_lt - total_out_lt
            book_closing_mt = opening_mt + total_in_mt - total_out_mt

            actual_closing_gsv = book_closing_gsv
            actual_closing_nsv = book_closing_nsv
            actual_closing_lt = book_closing_lt
            actual_closing_mt = book_closing_mt

            last_ticket_number = None

            if day_rows:
                last_row_of_day = day_rows[-1]

                actual_closing_gsv = safe_float(
                    last_row_of_day.running_balance_gsv_bbl
                )
                actual_closing_nsv = safe_float(
                    last_row_of_day.running_balance_nsv_bbl
                )
                actual_closing_lt = safe_float(
                    last_row_of_day.running_balance_lt
                )
                actual_closing_mt = safe_float(
                    last_row_of_day.running_balance_mt
                )
                last_ticket_number = last_row_of_day.ticket_number

            # If no row exists for this accounting day, carry forward previous closing.
            if not day_rows:
                actual_closing_gsv = opening_gsv
                actual_closing_nsv = opening_nsv
                actual_closing_lt = opening_lt
                actual_closing_mt = opening_mt

                book_closing_gsv = opening_gsv
                book_closing_nsv = opening_nsv
                book_closing_lt = opening_lt
                book_closing_mt = opening_mt

            loss_gain_gsv = actual_closing_gsv - book_closing_gsv
            loss_gain_nsv = actual_closing_nsv - book_closing_nsv
            loss_gain_lt = actual_closing_lt - book_closing_lt
            loss_gain_mt = actual_closing_mt - book_closing_mt

            daily_summary_rows.append(
                {
                    "accounting_date": accounting_date_value,
                    "location_code": location_code,
                    "location_name": location.location_name if location else "",
                    "tank_asset_code": tank_asset_code,
                    "tank_asset_name": tank_asset_name,
                    "product_name": product_name_value or None,
                    "opening_gsv_bbl": round(opening_gsv, 3),
                    "opening_nsv_bbl": round(opening_nsv, 3),
                    "opening_lt": round(opening_lt, 3),
                    "opening_mt": round(opening_mt, 3),
                    "total_in_gsv_bbl": round(total_in_gsv, 3),
                    "total_in_nsv_bbl": round(total_in_nsv, 3),
                    "total_in_lt": round(total_in_lt, 3),
                    "total_in_mt": round(total_in_mt, 3),
                    "total_out_gsv_bbl": round(total_out_gsv, 3),
                    "total_out_nsv_bbl": round(total_out_nsv, 3),
                    "total_out_lt": round(total_out_lt, 3),
                    "total_out_mt": round(total_out_mt, 3),
                    "book_closing_gsv_bbl": round(book_closing_gsv, 3),
                    "book_closing_nsv_bbl": round(book_closing_nsv, 3),
                    "book_closing_lt": round(book_closing_lt, 3),
                    "book_closing_mt": round(book_closing_mt, 3),
                    "actual_closing_gsv_bbl": round(actual_closing_gsv, 3),
                    "actual_closing_nsv_bbl": round(actual_closing_nsv, 3),
                    "actual_closing_lt": round(actual_closing_lt, 3),
                    "actual_closing_mt": round(actual_closing_mt, 3),
                    "loss_gain_gsv_bbl": round(loss_gain_gsv, 3),
                    "loss_gain_nsv_bbl": round(loss_gain_nsv, 3),
                    "loss_gain_lt": round(loss_gain_lt, 3),
                    "loss_gain_mt": round(loss_gain_mt, 3),
                    "rows_count": len(day_rows),
                    "last_ticket_number": last_ticket_number,
                }
            )

            previous_closing_gsv = actual_closing_gsv
            previous_closing_nsv = actual_closing_nsv
            previous_closing_lt = actual_closing_lt
            previous_closing_mt = actual_closing_mt

    return sorted(
        daily_summary_rows,
        key=lambda row: (
            row["accounting_date"],
            row["location_code"],
            row["tank_asset_code"],
            row["product_name"] or "",
        ),
    )


@app.get(
    "/tank-stock-ledger",
    response_model=list[TankStockLedgerResponse],
)
def get_tank_stock_ledger(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    status: str | None = "Active",
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    ledger_rows = get_filtered_tank_stock_ledger_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        status=status,
    )

    return [
        build_tank_stock_ledger_response(row, db)
        for row in ledger_rows
    ]


@app.get(
    "/tank-stock-ledger/summary",
    response_model=list[TankStockLedgerSummaryResponse],
)
def get_tank_stock_ledger_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    ledger_rows = get_filtered_tank_stock_ledger_rows(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_from=date_from,
        date_to=date_to,
        status="Active",
    )

    summary_map = {}

    for row in ledger_rows:
        key = (
            row.location_code,
            row.tank_asset_code,
            row.product_name or "",
        )

        if key not in summary_map:
            location = get_location_by_code(row.location_code, db)

            summary_map[key] = {
                "location_code": row.location_code,
                "location_name": location.location_name if location else "",
                "tank_asset_code": row.tank_asset_code,
                "tank_asset_name": row.tank_asset_name,
                "product_name": row.product_name,
                "opening_nsv_bbl": 0,
                "total_in_nsv_bbl": 0,
                "total_out_nsv_bbl": 0,
                "closing_nsv_bbl": 0,
                "opening_lt": 0,
                "total_in_lt": 0,
                "total_out_lt": 0,
                "closing_lt": 0,
                "opening_mt": 0,
                "total_in_mt": 0,
                "total_out_mt": 0,
                "closing_mt": 0,
            }

        summary = summary_map[key]

        sign = row.tank_operation_sign
        category = row.tank_operation_category

        movement_nsv = row.movement_nsv_bbl or 0
        movement_lt = row.movement_lt or 0
        movement_mt = row.movement_mt or 0

        if category == "OPENING":
            summary["opening_nsv_bbl"] += movement_nsv
            summary["opening_lt"] += movement_lt
            summary["opening_mt"] += movement_mt

        if sign == "IN":
            summary["total_in_nsv_bbl"] += movement_nsv
            summary["total_in_lt"] += movement_lt
            summary["total_in_mt"] += movement_mt

        if sign == "OUT":
            summary["total_out_nsv_bbl"] += movement_nsv
            summary["total_out_lt"] += movement_lt
            summary["total_out_mt"] += movement_mt

        # Closing values are based on last running balance in the selected period.
        summary["closing_nsv_bbl"] = row.running_balance_nsv_bbl or 0
        summary["closing_lt"] = row.running_balance_lt or 0
        summary["closing_mt"] = row.running_balance_mt or 0

    return list(summary_map.values())


@app.get(
    "/tank-stock-ledger/daily-summary",
    response_model=list[TankStockLedgerDailySummaryResponse],
)
def get_tank_stock_ledger_daily_summary(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Tank Stock Ledger",
        db,
    )

    date_from_value = parse_date_filter(date_from, "Date From")
    date_to_value = parse_date_filter(date_to, "Date To")

    if date_from_value is None or date_to_value is None:
        raise HTTPException(
            status_code=400,
            detail="Date From and Date To are required for daily summary",
        )

    ledger_rows = get_tank_stock_rows_for_daily_summary(
        db=db,
        location_code=location_code,
        tank_asset_code=tank_asset_code,
        product_name=product_name,
        date_to_value=date_to_value,
    )

    return build_tank_stock_daily_summary_rows(
        db=db,
        ledger_rows=ledger_rows,
        date_from_value=date_from_value,
        date_to_value=date_to_value,
    )

@app.post("/tank-stock-ledger/rebuild")
def rebuild_tank_stock_ledger(
    location_code: str | None = None,
    tank_asset_code: str | None = None,
    product_name: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Tank Stock Ledger",
        db,
    )

    query = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
    )

    cleaned_location_code = clean_optional_text(location_code)
    cleaned_tank_asset_code = clean_optional_text(tank_asset_code)
    cleaned_product_name = clean_optional_text(product_name)

    if cleaned_location_code:
        query = query.filter(TankStockLedger.location_code.ilike(cleaned_location_code))

    if cleaned_tank_asset_code:
        query = query.filter(TankStockLedger.tank_asset_code.ilike(cleaned_tank_asset_code))

    if cleaned_product_name:
        query = query.filter(TankStockLedger.product_name.ilike(cleaned_product_name))

    rows = query.all()

    group_keys = set()

    for row in rows:
        group_keys.add(
            (
                row.location_code,
                row.tank_asset_code,
                row.product_name,
            )
        )

    for location, tank_asset, product in group_keys:
        rebuild_tank_stock_running_balances(
            db=db,
            location_code=location,
            tank_asset_code=tank_asset,
            product_name=product,
        )

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Rebuild Tank Stock Ledger",
        current_user=current_user,
        entity_type="TankStockLedger",
        entity_id=None,
        entity_label="Tank Stock Ledger Rebuild",
        remarks="Rebuilt stock movements from chronological tank stock snapshots",
        request_path="/tank-stock-ledger/rebuild",
        details={
            "location_code": cleaned_location_code,
            "tank_asset_code": cleaned_tank_asset_code,
            "product_name": cleaned_product_name,
            "groups_rebuilt": len(group_keys),
            "rows_scanned": len(rows),
        },
    )

    db.commit()

    return {
        "message": "Tank Stock Ledger rebuilt successfully",
        "groups_rebuilt": len(group_keys),
        "rows_scanned": len(rows),
    }
# -------------------------
# Operation Transaction APIs
# -------------------------

def generate_operation_number(db: Session):
    today = datetime.now().strftime("%Y%m%d")
    prefix = f"OP-{today}"

    existing_count = db.query(OperationTransaction).filter(
        OperationTransaction.operation_number.ilike(f"{prefix}%")
    ).count()

    next_number = existing_count + 1

    return f"{prefix}-{next_number:04d}"


def get_transaction_ticket_number(transaction: OperationTransaction):
    return transaction.operation_ticket_number or transaction.operation_number or ""

def get_current_user_display_name(current_user: User):
    if current_user.full_name:
        return f"{current_user.full_name} ({current_user.username})"

    return current_user.username


def create_audit_log(
    db: Session,
    module_name: str,
    action: str,
    current_user: User | None = None,
    entity_type: str | None = None,
    entity_id: int | None = None,
    entity_label: str | None = None,
    ticket_number: str | None = None,
    operation_number: str | None = None,
    old_status: str | None = None,
    new_status: str | None = None,
    remarks: str | None = None,
    request_path: str | None = None,
    details: dict | None = None,
):
    performed_by = None

    if current_user:
        performed_by = get_current_user_display_name(current_user)

    # ✅ Convert datetime/date/Decimal/etc into JSON-safe values
    safe_details = jsonable_encoder(details) if details is not None else None

    audit_log = AuditLog(
        module_name=module_name,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_label=entity_label,
        ticket_number=ticket_number,
        operation_number=operation_number,
        old_status=old_status,
        new_status=new_status,
        performed_by=performed_by,
        remarks=remarks,
        request_path=request_path,
        details=safe_details,
    )

    db.add(audit_log)
    return audit_log

def build_audit_log_response(audit_log: AuditLog):
    return {
        "id": audit_log.id,
        "module_name": audit_log.module_name,
        "action": audit_log.action,
        "entity_type": audit_log.entity_type,
        "entity_id": audit_log.entity_id,
        "entity_label": audit_log.entity_label,
        "ticket_number": audit_log.ticket_number,
        "operation_number": audit_log.operation_number,
        "old_status": audit_log.old_status,
        "new_status": audit_log.new_status,
        "performed_by": audit_log.performed_by,
        "remarks": audit_log.remarks,
        "request_path": audit_log.request_path,
        "details": audit_log.details,
        "created_at": audit_log.created_at,
    }

def get_location_name_by_code(location_code: str | None, db: Session):
    if not location_code:
        return None

    location = db.query(Location).filter(
        Location.location_code == location_code
    ).first()

    if not location:
        return None

    return location.location_name


def get_location_by_code(location_code: str | None, db: Session):
    if not location_code:
        return None

    return db.query(Location).filter(
        Location.location_code == location_code
    ).first()


def get_asset_by_code(asset_code: str | None, db: Session):
    if not asset_code:
        return None

    return db.query(Asset).filter(
        Asset.asset_code == asset_code
    ).first()


def get_operation_type_by_code(operation_type_code: str | None, db: Session):
    if not operation_type_code:
        return None

    return db.query(OperationType).filter(
        OperationType.operation_type_code == operation_type_code
    ).first()


def build_operation_transaction_response(
    transaction: OperationTransaction,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code,
        db,
    )

    asset = get_asset_by_code(transaction.primary_asset_code, db)

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "primary_asset_code": transaction.primary_asset_code,
        "primary_asset_name": asset.asset_name if asset else "",
        "primary_asset_type_code": transaction.primary_asset_type_code,
        "convoy_number": transaction.convoy_number,
        "origin_location_code": transaction.origin_location_code,
        "origin_location_name": get_location_name_by_code(
            transaction.origin_location_code,
            db,
        ),
        "destination_location_code": transaction.destination_location_code,
        "destination_location_name": get_location_name_by_code(
            transaction.destination_location_code,
            db,
        ),
        "sender_location_code": transaction.sender_location_code,
        "sender_location_name": get_location_name_by_code(
            transaction.sender_location_code,
            db,
        ),
        "receiver_location_code": transaction.receiver_location_code,
        "receiver_location_name": get_location_name_by_code(
            transaction.receiver_location_code,
            db,
        ),
        "operation_date": transaction.operation_date,
        "operation_start_datetime": transaction.operation_start_datetime,
        "operation_end_datetime": transaction.operation_end_datetime,
        "product_name": transaction.product_name,
        "created_by": transaction.created_by,
        "remarks": transaction.remarks,
        "status": transaction.status,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
    }


def build_operation_transaction_register_row(
    transaction: OperationTransaction,
    db: Session,
):
    operation_type = get_operation_type_by_code(
        transaction.operation_type_code,
        db,
    )

    location = get_location_by_code(transaction.origin_location_code, db)
    primary_asset = get_asset_by_code(transaction.primary_asset_code, db)

    field_count = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .count()
    )

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_date": transaction.operation_date,
        "operation_type_id": operation_type.id if operation_type else None,
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name
        if operation_type
        else "",
        "location_id": location.id if location else None,
        "location_name": location.location_name if location else "",
        "location_code": transaction.origin_location_code,
        "primary_asset_id": primary_asset.id if primary_asset else None,
        "primary_asset_name": primary_asset.asset_name
        if primary_asset
        else "",
        "primary_asset_code": transaction.primary_asset_code,
        "convoy_number": transaction.convoy_number,
        "status": transaction.status,
        "field_count": field_count,
        "created_at": transaction.created_at,
    }


def validate_operation_transaction(
    transaction: OperationTransactionCreate,
    db: Session,
):
    if not transaction.operation_type_code:
        raise HTTPException(
            status_code=400,
            detail="Operation type is missing in operation entry request",
        )

    if not transaction.primary_asset_code:
        raise HTTPException(
            status_code=400,
            detail="Primary asset is missing in operation entry request",
        )

    if not transaction.origin_location_code:
        raise HTTPException(
            status_code=400,
            detail="Origin location is missing in operation entry request",
        )

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(transaction.operation_type_code)
    ).first()

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be used",
        )

    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(transaction.primary_asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    if asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active assets can be used for operation",
        )

    if (
        asset.asset_type_code.lower()
        != operation_type.applicable_asset_type_code.lower()
    ):
        raise HTTPException(
            status_code=400,
            detail="Selected operation type is not applicable for this asset type",
        )

    origin_location = db.query(Location).filter(
        Location.location_code.ilike(transaction.origin_location_code)
    ).first()

    if not origin_location:
        raise HTTPException(
            status_code=400,
            detail="Origin location not found",
        )

    if origin_location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active origin location can be used",
        )

    if transaction.destination_location_code:
        destination_location = db.query(Location).filter(
            Location.location_code.ilike(transaction.destination_location_code)
        ).first()

        if not destination_location:
            raise HTTPException(
                status_code=400,
                detail="Destination location not found",
            )

        if destination_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active destination location can be used",
            )

    if operation_type.requires_sender_location == "Yes":
        if not transaction.sender_location_code:
            raise HTTPException(
                status_code=400,
                detail="Sender location is required for this operation type",
            )

    if operation_type.requires_receiver_location == "Yes":
        if not transaction.receiver_location_code:
            raise HTTPException(
                status_code=400,
                detail="Receiver location is required for this operation type",
            )

    return operation_type, asset

def get_filtered_operation_transaction_rows(
    db: Session,
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
):
    query = db.query(OperationTransaction)

    if date_from:
        query = query.filter(OperationTransaction.operation_date >= date_from)

    if date_to:
        query = query.filter(OperationTransaction.operation_date <= date_to)

    resolved_operation_type_code = clean_optional_text(operation_type_code)

    if operation_type_id:
        operation_type = (
            db.query(OperationType)
            .filter(OperationType.id == operation_type_id)
            .first()
        )

        if operation_type:
            resolved_operation_type_code = operation_type.operation_type_code

    if resolved_operation_type_code:
        query = query.filter(
            OperationTransaction.operation_type_code.ilike(
                resolved_operation_type_code
            )
        )

    resolved_location_code = clean_optional_text(location_code)

    if location_id:
        location = (
            db.query(Location)
            .filter(Location.id == location_id)
            .first()
        )

        if location:
            resolved_location_code = location.location_code

    if resolved_location_code:
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(
                resolved_location_code
            )
        )

    resolved_asset_code = clean_optional_text(asset_code)

    if asset_id:
        asset = (
            db.query(Asset)
            .filter(Asset.id == asset_id)
            .first()
        )

        if asset:
            resolved_asset_code = asset.asset_code

    if resolved_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(
                resolved_asset_code
            )
        )

    if status:
        query = query.filter(OperationTransaction.status == status)

    transactions = query.order_by(OperationTransaction.id.desc()).all()

    result = []

    for transaction in transactions:
        row = build_operation_transaction_register_row(transaction, db)

        if search:
            search_value = search.lower().strip()

            searchable_text = " ".join(
                [
                    str(row["ticket_number"] or ""),
                    str(row["operation_number"] or ""),
                    str(row["operation_type_code"] or ""),
                    str(row["operation_type_name"] or ""),
                    str(row["location_name"] or ""),
                    str(row["location_code"] or ""),
                    str(row["primary_asset_name"] or ""),
                    str(row["primary_asset_code"] or ""),
                    str(row["status"] or ""),
                ]
            ).lower()

            if search_value not in searchable_text:
                continue

        result.append(row)

    return result

@app.get("/operation-transactions")
def get_operation_transactions(
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    return get_filtered_operation_transaction_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        operation_type_id=operation_type_id,
        operation_type_code=operation_type_code,
        location_id=location_id,
        location_code=location_code,
        asset_id=asset_id,
        asset_code=asset_code,
        status=status,
        search=search,
    )
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )
    query = db.query(OperationTransaction)

    if date_from:
        query = query.filter(OperationTransaction.operation_date >= date_from)

    if date_to:
        query = query.filter(OperationTransaction.operation_date <= date_to)

    resolved_operation_type_code = clean_optional_text(operation_type_code)

    if operation_type_id:
        operation_type = db.query(OperationType).filter(
            OperationType.id == operation_type_id
        ).first()

        if operation_type:
            resolved_operation_type_code = operation_type.operation_type_code

    if resolved_operation_type_code:
        query = query.filter(
            OperationTransaction.operation_type_code.ilike(
                resolved_operation_type_code
            )
        )

    resolved_location_code = clean_optional_text(location_code)

    if location_id:
        location = db.query(Location).filter(Location.id == location_id).first()

        if location:
            resolved_location_code = location.location_code

    if resolved_location_code:
        query = query.filter(
            OperationTransaction.origin_location_code.ilike(
                resolved_location_code
            )
        )

    resolved_asset_code = clean_optional_text(asset_code)

    if asset_id:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()

        if asset:
            resolved_asset_code = asset.asset_code

    if resolved_asset_code:
        query = query.filter(
            OperationTransaction.primary_asset_code.ilike(
                resolved_asset_code
            )
        )

    if status:
        query = query.filter(OperationTransaction.status == status)

    transactions = query.order_by(OperationTransaction.id.desc()).all()

    result = []

    for transaction in transactions:
        row = build_operation_transaction_register_row(transaction, db)

        if search:
            search_value = search.lower().strip()

            searchable_text = " ".join(
                [
                    str(row["ticket_number"] or ""),
                    str(row["operation_number"] or ""),
                    str(row["operation_type_code"] or ""),
                    str(row["operation_type_name"] or ""),
                    str(row["location_name"] or ""),
                    str(row["location_code"] or ""),
                    str(row["primary_asset_name"] or ""),
                    str(row["primary_asset_code"] or ""),
                    str(row["status"] or ""),
                ]
            ).lower()

            if search_value not in searchable_text:
                continue

        result.append(row)

    return result

@app.get("/operation-transactions/export/csv")
def export_operation_transactions_csv(
    date_from: str | None = None,
    date_to: str | None = None,
    operation_type_id: int | None = None,
    operation_type_code: str | None = None,
    location_id: int | None = None,
    location_code: str | None = None,
    asset_id: int | None = None,
    asset_code: str | None = None,
    status: str | None = None,
    search: str | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    rows = get_filtered_operation_transaction_rows(
        db=db,
        date_from=date_from,
        date_to=date_to,
        operation_type_id=operation_type_id,
        operation_type_code=operation_type_code,
        location_id=location_id,
        location_code=location_code,
        asset_id=asset_id,
        asset_code=asset_code,
        status=status,
        search=search,
    )

    output = io.StringIO()
    writer = csv.writer(output)

    writer.writerow(["Operation Transaction Register"])
    writer.writerow(["Generated At", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    writer.writerow(["Record Count", len(rows)])
    writer.writerow([])

    writer.writerow(["Applied Filters"])
    writer.writerow(["Date From", date_from or "All"])
    writer.writerow(["Date To", date_to or "All"])
    writer.writerow(["Operation Type ID", operation_type_id or "All"])
    writer.writerow(["Operation Type Code", operation_type_code or "All"])
    writer.writerow(["Location ID", location_id or "All"])
    writer.writerow(["Location Code", location_code or "All"])
    writer.writerow(["Asset ID", asset_id or "All"])
    writer.writerow(["Asset Code", asset_code or "All"])
    writer.writerow(["Status", status or "All"])
    writer.writerow(["Search", search or ""])
    writer.writerow([])

    writer.writerow(
        [
            "Ticket Number",
            "Operation Number",
            "Operation Date",
            "Operation Type Code",
            "Operation Type Name",
            "Location Code",
            "Location Name",
            "Primary Asset Code",
            "Primary Asset Name",
            "Field Count",
            "Status",
            "Created At",
        ]
    )

    for row in rows:
        writer.writerow(
            [
                row.get("ticket_number", ""),
                row.get("operation_number", ""),
                row.get("operation_date", ""),
                row.get("operation_type_code", ""),
                row.get("operation_type_name", ""),
                row.get("location_code", ""),
                row.get("location_name", ""),
                row.get("primary_asset_code", ""),
                row.get("primary_asset_name", ""),
                row.get("field_count", ""),
                row.get("status", ""),
                row.get("created_at", ""),
            ]
        )

    output.seek(0)

    filename = f"operation-transaction-register-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        },
    )

@app.post(
    "/operation-transactions",
    response_model=OperationTransactionResponse,
)
def create_operation_transaction(
    transaction: OperationTransactionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # This is a legacy/direct endpoint. Keep it secure.
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    operation_type, asset = validate_operation_transaction(transaction, db)

    created_by_display = get_current_user_display_name(current_user)

    # Always control created_by server-side (prevent spoofing)
    new_transaction = OperationTransaction(
        operation_number=generate_operation_number(db),
        operation_type_code=operation_type.operation_type_code,
        primary_asset_code=asset.asset_code,
        primary_asset_type_code=asset.asset_type_code,
        convoy_number=clean_optional_text(transaction.convoy_number),
        origin_location_code=transaction.origin_location_code.strip(),
        destination_location_code=clean_optional_text(
            transaction.destination_location_code
        ),
        sender_location_code=clean_optional_text(transaction.sender_location_code),
        receiver_location_code=clean_optional_text(transaction.receiver_location_code),
        operation_date=transaction.operation_date,
        operation_start_datetime=transaction.operation_start_datetime,
        operation_end_datetime=transaction.operation_end_datetime,
        product_name=clean_optional_text(transaction.product_name),
        created_by=created_by_display,
        remarks=clean_optional_text(transaction.remarks),
        status=transaction.status or "Draft",
    )

    db.add(new_transaction)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Create Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=new_transaction.id,
        entity_label=get_transaction_ticket_number(new_transaction),
        ticket_number=get_transaction_ticket_number(new_transaction),
        operation_number=new_transaction.operation_number,
        new_status=new_transaction.status,
        remarks="Created via /operation-transactions",
        request_path="/operation-transactions",
        details={
            "operation_type_code": new_transaction.operation_type_code,
            "primary_asset_code": new_transaction.primary_asset_code,
            "origin_location_code": new_transaction.origin_location_code,
            "destination_location_code": new_transaction.destination_location_code,
            "sender_location_code": new_transaction.sender_location_code,
            "receiver_location_code": new_transaction.receiver_location_code,
            "operation_date": str(new_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(new_transaction)

    return build_operation_transaction_response(new_transaction, db)


@app.put(
    "/operation-transactions/{transaction_id}",
    response_model=OperationTransactionResponse,
)
def update_operation_transaction(
    transaction_id: int,
    transaction: OperationTransactionCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # This is a legacy/direct endpoint. Keep it secure.
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    # Match Operation Entry edit rule
    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation transactions can be edited."
            ),
        )

    before_data = {
        "operation_type_code": existing_transaction.operation_type_code,
        "primary_asset_code": existing_transaction.primary_asset_code,
        "convoy_number": existing_transaction.convoy_number,
        "origin_location_code": existing_transaction.origin_location_code,
        "destination_location_code": existing_transaction.destination_location_code,
        "sender_location_code": existing_transaction.sender_location_code,
        "receiver_location_code": existing_transaction.receiver_location_code,
        "operation_date": str(existing_transaction.operation_date),
        "product_name": existing_transaction.product_name,
        "remarks": existing_transaction.remarks,
        "status": existing_transaction.status,
        "created_by": existing_transaction.created_by,
    }

    operation_type, asset = validate_operation_transaction(transaction, db)

    existing_transaction.operation_type_code = operation_type.operation_type_code
    existing_transaction.primary_asset_code = asset.asset_code
    existing_transaction.primary_asset_type_code = asset.asset_type_code
    existing_transaction.convoy_number = clean_optional_text(transaction.convoy_number)
    existing_transaction.origin_location_code = transaction.origin_location_code.strip()
    existing_transaction.destination_location_code = clean_optional_text(
        transaction.destination_location_code
    )
    existing_transaction.sender_location_code = clean_optional_text(
        transaction.sender_location_code
    )
    existing_transaction.receiver_location_code = clean_optional_text(
        transaction.receiver_location_code
    )
    existing_transaction.operation_date = transaction.operation_date
    existing_transaction.operation_start_datetime = transaction.operation_start_datetime
    existing_transaction.operation_end_datetime = transaction.operation_end_datetime
    existing_transaction.product_name = clean_optional_text(transaction.product_name)

    # IMPORTANT: do NOT allow client to change created_by
    existing_transaction.remarks = clean_optional_text(transaction.remarks)
    existing_transaction.updated_at = datetime.now()

    after_data = {
        "operation_type_code": existing_transaction.operation_type_code,
        "primary_asset_code": existing_transaction.primary_asset_code,
        "convoy_number": existing_transaction.convoy_number,
        "origin_location_code": existing_transaction.origin_location_code,
        "destination_location_code": existing_transaction.destination_location_code,
        "sender_location_code": existing_transaction.sender_location_code,
        "receiver_location_code": existing_transaction.receiver_location_code,
        "operation_date": str(existing_transaction.operation_date),
        "product_name": existing_transaction.product_name,
        "remarks": existing_transaction.remarks,
        "status": existing_transaction.status,
        "created_by": existing_transaction.created_by,
    }

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Update Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=existing_transaction.status,
        new_status=existing_transaction.status,
        remarks="Updated via /operation-transactions",
        request_path=f"/operation-transactions/{transaction_id}",
        details={
            "before": before_data,
            "after": after_data,
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return build_operation_transaction_response(existing_transaction, db)


@app.delete("/operation-transactions/{transaction_id}")
def delete_operation_transaction(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Cancel Operation Transaction",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation transactions can be cancelled. "
                "Submitted tickets must be recalled to Draft before cancelling. "
                "Approved and Cancelled tickets are locked."
            ),
        )

    old_status = existing_transaction.status

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_transaction.status = "Cancelled"
    existing_transaction.updated_at = datetime.now()

    existing_remarks = existing_transaction.remarks or ""

    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Cancelled by {changed_by}"
    ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=existing_transaction.id,
        old_status=old_status,
        new_status="Cancelled",
        changed_by=changed_by,
        remarks="Cancelled from Operation Transaction Register",
        changed_at=datetime.now(),
    )

    db.add(history)

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Cancel Operation Transaction",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=old_status,
        new_status="Cancelled",
        remarks="Cancelled from Operation Transaction Register",
        request_path=f"/operation-transactions/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return {
        "message": "Operation transaction cancelled successfully"
    }

# -------------------------
# Location Operation Availability APIs
# -------------------------

def build_location_operation_availability_response(
    availability: LocationOperationAvailability,
    db: Session,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(availability.location_code))
        .first()
    )

    operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(
                availability.operation_type_code
            )
        )
        .first()
    )

    return {
        "id": availability.id,
        "location_code": availability.location_code,
        "location_name": location.location_name if location else "",
        "operation_type_code": availability.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "status": availability.status,
        "remarks": availability.remarks,
        "created_at": availability.created_at,
        "updated_at": availability.updated_at,
    }


def validate_location_operation_availability(
    availability: LocationOperationAvailabilityCreate,
    db: Session,
    availability_id: int | None = None,
):
    location = (
        db.query(Location)
        .filter(Location.location_code.ilike(availability.location_code))
        .first()
    )

    if not location:
        raise HTTPException(
            status_code=400,
            detail="Location not found",
        )

    if location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active locations can be configured",
        )

    operation_type = (
        db.query(OperationType)
        .filter(
            OperationType.operation_type_code.ilike(
                availability.operation_type_code
            )
        )
        .first()
    )

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be configured",
        )

    duplicate_query = db.query(LocationOperationAvailability).filter(
        LocationOperationAvailability.location_code.ilike(
            availability.location_code
        ),
        LocationOperationAvailability.operation_type_code.ilike(
            availability.operation_type_code
        ),
    )

    if availability_id is not None:
        duplicate_query = duplicate_query.filter(
            LocationOperationAvailability.id != availability_id
        )

    duplicate = duplicate_query.first()

    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="This operation type is already configured for this location",
        )


@app.get(
    "/location-operation-availability",
    response_model=list[LocationOperationAvailabilityResponse],
)
def get_location_operation_availability(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Location Operation Availability",
        db,
    )

    availability_records = (
        db.query(LocationOperationAvailability)
        .order_by(LocationOperationAvailability.id)
        .all()
    )

    return [
        build_location_operation_availability_response(record, db)
        for record in availability_records
    ]

def build_location_operation_availability_audit_snapshot(
    availability: LocationOperationAvailability,
    db: Session,
):
    location = db.query(Location).filter(
        Location.location_code.ilike(availability.location_code)
    ).first()

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(availability.operation_type_code)
    ).first()

    return {
        "id": availability.id,
        "location_code": availability.location_code,
        "location_name": location.location_name if location else "",
        "operation_type_code": availability.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "status": availability.status,
        "remarks": availability.remarks,
    }

@app.post(
    "/location-operation-availability",
    response_model=LocationOperationAvailabilityResponse,
)
def create_location_operation_availability(
    availability: LocationOperationAvailabilityCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    validate_location_operation_availability(availability, db)

    new_record = LocationOperationAvailability(
        location_code=availability.location_code.strip(),
        operation_type_code=availability.operation_type_code.strip(),
        status=availability.status,
        remarks=clean_optional_text(availability.remarks),
    )

    db.add(new_record)
    db.flush()

    after_data = build_location_operation_availability_audit_snapshot(new_record, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=new_record.id,
        entity_label=f"{after_data.get('location_code')} - {after_data.get('operation_type_code')}",
        remarks="Location operation availability created",
        request_path="/location-operation-availability",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_record)

    return build_location_operation_availability_response(new_record, db)


@app.put(
    "/location-operation-availability/{availability_id}",
    response_model=LocationOperationAvailabilityResponse,
)
def update_location_operation_availability(
    availability_id: int,
    availability: LocationOperationAvailabilityCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    existing_record = (
        db.query(LocationOperationAvailability)
        .filter(LocationOperationAvailability.id == availability_id)
        .first()
    )

    if not existing_record:
        raise HTTPException(
            status_code=404,
            detail="Location operation availability not found",
        )

    before_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    validate_location_operation_availability(
        availability,
        db,
        availability_id,
    )

    existing_record.location_code = availability.location_code.strip()
    existing_record.operation_type_code = availability.operation_type_code.strip()
    existing_record.status = availability.status
    existing_record.remarks = clean_optional_text(availability.remarks)

    db.flush()

    after_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=existing_record.id,
        entity_label=f"{after_data.get('location_code')} - {after_data.get('operation_type_code')}",
        remarks="Location operation availability updated",
        request_path=f"/location-operation-availability/{availability_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_record)

    return build_location_operation_availability_response(existing_record, db)


@app.delete("/location-operation-availability/{availability_id}")
def delete_location_operation_availability(
    availability_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Location Operation Availability",
        db,
    )

    existing_record = (
        db.query(LocationOperationAvailability)
        .filter(LocationOperationAvailability.id == availability_id)
        .first()
    )

    if not existing_record:
        raise HTTPException(
            status_code=404,
            detail="Location operation availability not found",
        )

    deleted_data = build_location_operation_availability_audit_snapshot(
        existing_record, db
    )

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Location Operation Availability",
        current_user=current_user,
        entity_type="LocationOperationAvailability",
        entity_id=existing_record.id,
        entity_label=f"{deleted_data.get('location_code')} - {deleted_data.get('operation_type_code')}",
        remarks="Location operation availability deleted",
        request_path=f"/location-operation-availability/{availability_id}",
        details={"deleted": deleted_data},
    )

    db.delete(existing_record)
    db.commit()

    return {"message": "Location operation availability deleted successfully"}

# -------------------------
# Operation Template APIs
# -------------------------

VALID_ENTRY_LAYOUT_TYPES = [
    "Standard Form",
    "Stock Movement",
    "Tank Gauging",
    "Multi-Tank Before/After",
    "Vessel Cycle",
    "Tanker Loading",
    "Meter Reading",
]

VALID_CALCULATION_ENGINES = [
    "None",
    "Stock Movement Net/Variance",
    "Tank Quantity",
    "Barge Before/After Quantity",
    "Vessel Cycle Quantity",
    "Tanker Quantity",
    "Meter Reading Quantity",
]

def build_operation_template_response(
    template: OperationTemplate,
    db: Session,
):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code == template.operation_type_code
    ).first()

    fields = (
        db.query(OperationTemplateField)
        .filter(OperationTemplateField.template_id == template.id)
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "operation_type_code": template.operation_type_code,
        "operation_type_name": (
            operation_type.operation_type_name if operation_type else ""
        ),
        "entry_layout_type": template.entry_layout_type or "Standard Form",
        "calculation_engine": template.calculation_engine or "None",
        "description": template.description,
        "status": template.status,
        "created_at": template.created_at,
        "updated_at": template.updated_at,
        "fields": [
            {
                "id": field.id,
                "field_name": field.field_name,
                "field_code": field.field_code,
                "field_group": field.field_group,
                "data_type": field.data_type,
                "unit": field.unit,
                "is_required": field.is_required,
                "input_mode": field.input_mode,
                "calculation_role": field.calculation_role,
                "sort_order": field.sort_order,
                "status": field.status,
            }
            for field in fields
        ],
    }


def validate_operation_template(
    template: OperationTemplateCreate,
    db: Session,
):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(template.operation_type_code)
    ).first()

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be used",
        )

    if template.entry_layout_type not in VALID_ENTRY_LAYOUT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid entry layout type",
        )

    if template.calculation_engine not in VALID_CALCULATION_ENGINES:
        raise HTTPException(
            status_code=400,
            detail="Invalid calculation engine",
        )

    if len(template.fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please add at least one operation template field",
        )

    field_codes = [
        field.field_code.strip().lower()
        for field in template.fields
    ]

    if len(field_codes) != len(set(field_codes)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate field codes are not allowed in the same template",
        )

    field_names = [
        field.field_name.strip().lower()
        for field in template.fields
    ]

    if len(field_names) != len(set(field_names)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate field names are not allowed in the same template",
        )

    return operation_type


@app.get(
    "/operation-templates",
    response_model=list[OperationTemplateResponse],
)
def get_operation_templates(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Template",
        db,
    )

    templates = (
        db.query(OperationTemplate)
        .order_by(OperationTemplate.id)
        .all()
    )

    return [
        build_operation_template_response(template, db)
        for template in templates
    ]

def build_operation_template_audit_snapshot(
    template: OperationTemplate,
    db: Session,
):
    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code == template.operation_type_code
    ).first()

    fields = (
        db.query(OperationTemplateField)
        .filter(OperationTemplateField.template_id == template.id)
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    return {
        "id": template.id,
        "template_name": template.template_name,
        "operation_type_code": template.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "entry_layout_type": template.entry_layout_type or "Standard Form",
        "calculation_engine": template.calculation_engine or "None",
        "description": template.description,
        "status": template.status,
        "field_count": len(fields),
        "fields": [
            {
                "id": field.id,
                "field_name": field.field_name,
                "field_code": field.field_code,
                "field_group": field.field_group,
                "data_type": field.data_type,
                "unit": field.unit,
                "is_required": field.is_required,
                "input_mode": field.input_mode,
                "calculation_role": field.calculation_role,
                "sort_order": field.sort_order,
                "status": field.status,
            }
            for field in fields
        ],
    }

@app.post(
    "/operation-templates",
    response_model=OperationTemplateResponse,
)
def create_operation_template(
    template: OperationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.template_name.ilike(template.template_name)
    ).first()

    if existing_template:
        raise HTTPException(
            status_code=400,
            detail="Operation template name already exists",
        )

    operation_type = validate_operation_template(template, db)

    new_template = OperationTemplate(
        template_name=template.template_name.strip(),
        operation_type_code=operation_type.operation_type_code,
        entry_layout_type=template.entry_layout_type,
        calculation_engine=template.calculation_engine,
        description=clean_optional_text(template.description),
        status=template.status,
    )

    db.add(new_template)
    db.flush()

    for index, field in enumerate(template.fields):
        new_field = OperationTemplateField(
            template_id=new_template.id,
            field_name=field.field_name.strip(),
            field_code=field.field_code.strip(),
            field_group=field.field_group,
            data_type=field.data_type,
            unit=clean_optional_text(field.unit),
            is_required=field.is_required,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            sort_order=field.sort_order or index + 1,
            status=field.status,
        )
        db.add(new_field)

    db.flush()

    after_data = build_operation_template_audit_snapshot(new_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Create Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=new_template.id,
        entity_label=new_template.template_name,
        remarks="Operation template created",
        request_path="/operation-templates",
        details={"after": after_data},
    )

    db.commit()
    db.refresh(new_template)

    return build_operation_template_response(new_template, db)


@app.put(
    "/operation-templates/{template_id}",
    response_model=OperationTemplateResponse,
)
def update_operation_template(
    template_id: int,
    template: OperationTemplateCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Operation template not found",
        )

    duplicate_template = db.query(OperationTemplate).filter(
        OperationTemplate.template_name.ilike(template.template_name),
        OperationTemplate.id != template_id,
    ).first()

    if duplicate_template:
        raise HTTPException(
            status_code=400,
            detail="Operation template name already exists",
        )

    before_data = build_operation_template_audit_snapshot(existing_template, db)

    operation_type = validate_operation_template(template, db)

    existing_template.template_name = template.template_name.strip()
    existing_template.operation_type_code = operation_type.operation_type_code
    existing_template.entry_layout_type = template.entry_layout_type
    existing_template.calculation_engine = template.calculation_engine
    existing_template.description = clean_optional_text(template.description)
    existing_template.status = template.status

    db.query(OperationTemplateField).filter(
        OperationTemplateField.template_id == template_id
    ).delete()

    for index, field in enumerate(template.fields):
        new_field = OperationTemplateField(
            template_id=template_id,
            field_name=field.field_name.strip(),
            field_code=field.field_code.strip(),
            field_group=field.field_group,
            data_type=field.data_type,
            unit=clean_optional_text(field.unit),
            is_required=field.is_required,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            sort_order=field.sort_order or index + 1,
            status=field.status,
        )
        db.add(new_field)

    db.flush()

    after_data = build_operation_template_audit_snapshot(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Update Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Operation template updated",
        request_path=f"/operation-templates/{template_id}",
        details={"before": before_data, "after": after_data},
    )

    db.commit()
    db.refresh(existing_template)

    return build_operation_template_response(existing_template, db)


@app.delete("/operation-templates/{template_id}")
def delete_operation_template(
    template_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Manage Operation Template", db)

    existing_template = db.query(OperationTemplate).filter(
        OperationTemplate.id == template_id
    ).first()

    if not existing_template:
        raise HTTPException(
            status_code=404,
            detail="Operation template not found",
        )

    existing_transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_template_id == template_id)
        .first()
    )

    if existing_transaction:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete operation template because transactions exist for it",
        )

    deleted_data = build_operation_template_audit_snapshot(existing_template, db)

    create_audit_log(
        db=db,
        module_name="Operations",
        action="Delete Operation Template",
        current_user=current_user,
        entity_type="OperationTemplate",
        entity_id=existing_template.id,
        entity_label=existing_template.template_name,
        remarks="Operation template deleted",
        request_path=f"/operation-templates/{template_id}",
        details={"deleted": deleted_data},
    )

    db.query(OperationTemplateField).filter(
        OperationTemplateField.template_id == template_id
    ).delete()

    db.delete(existing_template)
    db.commit()

    return {"message": "Operation template deleted successfully"}

# -------------------------
# Operation Entry APIs
# -------------------------

def build_operation_entry_response(
    transaction: OperationTransaction,
    db: Session,
):
    template = None

    if transaction.operation_template_id:
        template = db.query(OperationTemplate).filter(
            OperationTemplate.id == transaction.operation_template_id
        ).first()

    values = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .order_by(
            OperationTransactionValue.sort_order,
            OperationTransactionValue.id,
        )
        .all()
    )

    return {
        "transaction": build_operation_transaction_response(transaction, db),
        "operation_template_id": transaction.operation_template_id,
        "operation_template_name": template.template_name if template else "",
        "values": [
            {
                "id": value.id,
                "field_code": value.field_code,
                "field_name": value.field_name,
                "field_group": value.field_group,
                "data_type": value.data_type,
                "unit": value.unit,
                "input_mode": value.input_mode,
                "calculation_role": value.calculation_role,
                "field_value": value.field_value,
                "sort_order": value.sort_order,
            }
            for value in values
        ],
    }


def validate_operation_entry(
    entry: OperationEntryCreate,
    db: Session,
):
    template = db.query(OperationTemplate).filter(
        OperationTemplate.id == entry.operation_template_id
    ).first()

    if not template:
        raise HTTPException(
            status_code=400,
            detail="Operation template not found",
        )

    if template.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation templates can be used",
        )

    transaction_operation_type_code = clean_optional_text(
        getattr(entry.transaction, "operation_type_code", None)
    )

    if transaction_operation_type_code is None:
        transaction_operation_type_code = template.operation_type_code

    if transaction_operation_type_code is None:
        raise HTTPException(
            status_code=400,
            detail="Operation type is missing in operation entry request",
        )

    if template.operation_type_code.lower() != transaction_operation_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected template does not belong to selected operation type",
        )

    operation_type = db.query(OperationType).filter(
        OperationType.operation_type_code.ilike(transaction_operation_type_code)
    ).first()

    if not operation_type:
        raise HTTPException(
            status_code=400,
            detail="Operation type not found",
        )

    if operation_type.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active operation types can be used",
        )

    if not clean_optional_text(entry.transaction.primary_asset_code):
        raise HTTPException(
            status_code=400,
            detail="Primary asset is missing in operation entry request",
        )

    asset = db.query(Asset).filter(
        Asset.asset_code.ilike(entry.transaction.primary_asset_code)
    ).first()

    if not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset not found",
        )

    if asset.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active assets can be used for operation",
        )

    if asset.asset_type_code.lower() != operation_type.applicable_asset_type_code.lower():
        raise HTTPException(
            status_code=400,
            detail="Selected operation type is not applicable for this asset type",
        )

    if not clean_optional_text(entry.transaction.origin_location_code):
        raise HTTPException(
            status_code=400,
            detail="Origin location is missing in operation entry request",
        )

    origin_location = db.query(Location).filter(
        Location.location_code.ilike(entry.transaction.origin_location_code)
    ).first()

    if not origin_location:
        raise HTTPException(
            status_code=400,
            detail="Origin location not found",
        )

    if origin_location.status != "Active":
        raise HTTPException(
            status_code=400,
            detail="Only Active origin location can be used",
        )

    if entry.transaction.destination_location_code:
        destination_location = db.query(Location).filter(
            Location.location_code.ilike(entry.transaction.destination_location_code)
        ).first()

        if not destination_location:
            raise HTTPException(
                status_code=400,
                detail="Destination location not found",
            )

        if destination_location.status != "Active":
            raise HTTPException(
                status_code=400,
                detail="Only Active destination location can be used",
            )

    if operation_type.requires_sender_location == "Yes":
        if not entry.transaction.sender_location_code:
            raise HTTPException(
                status_code=400,
                detail="Sender location is required for this operation type",
            )

    if operation_type.requires_receiver_location == "Yes":
        if not entry.transaction.receiver_location_code:
            raise HTTPException(
                status_code=400,
                detail="Receiver location is required for this operation type",
            )

    template_fields = (
        db.query(OperationTemplateField)
        .filter(
            OperationTemplateField.template_id == template.id,
            OperationTemplateField.status == "Active",
        )
        .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
        .all()
    )

    if len(template_fields) == 0:
        raise HTTPException(
            status_code=400,
            detail="Selected operation template has no active fields",
        )

    field_map = {
        field.field_code: field
        for field in template_fields
    }

    value_map = {
        value.field_code: value.field_value
        for value in entry.values
    }

    for field in template_fields:
        if field.is_required == "Yes" and field.input_mode == "Manual":
            if field.field_code not in value_map:
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field missing: {field.field_name}",
                )

            value = value_map.get(field.field_code)

            if value is None or str(value).strip() == "":
                raise HTTPException(
                    status_code=400,
                    detail=f"Required field cannot be blank: {field.field_name}",
                )

    for value in entry.values:
        if value.field_code not in field_map:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid field code: {value.field_code}",
            )

    return (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    )


def format_operation_date_for_ticket(operation_date):
    if operation_date is None:
        return datetime.now().strftime("%Y%m%d")

    if isinstance(operation_date, str):
        try:
            return datetime.fromisoformat(operation_date).strftime("%Y%m%d")
        except ValueError:
            return datetime.now().strftime("%Y%m%d")

    return operation_date.strftime("%Y%m%d")


def generate_operation_ticket_number(db, location_code, asset_code, operation_date):
    ticket_date = format_operation_date_for_ticket(operation_date)

    clean_location_code = str(location_code).strip().upper()
    clean_asset_code = str(asset_code).strip().upper()

    ticket_prefix = f"{clean_location_code}-{clean_asset_code}-{ticket_date}"

    existing_tickets = (
        db.query(OperationTransaction.operation_ticket_number)
        .filter(OperationTransaction.operation_ticket_number.like(f"{ticket_prefix}-%"))
        .all()
    )

    serial_numbers = []

    for row in existing_tickets:
        existing_ticket = row[0]

        if not existing_ticket:
            continue

        try:
            serial_numbers.append(int(str(existing_ticket).split("-")[-1]))
        except ValueError:
            continue

    next_serial_number = max(serial_numbers) + 1 if serial_numbers else 1

    return f"{ticket_prefix}-{next_serial_number:03d}"


def normalize_jsonb_value(value):
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.isoformat()

    if hasattr(value, "isoformat"):
        return value.isoformat()

    if isinstance(value, list):
        return [
            normalize_jsonb_value(item)
            for item in value
        ]

    if isinstance(value, dict):
        return {
            str(key): normalize_jsonb_value(item_value)
            for key, item_value in value.items()
        }

    return value


@app.get(
    "/operation-entries",
    response_model=list[OperationEntryResponse],
)
def get_operation_entries(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transactions = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.operation_template_id.isnot(None))
        .filter(OperationTransaction.status.in_(["Draft", "Rejected"]))
        .order_by(OperationTransaction.id.desc())
        .all()
    )

    return [
        build_operation_entry_response(transaction, db)
        for transaction in transactions
    ]


@app.post(
    "/operation-entries",
    response_model=OperationEntryResponse,
)
def create_operation_entry(
    entry: OperationEntryCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    ) = validate_operation_entry(entry, db)

    trip = get_trip_by_convoy_or_none(db, entry.transaction.convoy_number)
    ensure_trip_not_closed(trip)

    ticket_number = generate_operation_ticket_number(
        db=db,
        location_code=entry.transaction.origin_location_code,
        asset_code=asset.asset_code,
        operation_date=entry.transaction.operation_date,
    )

    new_transaction = OperationTransaction(
        operation_number=generate_operation_number(db),
        operation_ticket_number=ticket_number,
        operation_type_code=transaction_operation_type_code,
        operation_template_id=template.id,
        primary_asset_code=asset.asset_code,
        primary_asset_type_code=asset.asset_type_code,
        convoy_number=clean_optional_text(entry.transaction.convoy_number),
        origin_location_code=entry.transaction.origin_location_code.strip(),
        destination_location_code=clean_optional_text(
            entry.transaction.destination_location_code
        ),
        sender_location_code=clean_optional_text(entry.transaction.sender_location_code),
        receiver_location_code=clean_optional_text(entry.transaction.receiver_location_code),
        operation_date=entry.transaction.operation_date,
        operation_start_datetime=entry.transaction.operation_start_datetime,
        operation_end_datetime=entry.transaction.operation_end_datetime,
        product_name=clean_optional_text(entry.transaction.product_name),
        created_by=(
            f"{current_user.full_name} ({current_user.username})"
            if current_user.full_name
            else current_user.username
        ),
        remarks=clean_optional_text(entry.transaction.remarks),
        status=entry.transaction.status or "Draft",
    )

    db.add(new_transaction)
    db.flush()

    for field in template_fields:
        new_value = OperationTransactionValue(
            transaction_id=new_transaction.id,
            field_code=field.field_code,
            field_name=field.field_name,
            field_group=field.field_group,
            data_type=field.data_type,
            unit=field.unit,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            field_value=normalize_jsonb_value(value_map.get(field.field_code)),
            sort_order=field.sort_order,
        )

        db.add(new_value)

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Create Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=new_transaction.id,
        entity_label=ticket_number,
        ticket_number=ticket_number,
        operation_number=new_transaction.operation_number,
        new_status=new_transaction.status,
        remarks="Operation entry created",
        request_path="/operation-entries",
        details={
            "operation_type_code": new_transaction.operation_type_code,
            "operation_template_id": new_transaction.operation_template_id,
            "primary_asset_code": new_transaction.primary_asset_code,
            "origin_location_code": new_transaction.origin_location_code,
            "operation_date": str(new_transaction.operation_date),
        },
    )

    db.commit()
    db.refresh(new_transaction)

    return build_operation_entry_response(new_transaction, db)


@app.post("/operation-transactions/backfill-ticket-numbers")
def backfill_operation_transaction_ticket_numbers(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Operation Template",
        db,
    )

    transactions = (
        db.query(OperationTransaction)
        .filter(
            (OperationTransaction.operation_ticket_number == None)
            | (OperationTransaction.operation_ticket_number == "")
        )
        .order_by(
            OperationTransaction.operation_date.asc(),
            OperationTransaction.origin_location_code.asc(),
            OperationTransaction.primary_asset_code.asc(),
            OperationTransaction.id.asc(),
        )
        .all()
    )

    total_candidates = len(transactions)
    updated_count = 0
    skipped_count = 0
    examples = []

    for transaction in transactions:
        if not transaction.origin_location_code or not transaction.primary_asset_code:
            skipped_count += 1
            continue

        old_ticket = transaction.operation_ticket_number

        ticket_number = generate_operation_ticket_number(
            db=db,
            location_code=transaction.origin_location_code,
            asset_code=transaction.primary_asset_code,
            operation_date=transaction.operation_date,
        )

        transaction.operation_ticket_number = ticket_number
        updated_count += 1

        if len(examples) < 10:
            examples.append(
                {
                    "transaction_id": transaction.id,
                    "operation_number": transaction.operation_number,
                    "old_ticket_number": old_ticket,
                    "new_ticket_number": ticket_number,
                    "origin_location_code": transaction.origin_location_code,
                    "primary_asset_code": transaction.primary_asset_code,
                    "operation_date": str(transaction.operation_date),
                }
            )

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Backfill Ticket Numbers",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=None,
        entity_label="Backfill Ticket Numbers",
        remarks="Backfilled missing operation ticket numbers",
        request_path="/operation-transactions/backfill-ticket-numbers",
        details={
            "total_candidates": total_candidates,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "examples": examples,
        },
    )

    db.commit()

    return {
        "message": "Backfill completed",
        "total_candidates": total_candidates,
        "updated_count": updated_count,
        "skipped_count": skipped_count,
    }


@app.get("/operation-transactions/{transaction_id}")
def get_operation_transaction_detail(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(status_code=404, detail="Operation transaction not found")

    operation_type = get_operation_type_by_code(transaction.operation_type_code, db)
    location = get_location_by_code(transaction.origin_location_code, db)
    primary_asset = get_asset_by_code(transaction.primary_asset_code, db)

    values = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == transaction.id)
        .order_by(OperationTransactionValue.sort_order.asc(), OperationTransactionValue.id.asc())
        .all()
    )

    field_values = [
        {
            "id": value.id,
            "field_code": value.field_code,
            "field_name": value.field_name,
            "field_group": value.field_group,
            "data_type": value.data_type,
            "unit": value.unit,
            "input_mode": value.input_mode,
            "calculation_role": value.calculation_role,
            "field_value": value.field_value,
            "sort_order": value.sort_order,
        }
        for value in values
    ]

    return {
        "id": transaction.id,
        "operation_number": transaction.operation_number,
        "operation_ticket_number": get_transaction_ticket_number(transaction),
        "ticket_number": get_transaction_ticket_number(transaction),
        "operation_date": transaction.operation_date,
        "operation_type_code": transaction.operation_type_code,
        "operation_type_name": operation_type.operation_type_name if operation_type else "",
        "location_name": location.location_name if location else "",
        "location_code": transaction.origin_location_code,
        "primary_asset_name": primary_asset.asset_name if primary_asset else "",
        "primary_asset_code": transaction.primary_asset_code,
        "convoy_number": transaction.convoy_number,
        "status": transaction.status,
        "created_by": transaction.created_by,
        "created_at": transaction.created_at,
        "updated_at": transaction.updated_at,
        "field_values": field_values,
    }

# -------------------------
# Convoy / Trip Tracking APIs
# -------------------------

@app.get("/convoy-tracker", response_model=ConvoyTrackerResponse)
def get_convoy_tracker(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # View-only: reuse existing permission
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    convoy = clean_optional_text(convoy_number)

    if convoy is None:
        raise HTTPException(
            status_code=400,
            detail="convoy_number is required",
        )

    transactions = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.convoy_number.ilike(convoy))
        .order_by(OperationTransaction.operation_date.asc(), OperationTransaction.id.asc())
        .all()
    )

    # Group by asset (barge)
    asset_map = {}

    for tx in transactions:
        asset_code = tx.primary_asset_code
        asset = get_asset_by_code(asset_code, db)

        if asset_code not in asset_map:
            asset_map[asset_code] = {
                "asset_code": asset_code,
                "asset_name": asset.asset_name if asset else "",
                "tickets": [],
            }

        op_type = get_operation_type_by_code(tx.operation_type_code, db)

        asset_map[asset_code]["tickets"].append(
            {
                "transaction_id": tx.id,
                "ticket_number": get_transaction_ticket_number(tx),
                "operation_type_code": tx.operation_type_code,
                "operation_type_name": op_type.operation_type_name if op_type else "",
                "operation_date": tx.operation_date,
                "origin_location_code": tx.origin_location_code,
                "origin_location_name": get_location_name_by_code(tx.origin_location_code, db),
                "destination_location_code": tx.destination_location_code,
                "destination_location_name": get_location_name_by_code(tx.destination_location_code, db),
                "status": tx.status,
            }
        )

    return {
        "convoy_number": convoy,
        "total_tickets": len(transactions),
        "assets": list(asset_map.values()),
    }


@app.post("/trip-events", response_model=TripEventResponse)
def create_trip_event(
    request: TripEventCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    convoy = clean_optional_text(request.convoy_number)
    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    asset_code = clean_optional_text(request.asset_code)
    if asset_code is None:
        raise HTTPException(status_code=400, detail="asset_code is required")

    tx = None
    if request.operation_transaction_id is not None:
        tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == request.operation_transaction_id)
            .first()
        )
        if not tx:
            raise HTTPException(status_code=404, detail="Operation transaction not found")

        if str(tx.primary_asset_code or "").strip().lower() != asset_code.lower():
            raise HTTPException(
                status_code=400,
                detail="asset_code does not match the operation ticket primary_asset_code",
            )

        # Align convoy if needed
        if clean_optional_text(tx.convoy_number) is None:
            tx.convoy_number = convoy
            db.flush()
        elif str(tx.convoy_number).strip().lower() != convoy.lower():
            raise HTTPException(
                status_code=400,
                detail="Ticket convoy_number does not match request convoy_number",
            )

    # Ensure Trip exists
    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()
    created_by_display = get_current_user_display_name(current_user)

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=asset_code,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()
    
    ensure_trip_not_closed(trip)

    # Auto sequence if missing
    if request.sequence_no is None:
        max_seq = (
            db.query(func.max(TripEvent.sequence_no))
            .filter(TripEvent.trip_id == trip.id)
            .scalar()
        )
        sequence_no = (max_seq or 0) + 1
    else:
        sequence_no = int(request.sequence_no)

    event_type = clean_optional_text(request.event_type)
    if event_type is None:
        raise HTTPException(status_code=400, detail="event_type is required")

    # ✅ location_code must exist for ACK events (no ticket)
    location_code = clean_optional_text(request.location_code)
    if location_code is None and tx is not None:
        location_code = clean_optional_text(tx.origin_location_code)

    if location_code is None:
        raise HTTPException(
            status_code=400,
            detail="location_code is required when operation_transaction_id is not provided",
        )

    event_datetime = (
        request.event_datetime
        or (tx.operation_start_datetime if tx else None)
        or datetime.now()
    )

    op_tx_id = tx.id if tx else None

    new_event = TripEvent(
        trip_id=trip.id,
        event_type=event_type.upper(),
        location_code=location_code,
        asset_code=asset_code,
        operation_transaction_id=op_tx_id,
        sequence_no=sequence_no,
        event_datetime=event_datetime,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    db.add(new_event)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Convoy Tracker",
        action="Create Trip Event",
        current_user=current_user,
        entity_type="TripEvent",
        entity_id=new_event.id,
        entity_label=f"{convoy} | {new_event.event_type} | {asset_code}",
        ticket_number=(get_transaction_ticket_number(tx) if tx else None),
        operation_number=(tx.operation_number if tx else None),
        remarks="Trip event created",
        request_path="/trip-events",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "event_type": new_event.event_type,
            "asset_code": asset_code,
            "location_code": location_code,
            "operation_transaction_id": op_tx_id,
            "sequence_no": sequence_no,
        },
    )

    db.commit()
    db.refresh(new_event)

    return {
        "id": new_event.id,
        "trip_id": new_event.trip_id,
        "convoy_number": convoy,
        "event_type": new_event.event_type,
        "location_code": new_event.location_code,
        "asset_code": new_event.asset_code,
        "operation_transaction_id": new_event.operation_transaction_id,
        "sequence_no": new_event.sequence_no,
        "event_datetime": new_event.event_datetime,
        "created_by": new_event.created_by,
        "remarks": new_event.remarks,
        "created_at": new_event.created_at,
        "updated_at": new_event.updated_at,
    }

@app.get("/trips/by-convoy/{convoy_number}")
def get_trip_timeline_by_convoy(
    convoy_number: str,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    convoy = clean_optional_text(convoy_number)

    if convoy is None:
        raise HTTPException(
            status_code=400,
            detail="convoy_number is required",
        )

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()

    if not trip:
        raise HTTPException(
            status_code=404,
            detail="Trip not found for this convoy number",
        )

    events = (
        db.query(TripEvent)
        .filter(TripEvent.trip_id == trip.id)
        .order_by(TripEvent.sequence_no.asc(), TripEvent.id.asc())
        .all()
    )

    comparisons = (
        db.query(TripComparison)
        .filter(TripComparison.trip_id == trip.id)
        .order_by(TripComparison.id.asc())
        .all()
    )

    # Enrich events with ticket numbers for UI convenience
    event_rows = []

    for ev in events:
        tx = db.query(OperationTransaction).filter(OperationTransaction.id == ev.operation_transaction_id).first()
        asset = get_asset_by_code(ev.asset_code, db)

        event_rows.append(
            {
                "id": ev.id,
                "trip_id": ev.trip_id,
                "convoy_number": convoy,
                "event_type": ev.event_type,
                "sequence_no": ev.sequence_no,
                "event_datetime": ev.event_datetime,
                "location_code": ev.location_code,
                "location_name": get_location_name_by_code(ev.location_code, db),
                "asset_code": ev.asset_code,
                "asset_name": asset.asset_name if asset else "",
                "operation_transaction_id": ev.operation_transaction_id,
                "ticket_number": get_transaction_ticket_number(tx) if tx else "",
                "ticket_status": tx.status if tx else "",
            }
        )

    comparison_rows = []
    did_backfill = False

    for cmp in comparisons:
        left_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.left_transaction_id)
            .first()
        )
        right_tx = (
            db.query(OperationTransaction)
            .filter(OperationTransaction.id == cmp.right_transaction_id)
            .first()
        )

        # ✅ Backfill missing JSON for older comparisons (fixes blank reports)
        if (
            cmp.summary_json is None or cmp.per_tank_json is None
        ) and left_tx and right_tx:
            left_payload = load_multi_tank_payload(db, left_tx.id)
            right_payload = load_multi_tank_payload(db, right_tx.id)

            if left_payload and right_payload:
                auto_summary, auto_per_tank = build_multitank_comparison_json(
                    left_tx=left_tx,
                    right_tx=right_tx,
                    comparison_type=cmp.comparison_type,
                    left_payload=left_payload,
                    right_payload=right_payload,
                )
                if cmp.summary_json is None:
                    cmp.summary_json = auto_summary
                if cmp.per_tank_json is None:
                    cmp.per_tank_json = auto_per_tank
                did_backfill = True

        asset_code = (left_tx.primary_asset_code if left_tx else "") or (
            right_tx.primary_asset_code if right_tx else ""
        )
        asset = get_asset_by_code(asset_code, db) if asset_code else None

        comparison_rows.append(
            {
                "id": cmp.id,
                "trip_id": cmp.trip_id,
                "convoy_number": convoy,
                "comparison_type": cmp.comparison_type,
                "asset_code": asset_code,
                "asset_name": asset.asset_name if asset else "",
                "left_transaction_id": cmp.left_transaction_id,
                "left_ticket_number": get_transaction_ticket_number(left_tx)
                if left_tx
                else "",
                "right_transaction_id": cmp.right_transaction_id,
                "right_ticket_number": get_transaction_ticket_number(right_tx)
                if right_tx
                else "",
                "summary_json": cmp.summary_json,
                "per_tank_json": cmp.per_tank_json,
                "created_by": cmp.created_by,
                "remarks": cmp.remarks,
                "created_at": cmp.created_at,
                "updated_at": cmp.updated_at,
            }
        )

    if did_backfill:
        db.commit()

    return {
        "trip": {
            "id": trip.id,
            "convoy_number": trip.convoy_number,
            "primary_barge_asset_code": trip.primary_barge_asset_code,
            "status": trip.status,
            "created_by": trip.created_by,
            "remarks": trip.remarks,
            "created_at": trip.created_at,
            "updated_at": trip.updated_at,
        },
        "events": event_rows,
        "comparisons": comparison_rows,
    }


import json


def load_multi_tank_payload(db: Session, transaction_id: int):
    row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if not row or row.field_value is None:
        return None

    if isinstance(row.field_value, dict):
        return row.field_value

    try:
        return json.loads(str(row.field_value))
    except Exception:
        return None


def resolve_comparison_stages(comparison_type: str):
    """
    Decide which snapshot to compare from each ticket payload.
    MultiTank payload contains:
      payload["inputs"]["before"/"after"]
      payload["perTank"]["before"/"after"]
      payload["calculated"]["before"/"after"]
    """
    t = (comparison_type or "").upper()

    # Defaults
    left_stage = "after"
    right_stage = "before"

    if "UNLOAD_BEFORE_VS_UNLOAD_AFTER" in t:
        left_stage = "before"
        right_stage = "after"

    if "LOAD_PREV_VS_LOAD_CURRENT" in t:
        left_stage = "after"
        right_stage = "before"

    # Main case
    if "LOAD_AFTER_VS_UNLOAD_BEFORE" in t:
        left_stage = "after"
        right_stage = "before"

    return left_stage, right_stage


def get_payload_stage(payload: dict, stage_key: str):
    inputs = (payload.get("inputs") or {}).get(stage_key) or {}
    per_tank = (payload.get("perTank") or {}).get(stage_key) or {}
    totals = (payload.get("calculated") or {}).get(stage_key) or {}

    return {
        "inputs": inputs,
        "per_tank": per_tank,
        "totals": totals,
    }


def build_multitank_comparison_json(
    left_tx: OperationTransaction,
    right_tx: OperationTransaction,
    comparison_type: str,
    left_payload: dict,
    right_payload: dict,
):
    left_stage, right_stage = resolve_comparison_stages(comparison_type)

    l = get_payload_stage(left_payload, left_stage)
    r = get_payload_stage(right_payload, right_stage)

    # Tank list (union)
    tank_ids = set()
    tank_ids.update((left_payload.get("meta") or {}).get("tankIds") or [])
    tank_ids.update((right_payload.get("meta") or {}).get("tankIds") or [])
    tank_ids.update(list((l["per_tank"] or {}).keys()))
    tank_ids.update(list((r["per_tank"] or {}).keys()))
    tank_ids = [str(x) for x in tank_ids if str(x).strip()]
    tank_ids.sort()

    per_tank_rows = []
    for tid in tank_ids:
        lp = (l["per_tank"] or {}).get(tid) or {}
        rp = (r["per_tank"] or {}).get(tid) or {}

        per_tank_rows.append(
            {
                "tank_id": tid,
                "left": {
                    "total_dip": lp.get("totalDip", 0),
                    "water_dip": lp.get("waterDip", 0),
                    "tov": lp.get("tovCorrected", 0),
                    "fw": lp.get("fwCorrected", 0),
                },
                "right": {
                    "total_dip": rp.get("totalDip", 0),
                    "water_dip": rp.get("waterDip", 0),
                    "tov": rp.get("tovCorrected", 0),
                    "fw": rp.get("fwCorrected", 0),
                },
                "delta": {
                    "tov": (lp.get("tovCorrected", 0) or 0)
                    - (rp.get("tovCorrected", 0) or 0),
                    "fw": (lp.get("fwCorrected", 0) or 0)
                    - (rp.get("fwCorrected", 0) or 0),
                },
            }
        )

    def pick_totals(obj: dict):
        # totals already computed by frontend and stored in payload
        keys = [
            "TOV",
            "FW",
            "GOV",
            "GSV",
            "BSW",
            "NSV",
            "LT",
            "MT",
            "API60",
            "VCF",
            "ltFactor",
            "table11Method",
        ]
        return {k: obj.get(k) for k in keys if k in obj}

    left_totals = pick_totals(l["totals"] or {})
    right_totals = pick_totals(r["totals"] or {})

    def n(v):
        try:
            return float(v)
        except Exception:
            return 0.0

    delta_totals = {}
    for k in ["TOV", "FW", "GOV", "GSV", "BSW", "NSV", "LT", "MT"]:
        delta_totals[k] = n(left_totals.get(k)) - n(right_totals.get(k))

    summary_json = {
        "comparison_type": comparison_type,
        "asset_code": left_tx.primary_asset_code,
        "left": {
            "transaction_id": left_tx.id,
            "ticket_number": get_transaction_ticket_number(left_tx),
            "stage": left_stage,
            "operation_date": (
                str(left_tx.operation_date) if left_tx.operation_date else ""
            ),
            "location_code": left_tx.origin_location_code or "",
            "inputs": l["inputs"],
            "totals": left_totals,
        },
        "right": {
            "transaction_id": right_tx.id,
            "ticket_number": get_transaction_ticket_number(right_tx),
            "stage": right_stage,
            "operation_date": (
                str(right_tx.operation_date) if right_tx.operation_date else ""
            ),
            "location_code": right_tx.origin_location_code or "",
            "inputs": r["inputs"],
            "totals": right_totals,
        },
        "delta": {"totals": delta_totals},
        "units": {
            "dip": ((left_payload.get("meta") or {}).get("inputXUnit") or "mm"),
            "volume": ((left_payload.get("meta") or {}).get("outputUnit") or ""),
        },
    }

    per_tank_json = {"tanks": per_tank_rows}

    return summary_json, per_tank_json


@app.post("/trip-comparisons", response_model=TripComparisonResponse)
def create_trip_comparison(
    request: TripComparisonCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    # For now, treat as operational action
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    convoy = clean_optional_text(request.convoy_number)

    if convoy is None:
        raise HTTPException(status_code=400, detail="convoy_number is required")

    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()

    created_by_display = get_current_user_display_name(current_user)

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=None,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    ensure_trip_not_closed(trip)

    left_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.left_transaction_id).first()
    right_tx = db.query(OperationTransaction).filter(OperationTransaction.id == request.right_transaction_id).first()

    if not left_tx or not right_tx:
        raise HTTPException(status_code=404, detail="Left or Right transaction not found")

    # Align ticket convoy if missing
    if clean_optional_text(left_tx.convoy_number) is None:
        left_tx.convoy_number = convoy
    if clean_optional_text(right_tx.convoy_number) is None:
        right_tx.convoy_number = convoy

    # Reject mismatch
    if str(left_tx.convoy_number).strip().lower() != convoy.lower() or str(right_tx.convoy_number).strip().lower() != convoy.lower():
        raise HTTPException(status_code=400, detail="Both tickets must belong to the same convoy_number")

    comparison_type = clean_optional_text(request.comparison_type)
    if comparison_type is None:
        raise HTTPException(status_code=400, detail="comparison_type is required")

    # Auto-build comparison JSON if missing
    summary_json = request.summary_json
    per_tank_json = request.per_tank_json

    left_payload = None
    right_payload = None

    if summary_json is None or per_tank_json is None:
        left_payload = load_multi_tank_payload(db, left_tx.id)
        right_payload = load_multi_tank_payload(db, right_tx.id)

        if left_payload and right_payload:
            auto_summary, auto_per_tank = build_multitank_comparison_json(
                left_tx=left_tx,
                right_tx=right_tx,
                comparison_type=comparison_type,
                left_payload=left_payload,
                right_payload=right_payload,
            )
            if summary_json is None:
                summary_json = auto_summary
            if per_tank_json is None:
                per_tank_json = auto_per_tank

    # ✅ Prevent empty comparison records (this is why your report shows blanks)
    if summary_json is None or per_tank_json is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Unable to auto-build comparison data. "
                "Ensure BOTH tickets are Multi-Tank tickets and contain field_code 'multi_tank_payload'. "
                f"left_ticket_id={left_tx.id} has_payload={bool(left_payload)} | "
                f"right_ticket_id={right_tx.id} has_payload={bool(right_payload)}"
            ),
        )

    new_cmp = TripComparison(
        trip_id=trip.id,
        comparison_type=comparison_type,
        left_transaction_id=left_tx.id,
        right_transaction_id=right_tx.id,
        summary_json=summary_json,
        per_tank_json=per_tank_json,
        created_by=created_by_display,
        remarks=clean_optional_text(request.remarks),
    )

    db.add(new_cmp)
    db.flush()

    create_audit_log(
        db=db,
        module_name="Convoy Tracker",
        action="Create Trip Comparison",
        current_user=current_user,
        entity_type="TripComparison",
        entity_id=new_cmp.id,
        entity_label=f"{convoy} | {comparison_type}",
        ticket_number=get_transaction_ticket_number(left_tx),
        operation_number=left_tx.operation_number,
        remarks="Trip comparison created",
        request_path="/trip-comparisons",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "comparison_type": comparison_type,
            "left_transaction_id": left_tx.id,
            "left_ticket_number": get_transaction_ticket_number(left_tx),
            "right_transaction_id": right_tx.id,
            "right_ticket_number": get_transaction_ticket_number(right_tx),
        },
    )

    db.commit()
    db.refresh(new_cmp)

    return {
        "id": new_cmp.id,
        "trip_id": new_cmp.trip_id,
        "convoy_number": convoy,
        "comparison_type": new_cmp.comparison_type,
        "left_transaction_id": new_cmp.left_transaction_id,
        "right_transaction_id": new_cmp.right_transaction_id,
        "summary_json": new_cmp.summary_json,
        "per_tank_json": new_cmp.per_tank_json,
        "created_by": new_cmp.created_by,
        "remarks": new_cmp.remarks,
        "created_at": new_cmp.created_at,
        "updated_at": new_cmp.updated_at,
    }

# -------------------------
# Trip Close / Reopen + Lock enforcement
# -------------------------

class TripStatusUpdateRequest(BaseModel):
    remarks: str | None = None


def get_trip_by_convoy_or_none(db: Session, convoy_number: str | None):
    convoy = clean_optional_text(convoy_number)
    if convoy is None:
        return None
    return db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()


def ensure_trip_not_closed(trip: Trip | None):
    if not trip:
        return
    if str(trip.status or "").strip().upper() == "CLOSED":
        raise HTTPException(
            status_code=400,
            detail="Trip is CLOSED for this convoy. Reopen the trip to continue.",
        )


@app.post("/trips/{trip_id}/close")
def close_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if str(trip.status or "").upper() == "CLOSED":
        return {"message": "Trip already CLOSED", "trip_id": trip.id, "status": trip.status}

    before_status = trip.status
    trip.status = "CLOSED"
    trip.updated_at = datetime.now()

    if request and clean_optional_text(request.remarks):
        trip.remarks = (trip.remarks or "") + f"\n[Trip Closed] {clean_optional_text(request.remarks)}"

    create_audit_log(
        db=db,
        module_name="Convoy Tracker",
        action="Close Trip",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Trip closed manually",
        request_path=f"/trips/{trip_id}/close",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Trip CLOSED", "trip_id": trip.id, "status": trip.status}


@app.post("/trips/{trip_id}/reopen")
def reopen_trip(
    trip_id: int,
    request: TripStatusUpdateRequest | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(current_user, "Create Operation Entry", db)

    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")

    if str(trip.status or "").upper() == "OPEN":
        return {"message": "Trip already OPEN", "trip_id": trip.id, "status": trip.status}

    before_status = trip.status
    trip.status = "OPEN"
    trip.updated_at = datetime.now()

    if request and clean_optional_text(request.remarks):
        trip.remarks = (trip.remarks or "") + f"\n[Trip Reopened] {clean_optional_text(request.remarks)}"

    create_audit_log(
        db=db,
        module_name="Convoy Tracker",
        action="Reopen Trip",
        current_user=current_user,
        entity_type="Trip",
        entity_id=trip.id,
        entity_label=trip.convoy_number,
        remarks="Trip reopened manually",
        request_path=f"/trips/{trip_id}/reopen",
        details={
            "convoy_number": trip.convoy_number,
            "before_status": before_status,
            "after_status": trip.status,
        },
    )

    db.commit()
    db.refresh(trip)

    return {"message": "Trip REOPENED", "trip_id": trip.id, "status": trip.status}


# -------------------------
# Tank Stock Ledger Creation Helpers
# -------------------------

def safe_float(value, default_value: float = 0):
    try:
        if value is None:
            return default_value

        if str(value).strip() == "":
            return default_value

        return float(value)
    except (TypeError, ValueError):
        return default_value


def get_tank_gauging_payload_for_transaction(
    db: Session,
    transaction_id: int,
):
    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction_id,
            OperationTransactionValue.field_code == "tank_gauging_payload",
        )
        .first()
    )

    if payload_row is None or payload_row.field_value is None:
        return None

    if not isinstance(payload_row.field_value, dict):
        return None

    return payload_row.field_value


def parse_payload_gauging_datetime(payload: dict):
    inputs = payload.get("inputs") or {}

    gauging_date = clean_optional_text(inputs.get("gaugingDate"))
    gauging_time = clean_optional_text(inputs.get("gaugingTime"))

    if not gauging_date or not gauging_time:
        return None

    try:
        return datetime.fromisoformat(f"{gauging_date}T{gauging_time}")
    except ValueError:
        return None


def resolve_transaction_datetime_for_accounting_day(
    transaction: OperationTransaction,
    payload: dict,
):
    if transaction.operation_start_datetime is not None:
        return transaction.operation_start_datetime

    payload_datetime = parse_payload_gauging_datetime(payload)

    if payload_datetime is not None:
        return payload_datetime

    raise HTTPException(
        status_code=400,
        detail=(
            "Operation Start Date/Time or Tank Gauging Date/Time is required "
            "to calculate the Location Accounting Day."
        ),
    )


def calculate_accounting_window_from_setting(
    setting: LocationAccountingDaySetting,
    transaction_datetime: datetime,
):
    transaction_date = transaction_datetime.date()
    transaction_time = transaction_datetime.time()

    start_time = setting.day_start_time
    end_time = setting.day_end_time

    # Most hydrocarbon operational days are overnight:
    # Example 06:01 today to 06:00 next day.
    is_overnight_window = end_time < start_time

    if is_overnight_window:
        if transaction_time >= start_time:
            accounting_date = transaction_date
        else:
            accounting_date = transaction_date - timedelta(days=1)

        accounting_day_start = datetime.combine(accounting_date, start_time)
        accounting_day_end = datetime.combine(
            accounting_date + timedelta(days=1),
            end_time,
        )

    else:
        # Supports same-calendar-day windows if ever required.
        if transaction_time >= start_time:
            accounting_date = transaction_date
        else:
            accounting_date = transaction_date - timedelta(days=1)

        accounting_day_start = datetime.combine(accounting_date, start_time)
        accounting_day_end = datetime.combine(accounting_date, end_time)

    return {
        "accounting_date": accounting_date,
        "accounting_day_start": accounting_day_start,
        "accounting_day_end": accounting_day_end,
    }


def get_location_accounting_day_for_transaction(
    db: Session,
    location_code: str,
    transaction_datetime: datetime,
):
    cleaned_location_code = clean_optional_text(location_code)

    if not cleaned_location_code:
        raise HTTPException(
            status_code=400,
            detail="Location is required to calculate accounting day",
        )

    active_settings = (
        db.query(LocationAccountingDaySetting)
        .filter(
            LocationAccountingDaySetting.location_code.ilike(cleaned_location_code),
            LocationAccountingDaySetting.status == "Active",
        )
        .order_by(
            LocationAccountingDaySetting.effective_from.desc(),
            LocationAccountingDaySetting.id.desc(),
        )
        .all()
    )

    if len(active_settings) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "No Active Location Accounting Day Setting found for "
                f"{cleaned_location_code}. Configure it before approving "
                "Tank Gauging tickets."
            ),
        )

    matching_options = []

    for setting in active_settings:
        window = calculate_accounting_window_from_setting(
            setting=setting,
            transaction_datetime=transaction_datetime,
        )

        accounting_date = window["accounting_date"]

        effective_to = setting.effective_to or date(9999, 12, 31)

        if setting.effective_from <= accounting_date <= effective_to:
            if (
                window["accounting_day_start"]
                <= transaction_datetime
                <= window["accounting_day_end"]
            ):
                matching_options.append(
                    {
                        "setting": setting,
                        "window": window,
                    }
                )

    if len(matching_options) == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "No effective Location Accounting Day Setting matched this "
                "transaction date/time. Check Effective From/To settings."
            ),
        )

    selected = matching_options[0]
    selected_setting = selected["setting"]
    selected_window = selected["window"]

    return {
        "setting_id": selected_setting.id,
        "accounting_date": selected_window["accounting_date"],
        "accounting_day_start": selected_window["accounting_day_start"],
        "accounting_day_end": selected_window["accounting_day_end"],
    }

def get_ledger_sort_datetime(ledger: TankStockLedger):
    if ledger.accounting_day_start is not None:
        return ledger.accounting_day_start

    if ledger.operation_date is not None:
        return datetime.combine(ledger.operation_date, datetime_time(0, 0))

    return datetime.min


def get_previous_active_ledger_row(
    db: Session,
    location_code: str,
    tank_asset_code: str,
    product_name: str | None,
    transaction_datetime: datetime,
    exclude_ledger_id: int | None = None,
):
    query = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
        TankStockLedger.location_code.ilike(location_code),
        TankStockLedger.tank_asset_code.ilike(tank_asset_code),
    )

    cleaned_product_name = clean_optional_text(product_name)

    if cleaned_product_name:
        query = query.filter(TankStockLedger.product_name.ilike(cleaned_product_name))
    else:
        query = query.filter(TankStockLedger.product_name == None)

    if exclude_ledger_id is not None:
        query = query.filter(TankStockLedger.id != exclude_ledger_id)

    candidate_rows = query.all()

    previous_rows = []

    for row in candidate_rows:
        row_datetime = row.accounting_day_start

        # Prefer actual operation timestamp if stored in source payload.
        try:
            payload = row.source_payload or {}
            payload_inputs = payload.get("inputs") or {}
            gauging_date = clean_optional_text(payload_inputs.get("gaugingDate"))
            gauging_time = clean_optional_text(payload_inputs.get("gaugingTime"))

            if gauging_date and gauging_time:
                row_datetime = datetime.fromisoformat(
                    f"{gauging_date}T{gauging_time}"
                )
        except Exception:
            row_datetime = None

        if row_datetime is None:
            row_datetime = datetime.combine(row.operation_date, datetime_time(0, 0))

        if row_datetime < transaction_datetime:
            previous_rows.append((row_datetime, row.id, row))

    if not previous_rows:
        return None

    previous_rows.sort(key=lambda item: (item[0], item[1]))

    return previous_rows[-1][2]


def calculate_stock_movement_from_snapshot(
    operation_sign: str,
    current_gsv_bbl: float,
    current_nsv_bbl: float,
    current_lt: float,
    current_mt: float,
    previous_ledger: TankStockLedger | None,
):
    sign = str(operation_sign or "").upper()

    previous_gsv_bbl = 0
    previous_nsv_bbl = 0
    previous_lt = 0
    previous_mt = 0

    if previous_ledger is not None:
        previous_gsv_bbl = safe_float(
            previous_ledger.stock_gsv_bbl
            if previous_ledger.stock_gsv_bbl is not None
            else previous_ledger.running_balance_gsv_bbl
        )
        previous_nsv_bbl = safe_float(
            previous_ledger.stock_nsv_bbl
            if previous_ledger.stock_nsv_bbl is not None
            else previous_ledger.running_balance_nsv_bbl
        )
        previous_lt = safe_float(
            previous_ledger.stock_lt
            if previous_ledger.stock_lt is not None
            else previous_ledger.running_balance_lt
        )
        previous_mt = safe_float(
            previous_ledger.stock_mt
            if previous_ledger.stock_mt is not None
            else previous_ledger.running_balance_mt
        )

    if sign == "SET":
        movement_gsv_bbl = current_gsv_bbl
        movement_nsv_bbl = current_nsv_bbl
        movement_lt = current_lt
        movement_mt = current_mt

    elif sign == "IN":
        movement_gsv_bbl = max(current_gsv_bbl - previous_gsv_bbl, 0)
        movement_nsv_bbl = max(current_nsv_bbl - previous_nsv_bbl, 0)
        movement_lt = max(current_lt - previous_lt, 0)
        movement_mt = max(current_mt - previous_mt, 0)

    elif sign == "OUT":
        movement_gsv_bbl = max(previous_gsv_bbl - current_gsv_bbl, 0)
        movement_nsv_bbl = max(previous_nsv_bbl - current_nsv_bbl, 0)
        movement_lt = max(previous_lt - current_lt, 0)
        movement_mt = max(previous_mt - current_mt, 0)

    elif sign == "NEUTRAL":
        movement_gsv_bbl = 0
        movement_nsv_bbl = 0
        movement_lt = 0
        movement_mt = 0

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid Tank Operation Sign: {operation_sign}",
        )

    return {
        "previous_gsv_bbl": previous_gsv_bbl,
        "previous_nsv_bbl": previous_nsv_bbl,
        "previous_lt": previous_lt,
        "previous_mt": previous_mt,
        "movement_gsv_bbl": movement_gsv_bbl,
        "movement_nsv_bbl": movement_nsv_bbl,
        "movement_lt": movement_lt,
        "movement_mt": movement_mt,
    }

def is_tank_gauging_transaction(
    db: Session,
    transaction: OperationTransaction,
):
    if transaction.operation_template_id is None:
        return False

    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template:
        return False

    entry_layout_type = str(template.entry_layout_type or "").strip()
    calculation_engine = str(template.calculation_engine or "").strip()

    if entry_layout_type == "Tank Gauging":
        return True

    if calculation_engine == "Tank Quantity":
        return True

    payload = get_tank_gauging_payload_for_transaction(
        db=db,
        transaction_id=transaction.id,
    )

    return payload is not None


def rebuild_tank_stock_running_balances(
    db: Session,
    location_code: str,
    tank_asset_code: str,
    product_name: str | None,
):
    query = db.query(TankStockLedger).filter(
        TankStockLedger.location_code.ilike(location_code),
        TankStockLedger.tank_asset_code.ilike(tank_asset_code),
        TankStockLedger.status == "Active",
    )

    cleaned_product_name = clean_optional_text(product_name)

    if cleaned_product_name:
        query = query.filter(
            TankStockLedger.product_name.ilike(cleaned_product_name)
        )
    else:
        query = query.filter(TankStockLedger.product_name == None)

    ledger_rows = query.all()

    sortable_rows = []

    for row in ledger_rows:
        row_datetime = row.accounting_day_start

        try:
            payload = row.source_payload or {}
            payload_inputs = payload.get("inputs") or {}
            gauging_date = clean_optional_text(payload_inputs.get("gaugingDate"))
            gauging_time = clean_optional_text(payload_inputs.get("gaugingTime"))

            if gauging_date and gauging_time:
                row_datetime = datetime.fromisoformat(
                    f"{gauging_date}T{gauging_time}"
                )
        except Exception:
            row_datetime = None

        if row_datetime is None:
            row_datetime = datetime.combine(row.operation_date, datetime_time(0, 0))

        sortable_rows.append((row_datetime, row.id, row))

    sortable_rows.sort(key=lambda item: (item[0], item[1]))

    previous_row = None

    for row_datetime, _row_id, row in sortable_rows:
        current_gsv_bbl = safe_float(row.stock_gsv_bbl)
        current_nsv_bbl = safe_float(row.stock_nsv_bbl)
        current_lt = safe_float(row.stock_lt)
        current_mt = safe_float(row.stock_mt)

        # Backward compatibility for old rows before stock_* columns existed.
        if current_gsv_bbl == 0 and current_nsv_bbl == 0:
            current_gsv_bbl = safe_float(row.running_balance_gsv_bbl)
            current_nsv_bbl = safe_float(row.running_balance_nsv_bbl)
            current_lt = safe_float(row.running_balance_lt)
            current_mt = safe_float(row.running_balance_mt)

            row.stock_gsv_bbl = current_gsv_bbl
            row.stock_nsv_bbl = current_nsv_bbl
            row.stock_lt = current_lt
            row.stock_mt = current_mt

        movement = calculate_stock_movement_from_snapshot(
            operation_sign=row.tank_operation_sign,
            current_gsv_bbl=current_gsv_bbl,
            current_nsv_bbl=current_nsv_bbl,
            current_lt=current_lt,
            current_mt=current_mt,
            previous_ledger=previous_row,
        )

        row.previous_stock_gsv_bbl = movement["previous_gsv_bbl"]
        row.previous_stock_nsv_bbl = movement["previous_nsv_bbl"]
        row.previous_stock_lt = movement["previous_lt"]
        row.previous_stock_mt = movement["previous_mt"]

        row.movement_gsv_bbl = movement["movement_gsv_bbl"]
        row.movement_nsv_bbl = movement["movement_nsv_bbl"]
        row.movement_lt = movement["movement_lt"]
        row.movement_mt = movement["movement_mt"]

        # Running balance is the current stock snapshot after the operation.
        row.running_balance_gsv_bbl = current_gsv_bbl
        row.running_balance_nsv_bbl = current_nsv_bbl
        row.running_balance_lt = current_lt
        row.running_balance_mt = current_mt

        row.updated_at = datetime.now()

        previous_row = row

    db.flush()

def create_tank_stock_ledger_from_approved_transaction(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    if transaction.status != "Approved":
        return None

    if not is_tank_gauging_transaction(db, transaction):
        return None

    existing_ledger = (
        db.query(TankStockLedger)
        .filter(TankStockLedger.transaction_id == transaction.id)
        .first()
    )

    if existing_ledger:
        return existing_ledger

    payload = get_tank_gauging_payload_for_transaction(
        db=db,
        transaction_id=transaction.id,
    )

    if payload is None:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tank Gauging payload is missing. Open Operation Entry, "
                "save the tank gauging ticket, then approve again."
            ),
        )

    inputs = payload.get("inputs") or {}
    calculated = payload.get("calculated") or {}
    payload_asset = payload.get("asset") or {}

    transaction_datetime = resolve_transaction_datetime_for_accounting_day(
        transaction=transaction,
        payload=payload,
    )

    accounting_day = get_location_accounting_day_for_transaction(
        db=db,
        location_code=transaction.origin_location_code,
        transaction_datetime=transaction_datetime,
    )

    tank_operation_code = clean_optional_text(
        inputs.get("tankOperationCode")
    )
    tank_operation_label = clean_optional_text(
        inputs.get("tankOperationLabel")
    )
    tank_operation_category = clean_optional_text(
        inputs.get("tankOperationCategory")
    )
    tank_operation_sign = clean_optional_text(
        inputs.get("tankOperationSign")
    )

    if not tank_operation_code:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tank Operation is missing in Tank Gauging payload. "
                "Open the ticket, select Tank Operation, save, then approve."
            ),
        )

    if not tank_operation_label:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Label is missing in Tank Gauging payload.",
        )

    if not tank_operation_category:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Category is missing in Tank Gauging payload.",
        )

    if not tank_operation_sign:
        raise HTTPException(
            status_code=400,
            detail="Tank Operation Sign is missing in Tank Gauging payload.",
        )

    current_stock_gsv_bbl = safe_float(calculated.get("gsvBbl"))
    current_stock_nsv_bbl = safe_float(calculated.get("nsvBbl"))
    current_stock_lt = safe_float(calculated.get("lt"))
    current_stock_mt = safe_float(calculated.get("mt"))

    if current_stock_nsv_bbl == 0 and current_stock_gsv_bbl == 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Calculated tank quantity is missing or zero. "
                "Open the ticket, verify Tank Gauging calculations, save, then approve."
            ),
        )

    tank_asset = get_asset_by_code(transaction.primary_asset_code, db)

    tank_asset_name = ""

    if tank_asset:
        tank_asset_name = tank_asset.asset_name
    else:
        tank_asset_name = clean_optional_text(
            payload_asset.get("asset_name")
        ) or ""

    created_by_display = get_current_user_display_name(current_user)

    new_ledger = TankStockLedger(
        transaction_id=transaction.id,
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        location_code=transaction.origin_location_code,
        tank_asset_code=transaction.primary_asset_code,
        tank_asset_name=tank_asset_name,
        operation_date=transaction.operation_date,
        product_name=clean_optional_text(transaction.product_name),
        accounting_date=accounting_day["accounting_date"],
        accounting_day_start=accounting_day["accounting_day_start"],
        accounting_day_end=accounting_day["accounting_day_end"],
        accounting_day_setting_id=accounting_day["setting_id"],
        tank_operation_code=tank_operation_code,
        tank_operation_label=tank_operation_label,
        tank_operation_category=tank_operation_category,
        tank_operation_sign=tank_operation_sign,
        movement_gsv_bbl=0,
        movement_nsv_bbl=0,
        movement_lt=0,
        movement_mt=0,
        stock_gsv_bbl=current_stock_gsv_bbl,
        stock_nsv_bbl=current_stock_nsv_bbl,
        stock_lt=current_stock_lt,
        stock_mt=current_stock_mt,
        previous_stock_gsv_bbl=0,
        previous_stock_nsv_bbl=0,
        previous_stock_lt=0,
        previous_stock_mt=0,
        running_balance_gsv_bbl=current_stock_gsv_bbl,
        running_balance_nsv_bbl=current_stock_nsv_bbl,
        running_balance_lt=current_stock_lt,
        running_balance_mt=current_stock_mt,
        source_payload=normalize_jsonb_value(payload),
        status="Active",
        created_by=created_by_display,
        remarks="Auto-created when Tank Gauging ticket was approved",
    )

    db.add(new_ledger)
    db.flush()

    rebuild_tank_stock_running_balances(
        db=db,
        location_code=new_ledger.location_code,
        tank_asset_code=new_ledger.tank_asset_code,
        product_name=new_ledger.product_name,
    )

    db.flush()

    create_audit_log(
        db=db,
        module_name="Tank Stock Ledger",
        action="Create Tank Stock Ledger Entry",
        current_user=current_user,
        entity_type="TankStockLedger",
        entity_id=new_ledger.id,
        entity_label=(
            f"{new_ledger.ticket_number} | "
            f"{new_ledger.tank_asset_code} | "
            f"{new_ledger.tank_operation_label}"
        ),
        ticket_number=new_ledger.ticket_number,
        operation_number=new_ledger.operation_number,
        remarks="Auto-created on Tank Gauging approval",
        request_path="/operation-transactions/{id}/status",
        details={
            "transaction_id": transaction.id,
            "location_code": new_ledger.location_code,
            "tank_asset_code": new_ledger.tank_asset_code,
            "operation_date": str(new_ledger.operation_date),
            "transaction_datetime": transaction_datetime.isoformat(),
            "accounting_date": str(new_ledger.accounting_date),
            "accounting_day_start": (
                new_ledger.accounting_day_start.isoformat()
                if new_ledger.accounting_day_start
                else None
            ),
            "accounting_day_end": (
                new_ledger.accounting_day_end.isoformat()
                if new_ledger.accounting_day_end
                else None
            ),
            "accounting_day_setting_id": new_ledger.accounting_day_setting_id,
            "product_name": new_ledger.product_name,
            "tank_operation_code": new_ledger.tank_operation_code,
            "tank_operation_label": new_ledger.tank_operation_label,
            "tank_operation_category": new_ledger.tank_operation_category,
            "tank_operation_sign": new_ledger.tank_operation_sign,
            "stock_gsv_bbl": new_ledger.stock_gsv_bbl,
            "stock_nsv_bbl": new_ledger.stock_nsv_bbl,
            "stock_lt": new_ledger.stock_lt,
            "stock_mt": new_ledger.stock_mt,
            "previous_stock_gsv_bbl": new_ledger.previous_stock_gsv_bbl,
            "previous_stock_nsv_bbl": new_ledger.previous_stock_nsv_bbl,
            "previous_stock_lt": new_ledger.previous_stock_lt,
            "previous_stock_mt": new_ledger.previous_stock_mt,
            "movement_gsv_bbl": new_ledger.movement_gsv_bbl,
            "movement_nsv_bbl": new_ledger.movement_nsv_bbl,
            "movement_lt": new_ledger.movement_lt,
            "movement_mt": new_ledger.movement_mt,
            "running_balance_gsv_bbl": new_ledger.running_balance_gsv_bbl,
            "running_balance_nsv_bbl": new_ledger.running_balance_nsv_bbl,
            "running_balance_lt": new_ledger.running_balance_lt,
            "running_balance_mt": new_ledger.running_balance_mt,
        },
    )

    return new_ledger

def validate_operation_status_transition(current_status, next_status):
    allowed_transitions = {
        "Draft": ["Submitted", "Cancelled"],
        "Submitted": ["Approved", "Rejected", "Draft"],
        "Rejected": ["Submitted", "Cancelled"],
        "Approved": [],
        "Cancelled": [],
    }

    if current_status not in allowed_transitions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid current status: {current_status}",
        )

    if next_status not in allowed_transitions[current_status]:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change status from {current_status} to {next_status}",
        )

def validate_multi_tank_seals_before_submit(
    db: Session,
    transaction: OperationTransaction,
    submit_remarks: str | None,
):
    # Check template layout type
    template = (
        db.query(OperationTemplate)
        .filter(OperationTemplate.id == transaction.operation_template_id)
        .first()
    )

    if not template or (template.entry_layout_type or "") != "Multi-Tank Before/After":
        return None  # Not a multi-tank ticket, no seal validation needed

    # Load multi_tank_payload
    payload_row = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id == transaction.id,
            OperationTransactionValue.field_code == "multi_tank_payload",
        )
        .first()
    )

    if payload_row is None or payload_row.field_value is None:
        raise HTTPException(
            status_code=400,
            detail="Multi-Tank payload is missing. Open Operation Entry and save the ticket before submitting.",
        )

    payload = payload_row.field_value if isinstance(payload_row.field_value, dict) else {}

    seals_after = (((payload.get("seals") or {}).get("after")) or {})
    temporary = (seals_after.get("temporary") or {})

    # Required temporary seals (AFTER only)
    required_temp_keys = [
        "portManifoldSeal",
        "stbdManifoldSeal",
        "pumproomSeal",
    ]

    missing = []
    for k in required_temp_keys:
        if not str(temporary.get(k) or "").strip():
            missing.append(k)

    if missing:
        raise HTTPException(
            status_code=400,
            detail=(
                "Seal details are incomplete. Please enter AFTER temporary seals: "
                + ", ".join(missing)
            ),
        )

    # If mismatch exists, remarks required
    tank_seals = seals_after.get("tankSeals") or {}
    mismatch_count = 0

    if isinstance(tank_seals, dict):
        for _, positions in tank_seals.items():
            if not isinstance(positions, dict):
                continue
            for _, cell in positions.items():
                if not isinstance(cell, dict):
                    continue
                master = str(cell.get("master") or "").strip()
                observed = str(cell.get("observed") or "").strip()
                if master and observed and master != observed:
                    mismatch_count += 1

    if mismatch_count > 0 and not str(submit_remarks or "").strip():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Seal mismatch detected ({mismatch_count} mismatch). "
                "Please add remarks before submitting."
            ),
        )

    return {
        "required_temp_seals": required_temp_keys,
        "missing_temp_seals": missing,
        "mismatch_count": mismatch_count,
    }

def auto_create_trip_event_on_submit(
    db: Session,
    transaction: OperationTransaction,
    current_user: User,
):
    """
    Auto-create Trip + TripEvent when a BARGE ticket is submitted and convoy_number is present.

    Rule:
      - First event for (convoy + asset) => LOAD_1
      - Next submitted ticket for same (convoy + asset) => LOAD_2_TOPUP
    """
    convoy = clean_optional_text(transaction.convoy_number)

    # Only apply when convoy is present and asset type is BARGE
    if convoy is None:
        return None, None

    if str(transaction.primary_asset_type_code or "").strip().upper() != "BARGE":
        return None, None

    asset_code = str(transaction.primary_asset_code or "").strip()

    if not asset_code:
        return None, None

    created_by_display = get_current_user_display_name(current_user)

    # Ensure Trip exists
    trip = db.query(Trip).filter(Trip.convoy_number.ilike(convoy)).first()

    if not trip:
        trip = Trip(
            convoy_number=convoy,
            primary_barge_asset_code=asset_code,
            status="OPEN",
            created_by=created_by_display,
            remarks=None,
        )
        db.add(trip)
        db.flush()

    # Find last event for this trip+asset (if any)
    last_event = (
        db.query(TripEvent)
        .filter(TripEvent.trip_id == trip.id)
        .filter(TripEvent.asset_code == asset_code)
        .order_by(TripEvent.sequence_no.desc(), TripEvent.id.desc())
        .first()
    )

    # Prevent duplicate linking for same ticket
    existing_event_for_ticket = (
        db.query(TripEvent)
        .filter(TripEvent.operation_transaction_id == transaction.id)
        .first()
    )

    if existing_event_for_ticket:
        return trip, None

    # Determine event type
    event_type = "LOAD_1" if not last_event else "LOAD_2_TOPUP"

    # Next sequence no
    max_seq = (
        db.query(func.max(TripEvent.sequence_no))
        .filter(TripEvent.trip_id == trip.id)
        .scalar()
    )
    seq = (max_seq or 0) + 1

    new_event = TripEvent(
        trip_id=trip.id,
        event_type=event_type,
        location_code=clean_optional_text(transaction.origin_location_code),
        asset_code=asset_code,
        operation_transaction_id=transaction.id,
        sequence_no=seq,
        event_datetime=transaction.operation_start_datetime or datetime.now(),
        created_by=created_by_display,
        remarks="Auto-created on Submit",
    )

    db.add(new_event)
    db.flush()

    # Create a basic continuity comparison record if there is a previous event
    new_cmp = None

    if last_event:
        prev_tx_id = last_event.operation_transaction_id
        # Only create if both tickets are under same convoy (should be true)
        new_cmp = TripComparison(
            trip_id=trip.id,
            comparison_type="LOAD_PREV_vs_LOAD_CURRENT",
            left_transaction_id=prev_tx_id,
            right_transaction_id=transaction.id,
            summary_json=None,
            per_tank_json=None,
            created_by=created_by_display,
            remarks="Auto-created continuity placeholder (calculation to be added)",
        )
        db.add(new_cmp)
        db.flush()

    # Audit logs for auto objects (so Audit Log is complete)
    create_audit_log(
        db=db,
        module_name="Convoy Tracker",
        action="Auto Create Trip Event",
        current_user=current_user,
        entity_type="TripEvent",
        entity_id=new_event.id,
        entity_label=f"{convoy} | {event_type} | {asset_code}",
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        remarks="Auto created on Submit",
        request_path="/operation-transactions/{id}/status",
        details={
            "convoy_number": convoy,
            "trip_id": trip.id,
            "event_type": event_type,
            "asset_code": asset_code,
            "operation_transaction_id": transaction.id,
            "sequence_no": seq,
        },
    )

    if new_cmp:
        create_audit_log(
            db=db,
            module_name="Convoy Tracker",
            action="Auto Create Trip Comparison",
            current_user=current_user,
            entity_type="TripComparison",
            entity_id=new_cmp.id,
            entity_label=f"{convoy} | LOAD_PREV_vs_LOAD_CURRENT",
            ticket_number=get_transaction_ticket_number(transaction),
            operation_number=transaction.operation_number,
            remarks="Auto created on Submit (placeholder)",
            request_path="/operation-transactions/{id}/status",
            details={
                "convoy_number": convoy,
                "trip_id": trip.id,
                "comparison_type": "LOAD_PREV_vs_LOAD_CURRENT",
                "left_transaction_id": new_cmp.left_transaction_id,
                "right_transaction_id": new_cmp.right_transaction_id,
            },
        )

    return trip, new_event

@app.patch("/operation-transactions/{transaction_id}/status")
def update_operation_transaction_status(
    transaction_id: int,
    status_update: OperationTransactionStatusUpdate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )
    
    trip = get_trip_by_convoy_or_none(db, transaction.convoy_number)
    ensure_trip_not_closed(trip)

    next_status = clean_optional_text(status_update.status)

    if next_status is None:
        raise HTTPException(
            status_code=400,
            detail="Status is required",
        )

    allowed_statuses = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"]

    if next_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid transaction status",
        )

    required_permission = get_required_permission_for_status_change(next_status)

    if required_permission:
        require_user_permission(current_user, required_permission, db)

    validate_operation_status_transition(transaction.status, next_status)

    old_status = transaction.status
    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )
    
    status_remarks = clean_optional_text(status_update.remarks)

    seal_validation_details = None
    if next_status == "Submitted":
        seal_validation_details = validate_multi_tank_seals_before_submit(
            db=db,
            transaction=transaction,
            submit_remarks=status_remarks,
        )

    transaction.status = next_status
    transaction.updated_at = datetime.now()

        # Auto trip tracking on submit (LOAD_1 / LOAD_2_TOPUP)
    if next_status == "Submitted":
        auto_create_trip_event_on_submit(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )

    if next_status == "Approved":
        create_tank_stock_ledger_from_approved_transaction(
            db=db,
            transaction=transaction,
            current_user=current_user,
        )
    if status_remarks:
        existing_remarks = transaction.remarks or ""
        transaction.remarks = (
            f"{existing_remarks}\n"
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
            f"{changed_by} changed status from {old_status} to {next_status}: "
            f"{status_remarks}"
        ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=transaction.id,
        old_status=old_status,
        new_status=next_status,
        changed_by=changed_by,
        remarks=status_remarks,
        changed_at=datetime.now(),
    )

    db.add(history)

    action_name = f"Change Status to {next_status}"

    if next_status == "Submitted":
        action_name = "Submit Operation Transaction"
    elif next_status == "Approved":
        action_name = "Approve Operation Transaction"
    elif next_status == "Rejected":
        action_name = "Reject Operation Transaction"
    elif next_status == "Draft":
        action_name = "Recall Operation Transaction"
    elif next_status == "Cancelled":
        action_name = "Cancel Operation Transaction"

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action=action_name,
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=transaction.id,
        entity_label=get_transaction_ticket_number(transaction),
        ticket_number=get_transaction_ticket_number(transaction),
        operation_number=transaction.operation_number,
        old_status=old_status,
        new_status=next_status,
        remarks=status_remarks or "",
        request_path=f"/operation-transactions/{transaction_id}/status",
        details={
            "operation_type_code": transaction.operation_type_code,
            "operation_template_id": transaction.operation_template_id,
            "primary_asset_code": transaction.primary_asset_code,
            "origin_location_code": transaction.origin_location_code,
            "operation_date": str(transaction.operation_date),
            "seal_validation": seal_validation_details,
        },
    )

    db.commit()
    db.refresh(transaction)

    return {
        "message": f"Transaction status changed to {next_status}",
        "transaction": build_operation_transaction_response(transaction, db),
    }


@app.get("/operation-transactions/{transaction_id}/status-history")
def get_operation_transaction_status_history(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Operation Transaction",
        db,
    )

    transaction = (
        db.query(OperationTransaction)
        .filter(OperationTransaction.id == transaction_id)
        .first()
    )

    if transaction is None:
        raise HTTPException(
            status_code=404,
            detail="Operation transaction not found",
        )

    history = (
        db.query(OperationTransactionStatusHistory)
        .filter(OperationTransactionStatusHistory.transaction_id == transaction_id)
        .order_by(OperationTransactionStatusHistory.changed_at.asc())
        .all()
    )

    return [
        {
            "id": item.id,
            "transaction_id": item.transaction_id,
            "old_status": item.old_status,
            "new_status": item.new_status,
            "changed_by": item.changed_by,
            "remarks": item.remarks,
            "changed_at": item.changed_at,
        }
        for item in history
    ]


@app.put(
    "/operation-entries/{transaction_id}",
    response_model=OperationEntryResponse,
)
def update_operation_entry(
    transaction_id: int,
    entry: OperationEntryCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Create Operation Entry",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation entry not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation entries can be edited. "
                "Recall Submitted tickets to Draft before editing."
            ),
        )
    
    convoy_to_check = clean_optional_text(entry.transaction.convoy_number) or clean_optional_text(existing_transaction.convoy_number)
    trip = get_trip_by_convoy_or_none(db, convoy_to_check)
    ensure_trip_not_closed(trip)

    (
        template,
        operation_type,
        asset,
        template_fields,
        value_map,
        transaction_operation_type_code,
    ) = validate_operation_entry(entry, db)

    existing_transaction.operation_type_code = transaction_operation_type_code
    existing_transaction.operation_template_id = template.id
    existing_transaction.primary_asset_code = asset.asset_code
    existing_transaction.primary_asset_type_code = asset.asset_type_code
    existing_transaction.convoy_number = clean_optional_text(entry.transaction.convoy_number)
    existing_transaction.origin_location_code = entry.transaction.origin_location_code.strip()
    existing_transaction.destination_location_code = clean_optional_text(
        entry.transaction.destination_location_code
    )
    existing_transaction.sender_location_code = clean_optional_text(
        entry.transaction.sender_location_code
    )
    existing_transaction.receiver_location_code = clean_optional_text(
        entry.transaction.receiver_location_code
    )
    existing_transaction.operation_date = entry.transaction.operation_date
    existing_transaction.operation_start_datetime = entry.transaction.operation_start_datetime
    existing_transaction.operation_end_datetime = entry.transaction.operation_end_datetime
    existing_transaction.product_name = clean_optional_text(entry.transaction.product_name)
    existing_transaction.remarks = clean_optional_text(entry.transaction.remarks)
    existing_transaction.updated_at = datetime.now()

    db.query(OperationTransactionValue).filter(
        OperationTransactionValue.transaction_id == transaction_id
    ).delete()

    for field in template_fields:
        new_value = OperationTransactionValue(
            transaction_id=transaction_id,
            field_code=field.field_code,
            field_name=field.field_name,
            field_group=field.field_group,
            data_type=field.data_type,
            unit=field.unit,
            input_mode=field.input_mode,
            calculation_role=field.calculation_role,
            field_value=normalize_jsonb_value(value_map.get(field.field_code)),
            sort_order=field.sort_order,
        )

        db.add(new_value)

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_remarks = existing_transaction.remarks or ""
    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Edited by {changed_by}"
    ).strip()

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Update Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=existing_transaction.status,
        new_status=existing_transaction.status,
        remarks="Operation entry edited",
        request_path=f"/operation-entries/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
            "field_count": len(template_fields),
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return build_operation_entry_response(existing_transaction, db)


@app.delete("/operation-entries/{transaction_id}")
def delete_operation_entry(
    transaction_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Cancel Operation Transaction",
        db,
    )

    existing_transaction = db.query(OperationTransaction).filter(
        OperationTransaction.id == transaction_id
    ).first()

    if not existing_transaction:
        raise HTTPException(
            status_code=404,
            detail="Operation entry not found",
        )

    if existing_transaction.status not in ["Draft", "Rejected"]:
        raise HTTPException(
            status_code=400,
            detail=(
                "Only Draft or Rejected operation entries can be cancelled. "
                "Submitted tickets must be recalled first. Approved and Cancelled tickets are locked."
            ),
        )

    old_status = existing_transaction.status

    changed_by = (
        f"{current_user.full_name} ({current_user.username})"
        if current_user.full_name
        else current_user.username
    )

    existing_transaction.status = "Cancelled"
    existing_transaction.updated_at = datetime.now()

    existing_remarks = existing_transaction.remarks or ""
    existing_transaction.remarks = (
        f"{existing_remarks}\n"
        f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] "
        f"Cancelled by {changed_by}"
    ).strip()

    history = OperationTransactionStatusHistory(
        transaction_id=existing_transaction.id,
        old_status=old_status,
        new_status="Cancelled",
        changed_by=changed_by,
        remarks="Cancelled from Operation Entry editable list",
        changed_at=datetime.now(),
    )

    db.add(history)

    field_count = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id == existing_transaction.id)
        .count()
    )

    create_audit_log(
        db=db,
        module_name="Operation Transaction",
        action="Cancel Operation Entry",
        current_user=current_user,
        entity_type="OperationTransaction",
        entity_id=existing_transaction.id,
        entity_label=get_transaction_ticket_number(existing_transaction),
        ticket_number=get_transaction_ticket_number(existing_transaction),
        operation_number=existing_transaction.operation_number,
        old_status=old_status,
        new_status="Cancelled",
        remarks="Cancelled from Operation Entry editable list",
        request_path=f"/operation-entries/{transaction_id}",
        details={
            "operation_type_code": existing_transaction.operation_type_code,
            "operation_template_id": existing_transaction.operation_template_id,
            "primary_asset_code": existing_transaction.primary_asset_code,
            "origin_location_code": existing_transaction.origin_location_code,
            "operation_date": str(existing_transaction.operation_date),
            "field_count": field_count,
        },
    )

    db.commit()
    db.refresh(existing_transaction)

    return {
        "message": "Operation entry cancelled successfully"
    }

# -------------------------
# Common Table 11 Factor APIs
# -------------------------

def build_table11_factor_response(row: Table11Factor):
    return {
        "id": row.id,
        "api60": float(row.api60),
        "lt_factor": float(row.lt_factor),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def interpolate_table11_factor(api60: float, db: Session):
    if api60 is None:
        raise HTTPException(
            status_code=400,
            detail="API @ 60°F is required",
        )

    api_value = float(api60)

    rows = (
        db.query(Table11Factor)
        .order_by(Table11Factor.api60.asc())
        .all()
    )

    if len(rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Table 11 factor master is empty. Please upload API@60 and LT factor data first.",
        )

    exact_row = next(
        (
            row
            for row in rows
            if float(row.api60) == api_value
        ),
        None,
    )

    if exact_row:
        return {
            "api60": api_value,
            "lower_api60": float(exact_row.api60),
            "upper_api60": float(exact_row.api60),
            "lt_factor": float(exact_row.lt_factor),
            "lookup_method": "Exact match",
        }

    lower_row = None
    upper_row = None

    for row in rows:
        row_api = float(row.api60)

        if row_api < api_value:
            lower_row = row

        if row_api > api_value:
            upper_row = row
            break

    if lower_row is None:
        first_row = rows[0]

        return {
            "api60": api_value,
            "lower_api60": float(first_row.api60),
            "upper_api60": float(first_row.api60),
            "lt_factor": float(first_row.lt_factor),
            "lookup_method": "Below range - nearest factor used",
        }

    if upper_row is None:
        last_row = rows[-1]

        return {
            "api60": api_value,
            "lower_api60": float(last_row.api60),
            "upper_api60": float(last_row.api60),
            "lt_factor": float(last_row.lt_factor),
            "lookup_method": "Above range - nearest factor used",
        }

    lower_api = float(lower_row.api60)
    upper_api = float(upper_row.api60)
    lower_factor = float(lower_row.lt_factor)
    upper_factor = float(upper_row.lt_factor)

    if upper_api == lower_api:
        interpolated_factor = lower_factor
    else:
        ratio = (api_value - lower_api) / (upper_api - lower_api)
        interpolated_factor = lower_factor + ratio * (upper_factor - lower_factor)

    return {
        "api60": api_value,
        "lower_api60": lower_api,
        "upper_api60": upper_api,
        "lt_factor": round(interpolated_factor, 10),
        "lookup_method": "Linear interpolation",
    }


@app.get(
    "/table11-factors",
    response_model=list[Table11FactorResponse],
)
def get_table11_factors(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    rows = (
        db.query(Table11Factor)
        .order_by(Table11Factor.api60.asc())
        .all()
    )

    return [
        build_table11_factor_response(row)
        for row in rows
    ]


@app.get(
    "/table11-factors/lookup",
    response_model=Table11LookupResponse,
)
def lookup_table11_factor(
    api60: float,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Asset Calibration",
        db,
    )

    return interpolate_table11_factor(api60, db)

def build_table11_audit_snapshot(db: Session, preview_limit: int = 20):
    rows = db.query(Table11Factor).order_by(Table11Factor.api60.asc()).all()

    count = len(rows)

    min_api = float(rows[0].api60) if count > 0 else None
    max_api = float(rows[-1].api60) if count > 0 else None

    preview_rows = rows[:preview_limit]

    return {
        "count": count,
        "min_api60": min_api,
        "max_api60": max_api,
        "preview_limit": preview_limit,
        "preview_rows": [
            {
                "api60": float(r.api60),
                "lt_factor": float(r.lt_factor),
            }
            for r in preview_rows
        ],
    }

@app.post(
    "/table11-factors/bulk",
    response_model=list[Table11FactorResponse],
)
def bulk_save_table11_factors(
    request: Table11FactorBulkCreate,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    if len(request.rows) == 0:
        raise HTTPException(
            status_code=400,
            detail="Please provide at least one Table 11 row",
        )

    api_values = [float(row.api60) for row in request.rows]

    if len(api_values) != len(set(api_values)):
        raise HTTPException(
            status_code=400,
            detail="Duplicate API @ 60°F values are not allowed",
        )

    for row in request.rows:
        if row.api60 <= 0:
            raise HTTPException(
                status_code=400,
                detail="API @ 60°F must be greater than zero",
            )
        if row.lt_factor <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"LT factor must be greater than zero for API @ 60°F {row.api60}",
            )

    before_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    # Replace all
    db.query(Table11Factor).delete()

    for row in request.rows:
        db.add(
            Table11Factor(
                api60=float(row.api60),
                lt_factor=float(row.lt_factor),
            )
        )

    db.flush()

    after_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    create_audit_log(
        db=db,
        module_name="Table 11 Factor Master",
        action="Bulk Save Table 11 Factors",
        current_user=current_user,
        entity_type="Table11Factor",
        entity_id=None,
        entity_label="Table 11 Factor Master",
        remarks="Replaced Table 11 factor master rows",
        request_path="/table11-factors/bulk",
        details={
            "before": before_snapshot,
            "after": after_snapshot,
            "input_row_count": len(request.rows),
        },
    )

    db.commit()

    saved_rows = db.query(Table11Factor).order_by(Table11Factor.api60.asc()).all()

    return [build_table11_factor_response(row) for row in saved_rows]


@app.delete("/table11-factors")
def clear_table11_factors(
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Asset Calibration",
        db,
    )

    before_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    deleted_count = db.query(Table11Factor).delete()
    db.flush()

    after_snapshot = build_table11_audit_snapshot(db, preview_limit=20)

    create_audit_log(
        db=db,
        module_name="Table 11 Factor Master",
        action="Clear Table 11 Factors",
        current_user=current_user,
        entity_type="Table11Factor",
        entity_id=None,
        entity_label="Table 11 Factor Master",
        remarks="Cleared all Table 11 factor rows",
        request_path="/table11-factors",
        details={
            "before": before_snapshot,
            "after": after_snapshot,
            "deleted_count": deleted_count,
        },
    )

    db.commit()

    return {
        "message": "Table 11 factors cleared successfully",
        "deleted_count": deleted_count,
    }

# -------------------------
# Company Report Profile APIs
# -------------------------

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

# -------------------------
# Audit Log APIs
# -------------------------

@app.get("/audit-logs", response_model=list[AuditLogResponse])
def get_audit_logs(
    module_name: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    ticket_number: str | None = None,
    operation_number: str | None = None,
    performed_by: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    limit: int = 200,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Audit Log",
        db,
    )

    query = db.query(AuditLog)

    if module_name:
        query = query.filter(AuditLog.module_name.ilike(f"%{module_name.strip()}%"))

    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action.strip()}%"))

    if entity_type:
        query = query.filter(AuditLog.entity_type.ilike(f"%{entity_type.strip()}%"))

    if ticket_number:
        query = query.filter(AuditLog.ticket_number.ilike(f"%{ticket_number.strip()}%"))

    if operation_number:
        query = query.filter(
            AuditLog.operation_number.ilike(f"%{operation_number.strip()}%")
        )

    if performed_by:
        query = query.filter(AuditLog.performed_by.ilike(f"%{performed_by.strip()}%"))

    if date_from:
        try:
            parsed_date_from = datetime.fromisoformat(date_from)
            query = query.filter(AuditLog.created_at >= parsed_date_from)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="date_from must be in ISO format, for example 2026-05-13",
            )

    if date_to:
        try:
            parsed_date_to = datetime.fromisoformat(date_to)
            query = query.filter(AuditLog.created_at <= parsed_date_to)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="date_to must be in ISO format, for example 2026-05-13",
            )

    safe_limit = min(max(limit, 1), 1000)

    audit_logs = (
        query.order_by(AuditLog.id.desc())
        .limit(safe_limit)
        .all()
    )

    return [
        build_audit_log_response(audit_log)
        for audit_log in audit_logs
    ]

@app.get("/audit-logs/{audit_log_id}", response_model=AuditLogResponse)
def get_audit_log_by_id(
    audit_log_id: int,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Audit Log",
        db,
    )

    audit_log = db.query(AuditLog).filter(AuditLog.id == audit_log_id).first()

    if not audit_log:
        raise HTTPException(
            status_code=404,
            detail="Audit log not found",
        )

    return build_audit_log_response(audit_log)

@app.get(
    "/company-report-profiles",
    response_model=list[CompanyReportProfileResponse],
)
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


@app.post(
    "/company-report-profiles",
    response_model=CompanyReportProfileResponse,
)
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


@app.put(
    "/company-report-profiles/{profile_id}",
    response_model=CompanyReportProfileResponse,
)
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


@app.delete("/company-report-profiles/{profile_id}")
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

# -------------------------
# Barge Seal Master APIs
# -------------------------

@app.get("/barge-seal-master", response_model=list[BargeSealMasterResponse])
def get_barge_seal_master(
    asset_code: str,
    effective_date: date | None = None,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "View Barge Seal Master",
        db,
    )

    asset_code_clean = (asset_code or "").strip()
    if asset_code_clean == "":
        raise HTTPException(status_code=400, detail="asset_code is required")

    query = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code_clean)
    )

    if effective_date is None:
        query = query.filter(BargeSealMaster.effective_date.is_(None))
    else:
        query = query.filter(BargeSealMaster.effective_date == effective_date)

    rows = (
        query.order_by(
            BargeSealMaster.tank_id.asc(),
            BargeSealMaster.seal_position.asc(),
        ).all()
    )

    return rows


@app.post("/barge-seal-master/bulk", response_model=list[BargeSealMasterResponse])
def bulk_save_barge_seal_master(
    request: BargeSealMasterBulkSaveRequest,
    current_user: User = Depends(get_current_user_from_token),
    db: Session = Depends(get_db),
):
    require_user_permission(
        current_user,
        "Manage Barge Seal Master",
        db,
    )

    asset_code = (request.asset_code or "").strip()
    if asset_code == "":
        raise HTTPException(status_code=400, detail="asset_code is required")

    asset = db.query(Asset).filter(Asset.asset_code.ilike(asset_code)).first()
    if not asset:
        raise HTTPException(status_code=400, detail="Asset not found")

    if request.rows is None or len(request.rows) == 0:
        raise HTTPException(status_code=400, detail="Please provide at least one seal row")

    def norm(s: str) -> str:
        return str(s or "").strip()

    def norm_pos(s: str) -> str:
        return str(s or "").strip().upper()

    # Build request map + validate duplicates
    req_map = {}
    duplicate_keys = []

    for row in request.rows:
        tank_id = norm(row.tank_id)
        seal_position = norm_pos(row.seal_position)
        seal_number = norm(row.seal_number)

        if tank_id == "":
            raise HTTPException(status_code=400, detail="tank_id is required in rows")
        if seal_position == "":
            raise HTTPException(status_code=400, detail="seal_position is required in rows")
        if seal_number == "":
            raise HTTPException(status_code=400, detail="seal_number is required in rows")

        key = (tank_id, seal_position)
        if key in req_map:
            duplicate_keys.append(f"{tank_id}:{seal_position}")
            continue

        req_map[key] = {
            "tank_id": tank_id,
            "seal_position": seal_position,
            "seal_number": seal_number,
            "remarks": clean_optional_text(row.remarks),
            "status": row.status or "Active",
        }

    if duplicate_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Duplicate seal keys in request: {', '.join(duplicate_keys)}",
        )

    # Load existing master rows for this asset + effective_date
    existing_q = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code)
    )

    if request.effective_date is None:
        existing_q = existing_q.filter(BargeSealMaster.effective_date.is_(None))
    else:
        existing_q = existing_q.filter(BargeSealMaster.effective_date == request.effective_date)

    existing_rows = existing_q.all()

    def existing_key(obj: BargeSealMaster):
        return (norm(obj.tank_id), norm_pos(obj.seal_position))

    existing_map = {existing_key(r): r for r in existing_rows}

    before_count = len(existing_rows)

    added = []
    updated = []
    removed = []

    # Removed: exists in DB but not in request
    for key, obj in existing_map.items():
        if key not in req_map:
            removed.append({
                "tank_id": obj.tank_id,
                "seal_position": obj.seal_position,
                "seal_number": obj.seal_number,
                "status": obj.status,
            })
            db.delete(obj)

    # Added/Updated
    for key, incoming in req_map.items():
        if key in existing_map:
            obj = existing_map[key]

            changed = (
                (obj.seal_number or "") != (incoming["seal_number"] or "")
                or (obj.status or "") != (incoming["status"] or "")
                or (obj.remarks or "") != (incoming["remarks"] or "")
                or obj.effective_date != request.effective_date
            )

            if changed:
                updated.append({
                    "tank_id": obj.tank_id,
                    "seal_position": obj.seal_position,
                    "before_seal_number": obj.seal_number,
                    "after_seal_number": incoming["seal_number"],
                    "before_status": obj.status,
                    "after_status": incoming["status"],
                })

                obj.seal_number = incoming["seal_number"]
                obj.status = incoming["status"]
                obj.remarks = incoming["remarks"]
                obj.effective_date = request.effective_date
                obj.updated_at = datetime.now()
        else:
            new_row = BargeSealMaster(
                asset_code=asset_code,
                tank_id=incoming["tank_id"],
                seal_position=incoming["seal_position"],
                seal_number=incoming["seal_number"],
                effective_date=request.effective_date,
                remarks=incoming["remarks"],
                status=incoming["status"],
            )
            db.add(new_row)

            added.append({
                "tank_id": incoming["tank_id"],
                "seal_position": incoming["seal_position"],
                "seal_number": incoming["seal_number"],
                "status": incoming["status"],
            })

    db.flush()

    after_count = before_count - len(removed) + len(added)

    # Audit (store counts + small samples only)
    create_audit_log(
        db=db,
        module_name="Barge Seal Master",
        action="Bulk Save Barge Seals",
        current_user=current_user,
        entity_type="BargeSealMaster",
        entity_id=None,
        entity_label=asset_code,
        remarks="Barge seal master bulk saved",
        request_path="/barge-seal-master/bulk",
        details={
            "asset_code": asset_code,
            "effective_date": str(request.effective_date) if request.effective_date else None,
            "before_count": before_count,
            "after_count": after_count,
            "added_count": len(added),
            "updated_count": len(updated),
            "removed_count": len(removed),
            "added_sample": added[:20],
            "updated_sample": updated[:20],
            "removed_sample": removed[:20],
        },
    )

    db.commit()

    # Return saved rows
    out_q = db.query(BargeSealMaster).filter(
        BargeSealMaster.asset_code.ilike(asset_code)
    )

    if request.effective_date is None:
        out_q = out_q.filter(BargeSealMaster.effective_date.is_(None))
    else:
        out_q = out_q.filter(BargeSealMaster.effective_date == request.effective_date)

    return out_q.order_by(
        BargeSealMaster.tank_id.asc(),
        BargeSealMaster.seal_position.asc(),
    ).all()
