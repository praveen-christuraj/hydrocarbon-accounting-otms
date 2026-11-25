"""Validation and execution adapter for interactive Analytics dashboards.

Analytics definitions deliberately reuse the Report Builder's allow-listed
catalog, formula engine, location scoping, and execution limits. This module
only translates each visual to a report definition; it does not construct SQL.
"""
from __future__ import annotations

import copy
import re

from app.services.report_engine import ReportDefinitionError, run_report, validate_definition

VISUAL_TYPES = {
    "KPI_CARD", "TABLE", "MATRIX", "BAR", "COLUMN", "LINE", "AREA",
    "PIE", "DONUT", "GAUGE", "TEXT", "TANK_VISUAL",
}
MAX_VISUALS = 24
MAX_SLICERS = 12
HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
ALLOWED_SLICER_TYPES = {"SELECT", "TEXT", "NUMBER", "NUMBER_RANGE", "DATE", "DATE_RANGE"}
RUNTIME_TYPE_BY_SLICER = {
    "SELECT": "select",
    "TEXT": "text",
    "NUMBER": "number",
    "NUMBER_RANGE": "number_range",
    "DATE": "date",
    "DATE_RANGE": "date_range",
}


def _as_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return default


def _clamp_int(value, minimum, maximum, default):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _safe_color(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return None
    color = value.strip()
    if HEX_COLOR_RE.match(color):
        return color
    # Allow a small set of CSS variable/theme tokens used by the app.
    if color in {"var(--primary)", "var(--text)", "var(--text-muted)", "var(--text-secondary)", "var(--success)", "var(--warning)", "var(--danger)", "var(--surface)"}:
        return color
    return None


def _normalize_style(style):
    if not isinstance(style, dict):
        style = {}
    kpi = style.get("kpi") if isinstance(style.get("kpi"), dict) else {}
    table = style.get("table") if isinstance(style.get("table"), dict) else {}
    chart = style.get("chart") if isinstance(style.get("chart"), dict) else {}

    normalized = {
        "cardBackground": _safe_color(style.get("cardBackground")),
        "cardBorder": _as_bool(style.get("cardBorder"), True),
        "titleColor": _safe_color(style.get("titleColor")),
        "kpi": {
            "valueColor": _safe_color(kpi.get("valueColor")),
            "labelColor": _safe_color(kpi.get("labelColor")),
            "valueFontSize": _clamp_int(kpi.get("valueFontSize"), 20, 96, 48),
            "labelFontSize": _clamp_int(kpi.get("labelFontSize"), 10, 32, 13),
            "align": str(kpi.get("align") or "left").lower() if str(kpi.get("align") or "left").lower() in {"left", "center", "right"} else "left",
            "prefix": str(kpi.get("prefix") or "")[:24],
            "suffix": str(kpi.get("suffix") or "")[:24],
            "compact": _as_bool(kpi.get("compact"), False),
            "decimals": _clamp_int(kpi.get("decimals"), 0, 6, 2) if kpi.get("decimals") is not None else None,
        },
        "table": {
            "density": str(table.get("density") or "comfortable").lower() if str(table.get("density") or "comfortable").lower() in {"compact", "comfortable", "spacious"} else "comfortable",
            "stickyHeader": _as_bool(table.get("stickyHeader"), True),
            "striped": _as_bool(table.get("striped"), False),
            "wrapText": _as_bool(table.get("wrapText"), False),
        },
        "chart": {
            "palette": [c for c in (_safe_color(item) for item in (chart.get("palette") or [])) if c][:12] if isinstance(chart.get("palette"), list) else [],
            "showLegend": _as_bool(chart.get("showLegend"), True),
            "showLabels": _as_bool(chart.get("showLabels"), False),
            "showGrid": _as_bool(chart.get("showGrid"), True),
            "smooth": _as_bool(chart.get("smooth"), False),
            "areaFill": _as_bool(chart.get("areaFill"), False),
            "stacked": _as_bool(chart.get("stacked"), False),
            "xLabelRotation": _clamp_int(chart.get("xLabelRotation"), 0, 90, 0) if chart.get("xLabelRotation") is not None else None,
        },
    }
    return normalized


def _normalize_layout_item(item, valid_ids, seen_layout):
    if not isinstance(item, dict):
        return None
    visual_id = str(item.get("i") or "")
    if visual_id not in valid_ids or visual_id in seen_layout:
        return None
    seen_layout.add(visual_id)
    w = _clamp_int(item.get("w"), 1, 12, 12)
    h = _clamp_int(item.get("h"), 2, 40, 6)
    x = _clamp_int(item.get("x"), 0, 12 - w, 0)
    y = _clamp_int(item.get("y"), 0, 2000, 0)
    return {"i": visual_id, "x": x, "y": y, "w": w, "h": h, "minW": _clamp_int(item.get("minW"), 1, 12, 2), "minH": _clamp_int(item.get("minH"), 2, 40, 2)}


def _normalize_layout(layout, visuals):
    valid_ids = {str(v.get("id")) for v in visuals if isinstance(v, dict) and v.get("id")}
    if isinstance(layout, dict):
        # Backward/forward compatible: accept {"lg":[...], ...} and normalize each breakpoint.
        normalized = {}
        for bp in ("lg", "md", "sm", "xs"):
            seen = set()
            items = layout.get(bp) if isinstance(layout.get(bp), list) else []
            normalized[bp] = [n for n in (_normalize_layout_item(item, valid_ids, seen) for item in items) if n]
            # Add missing visuals at end for this breakpoint
            for index, visual in enumerate(visuals):
                vid = str(visual.get("id"))
                if vid in seen:
                    continue
                col_count = {"lg": 12, "md": 10, "sm": 6, "xs": 2}[bp]
                w = min(12 if bp == "lg" else col_count, col_count)
                normalized[bp].append({"i": vid, "x": 0, "y": 1000 + index * 6, "w": w, "h": 6, "minW": 2, "minH": 2})
        return normalized

    if not isinstance(layout, list):
        layout = []
    seen = set()
    normalized_lg = [n for n in (_normalize_layout_item(item, valid_ids, seen) for item in layout) if n]
    for index, visual in enumerate(visuals):
        vid = str(visual.get("id"))
        if vid in seen:
            continue
        normalized_lg.append({"i": vid, "x": 0, "y": 1000 + index * 6, "w": 12, "h": 6, "minW": 2, "minH": 2})
    return normalized_lg


def _slicer_column_key(slicer):
    if not isinstance(slicer, dict):
        return ""
    return str(slicer.get("column_key") or slicer.get("field") or (slicer.get("source") or {}).get("column") or "")


def _normalize_slicer(slicer, valid_visual_ids):
    if not isinstance(slicer, dict):
        return None
    stype = str(slicer.get("type") or "SELECT").upper()
    if stype not in ALLOWED_SLICER_TYPES:
        return None
    key = str(slicer.get("key") or "").strip()
    if not key:
        return None
    label = str(slicer.get("label") or key).strip()[:120] or key
    column_key = _slicer_column_key(slicer).strip()
    visual_ids = slicer.get("visual_ids")
    if visual_ids is None:
        normalized_visual_ids = list(valid_visual_ids)
    elif isinstance(visual_ids, list):
        normalized_visual_ids = [str(item) for item in visual_ids if str(item) in valid_visual_ids]
        if not normalized_visual_ids:
            normalized_visual_ids = list(valid_visual_ids)
    else:
        normalized_visual_ids = list(valid_visual_ids)
    config = slicer.get("config") if isinstance(slicer.get("config"), dict) else {}
    return {
        "id": str(slicer.get("id") or key),
        "key": key,
        "label": label,
        "type": stype,
        "column_key": column_key,
        "field": column_key,
        "visual_ids": normalized_visual_ids,
        "required": _as_bool(slicer.get("required"), False),
        "default": slicer.get("default"),
        "config": {
            "multi": _as_bool(config.get("multi"), stype == "SELECT"),
            "placeholder": str(config.get("placeholder") or "")[:120],
            "allowAll": _as_bool(config.get("allowAll"), True),
        },
    }


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
    hidden_keys = {
        str(column.get("key"))
        for column in columns
        if isinstance(column, dict) and _as_bool(column.get("hidden"), False)
    }

    for slicer in slicers or []:
        if not isinstance(slicer, dict):
            continue
        if slicer.get("visual_ids") and str(visual.get("id")) not in {str(v) for v in slicer.get("visual_ids") or []}:
            continue
        stype = str(slicer.get("type") or "SELECT").upper()
        runtime_type = RUNTIME_TYPE_BY_SLICER.get(stype)
        if not runtime_type:
            continue
        key = _slicer_column_key(slicer)
        runtime_key = str(slicer.get("key") or "")
        if not key or not runtime_key:
            continue
        if key in available_keys and not any(item.get("key") == runtime_key for item in query["runtime_filters"]):
            query["runtime_filters"].append({
                "key": runtime_key,
                "label": slicer.get("label") or runtime_key,
                "type": runtime_type,
                "column_key": key,
                "required": _as_bool(slicer.get("required"), False),
                **({"default": slicer.get("default")} if slicer.get("default") not in (None, "", []) else {}),
            })
    return query


def validate_analytics_definition(definition: dict) -> dict:
    if not isinstance(definition, dict):
        raise ReportDefinitionError("Dashboard design must be an object.")
    candidate = copy.deepcopy(definition)
    if candidate.get("schema_version", 2) not in {2, 3}:
        raise ReportDefinitionError("Unsupported Analytics dashboard design version.")
    candidate["schema_version"] = 2

    visuals = candidate.get("visuals")
    if not isinstance(visuals, list) or not visuals:
        raise ReportDefinitionError("Add at least one visual to the dashboard.")
    if len(visuals) > MAX_VISUALS:
        raise ReportDefinitionError(f"A dashboard can have at most {MAX_VISUALS} visuals.")

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
        visual["type"] = visual_type
        visual["title"] = str(visual.get("title") or "Untitled visual")[:200]
        if visual.get("description") is not None:
            visual["description"] = str(visual.get("description") or "")[:500]
        visual["style"] = _normalize_style(visual.get("style"))
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
            visual_query["unit"] = unit
            visual["query"] = visual_query
            continue
        # Ensure query has required shape before validation.
        if not isinstance(visual_query.get("columns"), list):
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' query columns must be a list.")
        visual["query"] = visual_query

    slicers_raw = candidate.get("slicers") or []
    if not isinstance(slicers_raw, list) or len(slicers_raw) > MAX_SLICERS:
        raise ReportDefinitionError(f"A dashboard can have at most {MAX_SLICERS} slicers.")
    normalized_slicers = []
    slicer_keys: set[str] = set()
    for slicer in slicers_raw:
        normalized = _normalize_slicer(slicer, valid_ids)
        if normalized is None:
            if isinstance(slicer, dict) and str(slicer.get("type") or "").upper() not in ALLOWED_SLICER_TYPES:
                raise ReportDefinitionError(f"Slicer '{slicer.get('label') or slicer.get('key') or 'slicer'}' has an unsupported type.")
            raise ReportDefinitionError("Each dashboard slicer must be a valid object with a unique key.")
        key = normalized["key"]
        if key in slicer_keys:
            raise ReportDefinitionError("Every slicer needs a unique key.")
        slicer_keys.add(key)
        column_key = normalized.get("column_key")
        if not column_key:
            raise ReportDefinitionError(f"Slicer '{normalized.get('label') or key}' must be bound to a field.")
        # Slicer target visuals must exist
        if not normalized.get("visual_ids"):
            # If user explicitly targeted none, keep as empty (no-op) but valid; default is all.
            normalized["visual_ids"] = []
        normalized_slicers.append(normalized)
    candidate["slicers"] = normalized_slicers

    # Validate each query visual against report engine, including slicer-generated runtime filters.
    for visual in visuals:
        visual_type = str(visual.get("type") or "").upper()
        if visual_type in {"TEXT", "TANK_VISUAL"}:
            continue
        visual_source = ((visual.get("query") or {}).get("source") or {})
        if visual_source.get("kind") == "material_balance":
            continue
        query = report_definition_for_visual(visual, normalized_slicers)
        if visual_type == "MATRIX":
            query["report_type"] = "MATRIX"
        else:
            query["report_type"] = "TABULAR"
        try:
            validate_definition(query)
        except ReportDefinitionError as exc:
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual.get('id')}': {exc}") from exc

    # Slicer binding validation: slicer must bind to at least one targeted visual column (or be addable as hidden column).
    exposed = {}
    for visual in visuals:
        if not isinstance(visual, dict):
            continue
        vid = str(visual.get("id"))
        for column in ((visual.get("query") or {}).get("columns") or []):
            if isinstance(column, dict) and column.get("key"):
                exposed[(vid, str(column.get("key")))] = column
    unsupported_slicer_visuals = {
        str(v.get("id")) for v in visuals
        if isinstance(v, dict) and (((v.get("query") or {}).get("source") or {}).get("kind") == "material_balance" or str(v.get("type") or "").upper() in {"TEXT", "TANK_VISUAL"})
    }
    for slicer in normalized_slicers:
        targets = [vid for vid in (slicer.get("visual_ids") or []) if vid in valid_ids and vid not in unsupported_slicer_visuals]
        if not targets:
            # If slicer only targets unsupported visuals, keep it but it won't apply.
            slicer["visual_ids"] = [vid for vid in (slicer.get("visual_ids") or []) if vid in valid_ids]
            continue
        slicer["visual_ids"] = targets
        column_key = str(slicer.get("column_key") or "")
        bound = any((vid, column_key) in exposed for vid in targets)
        if not bound:
            raise ReportDefinitionError(
                f"Slicer '{slicer.get('label') or slicer.get('key')}' references field '{column_key}' that is not present in its targeted visuals. "
                "Add that field to the visual (or recreate the slicer) so it can be filtered."
            )

    candidate["layout"] = _normalize_layout(candidate.get("layout"), visuals)
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


def _strip_hidden_columns(result: dict, visual: dict) -> dict:
    if not isinstance(result, dict):
        return result
    query_columns = ((visual.get("query") or {}).get("columns") or [])
    hidden_keys = {
        str(col.get("key"))
        for col in query_columns
        if isinstance(col, dict) and _as_bool(col.get("hidden"), False)
    }
    if not hidden_keys:
        return result
    result = copy.deepcopy(result)
    result["columns"] = [col for col in (result.get("columns") or []) if str(col.get("key")) not in hidden_keys]
    for row in result.get("rows") or []:
        if isinstance(row, dict):
            for key in hidden_keys:
                row.pop(key, None)
    totals = result.get("totals")
    if isinstance(totals, dict):
        for key in hidden_keys:
            totals.pop(key, None)
    return result


def run_visual(db, user, visual: dict, definition: dict, params: dict) -> dict:
    source = ((visual.get("query") or {}).get("source") or {})
    if source.get("kind") == "material_balance":
        from app.dependencies.permissions import require_user_permission
        require_user_permission(user, "View Material Balance Report", db)
        return _strip_hidden_columns(_run_material_balance_visual(db, visual, params), visual)
    if visual.get("type") in {"TEXT", "TANK_VISUAL"}:
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}
    report_definition = report_definition_for_visual(visual, definition.get("slicers") or [])
    report_definition["report_type"] = "MATRIX" if visual.get("type") == "MATRIX" else "TABULAR"
    result = run_report(db, user, report_definition, params)
    return _strip_hidden_columns(result, visual)


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
        if query.get("date_basis") == "NONE":
            visual_params.pop("date_from", None)
            visual_params.pop("date_to", None)
        result = run_visual(db, user, visual, normalized, visual_params)
        result.get("meta", {}).pop("_export_rows", None)
        results[visual["id"]] = result
    return {"results": results}
