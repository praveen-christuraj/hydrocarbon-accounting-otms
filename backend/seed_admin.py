import os
import sys
import secrets
from datetime import datetime, timezone

from dotenv import load_dotenv
from passlib.context import CryptContext
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env file")
    sys.exit(1)

engine = create_engine(DATABASE_URL)
password_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str):
    return password_context.hash(password)


STANDARD_PERMISSIONS = [
    {"permission_name": "View User", "module_name": "User Master", "description": "Can view users"},
    {"permission_name": "Manage User", "module_name": "User Master", "description": "Can create, update, and delete users"},
    {"permission_name": "View Role", "module_name": "Role Master", "description": "Can view roles"},
    {"permission_name": "Manage Role", "module_name": "Role Master", "description": "Can create, update, and delete roles"},
    {"permission_name": "View Permission", "module_name": "Permission Master", "description": "Can view permissions"},
    {"permission_name": "Manage Permission", "module_name": "Permission Master", "description": "Can create, update, and delete permissions"},
    {"permission_name": "View Role Permission Assignment", "module_name": "Role Permission Assignment", "description": "Can view role permission assignments"},
    {"permission_name": "Manage Role Permission Assignment", "module_name": "Role Permission Assignment", "description": "Can assign permissions to roles"},
    {"permission_name": "View User Role Assignment", "module_name": "User Role Assignment", "description": "Can view user role assignments"},
    {"permission_name": "Manage User Role Assignment", "module_name": "User Role Assignment", "description": "Can assign roles to users"},
    {"permission_name": "View Access Summary", "module_name": "Access Summary", "description": "Can view final RBAC access summary"},
    {"permission_name": "View Dashboard", "module_name": "Dashboard", "description": "Can view dashboard configurations"},
    {"permission_name": "Manage Dashboard", "module_name": "Dashboard", "description": "Can create, update, publish, and revert dashboards"},
    {"permission_name": "View Location", "module_name": "Location Master", "description": "Can view locations"},
    {"permission_name": "Manage Location", "module_name": "Location Master", "description": "Can create, update, and delete locations"},
    {"permission_name": "View Location Accounting Day Setting", "module_name": "Location Accounting Day Setting", "description": "Can view location-wise accounting day settings"},
    {"permission_name": "Manage Location Accounting Day Setting", "module_name": "Location Accounting Day Setting", "description": "Can create, update, and delete location-wise accounting day settings"},
    {"permission_name": "View Asset Type", "module_name": "Asset Type Master", "description": "Can view asset types"},
    {"permission_name": "Manage Asset Type", "module_name": "Asset Type Master", "description": "Can create, update, and delete asset types"},
    {"permission_name": "View Asset", "module_name": "Asset Master", "description": "Can view assets"},
    {"permission_name": "Manage Asset", "module_name": "Asset Master", "description": "Can create, update, and delete assets"},
    {"permission_name": "View Calibration Template", "module_name": "Calibration Template Master", "description": "Can view calibration templates"},
    {"permission_name": "Manage Calibration Template", "module_name": "Calibration Template Master", "description": "Can create, update, and delete calibration templates"},
    {"permission_name": "View Asset Calibration", "module_name": "Asset Calibration Table", "description": "Can view asset calibration tables"},
    {"permission_name": "Manage Asset Calibration", "module_name": "Asset Calibration Table", "description": "Can create, upload, update, and delete calibration data"},
    {"permission_name": "View Asset Assignment", "module_name": "Asset Assignment", "description": "Can view asset assignments"},
    {"permission_name": "Manage Asset Assignment", "module_name": "Asset Assignment", "description": "Can create, update, and delete asset assignments"},
    {"permission_name": "View Asset Assignment Summary", "module_name": "Asset Assignment Summary", "description": "Can view asset assignment summary"},
    {"permission_name": "View Operation Type", "module_name": "Operations", "description": "Can view operation type master"},
    {"permission_name": "Manage Operation Type", "module_name": "Operations", "description": "Can create, update, and delete operation types"},
    {"permission_name": "View Tank Operation", "module_name": "Operations", "description": "Can view location-wise tank operation master"},
    {"permission_name": "Manage Tank Operation", "module_name": "Operations", "description": "Can create, update, and delete location-wise tank operations"},
    {"permission_name": "View Vessel Operation", "module_name": "Operations", "description": "Can view Vessel Operation Master"},
    {"permission_name": "Manage Vessel Operation", "module_name": "Operations", "description": "Can create, update, and delete Vessel Operation Master entries"},
    {"permission_name": "View Vessel Stock Ledger", "module_name": "Operations", "description": "Can view Vessel Stock Ledger"},
    {"permission_name": "View Movement Mapping", "module_name": "Operations", "description": "Can view Movement Mapping and reconciliation comparisons"},
    {"permission_name": "Manage Movement Mapping", "module_name": "Operations", "description": "Can create/update/close Movement Mapping"},
    {"permission_name": "View Shuttle Tracking", "module_name": "Operations", "description": "Can view Shuttle Tracking"},
    {"permission_name": "Manage Shuttle Tracking", "module_name": "Operations", "description": "Can close/reopen Shuttle voyages"},
    {"permission_name": "View FSO Tracking", "module_name": "Operations", "description": "Can view FSO Tracking"},
    {"permission_name": "Manage FSO Tracking", "module_name": "Operations", "description": "Can close/reopen FSO voyages"},
    {"permission_name": "View Tank Stock Ledger", "module_name": "Operations", "description": "Can view tank stock ledger and stock movement summary"},
    {"permission_name": "Manage Tank Stock Ledger", "module_name": "Operations", "description": "Can rebuild or manage tank stock ledger entries"},
    {"permission_name": "View Location Operation Availability", "module_name": "Operations", "description": "Can view location operation availability"},
    {"permission_name": "Manage Location Operation Availability", "module_name": "Operations", "description": "Can configure operation availability by location"},
    {"permission_name": "View Operation Template", "module_name": "Operations", "description": "Can view operation templates"},
    {"permission_name": "Manage Operation Template", "module_name": "Operations", "description": "Can create, update, and delete operation templates"},
    {"permission_name": "Create Operation Entry", "module_name": "Operations", "description": "Can create new operation tickets from Operation Entry"},
    {"permission_name": "View Operation Transaction", "module_name": "Operations", "description": "Can view operation transaction register and detail"},
    {"permission_name": "Submit Operation Transaction", "module_name": "Operations", "description": "Can submit draft operation tickets"},
    {"permission_name": "Review Operation Transaction", "module_name": "Operations", "description": "Can review operation tickets before submit/approve confirmation"},
    {"permission_name": "Approve Operation Transaction", "module_name": "Operations", "description": "Can approve submitted operation tickets"},
    {"permission_name": "Reject Operation Transaction", "module_name": "Operations", "description": "Can reject submitted operation tickets"},
    {"permission_name": "Cancel Operation Transaction", "module_name": "Operations", "description": "Can cancel draft or rejected operation tickets"},
    {"permission_name": "Request Approved Transaction Correction", "module_name": "Operations", "description": "Can request admin revoke for approved operation tickets that need correction"},
    {"permission_name": "View Approved Transaction Correction Requests", "module_name": "Operations", "description": "Can view approved transaction correction and revoke requests"},
    {"permission_name": "Admin Revoke Approved Transaction", "module_name": "Operations", "description": "Can revoke approval and push approved tickets back to submitted review"},
    {"permission_name": "View Barge Seal Master", "module_name": "Barge Seal Master", "description": "Can view barge seal master"},
    {"permission_name": "Manage Barge Seal Master", "module_name": "Barge Seal Master", "description": "Can create/update barge seal master"},
    {"permission_name": "View Flowmeter Config", "module_name": "Flowmeter Config", "description": "Can view flowmeter meter configuration"},
    {"permission_name": "Manage Flowmeter Config", "module_name": "Flowmeter Config", "description": "Can create, update, and delete flowmeter meter configuration"},
    {"permission_name": "View Flowmeter Record", "module_name": "Flowmeter Record", "description": "Can view flowmeter meter records"},
    {"permission_name": "Create Flowmeter Record", "module_name": "Flowmeter Record", "description": "Can create flowmeter meter records"},
    {"permission_name": "View Company Report Profile", "module_name": "Company Report Profile", "description": "Can view company report profiles"},
    {"permission_name": "Manage Company Report Profile", "module_name": "Company Report Profile", "description": "Can create, update, and delete company report profiles"},
    {"permission_name": "View Audit Log", "module_name": "Audit Log", "description": "Can view system audit logs"},
    {"permission_name": "View System Notification", "module_name": "System Notification", "description": "Can view system notifications and user notification inbox"},
    {"permission_name": "Manage System Notification", "module_name": "System Notification", "description": "Can create and update system notifications"},
    {"permission_name": "Publish System Notification", "module_name": "System Notification", "description": "Can publish system notifications to users"},
    {"permission_name": "Deactivate System Notification", "module_name": "System Notification", "description": "Can deactivate published system notifications"},
    {"permission_name": "Acknowledge System Notification", "module_name": "System Notification", "description": "Can acknowledge or dismiss assigned system notifications"},
    {"permission_name": "View System Notification Delivery Report", "module_name": "System Notification", "description": "Can view delivery, seen, dismissed, and acknowledgement reports"},
    {"permission_name": "View Backup", "module_name": "Backup Recovery", "description": "Can view backup settings and backup job history"},
    {"permission_name": "Create Manual Backup", "module_name": "Backup Recovery", "description": "Can create a manual database backup"},
    {"permission_name": "Manage Backup Settings", "module_name": "Backup Recovery", "description": "Can configure automatic backup schedule and retention settings"},
    {"permission_name": "Download Backup", "module_name": "Backup Recovery", "description": "Can download completed backup files"},
    {"permission_name": "Verify Backup Checksum", "module_name": "Backup Recovery", "description": "Can verify backup file checksum integrity"},
    {"permission_name": "Delete Backup", "module_name": "Backup Recovery", "description": "Can delete backup files while preserving backup job history"},
    {"permission_name": "Run Backup Cleanup", "module_name": "Backup Recovery", "description": "Can run retention cleanup for old backup files"},
    {"permission_name": "Request Backup Restore", "module_name": "Backup Recovery", "description": "Can request restore approval for a completed backup"},
    {"permission_name": "Approve Backup Restore", "module_name": "Backup Recovery", "description": "Can approve backup restore requests"},
    {"permission_name": "Reject Backup Restore", "module_name": "Backup Recovery", "description": "Can reject backup restore requests"},
    {"permission_name": "Validate Backup Restore", "module_name": "Backup Recovery", "description": "Can validate an approved backup restore request"},
    {"permission_name": "Execute Backup Restore", "module_name": "Backup Recovery", "description": "Can execute a validated backup restore into the production database"},
    {"permission_name": "View Reports", "module_name": "Reports", "description": "Can view reports"},
    {"permission_name": "Export Reports", "module_name": "Reports", "description": "Can export reports"},
    {"permission_name": "View Admin Settings", "module_name": "Admin", "description": "Can view admin settings"},
    {"permission_name": "Manage Admin Settings", "module_name": "Admin", "description": "Can manage admin settings"},
    {"permission_name": "View Out-Turn Report", "module_name": "Reports", "description": "Can view Out-Turn Report"},
    {"permission_name": "View Material Balance Report", "module_name": "Reports", "description": "Can view Material Balance Report"},
    {"permission_name": "View Material Balance Template", "module_name": "Configuration", "description": "Can view Material Balance template configuration"},
    {"permission_name": "Manage Material Balance Template", "module_name": "Configuration", "description": "Can create, edit, and delete Material Balance template configuration"},
    {"permission_name": "View Operation Workflow Policy", "module_name": "Operations", "description": "Can view operation workflow authorization policies"},
    {"permission_name": "Manage Operation Workflow Policy", "module_name": "Operations", "description": "Can create, update, and delete operation workflow authorization policies"},
    {"permission_name": "View My Tasks", "module_name": "Operations", "description": "Can view assigned operation approval tasks"},
    {"permission_name": "Act On Operation Task", "module_name": "Operations", "description": "Can take, release, approve, or reject assigned operation tasks"},
    {"permission_name": "Manage Operation Tasks", "module_name": "Operations", "description": "Can view and manage all operation approval tasks"},
    {"permission_name": "View Own Security Settings", "module_name": "User Security", "description": "Can view own password and 2FA security settings"},
    {"permission_name": "Manage Own Security Settings", "module_name": "User Security", "description": "Can change own password and manage own 2FA settings"},
    {"permission_name": "Request Password Reset", "module_name": "User Security", "description": "Can request administrator password reset"},
    {"permission_name": "Reset User Password", "module_name": "User Security", "description": "Can hard reset user passwords"},
    {"permission_name": "Reset User 2FA", "module_name": "User Security", "description": "Can reset user 2FA during administrator password reset"},
]


def seed():
    db = Session(bind=engine)
    try:
        print("Connecting to database...")
    db.execute(text("SELECT 1"))
    print("Database connected.\n")

    # Create Admin role
    role = db.execute(
        text("SELECT id FROM roles WHERE role_name = 'Admin'")
    ).fetchone()
    if role:
        admin_role_id = role[0]
        print(f"[SKIP] Role 'Admin' already exists (id={admin_role_id})")
    else:
        result = db.execute(
            text(
                "INSERT INTO roles (role_name, description, status, created_at, updated_at) "
                "VALUES (:name, :desc, 'Active', :now, :now) RETURNING id"
            ),
            {"name": "Admin", "desc": "Full system access", "now": datetime.now(timezone.utc)},
        )
            admin_role_id = result.fetchone()[0]
            db.commit()
            print(f"[CREATE] Role 'Admin' created (id={admin_role_id})")

        # Seed permissions
        created_perms = 0
        skipped_perms = 0
        permission_ids = []

        for p in STANDARD_PERMISSIONS:
            existing = db.execute(
                text(
                    "SELECT id FROM permissions "
                    "WHERE permission_name = :pn AND module_name = :mn"
                ),
                {"pn": p["permission_name"], "mn": p["module_name"]},
            ).fetchone()
            if existing:
                permission_ids.append(existing[0])
                skipped_perms += 1
            else:
                result = db.execute(
                    text(
                        "INSERT INTO permissions (permission_name, module_name, description, status, created_at, updated_at) "
                        "VALUES (:pn, :mn, :desc, 'Active', :now, :now) RETURNING id"
                    ),
                    {
                        "pn": p["permission_name"],
                        "mn": p["module_name"],
                        "desc": p["description"],
                    "now": datetime.now(timezone.utc),
                },
            )
            permission_ids.append(result.fetchone()[0])
            created_perms += 1

        db.commit()
        print(f"[PERMISSIONS] Created {created_perms}, skipped {skipped_perms}")

        # Assign all permissions to Admin role
        assigned = 0
        skipped_rp = 0
        for perm_id in permission_ids:
            existing = db.execute(
                text(
                    "SELECT id FROM role_permissions WHERE role_id = :rid AND permission_id = :pid"
                ),
                {"rid": admin_role_id, "pid": perm_id},
            ).fetchone()
            if existing:
                skipped_rp += 1
            else:
                db.execute(
                    text(
                        "INSERT INTO role_permissions (role_id, permission_id, created_at) "
                        "VALUES (:rid, :pid, :now)"
                    ),
                    {"rid": admin_role_id, "pid": perm_id, "now": datetime.now(timezone.utc)},
                )
                assigned += 1

        db.commit()
        print(f"[ROLE_PERMISSIONS] Assigned {assigned}, skipped {skipped_rp}")

        # Create admin user
        admin_username = "admin"
        admin_password = secrets.token_urlsafe(16)
        existing_user = db.execute(
            text("SELECT id FROM users WHERE username = :un"),
            {"un": admin_username},
        ).fetchone()

        if existing_user:
            print(f"[SKIP] User 'admin' already exists (id={existing_user[0]})")
        else:
            hashed = hash_password(admin_password)
            result = db.execute(
                text(
                    "INSERT INTO users (full_name, username, email, phone, department, designation, "
                    "password_hash, password_changed_at, force_password_change, password_never_expires, "
                    "password_expiry_days, failed_login_count, totp_enabled, force_2fa, status, created_at, updated_at) "
                    "VALUES (:fn, :un, :em, :ph, :dept, :desig, :pw, :now, 'No', 'Yes', 30, 0, 'No', 'No', 'Active', :now, :now) "
                    "RETURNING id"
                ),
                {
                    "fn": "System Administrator",
                    "un": admin_username,
                    "em": "admin@hydrocarbon.example.com",
                    "ph": None,
                    "dept": "IT Administration",
                    "desig": "System Administrator",
                    "pw": hashed,
                    "now": datetime.now(timezone.utc),
                },
            )
            admin_user_id = result.fetchone()[0]
            db.commit()
            print(f"[CREATE] User 'admin' created (id={admin_user_id})")

            # Assign Admin role to admin user
            existing_ura = db.execute(
                text(
                    "SELECT id FROM user_roles WHERE user_id = :uid"
                ),
                {"uid": admin_user_id},
            ).fetchone()
            if existing_ura:
                db.execute(
                    text(
                        "UPDATE user_roles SET role_id = :rid WHERE user_id = :uid"
                    ),
                    {"rid": admin_role_id, "uid": admin_user_id},
                )
                db.commit()
                print(f"[UPDATE] User 'admin' role assignment updated to 'Admin'")
            else:
                db.execute(
                    text(
                        "INSERT INTO user_roles (user_id, role_id, created_at) "
                        "VALUES (:uid, :rid, :now)"
                    ),
                    {"uid": admin_user_id, "rid": admin_role_id, "now": datetime.now(timezone.utc)},
                )
                db.commit()
                print(f"[CREATE] User 'admin' assigned to 'Admin' role")

        print("\n=== SEED COMPLETE ===")
        print("Username: admin")
        print(f"Password: {admin_password}")
        print("Login at: http://localhost:5173")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
