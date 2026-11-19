"""AST guard: prevent new bare datetime.now() calls without a UTC decision.

Existing calls are grandfathered per-file while the codebase is migrated;
removing calls lowers these budgets. Run from any working directory with
``python backend/scripts/check_datetime_usage.py``.
"""
import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
BASELINE = {
    "backend/app/routers/assets.py": 1,
    "backend/app/routers/auth.py": 16,
    "backend/app/routers/backup_restore.py": 48,
    "backend/app/routers/barge_seal_master.py": 1,
    "backend/app/routers/barge_trip_tracking.py": 5,
    "backend/app/routers/company_report_profiles.py": 1,
    "backend/app/routers/correction_requests.py": 5,
    "backend/app/routers/dashboard.py": 5,
    "backend/app/routers/flowmeter_configs_records.py": 1,
    "backend/app/routers/material_balance_templates.py": 2,
    "backend/app/routers/movement_mappings.py": 10,
    "backend/app/routers/operation_entries.py": 5,
    "backend/app/routers/operation_tasks.py": 16,
    "backend/app/routers/operation_templates.py": 1,
    "backend/app/routers/operation_transactions.py": 14,
    "backend/app/routers/out_turn_summary.py": 1,
    "backend/app/routers/prime_mover_tanker_links.py": 2,
    "backend/app/routers/report_builder.py": 4,
    "backend/app/routers/reports.py": 3,
    "backend/app/routers/system_notifications.py": 14,
    "backend/app/routers/tank_operation_summary.py": 2,
    "backend/app/routers/tank_operations.py": 1,
    "backend/app/routers/tracking_module_configs.py": 3,
    "backend/app/routers/vessel_operations.py": 1,
    "backend/app/routers/vessel_stock_ledger.py": 1,
    "backend/app/routers/workflow_policies.py": 1,
    "backend/app/services/permission_catalog.py": 1,
    "backend/app/services/report_engine.py": 1,
    "backend/app/services/tracking_helpers.py": 2,
    "backend/app/services/transaction_helpers.py": 1,
}


def bare_datetime_now_count(path: Path) -> int:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    return sum(
        1
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "now"
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "datetime"
        and not node.args
        and not node.keywords
    )


def main() -> int:
    failures = []
    app_files = sorted((ROOT / "backend/app").rglob("*.py"))
    for path in app_files:
        relative = path.relative_to(ROOT).as_posix()
        budget = BASELINE.get(relative, 0)
        actual = bare_datetime_now_count(path)
        if actual > budget:
            failures.append(f"{relative}: {actual} bare datetime.now() calls (baseline {budget})")
    if failures:
        print("New bare datetime.now() calls detected; use an explicit UTC convention:")
        print("\n".join(failures))
        return 1
    print("datetime.now() baseline check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
