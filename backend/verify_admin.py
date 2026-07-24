#!/usr/bin/env python
"""
Verify admin user setup - run this to check if admin user has correct role and permissions.
Usage: python verify_admin.py
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not found in .env")
    sys.exit(1)

# If using Docker host 'postgres', replace with localhost for local testing
if "@postgres:" in DATABASE_URL:
    print("NOTE: DATABASE_URL uses 'postgres' host (Docker). Replacing with 'localhost' for local testing...")
    DATABASE_URL = DATABASE_URL.replace("@postgres:", "@localhost:")

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

engine = create_engine(DATABASE_URL)

def verify():
    db = Session(bind=engine)
    try:
        print("=" * 60)
        print("ADMIN USER VERIFICATION")
        print("=" * 60)

        # 1. Check admin user
        admin_user = db.execute(
            text("SELECT id, username, full_name, status FROM users WHERE username ILIKE 'admin'")
        ).fetchone()
        print(f"\n1. Admin User: {admin_user}")
        if not admin_user:
            print("   ❌ FAIL: Admin user not found!")
            return False
        admin_user_id = admin_user[0]

        # 2. Check Admin role
        admin_role = db.execute(
            text("SELECT id, role_name, status FROM roles WHERE role_name ILIKE 'admin'")
        ).fetchone()
        print(f"\n2. Admin Role: {admin_role}")
        if not admin_role:
            print("   ❌ FAIL: Admin role not found!")
            return False
        admin_role_id = admin_role[0]

        # 3. Check user_roles assignment
        user_role = db.execute(
            text("SELECT user_id, role_id FROM user_roles WHERE user_id = :uid"),
            {"uid": admin_user_id}
        ).fetchone()
        print(f"\n3. UserRole Assignment: {user_role}")
        if not user_role:
            print("   ❌ FAIL: Admin user has NO role assigned!")
            return False
        if user_role[1] != admin_role_id:
            print(f"   ❌ FAIL: Admin user has role_id={user_role[1]}, expected {admin_role_id}")
            return False
        print("   ✅ PASS: Admin user correctly assigned to Admin role")

        # 4. Check permissions assigned to Admin role
        perm_count = db.execute(
            text("""
                SELECT COUNT(*) FROM role_permissions rp
                JOIN permissions p ON p.id = rp.permission_id
                WHERE rp.role_id = :rid AND p.status = 'Active'
            """),
            {"rid": admin_role_id}
        ).scalar()
        total_active_perms = db.execute(
            text("SELECT COUNT(*) FROM permissions WHERE status = 'Active'")
        ).scalar()
        print(f"\n4. Permissions: Admin role has {perm_count}/{total_active_perms} active permissions")
        if perm_count < total_active_perms:
            print(f"   ⚠️  WARNING: Admin role missing {total_active_perms - perm_count} permissions")
        else:
            print("   ✅ PASS: Admin role has all active permissions")

        # 5. Check critical permissions
        critical_perms = [
            "View Role Permission Assignment",
            "Manage Role Permission Assignment",
            "View User Role Assignment",
            "Manage User Role Assignment",
            "View Role",
            "Manage Role",
            "View Permission",
            "Manage Permission",
        ]
        print("\n5. Critical Permissions Check:")
        for perm_name in critical_perms:
            has_perm = db.execute(
                text("""
                    SELECT 1 FROM role_permissions rp
                    JOIN permissions p ON p.id = rp.permission_id
                    WHERE rp.role_id = :rid AND p.permission_name ILIKE :pname AND p.status = 'Active'
                """),
                {"rid": admin_role_id, "pname": perm_name}
            ).fetchone()
            status = "✅" if has_perm else "❌"
            print(f"   {status} {perm_name}")

        print("\n" + "=" * 60)
        print("VERIFICATION COMPLETE")
        print("=" * 60)
        return True

    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        db.close()

if __name__ == "__main__":
    success = verify()
    sys.exit(0 if success else 1)