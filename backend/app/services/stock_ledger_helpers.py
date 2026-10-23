"""
Shared helpers for Tank Stock Ledger and Report modules.

Consolidates functions that were previously duplicated between:
  - backend/app/routers/tank_stock_ledger.py
  - backend/app/routers/reports.py
"""

from sqlalchemy.orm import Session

from app.utils.helpers import safe_float, get_location_by_code
from app.services.material_balance_helpers import normalize_material_balance_category


def build_out_turn_report_response_from_values(
    params: dict,
    db: Session,
) -> dict:
    """
    Canonical Out-Turn Report response builder.

    Accepts a dict with already-extracted values (not ORM objects) and
    returns the full OTR response dict with receipt/production/draining/
    dispatch/other classification aligned with Tank Operation signs.
    """
    if params.get("location_name") is not None:
        location = None
        prefetched_location_name = params["location_name"]
    else:
        location = get_location_by_code(params["location_code"], db)
        prefetched_location_name = None

    previous_gsv = safe_float(params.get("previous_gsv", 0))
    previous_nsv = safe_float(params.get("previous_nsv", 0))
    previous_lt = safe_float(params.get("previous_lt", 0))
    previous_mt = safe_float(params.get("previous_mt", 0))

    stock_after_gsv = safe_float(params.get("stock_after_gsv", 0))
    stock_after_nsv = safe_float(params.get("stock_after_nsv", 0))
    stock_after_lt = safe_float(params.get("stock_after_lt", 0))
    stock_after_mt = safe_float(params.get("stock_after_mt", 0))

    if all(
        k in params
        for k in ("signed_net_gsv", "signed_net_nsv", "signed_net_lt", "signed_net_mt")
    ):
        signed_net_gsv = safe_float(params["signed_net_gsv"])
        signed_net_nsv = safe_float(params["signed_net_nsv"])
        signed_net_lt = safe_float(params["signed_net_lt"])
        signed_net_mt = safe_float(params["signed_net_mt"])
    else:
        signed_net_gsv = stock_after_gsv - previous_gsv
        signed_net_nsv = stock_after_nsv - previous_nsv
        signed_net_lt = stock_after_lt - previous_lt
        signed_net_mt = stock_after_mt - previous_mt

    net_receipt_gsv = 0.0
    net_receipt_nsv = 0.0
    net_receipt_lt = 0.0
    net_receipt_mt = 0.0

    net_dispatch_gsv = 0.0
    net_dispatch_nsv = 0.0
    net_dispatch_lt = 0.0
    net_dispatch_mt = 0.0

    receipt_gsv = 0.0
    receipt_nsv = 0.0
    receipt_lt = 0.0
    receipt_mt = 0.0

    production_gsv = 0.0
    production_nsv = 0.0
    production_lt = 0.0
    production_mt = 0.0

    draining_gsv = 0.0
    draining_nsv = 0.0
    draining_lt = 0.0
    draining_mt = 0.0

    dispatch_gsv = 0.0
    dispatch_nsv = 0.0
    dispatch_lt = 0.0
    dispatch_mt = 0.0

    other_in_gsv = 0.0
    other_in_nsv = 0.0
    other_in_lt = 0.0
    other_in_mt = 0.0

    other_out_gsv = 0.0
    other_out_nsv = 0.0
    other_out_lt = 0.0
    other_out_mt = 0.0

    sign = str(params.get("tank_operation_sign") or "").strip().upper()
    category = normalize_material_balance_category(params.get("tank_operation_category"))

    in_gsv = max(signed_net_gsv, 0.0)
    in_nsv = max(signed_net_nsv, 0.0)
    in_lt = max(signed_net_lt, 0.0)
    in_mt = max(signed_net_mt, 0.0)

    out_gsv = max(-signed_net_gsv, 0.0)
    out_nsv = max(-signed_net_nsv, 0.0)
    out_lt = max(-signed_net_lt, 0.0)
    out_mt = max(-signed_net_mt, 0.0)

    if sign in ("SET", "NEUTRAL"):
        # Opening stock resets (SET) and closing / before-operation static
        # gauges (NEUTRAL) establish reference tank snapshots without counting
        # as receipts or dispatches.
        pass

    elif sign == "IN":
        net_receipt_gsv = in_gsv
        net_receipt_nsv = in_nsv
        net_receipt_lt = in_lt
        net_receipt_mt = in_mt

        if category == "RECEIPT":
            receipt_gsv = in_gsv
            receipt_nsv = in_nsv
            receipt_lt = in_lt
            receipt_mt = in_mt
        elif category == "PRODUCTION":
            production_gsv = in_gsv
            production_nsv = in_nsv
            production_lt = in_lt
            production_mt = in_mt
        else:
            other_in_gsv = in_gsv
            other_in_nsv = in_nsv
            other_in_lt = in_lt
            other_in_mt = in_mt

    elif sign == "OUT":
        net_dispatch_gsv = out_gsv
        net_dispatch_nsv = out_nsv
        net_dispatch_lt = out_lt
        net_dispatch_mt = out_mt

        if category == "DISPATCH":
            dispatch_gsv = out_gsv
            dispatch_nsv = out_nsv
            dispatch_lt = out_lt
            dispatch_mt = out_mt
        elif category == "DRAINING":
            draining_gsv = out_gsv
            draining_nsv = out_nsv
            draining_lt = out_lt
            draining_mt = out_mt
        else:
            other_out_gsv = out_gsv
            other_out_nsv = out_nsv
            other_out_lt = out_lt
            other_out_mt = out_mt

    elif signed_net_gsv >= 0 and signed_net_nsv >= 0:
        other_in_gsv = in_gsv
        other_in_nsv = in_nsv
        other_in_lt = in_lt
        other_in_mt = in_mt
        net_receipt_gsv = in_gsv
        net_receipt_nsv = in_nsv
        net_receipt_lt = in_lt
        net_receipt_mt = in_mt

    else:
        other_out_gsv = out_gsv
        other_out_nsv = out_nsv
        other_out_lt = out_lt
        other_out_mt = out_mt
        net_dispatch_gsv = out_gsv
        net_dispatch_nsv = out_nsv
        net_dispatch_lt = out_lt
        net_dispatch_mt = out_mt

    operation_dt = params.get("operation_datetime")
    gauging_date = params.get("gauging_date")
    gauging_time = params.get("gauging_time")
    if gauging_date is None and operation_dt is not None:
        gauging_date = operation_dt.date() if hasattr(operation_dt, "date") else None
    if gauging_time is None and operation_dt is not None and hasattr(operation_dt, "strftime"):
        gauging_time = (
            operation_dt.strftime("%H:%M:%S")
            if getattr(operation_dt, "second", 0)
            else operation_dt.strftime("%H:%M")
        )

    return {
        "ledger_id": params.get("ledger_id", params.get("transaction_id", 0)),
        "transaction_id": params.get("transaction_id"),
        "ticket_number": params.get("ticket_number") or "",
        "operation_number": params.get("operation_number") or "",
        "accounting_date": params.get("accounting_date"),
        "gauging_date": gauging_date,
        "gauging_time": gauging_time,
        "operation_datetime": operation_dt,
        "location_code": params.get("location_code") or "",
        "location_name": prefetched_location_name
        if prefetched_location_name is not None
        else (location.location_name if location else ""),
        "tank_asset_code": params.get("tank_asset_code") or "",
        "tank_asset_name": params.get("tank_asset_name") or "",
        "product_name": params.get("product_name") or "",
        "tank_operation_code": params.get("tank_operation_code") or "",
        "tank_operation_label": params.get("tank_operation_label") or "",
        "tank_operation_category": params.get("tank_operation_category") or "",
        "tank_operation_sign": params.get("tank_operation_sign") or "",
        "previous_stock_gsv_bbl": round(previous_gsv, 3),
        "previous_stock_nsv_bbl": round(previous_nsv, 3),
        "previous_stock_lt": round(previous_lt, 3),
        "previous_stock_mt": round(previous_mt, 3),
        "stock_after_gsv_bbl": round(stock_after_gsv, 3),
        "stock_after_nsv_bbl": round(stock_after_nsv, 3),
        "stock_after_lt": round(stock_after_lt, 3),
        "stock_after_mt": round(stock_after_mt, 3),
        "receipt_gsv_bbl": round(receipt_gsv, 3),
        "receipt_nsv_bbl": round(receipt_nsv, 3),
        "receipt_lt": round(receipt_lt, 3),
        "receipt_mt": round(receipt_mt, 3),
        "production_gsv_bbl": round(production_gsv, 3),
        "production_nsv_bbl": round(production_nsv, 3),
        "production_lt": round(production_lt, 3),
        "production_mt": round(production_mt, 3),
        "draining_gsv_bbl": round(draining_gsv, 3),
        "draining_nsv_bbl": round(draining_nsv, 3),
        "draining_lt": round(draining_lt, 3),
        "draining_mt": round(draining_mt, 3),
        "dispatch_gsv_bbl": round(dispatch_gsv, 3),
        "dispatch_nsv_bbl": round(dispatch_nsv, 3),
        "dispatch_lt": round(dispatch_lt, 3),
        "dispatch_mt": round(dispatch_mt, 3),
        "other_in_gsv_bbl": round(other_in_gsv, 3),
        "other_in_nsv_bbl": round(other_in_nsv, 3),
        "other_in_lt": round(other_in_lt, 3),
        "other_in_mt": round(other_in_mt, 3),
        "other_out_gsv_bbl": round(other_out_gsv, 3),
        "other_out_nsv_bbl": round(other_out_nsv, 3),
        "other_out_lt": round(other_out_lt, 3),
        "other_out_mt": round(other_out_mt, 3),
        "net_receipt_gsv_bbl": round(net_receipt_gsv, 3),
        "net_receipt_nsv_bbl": round(net_receipt_nsv, 3),
        "net_receipt_lt": round(net_receipt_lt, 3),
        "net_receipt_mt": round(net_receipt_mt, 3),
        "net_dispatch_gsv_bbl": round(net_dispatch_gsv, 3),
        "net_dispatch_nsv_bbl": round(net_dispatch_nsv, 3),
        "net_dispatch_lt": round(net_dispatch_lt, 3),
        "net_dispatch_mt": round(net_dispatch_mt, 3),
        "signed_net_movement_gsv_bbl": round(signed_net_gsv, 3),
        "signed_net_movement_nsv_bbl": round(signed_net_nsv, 3),
        "signed_net_movement_lt": round(signed_net_lt, 3),
        "signed_net_movement_mt": round(signed_net_mt, 3),
        "status": params.get("status", "Active"),
        "remarks": params.get("remarks"),
    }


def add_volume_values_from_values(
    target: dict,
    prefix: str,
    movement_gsv: float,
    movement_nsv: float,
    movement_lt: float,
    movement_mt: float,
):
    """Add movement volume values to a target dict keyed by prefix."""
    target[f"{prefix}_gsv"] += safe_float(movement_gsv)
    target[f"{prefix}_nsv"] += safe_float(movement_nsv)
    target[f"{prefix}_lt"] += safe_float(movement_lt)
    target[f"{prefix}_mt"] += safe_float(movement_mt)
