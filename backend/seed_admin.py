import os
import sys
from datetime import datetime, timezone

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

load_dotenv()

# The standard permission catalog lives in app/utils/default_permissions.py
# (module-wise CRUD permissions). Import it instead of keeping a copy here.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from app.utils.default_permissions import STANDARD_PERMISSIONS  # noqa: E402
from app.utils.password_policy import validate_password_policy  # noqa: E402
from app.utils.security import hash_password  # noqa: E402

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env file")
    sys.exit(1)

engine = create_engine(DATABASE_URL)




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
                # Match by name only (case-insensitive) so a module rename never
                # creates a duplicate permission.
                existing = db.execute(
                    text(
                        "SELECT id FROM permissions "
                        "WHERE lower(permission_name) = lower(:pn) ORDER BY id LIMIT 1"
                    ),
                    {"pn": p["permission_name"]},
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
            admin_password = str(os.getenv("INITIAL_ADMIN_PASSWORD") or "")
            if not admin_password:
                raise RuntimeError("INITIAL_ADMIN_PASSWORD must be provided securely")
            validate_password_policy(admin_password, username=admin_username)
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
                        "VALUES (:fn, :un, :em, :ph, :dept, :desig, :pw, :now, 'Yes', 'No', 60, 0, 'No', 'No', 'Active', :now, :now) "
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
            print("Password: supplied through INITIAL_ADMIN_PASSWORD (not displayed)")
            print("Login at: http://localhost:5173")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
