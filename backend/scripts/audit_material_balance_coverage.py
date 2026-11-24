"""
audit_material_balance_coverage.py

Read-only audit of Material Balance Template mappings.

Usage:
    cd backend
    python -m scripts.audit_material_balance_coverage \
        [--location CODE] [--date-from YYYY-MM-DD] [--date-to YYYY-MM-DD] [--json FILE]

Prints:
  1. every active MOVEMENT column mapping and whether it resolves to an
     active Tank Operation of the template's location;
  2. active IN/OUT operations not covered by any active column;
  3. ledger rows in the date range whose operation code is not covered;
  4. canonical collisions between operation codes of the same location.

No database writes.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date

from app.database import SessionLocal
from app.models import (
    MaterialBalanceTemplate,
    MaterialBalanceTemplateColumn,
    TankOperation,
    TankStockLedger,
)
from app.services.material_balance_helpers import normalize_operation_code


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def audit(db, location: str | None, date_from: date | None, date_to: date | None) -> dict:
    templates = (
        db.query(MaterialBalanceTemplate)
        .filter(MaterialBalanceTemplate.status == "Active")
        .order_by(MaterialBalanceTemplate.location_code, MaterialBalanceTemplate.id)
        .all()
    )
    if location:
        templates = [t for t in templates if t.location_code.lower() == location.lower()]

    operations = db.query(TankOperation).filter(TankOperation.status == "Active").all()
    ops_by_location = defaultdict(list)
    for op in operations:
        ops_by_location[(op.location_code or "").strip().lower()].append(op)

    # The report uses the newest Active template per location. Mirror that rule.
    newest_by_location = {}
    for template in templates:
        loc = (template.location_code or "").strip().lower()
        current = newest_by_location.get(loc)
        if current is None or template.id > current.id:
            newest_by_location[loc] = template

    mappings = []
    covered_by_location = defaultdict(set)

    for template in templates:
        columns = (
            db.query(MaterialBalanceTemplateColumn)
            .filter(
                MaterialBalanceTemplateColumn.template_id == template.id,
                MaterialBalanceTemplateColumn.status == "Active",
            )
            .order_by(MaterialBalanceTemplateColumn.column_order, MaterialBalanceTemplateColumn.id)
            .all()
        )
        location_ops = ops_by_location[(template.location_code or "").strip().lower()]
        by_canonical = defaultdict(list)
        for op in location_ops:
            by_canonical[normalize_operation_code(op.operation_code)].append(op)

        for column in columns:
            if str(column.column_type or "").upper() != "MOVEMENT":
                continue
            excluded = {
                normalize_operation_code(code)
                for code in (column.excluded_operation_codes or [])
            }
            for code in column.mapped_operation_codes or []:
                canonical = normalize_operation_code(code)
                matches = by_canonical.get(canonical, [])
                status = "ok" if len(matches) == 1 else "ambiguous" if matches else "unknown"
                mappings.append(
                    {
                        "location_code": template.location_code,
                        "template_name": template.template_name,
                        "column_key": column.column_key,
                        "stored_code": code,
                        "canonical": canonical,
                        "matches": [m.operation_code for m in matches],
                        "status": status,
                    }
                )
                # Only the newest Active template decides report coverage.
                newest = newest_by_location.get(
                    (template.location_code or "").strip().lower()
                )
                if (
                    newest is not None
                    and newest.id == template.id
                    and canonical not in excluded
                ):
                    covered_by_location[(template.location_code or "").lower()].add(canonical)

    unmapped_operations = []
    for loc, template in newest_by_location.items():
        covered = covered_by_location.get(loc, set())
        for op in ops_by_location.get(loc, []):
            if str(op.operation_sign or "").upper() not in ("IN", "OUT"):
                continue
            if normalize_operation_code(op.operation_code) not in covered:
                unmapped_operations.append(
                    {
                        "location_code": template.location_code,
                        "template_name": template.template_name,
                        "operation_code": op.operation_code,
                        "operation_label": op.operation_label,
                        "operation_category": op.operation_category,
                        "operation_sign": op.operation_sign,
                    }
                )

    ledger_query = db.query(TankStockLedger).filter(TankStockLedger.status == "Active")
    if location:
        ledger_query = ledger_query.filter(TankStockLedger.location_code.ilike(location))
    if date_from:
        ledger_query = ledger_query.filter(TankStockLedger.accounting_date >= date_from)
    if date_to:
        ledger_query = ledger_query.filter(TankStockLedger.accounting_date <= date_to)

    unmapped_rows = []
    for row in ledger_query.all():
        canonical = normalize_operation_code(row.tank_operation_code)
        if canonical in covered_by_location[(row.location_code or "").lower()]:
            continue
        unmapped_rows.append(
            {
                "location_code": row.location_code,
                "tank_asset_code": row.tank_asset_code,
                "accounting_date": str(row.accounting_date),
                "ticket_number": row.ticket_number,
                "tank_operation_code": row.tank_operation_code,
                "tank_operation_label": row.tank_operation_label,
                "movement_nsv_bbl": row.movement_nsv_bbl,
            }
        )

    collisions = {}
    for loc, ops in ops_by_location.items():
        by_canonical = defaultdict(list)
        for op in ops:
            by_canonical[normalize_operation_code(op.operation_code)].append(op.operation_code)
        hits = {k: v for k, v in by_canonical.items() if len(v) > 1}
        if hits:
            collisions[loc] = hits

    return {
        "mappings": mappings,
        "unmapped_operations": unmapped_operations,
        "unmapped_ledger_rows": unmapped_rows,
        "canonical_collisions": collisions,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--location")
    parser.add_argument("--date-from")
    parser.add_argument("--date-to")
    parser.add_argument("--json")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = audit(
            db,
            location=args.location,
            date_from=parse_date(args.date_from),
            date_to=parse_date(args.date_to),
        )
    finally:
        db.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, default=str)
        print(f"Written {args.json}")

    print("\n=== MAPPINGS ===")
    for item in result["mappings"]:
        print(
            f"{item['location_code']:10} {item['template_name'][:28]:28} "
            f"{item['column_key'][:22]:22} {item['stored_code'][:28]:28} "
            f"{item['status']:9} {', '.join(item['matches'])}"
        )
    print("\n=== UNMAPPED OPERATIONS ===")
    for item in result["unmapped_operations"]:
        print(
            f"{item['location_code']:10} {item['operation_code'][:28]:28} "
            f"{item['operation_label'][:28]:28} {item['operation_sign']}"
        )
    print(f"\n=== UNMAPPED LEDGER ROWS: {len(result['unmapped_ledger_rows'])} ===")
    for item in result["unmapped_ledger_rows"][:50]:
        print(
            f"{item['location_code']:10} {item['tank_asset_code'][:14]:14} "
            f"{item['accounting_date']:12} {item['tank_operation_code'][:28]:28} "
            f"{item['movement_nsv_bbl']} {item['ticket_number']}"
        )
    print("\n=== CANONICAL COLLISIONS ===")
    for loc, hits in result["canonical_collisions"].items():
        for canonical, codes in hits.items():
            print(f"{loc:10} {canonical:20} <- {', '.join(codes)}")


if __name__ == "__main__":
    main()
