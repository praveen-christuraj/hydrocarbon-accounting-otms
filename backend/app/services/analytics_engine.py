"""Validation and execution adapter for interactive Analytics dashboards.

Analytics definitions deliberately reuse the Report Builder's allow-listed
catalog, formula engine, location scoping, and execution limits. This module
only translates each visual to a report definition; it does not construct SQL.
"""
from __future__ import annotations

import copy

from app.services.report_engine import ReportDefinitionError, run_report, validate_definition

VISUAL_TYPES = {
    "KPI_CARD", "TABLE", "MATRIX", "BAR", "COLUMN", "LINE", "AREA",
    "PIE", "DONUT", "GAUGE", "TEXT", "TANK_VISUAL",
}
MAX_VISUALS = 24
MAX_SLICERS = 6


def report_definition_for_visual(visual: dict, slicers: list[dict] | None = None) -> dict:
    query = copy.deepcopy(visual.get("query") or {})
    query.setdefault("schema_version", 1)
    query.setdefault("report_type", "MATRIX" if visual.get("type") == "MATRIX" else "TABULAR")
    query.setdefault("source", {"kind": "operation_tickets"})
    query.setdefault("date_basis", "ACCOUNTING_DATE")
    query.setdefault("filters", [])
    query.setdefault("filter_logic", "AND")
    query.setdefault("runtime_filters", [])
    query.setdefault("group_by", [])
    query.setdefault("sort", [])
    query.setdefault("options", {"show_totals": True, "page_size": 50})
    for field in ("columns", "filters", "runtime_filters", "group_by", "sort"):
        if not isinstance(query.get(field), list):
            raise ReportDefinitionError(f"Visual query field '{field}' must be a list.")
    if not isinstance(query.get("source"), dict) or not isinstance(query.get("options"), dict):
        raise ReportDefinitionError("Visual query source and options must be objects.")
    columns = query.get("columns") or []
    available_keys = {str(column.get("key")) for column in columns if isinstance(column, dict)}
    for slicer in slicers or []:
        key = str(slicer.get("column_key") or "")
        if key in available_keys and slicer.get("type") == "SELECT":
            runtime_key = str(slicer.get("key") or "")
            if runtime_key and not any(item.get("key") == runtime_key for item in query["runtime_filters"]):
                query["runtime_filters"].append({
                    "key": runtime_key,
                    "label": slicer.get("label") or runtime_key,
                    "type": "select",
                    "column_key": key,
                })
    return query


def validate_analytics_definition(definition: dict) -> dict:
    if not isinstance(definition, dict):
        raise ReportDefinitionError("Dashboard design must be an object.")
    candidate = copy.deepcopy(definition)
    if candidate.get("schema_version", 2) != 2:
        raise ReportDefinitionError("Unsupported Analytics dashboard design version.")
    visuals = candidate.get("visuals")
    if not isinstance(visuals, list) or not visuals:
        raise ReportDefinitionError("Add at least one visual to the dashboard.")
    if len(visuals) > MAX_VISUALS:
        raise ReportDefinitionError(f"A dashboard can have at most {MAX_VISUALS} visuals.")
    slicers = candidate.get("slicers") or []
    if not isinstance(slicers, list) or len(slicers) > MAX_SLICERS:
        raise ReportDefinitionError(f"A dashboard can have at most {MAX_SLICERS} slicers.")
    if any(not isinstance(slicer, dict) for slicer in slicers):
        raise ReportDefinitionError("Each dashboard slicer must be an object.")
    candidate["slicers"] = slicers

    ids: set[str] = set()
    valid_ids: set[str] = set()
    for index, visual in enumerate(visuals):
        if not isinstance(visual, dict):
            raise ReportDefinitionError(f"Visual {index + 1} is not valid.")
        visual_id = str(visual.get("id") or "").strip()
        if not visual_id or visual_id in ids:
            raise ReportDefinitionError(f"Visual {index + 1} needs a unique id.")
        ids.add(visual_id)
        valid_ids.add(visual_id)
        visual_type = str(visual.get("type") or "").upper()
        if visual_type not in VISUAL_TYPES:
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' has an unsupported type.")
        if visual_type in {"TEXT", "TANK_VISUAL"}:
            continue
        visual_query = visual.get("query") or {}
        if not isinstance(visual_query, dict):
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' query must be an object.")
        visual_source = visual_query.get("source") or {}
        if not isinstance(visual_source, dict):
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' source must be an object.")
        if visual_source.get("kind") == "material_balance":
            if visual_type != "TABLE":
                raise ReportDefinitionError("Material Balance visuals are currently supported as dynamic tables.")
            unit = str(visual_query.get("unit") or "nsv").lower()
            if unit not in {"gsv", "nsv", "lt", "mt"}:
                raise ReportDefinitionError("Material Balance unit must be GSV, NSV, LT or MT.")
            continue
        query = report_definition_for_visual(visual, candidate.get("slicers") or [])
        if visual_type == "MATRIX":
            query["report_type"] = "MATRIX"
        else:
            query["report_type"] = "TABULAR"
        try:
            validate_definition(query)
        except ReportDefinitionError as exc:
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}': {exc}") from exc

    slicers = candidate.get("slicers") or []
    if not isinstance(slicers, list) or len(slicers) > MAX_SLICERS:
        raise ReportDefinitionError(f"A dashboard can have at most {MAX_SLICERS} slicers.")
    slicer_keys: set[str] = set()
    exposed = {
        (visual.get("id"), column.get("key"))
        for visual in visuals if isinstance(visual, dict)
        for column in ((visual.get("query") or {}).get("columns") or [])
        if isinstance(column, dict)
    }
    for slicer in slicers:
        key = str(slicer.get("key") or "")
        if not key or key in slicer_keys:
            raise ReportDefinitionError("Every slicer needs a unique key.")
        slicer_keys.add(key)
        if str(slicer.get("type") or "").upper() not in {"SELECT", "DATE", "DATE_RANGE"}:
            raise ReportDefinitionError(f"Slicer '{slicer.get('label') or key}' has an unsupported type.")
        if str(slicer.get("type") or "").upper() == "SELECT":
            bound = str(slicer.get("column_key") or "")
            visual_ids = slicer.get("visual_ids")
            if visual_ids is None:
                visual_ids = [visual.get("id") for visual in visuals]
            if not isinstance(visual_ids, list) or any(str(item) not in valid_ids for item in visual_ids):
                raise ReportDefinitionError(f"Slicer '{slicer.get('label') or key}' references an invalid visual.")
            if not any((visual_id, bound) in exposed for visual_id in visual_ids):
                raise ReportDefinitionError(f"Slicer '{slicer.get('label') or key}' is not bound to a visual column.")

    layout = candidate.get("layout") or []
    if not isinstance(layout, list):
        raise ReportDefinitionError("Dashboard layout must be a list.")
    seen_layout: set[str] = set()
    for item in layout:
        if not isinstance(item, dict):
            raise ReportDefinitionError("A dashboard layout item is not valid.")
        visual_id = str(item.get("i") or "")
        if visual_id not in valid_ids or visual_id in seen_layout:
            raise ReportDefinitionError("Dashboard layout references a missing or duplicate visual.")
        seen_layout.add(visual_id)
        for field, minimum, maximum in (("x", 0, 11), ("y", 0, 1000), ("w", 1, 12), ("h", 1, 30)):
            try:
                value = int(item.get(field))
            except (TypeError, ValueError):
                raise ReportDefinitionError(f"Dashboard layout field '{field}' must be a whole number.")
            if not minimum <= value <= maximum or (field == "x" and value + int(item.get("w", 1)) > 12):
                raise ReportDefinitionError(f"Dashboard layout field '{field}' is outside the supported range.")
    return candidate


def _run_material_balance_visual(db, visual: dict, params: dict) -> dict:
    from datetime import date

    from app.routers.reports import (
        build_dynamic_material_balance_columns_response,
        build_dynamic_material_balance_tank_rows,
        consolidate_dynamic_material_balance_rows_by_location,
        get_material_balance_rows_for_continuity,
    )
    from app.services.material_balance_helpers import (
        build_material_balance_coverage,
        get_active_material_balance_template_columns,
        get_active_material_balance_template_for_location,
    )

    source = (visual.get("query") or {}).get("source") or {}
    location_codes = params.get("location_codes") or []
    source_location = source.get("location_code")
    if source_location and location_codes and str(source_location).casefold() not in {str(code).casefold() for code in location_codes}:
        raise ReportDefinitionError("The Material Balance visual location is outside the dashboard runner's selected scope.")
    location_code = source_location or (location_codes[0] if len(location_codes) == 1 else None)
    if not location_code:
        raise ReportDefinitionError("Choose exactly one location for a Material Balance visual.")
    if not params.get("date_from") or not params.get("date_to"):
        raise ReportDefinitionError("Choose a Date From and Date To to run a Material Balance visual.")

    def as_date(value):
        if isinstance(value, date):
            return value
        return date.fromisoformat(str(value))

    date_from_value, date_to_value = as_date(params["date_from"]), as_date(params["date_to"])
    if date_from_value > date_to_value:
        raise ReportDefinitionError("Date From cannot be after Date To.")

    template = get_active_material_balance_template_for_location(db, location_code)
    columns = get_active_material_balance_template_columns(db, template.id)
    ledger_rows = get_material_balance_rows_for_continuity(
        db=db, location_code=location_code,
        tank_asset_code=(visual.get("query") or {}).get("tank_asset_code"),
        product_name=None, date_to_value=date_to_value, status="Active",
    )
    unit_key = str((visual.get("query") or {}).get("unit") or "nsv").lower()
    tank_rows = build_dynamic_material_balance_tank_rows(
        db=db, ledger_rows=ledger_rows, columns=columns,
        date_from_value=date_from_value, date_to_value=date_to_value,
        unit_key=unit_key,
    )
    report_rows = consolidate_dynamic_material_balance_rows_by_location(tank_rows, columns)
    coverage = build_material_balance_coverage(
        db=db, location_code=location_code, columns=columns, ledger_rows=ledger_rows,
        date_from_value=date_from_value, date_to_value=date_to_value,
    )
    dynamic_columns = build_dynamic_material_balance_columns_response(columns)
    output_columns = [
        {"key": "accounting_date", "label": "Accounting Date", "data_type": "date"},
        {"key": "tank_asset_code", "label": "Tank", "data_type": "text"},
        {"key": "product_name", "label": "Product", "data_type": "text"},
        *[{
            "key": item["column_key"], "label": item["column_label"], "data_type": "number",
            "aggregate": None, "format": {"decimals": 3},
        } for item in dynamic_columns],
    ]
    rows = []
    for item in report_rows:
        row = {
            "accounting_date": item.get("accounting_date"),
            "tank_asset_code": item.get("tank_asset_code"),
            "product_name": item.get("product_name"),
        }
        row.update(item.get("values") or {})
        rows.append(row)
    warnings = []
    if coverage["unmapped_operations"]:
        warnings.append(
            f"{len(coverage['unmapped_operations'])} active IN/OUT Tank Operation(s) are not mapped in the active Material Balance Template."
        )
    return {
        "columns": output_columns, "rows": rows, "totals": {},
        "meta": {"warnings": warnings, "total_rows": len(rows), "date_basis_label": "Accounting Date",
                 "material_balance_template": template.template_name, "unmapped_ledger_rows_count": coverage["unmapped_ledger_rows_count"]},
    }


def run_visual(db, user, visual: dict, definition: dict, params: dict) -> dict:
    source = ((visual.get("query") or {}).get("source") or {})
    if source.get("kind") == "material_balance":
        from app.dependencies.permissions import require_user_permission
        require_user_permission(user, "View Material Balance Report", db)
        return _run_material_balance_visual(db, visual, params)
    if visual.get("type") in {"TEXT", "TANK_VISUAL"}:
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}
    report_definition = report_definition_for_visual(visual, definition.get("slicers") or [])
    report_definition["report_type"] = "MATRIX" if visual.get("type") == "MATRIX" else "TABULAR"
    return run_report(db, user, report_definition, params)


def run_dashboard(db, user, definition: dict, params: dict | None = None, visual_ids: list[str] | None = None) -> dict:
    normalized = validate_analytics_definition(definition)
    if visual_ids is not None and (not isinstance(visual_ids, list) or any(not isinstance(item, str) for item in visual_ids)):
        raise ReportDefinitionError("Visual ids must be provided as a list of visual keys.")
    known_ids = {visual.get("id") for visual in normalized["visuals"]}
    selected = set(visual_ids or [])
    if selected - known_ids:
        raise ReportDefinitionError("One or more requested visuals do not exist in this dashboard.")
    results = {}
    for visual in normalized["visuals"]:
        if selected and visual["id"] not in selected:
            continue
        visual_params = dict(params or {})
        visual_params["runtime_values"] = dict((params or {}).get("runtime_values") or {})
        query = visual.get("query") or {}
        if query.get("date_basis") == "NONE" and visual.get("type") != "TABLE":
            visual_params.pop("date_from", None)
            visual_params.pop("date_to", None)
        elif query.get("date_basis") == "NONE":
            visual_params.pop("date_from", None)
            visual_params.pop("date_to", None)
        result = run_visual(db, user, visual, normalized, visual_params)
        result.get("meta", {}).pop("_export_rows", None)
        results[visual["id"]] = result
    return {"results": results}
