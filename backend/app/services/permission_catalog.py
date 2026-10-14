"""Keep the permissions table in step with the standard catalog.

``sync_standard_permissions`` creates missing catalog permissions and aligns
the module/description of existing ones (matched by permission name, case
insensitive, so a module rename never produces duplicates).

``migrate_legacy_permissions`` converts the legacy "Manage <Entity>"
permissions into the granular CRUD permissions. Every role that held a legacy
permission is granted all of its replacements before the legacy permission is
removed, so nobody loses access. The conversion is idempotent: once the legacy
rows are gone, later runs do nothing.

Permissions created by administrators that are not part of the catalog are
never modified.
"""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Permission, RolePermission
from app.utils.default_permissions import (
    DERIVED_PERMISSION_GRANTS,
    LEGACY_PERMISSION_REPLACEMENTS,
    STANDARD_PERMISSIONS,
)


def _key(value) -> str:
    return str(value or "").strip().casefold()


def _is_active(permission: Permission) -> bool:
    return _key(permission.status) == "active"


def sync_standard_permissions(db: Session) -> dict:
    """Create missing catalog permissions and align existing ones.

    Returns counts and a ``{casefolded name: Permission}`` map of the catalog
    rows. The caller owns the transaction (nothing is committed here).
    """
    rows_by_name: dict[str, list[Permission]] = {}
    for permission in db.query(Permission).order_by(Permission.id).all():
        rows_by_name.setdefault(_key(permission.permission_name), []).append(permission)

    created = 0
    updated = 0
    unchanged = 0
    catalog_rows: dict[str, Permission] = {}

    for entry in STANDARD_PERMISSIONS:
        name = entry["permission_name"]
        module_name = entry["module_name"]
        description = entry["description"]
        key = _key(name)
        candidates = rows_by_name.get(key, [])

        if not candidates:
            permission = Permission(
                permission_name=name,
                module_name=module_name,
                description=description,
                status="Active",
            )
            db.add(permission)
            rows_by_name[key] = [permission]
            catalog_rows[key] = permission
            created += 1
            continue

        exact = next(
            (
                row for row in candidates
                if row.permission_name == name and row.module_name == module_name
            ),
            None,
        )
        target = exact or next(
            (row for row in candidates if _key(row.module_name) == _key(module_name)),
            candidates[0],
        )

        changed = False
        if exact is None:
            # No row holds the exact (name, module) pair, so normalising this
            # row cannot collide with the unique (permission_name, module_name)
            # constraint.
            if target.permission_name != name:
                target.permission_name = name
                changed = True
            if target.module_name != module_name:
                target.module_name = module_name
                changed = True
        if (target.description or "") != description:
            target.description = description
            changed = True

        if changed:
            target.updated_at = datetime.now()
            updated += 1
        else:
            unchanged += 1
        catalog_rows[key] = target

    db.flush()
    return {
        "created_count": created,
        "updated_count": updated,
        "existing_count": updated + unchanged,
        "total_standard_permissions": len(STANDARD_PERMISSIONS),
        "catalog_rows": catalog_rows,
    }


def migrate_legacy_permissions(db: Session, catalog_rows: dict | None = None) -> dict:
    """Convert legacy permissions to the CRUD catalog (idempotent).

    ``catalog_rows`` is the map returned by ``sync_standard_permissions``; it
    is rebuilt when omitted. The caller owns the transaction.
    """
    legacy_names = {_key(name): name for name in LEGACY_PERMISSION_REPLACEMENTS}
    all_permissions = db.query(Permission).order_by(Permission.id).all()
    legacy_rows = [
        permission for permission in all_permissions
        if _key(permission.permission_name) in legacy_names
    ]
    if not legacy_rows:
        return {
            "migrated": False,
            "legacy_permissions_removed": 0,
            "role_permissions_granted": 0,
            "roles_affected": 0,
        }

    if catalog_rows is None:
        catalog_rows = sync_standard_permissions(db)["catalog_rows"]

    existing_pairs = {
        (role_id, permission_id)
        for role_id, permission_id in db.query(
            RolePermission.role_id, RolePermission.permission_id
        ).all()
    }
    holders_by_permission: dict[int, set[int]] = {}
    for role_id, permission_id in existing_pairs:
        holders_by_permission.setdefault(permission_id, set()).add(role_id)

    granted = 0
    roles_affected: set[int] = set()
    now = datetime.now(timezone.utc)

    def grant(role_id: int, permission: Permission) -> None:
        nonlocal granted
        pair = (role_id, permission.id)
        if pair in existing_pairs:
            return
        db.add(RolePermission(role_id=role_id, permission_id=permission.id, created_at=now))
        existing_pairs.add(pair)
        granted += 1
        roles_affected.add(role_id)

    conversion_log = {}

    # 1. Legacy permission -> replacements. An inactive legacy permission gave
    #    nobody access, so its holders receive nothing.
    for legacy in legacy_rows:
        replacements = LEGACY_PERMISSION_REPLACEMENTS[legacy_names[_key(legacy.permission_name)]]
        holders = holders_by_permission.get(legacy.id, set()) if _is_active(legacy) else set()
        for role_id in sorted(holders):
            for replacement_name in replacements:
                grant(role_id, catalog_rows[_key(replacement_name)])
        conversion_log[legacy.permission_name] = {
            "roles": len(holders),
            "replacements": list(replacements),
        }

    # 2. Capabilities that used to ride on a retained permission (for example
    #    Barge Tracking on "View Operation Transaction") get their own
    #    permission; grant it to the roles that had the capability.
    rows_by_name: dict[str, list[Permission]] = {}
    for permission in all_permissions:
        rows_by_name.setdefault(_key(permission.permission_name), []).append(permission)
    for target_name, source_names in DERIVED_PERMISSION_GRANTS.items():
        target = catalog_rows[_key(target_name)]
        holders: set[int] = set()
        for source_name in source_names:
            for source in rows_by_name.get(_key(source_name), []):
                if _is_active(source):
                    holders |= holders_by_permission.get(source.id, set())
        for role_id in sorted(holders):
            grant(role_id, target)

    db.flush()

    # 3. Remove the legacy permissions (their role links first, so this also
    #    works on databases that do not enforce ON DELETE CASCADE).
    legacy_ids = [legacy.id for legacy in legacy_rows]
    db.query(RolePermission).filter(
        RolePermission.permission_id.in_(legacy_ids)
    ).delete(synchronize_session=False)
    for legacy in legacy_rows:
        db.delete(legacy)
    db.flush()

    return {
        "migrated": True,
        "legacy_permissions_removed": len(legacy_rows),
        "role_permissions_granted": granted,
        "roles_affected": len(roles_affected),
        "conversions": conversion_log,
    }


def apply_permission_catalog(db: Session) -> dict:
    """Seed the catalog and convert legacy permissions in one transaction."""
    sync_result = sync_standard_permissions(db)
    migration_result = migrate_legacy_permissions(db, sync_result["catalog_rows"])
    result = {key: value for key, value in sync_result.items() if key != "catalog_rows"}
    result["migration"] = migration_result
    return result
