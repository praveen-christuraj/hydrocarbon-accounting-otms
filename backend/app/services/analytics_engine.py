"""Validation and execution adapter for interactive Analytics dashboards.

Analytics definitions deliberately reuse the Report Builder's allow-listed
catalog, formula engine, location scoping, and execution limits. This module
only translates each visual to a report definition or governed snapshot query;
it never constructs raw SQL.
"""
from __future__ import annotations

import copy
import io
import re
from datetime import date, datetime

from sqlalchemy import func

from app.services.report_catalog import (
    LEDGER_VIRTUAL_FIELDS,
    TICKET_VIRTUAL_FIELDS,
    allowed_columns as catalog_allowed_columns,
)
from app.services.report_engine import (
    FILTER_OPERATORS,
    ReportDefinitionError,
    _export_matrix_of,
    run_report,
    validate_definition,
)
from app.utils.spreadsheet import sanitize_spreadsheet_cell

VISUAL_TYPES = {
    # KPI, Gauge, Tank & Text
    "KPI_CARD", "GAUGE", "INDICATOR_BULLET", "TANK_VISUAL", "TEXT",
    # Perspective-style DataGrid & Pivot Matrix
    "TABLE", "MATRIX", "PIVOT_GRID",
    # Apache ECharts BI Suite
    "BAR", "COLUMN", "LINE", "AREA", "COMBO",
    "PIE", "DONUT", "WATERFALL", "SANKEY",
    "TREEMAP", "SUNBURST", "HEATMAP", "FUNNEL", "RADAR",
    # Plotly.js Scientific, Statistical & Engineering Suite
    "SCATTER", "BOX_PLOT", "VIOLIN_PLOT", "HISTOGRAM",
    "CONTOUR_2D", "PLOTLY_WATERFALL", "SURFACE_3D",
}

MAX_VISUALS = 32
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
ALLOWED_CSS_TOKENS = {
    "var(--primary)", "var(--text)", "var(--text-muted)", "var(--text-secondary)",
    "var(--success)", "var(--warning)", "var(--danger)", "var(--info)",
    "var(--surface)", "var(--surface-2)", "var(--navy-900)", "var(--navy-700)",
}
PERSPECTIVE_AGGREGATES = {
    "SUM", "AVG", "COUNT", "DISTINCT_COUNT", "MIN", "MAX",
    "MEDIAN", "STDDEV", "PCT_TOTAL", "FIRST", "LAST", "VARIANCE",
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


def _clamp_float(value, minimum, maximum, default=None):
    if value is None or value == "":
        return default
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def _safe_color(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        return None
    color = value.strip()
    if HEX_COLOR_RE.match(color) or color in ALLOWED_CSS_TOKENS:
        return color
    return None


def _layout_defaults_for_type(visual_type: str) -> tuple[int, int, int, int]:
    """Return (default_w, default_h, min_w, min_h) on a 12-column grid."""
    vtype = str(visual_type or "TABLE").upper()
    if vtype in {"TABLE", "MATRIX", "PIVOT_GRID"}:
        return (12, 7, 6, 5)
    if vtype in {"KPI_CARD", "GAUGE", "INDICATOR_BULLET"}:
        return (3, 4, 3, 3)
    if vtype == "TEXT":
        return (4, 3, 3, 2)
    if vtype in {"PIE", "DONUT"}:
        return (4, 6, 4, 5)
    if vtype == "TANK_VISUAL":
        return (6, 6, 4, 5)
    return (6, 6, 4, 5)


def _normalize_conditional_rules(rules):
    if not isinstance(rules, list):
        return []
    cleaned = []
    for item in rules[:20]:
        if not isinstance(item, dict):
            continue
        op = str(item.get("operator") or "gt").lower()
        if op not in {"gt", "gte", "lt", "lte", "eq", "ne", "between", "contains"}:
            op = "gt"
        cleaned.append({
            "columnKey": str(item.get("columnKey") or "")[:80],
            "operator": op,
            "value": str(item.get("value") if item.get("value") is not None else "")[:120],
            "value2": str(item.get("value2") if item.get("value2") is not None else "")[:120],
            "textColor": _safe_color(item.get("textColor")),
            "bgColor": _safe_color(item.get("bgColor")),
            "tone": str(item.get("tone") or "custom").lower() if str(item.get("tone") or "").lower() in {"success", "warning", "danger", "info", "custom"} else "custom",
        })
    return cleaned


def _normalize_style(style):
    if not isinstance(style, dict):
        style = {}
    kpi = style.get("kpi") if isinstance(style.get("kpi"), dict) else {}
    table = style.get("table") if isinstance(style.get("table"), dict) else {}
    chart = style.get("chart") if isinstance(style.get("chart"), dict) else {}
    plotly_cfg = style.get("plotly") if isinstance(style.get("plotly"), dict) else {}

    legend_pos = str(chart.get("legendPosition") or "top").lower()
    if legend_pos not in {"top", "bottom", "left", "right"}:
        legend_pos = "top"

    stack_mode = str(chart.get("stackMode") or ("stack" if _as_bool(chart.get("stacked"), False) else "none")).lower()
    if stack_mode not in {"none", "stack", "percent"}:
        stack_mode = "none"

    color_scale = str(table.get("colorScale") or "none").lower()
    if color_scale not in {"none", "diverging", "navy", "emerald", "amber"}:
        color_scale = "none"

    normalized = {
        "cardBackground": _safe_color(style.get("cardBackground")),
        "cardBorder": _as_bool(style.get("cardBorder"), True),
        "titleColor": _safe_color(style.get("titleColor")),
        "accentTop": _as_bool(style.get("accentTop"), False),
        "kpi": {
            "valueColor": _safe_color(kpi.get("valueColor")),
            "labelColor": _safe_color(kpi.get("labelColor")),
            "valueFontSize": _clamp_int(kpi.get("valueFontSize"), 20, 96, 36),
            "labelFontSize": _clamp_int(kpi.get("labelFontSize"), 10, 32, 13),
            "align": str(kpi.get("align") or "left").lower() if str(kpi.get("align") or "left").lower() in {"left", "center", "right"} else "left",
            "prefix": str(kpi.get("prefix") or "")[:24],
            "suffix": str(kpi.get("suffix") or "")[:24],
            "compact": _as_bool(kpi.get("compact"), False),
            "decimals": _clamp_int(kpi.get("decimals"), 0, 6, 2) if kpi.get("decimals") is not None else None,
            "showSparkline": _as_bool(kpi.get("showSparkline"), True),
            "comparisonKey": str(kpi.get("comparisonKey") or "")[:80] or None,
            "targetValue": _clamp_float(kpi.get("targetValue"), -1e15, 1e15, None),
            "minValue": _clamp_float(kpi.get("minValue"), -1e15, 1e15, 0.0),
            "maxValue": _clamp_float(kpi.get("maxValue"), -1e15, 1e15, None),
            "warningThreshold": _clamp_float(kpi.get("warningThreshold"), -1e15, 1e15, 80.0),
            "dangerThreshold": _clamp_float(kpi.get("dangerThreshold"), -1e15, 1e15, 95.0),
            "invertThresholds": _as_bool(kpi.get("invertThresholds"), False),
        },
        "table": {
            "density": str(table.get("density") or "comfortable").lower() if str(table.get("density") or "comfortable").lower() in {"compact", "comfortable", "spacious"} else "comfortable",
            "stickyHeader": _as_bool(table.get("stickyHeader"), True),
            "striped": _as_bool(table.get("striped"), True),
            "wrapText": _as_bool(table.get("wrapText"), False),
            "dataBars": _as_bool(table.get("dataBars"), True),
            "colorScale": color_scale,
            "showSummaryBar": _as_bool(table.get("showSummaryBar"), True),
            "showSubtotals": _as_bool(table.get("showSubtotals"), True),
            "freezeFirstColumn": _as_bool(table.get("freezeFirstColumn"), True),
            "conditionalRules": _normalize_conditional_rules(table.get("conditionalRules")),
        },
        "chart": {
            "palette": [c for c in (_safe_color(item) for item in (chart.get("palette") or [])) if c][:12] if isinstance(chart.get("palette"), list) else [],
            "showLegend": _as_bool(chart.get("showLegend"), True),
            "legendPosition": legend_pos,
            "showLabels": _as_bool(chart.get("showLabels"), False) if "showLabels" in chart else None,
            "showGrid": _as_bool(chart.get("showGrid"), True),
            "smooth": _as_bool(chart.get("smooth"), False),
            "areaFill": _as_bool(chart.get("areaFill"), False),
            "stacked": stack_mode != "none",
            "stackMode": stack_mode,
            "dataZoom": _as_bool(chart.get("dataZoom"), False),
            "showToolbox": _as_bool(chart.get("showToolbox"), True),
            "dualAxis": _as_bool(chart.get("dualAxis"), False),
            "referenceLine": _clamp_float(chart.get("referenceLine"), -1e15, 1e15, None),
            "referenceLabel": str(chart.get("referenceLabel") or "")[:60],
            "xLabelRotation": _clamp_int(chart.get("xLabelRotation"), 0, 90, 0) if chart.get("xLabelRotation") is not None else None,
        },
        "plotly": {
            "showModeBar": _as_bool(plotly_cfg.get("showModeBar"), True),
            "boxMean": _as_bool(plotly_cfg.get("boxMean"), True),
            "showOutliers": _as_bool(plotly_cfg.get("showOutliers"), True),
            "trendline": _as_bool(plotly_cfg.get("trendline"), True),
            "colorscale": str(plotly_cfg.get("colorscale") or "Blues")[:30],
            "bins": _clamp_int(
                plotly_cfg.get("bins") if plotly_cfg.get("bins") is not None else plotly_cfg.get("binCount"),
                5, 100, 20,
            ),
        },
    }
    return normalized


def _normalize_explorer(explorer):
    """Perspective-style interactive pivot/grid/view-switcher state."""
    if not isinstance(explorer, dict):
        return {
            "groupByKeys": [],
            "splitByKeys": [],
            "measureSpecs": [],
            "sortSpecs": [],
            "whereRules": [],
            "allowViewSwitch": True,
            "showShelfByDefault": False,
        }
    group_by = [str(k)[:80] for k in (explorer.get("groupByKeys") or []) if k][:5]
    split_by = [str(k)[:80] for k in (explorer.get("splitByKeys") or []) if k][:3]
    measures = []
    for item in (explorer.get("measureSpecs") or [])[:12]:
        if isinstance(item, dict) and item.get("key"):
            agg = str(item.get("aggregate") or "SUM").upper()
            if agg not in PERSPECTIVE_AGGREGATES:
                agg = "SUM"
            measures.append({
                "key": str(item["key"])[:80],
                "aggregate": agg,
                "label": str(item.get("label") or "")[:120] or None,
                "axis": "secondary" if str(item.get("axis") or "").lower() == "secondary" else "primary",
            })
    sorts = []
    for item in (explorer.get("sortSpecs") or [])[:6]:
        if isinstance(item, dict) and item.get("key"):
            direction = str(item.get("direction") or "DESC").upper()
            if direction not in {"ASC", "DESC", "ABS_DESC"}:
                direction = "DESC"
            sorts.append({"key": str(item["key"])[:80], "direction": direction})
    where_rules = []
    for item in (explorer.get("whereRules") or [])[:12]:
        if isinstance(item, dict) and item.get("key"):
            op = str(item.get("operator") or "eq").lower()
            if op not in FILTER_OPERATORS:
                op = "eq"
            where_rules.append({
                "key": str(item["key"])[:80],
                "operator": op,
                "value": item.get("value"),
                "value2": item.get("value2"),
            })
    return {
        "groupByKeys": group_by,
        "splitByKeys": split_by,
        "measureSpecs": measures,
        "sortSpecs": sorts,
        "whereRules": where_rules,
        "allowViewSwitch": _as_bool(explorer.get("allowViewSwitch"), True),
        "showShelfByDefault": _as_bool(explorer.get("showShelfByDefault"), False),
    }


def _normalize_interactions(interactions):
    if not isinstance(interactions, dict):
        interactions = {}
    drill = interactions.get("drillThrough") if isinstance(interactions.get("drillThrough"), dict) else {}
    mode = str(drill.get("mode") or "RECORDS").upper()
    if mode not in {"NONE", "RECORDS", "TRANSACTION_DETAIL", "DASHBOARD", "CUSTOM_REPORT"}:
        mode = "RECORDS"
    return {
        "crossFilter": _as_bool(interactions.get("crossFilter"), True),
        "brushFilter": _as_bool(interactions.get("brushFilter"), False),
        "drillThrough": {
            "enabled": _as_bool(drill.get("enabled"), True),
            "mode": mode,
            "targetDashboardId": _clamp_int(drill.get("targetDashboardId"), 1, 10_000_000, 0) or None,
            "targetReportId": _clamp_int(drill.get("targetReportId"), 1, 10_000_000, 0) or None,
            "keyColumn": str(drill.get("keyColumn") or "")[:80] or None,
        },
    }


def _normalize_layout_item(item, valid_ids, type_by_id, seen_layout, cols=12):
    if not isinstance(item, dict):
        return None
    visual_id = str(item.get("i") or item.get("id") or "")
    if visual_id not in valid_ids or visual_id in seen_layout:
        return None
    seen_layout.add(visual_id)
    default_w, default_h, type_min_w, type_min_h = _layout_defaults_for_type(type_by_id.get(visual_id, "TABLE"))
    effective_min_w = min(cols, max(type_min_w if cols >= 10 else 2, _clamp_int(item.get("minW"), 1, cols, type_min_w)))
    effective_min_h = max(type_min_h, _clamp_int(item.get("minH"), 2, 40, type_min_h))
    raw_w = _clamp_int(item.get("w"), 1, cols, min(cols, default_w))
    # Auto-heal narrow/corrupted desktop widths (e.g. w=2 saved for a TABLE visual).
    w = max(effective_min_w, raw_w) if cols >= 10 else min(cols, max(1, raw_w))
    h = max(effective_min_h, _clamp_int(item.get("h"), 2, 40, default_h))
    x = _clamp_int(item.get("x"), 0, max(0, cols - w), 0)
    y = _clamp_int(item.get("y"), 0, 2000, 0)
    return {
        "i": visual_id,
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "minW": effective_min_w,
        "minH": effective_min_h,
        "locked": _as_bool(item.get("locked"), False),
        "noMove": _as_bool(item.get("noMove"), False),
        "noResize": _as_bool(item.get("noResize"), False),
    }


def _normalize_layout(layout, visuals):
    valid_ids = {str(v.get("id")) for v in visuals if isinstance(v, dict) and v.get("id")}
    type_by_id = {str(v.get("id")): str(v.get("type") or "TABLE").upper() for v in visuals if isinstance(v, dict) and v.get("id")}

    if isinstance(layout, dict):
        normalized = {}
        for bp in ("lg", "md", "sm", "xs"):
            col_count = {"lg": 12, "md": 10, "sm": 6, "xs": 2}[bp]
            seen = set()
            items = layout.get(bp) if isinstance(layout.get(bp), list) else []
            normalized[bp] = [
                n for n in (_normalize_layout_item(item, valid_ids, type_by_id, seen, col_count) for item in items) if n
            ]
            for index, visual in enumerate(visuals):
                vid = str(visual.get("id"))
                if vid in seen:
                    continue
                def_w, def_h, min_w, min_h = _layout_defaults_for_type(type_by_id.get(vid, "TABLE"))
                w = min(def_w if bp == "lg" else col_count, col_count)
                normalized[bp].append({
                    "i": vid, "x": 0, "y": 1000 + index * def_h,
                    "w": w, "h": def_h, "minW": min(min_w, col_count), "minH": min_h,
                    "locked": False, "noMove": False, "noResize": False,
                })
        return normalized

    if not isinstance(layout, list):
        layout = []
    seen = set()
    normalized_lg = [n for n in (_normalize_layout_item(item, valid_ids, type_by_id, seen, 12) for item in layout) if n]
    cursor_x = 0
    cursor_y = max((item["y"] + item["h"] for item in normalized_lg), default=0)
    for visual in visuals:
        vid = str(visual.get("id"))
        if vid in seen:
            continue
        def_w, def_h, min_w, min_h = _layout_defaults_for_type(type_by_id.get(vid, "TABLE"))
        if cursor_x + def_w > 12:
            cursor_x = 0
            cursor_y += def_h
        normalized_lg.append({
            "i": vid, "x": cursor_x, "y": cursor_y,
            "w": def_w, "h": def_h, "minW": min_w, "minH": min_h,
            "locked": False, "noMove": False, "noResize": False,
        })
        cursor_x += def_w
        if cursor_x >= 12:
            cursor_x = 0
            cursor_y += def_h
    return normalized_lg


def _slicer_column_key(slicer):
    if not isinstance(slicer, dict):
        return ""
    return str(slicer.get("column_key") or slicer.get("field") or (slicer.get("source") or {}).get("column") or "")


def _canonical_slicer_type(raw_type) -> str:
    stype = str(raw_type or "SELECT").upper().strip()
    if stype == "SINGLE_DATE":
        return "DATE"
    return stype


def _normalize_slicer(slicer, valid_visual_ids):
    if not isinstance(slicer, dict):
        return None
    stype = _canonical_slicer_type(slicer.get("type"))
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


TRACKING_STATUS_KINDS = {"tracking_status", "barge_tracking_status", "shuttle_tracking_status", "fso_tracking_status", "tanker_tracking_status"}


def _is_special_source(visual: dict) -> bool:
    vtype = str(visual.get("type") or "").upper()
    if vtype == "TEXT":
        return True
    source_kind = (((visual.get("query") or {}).get("source") or {}).get("kind") or "")
    if source_kind in {"material_balance", "tank_snapshot"} | TRACKING_STATUS_KINDS:
        return True
    if vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns")):
        return True
    return False


def _virtual_fields_for_source(kind: str) -> dict[str, dict]:
    if kind == "operation_tickets":
        return {item["field"]: item for item in TICKET_VIRTUAL_FIELDS}
    if kind == "tank_stock_ledger":
        return {item["field"]: item for item in LEDGER_VIRTUAL_FIELDS}
    return {}


def _table_name_for_source(source: dict | None) -> str | None:
    src = source if isinstance(source, dict) else {}
    kind = str(src.get("kind") or "operation_tickets")
    if kind == "table":
        return src.get("table")
    if kind == "operation_tickets":
        return "operation_transactions"
    if kind == "tank_stock_ledger":
        return "tank_stock_ledger"
    return None


def _resolve_missing_slicer_column(query: dict, column_key: str, slicer: dict) -> dict | None:
    """Build a hidden data column definition for a slicer-bound DB/source field.

    Allows slicers to be added from selected DB columns even when the field is
    not displayed in the visual. Only allow-listed catalog/virtual fields are
    resolvable; unknown/sensitive columns return None and fail validation.
    """
    source = query.get("source") if isinstance(query.get("source"), dict) else {}
    kind = str(source.get("kind") or "operation_tickets")
    table_name = _table_name_for_source(source)
    table_columns = catalog_allowed_columns(table_name) if table_name else {}

    # 1) Regular DB column on the source table
    if column_key in table_columns:
        meta = table_columns[column_key] or {}
        return {
            "key": column_key,
            "label": slicer.get("label") or meta.get("label") or column_key,
            "kind": "data",
            "source": {"type": "column", "column": column_key},
            "data_type": meta.get("data_type", "text"),
            "aggregate": None,
            "hidden": True,
        }

    # 2) Virtual field for the source kind
    virtuals = _virtual_fields_for_source(kind)
    if column_key in virtuals:
        meta = virtuals[column_key] or {}
        return {
            "key": column_key,
            "label": slicer.get("label") or meta.get("label") or column_key,
            "kind": "data",
            "source": {"type": "virtual", "field": column_key},
            "data_type": meta.get("data_type", "text"),
            "aggregate": None,
            "hidden": True,
        }

    # 3) Ticket field (operation_tickets only) - key matches field_code convention
    if kind == "operation_tickets" and re.match(r"^[A-Za-z0-9_]+$", column_key):
        # Only inject if it looks like a field code the user explicitly picked;
        # report_engine will validate against catalog/discovered fields.
        return {
            "key": re.sub(r"[^a-z0-9_]", "_", column_key.lower()).strip("_") or column_key.lower(),
            "label": slicer.get("label") or column_key,
            "kind": "data",
            "source": {"type": "ticket_field", "field_code": column_key},
            "data_type": str(slicer.get("data_type") or "text"),
            "aggregate": None,
            "hidden": True,
        }
    return None


def report_definition_for_visual(visual: dict, slicers: list[dict] | None = None) -> dict:
    query = copy.deepcopy(visual.get("query") or {})
    query.setdefault("schema_version", 1)
    query.setdefault("report_type", "MATRIX" if visual.get("type") == "MATRIX" and query.get("matrix") else "TABULAR")
    query.setdefault("source", {"kind": "operation_tickets"})
    query.setdefault("date_basis", "ACCOUNTING_DATE")
    query.setdefault("filters", [])
    query.setdefault("filter_logic", "AND")
    query.setdefault("runtime_filters", [])
    query.setdefault("group_by", [])
    query.setdefault("sort", [])
    query.setdefault("options", {"show_totals": True, "page_size": 500})
    for field in ("columns", "filters", "runtime_filters", "group_by", "sort"):
        if not isinstance(query.get(field), list):
            raise ReportDefinitionError(f"Visual query field '{field}' must be a list.")
    if not isinstance(query.get("source"), dict) or not isinstance(query.get("options"), dict):
        raise ReportDefinitionError("Visual query source and options must be objects.")

    # Remove analytics-only metadata keys before passing to strict report_engine.validate_definition
    for extra_key in (
        "dimension_key", "secondary_dimension_key", "measure_key", "metric_key",
        "metric_label", "measure_keys", "secondary_measure_keys", "size_key",
        "unit",
    ):
        query.pop(extra_key, None)

    columns = query.get("columns") or []
    available_keys = {str(column.get("key")) for column in columns if isinstance(column, dict)}

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
        target_key = key
        if target_key not in available_keys:
            injected = _resolve_missing_slicer_column(query, target_key, slicer)
            if injected and injected.get("key") not in available_keys:
                # Ensure the injected key is valid for report engine
                injected_key = str(injected.get("key") or "")
                if re.match(r"^[a-z][a-z0-9_]*$", injected_key):
                    columns.append(injected)
                    available_keys.add(injected_key)
                    target_key = injected_key
        if target_key in available_keys and not any(item.get("key") == runtime_key for item in query["runtime_filters"]):
            query["runtime_filters"].append({
                "key": runtime_key,
                "label": slicer.get("label") or runtime_key,
                "type": runtime_type,
                "column_key": target_key,
                "required": _as_bool(slicer.get("required"), False),
                **({"default": slicer.get("default")} if slicer.get("default") not in (None, "", []) else {}),
            })

    def _ensure_column(key: str, fallback_label: str | None = None):
        if not key or key in available_keys:
            return key
        injected = _resolve_missing_slicer_column(query, key, {"label": fallback_label or key})
        if injected and injected.get("key") not in available_keys:
            injected_key = str(injected.get("key") or "")
            if re.match(r"^[a-z][a-z0-9_]*$", injected_key):
                columns.append(injected)
                available_keys.add(injected_key)
                return injected_key
        return key

    for flt in query.get("filters") or []:
        if isinstance(flt, dict) and flt.get("column_key"):
            _ensure_column(str(flt["column_key"]))
    for rf in query.get("runtime_filters") or []:
        if isinstance(rf, dict) and rf.get("column_key"):
            _ensure_column(str(rf["column_key"]), rf.get("label"))
    for gb in query.get("group_by") or []:
        if isinstance(gb, dict) and gb.get("key"):
            _ensure_column(str(gb["key"]))
    for srt in query.get("sort") or []:
        if isinstance(srt, dict) and srt.get("key"):
            _ensure_column(str(srt["key"]))
    return query


def validate_analytics_definition(definition: dict) -> dict:
    if not isinstance(definition, dict):
        raise ReportDefinitionError("Dashboard design must be an object.")
    candidate = copy.deepcopy(definition)
    if candidate.get("schema_version", 2) not in {2, 3}:
        raise ReportDefinitionError("Unsupported Analytics dashboard design version.")
    candidate["schema_version"] = 2

    canvas = candidate.get("canvas") if isinstance(candidate.get("canvas"), dict) else {}
    candidate["canvas"] = {
        "floatMode": _as_bool(canvas.get("floatMode"), False),
        "cellHeight": _clamp_int(canvas.get("cellHeight"), 40, 120, 64),
        "margin": _clamp_int(canvas.get("margin"), 4, 28, 14),
    }

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
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' has an unsupported type '{visual_type}'.")
        visual["type"] = visual_type
        visual["title"] = str(visual.get("title") or "Untitled visual")[:200]
        if visual.get("description") is not None:
            visual["description"] = str(visual.get("description") or "")[:500]
        visual["style"] = _normalize_style(visual.get("style"))
        visual["explorer"] = _normalize_explorer(visual.get("explorer"))
        visual["interactions"] = _normalize_interactions(visual.get("interactions"))

        if visual_type == "TEXT":
            visual["text"] = str(visual.get("text") or "")[:4000]
            continue

        visual_query = visual.get("query") or {}
        if not isinstance(visual_query, dict):
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' query must be an object.")
        visual_source = visual_query.get("source") or {}
        if not isinstance(visual_source, dict):
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual_id}' source must be an object.")

        if visual_source.get("kind") == "material_balance":
            if visual_type not in {"TABLE", "PIVOT_GRID", "MATRIX"}:
                raise ReportDefinitionError("Material Balance visuals are supported as interactive tables or pivot grids.")
            unit = str(visual_query.get("unit") or "nsv").lower()
            if unit not in {"gsv", "nsv", "lt", "mt"}:
                raise ReportDefinitionError("Material Balance unit must be GSV, NSV, LT or MT.")
            visual_query["unit"] = unit
            visual["query"] = visual_query
            continue

        if visual_source.get("kind") == "tank_snapshot" or (visual_type == "TANK_VISUAL" and not visual_query.get("columns")):
            unit = str(visual_query.get("unit") or "nsv").lower()
            if unit not in {"gsv", "nsv", "lt", "mt"}:
                unit = "nsv"
            visual_query["source"] = {"kind": "tank_snapshot"}
            visual_query["unit"] = unit
            visual["query"] = visual_query
            continue

        if visual_source.get("kind") in TRACKING_STATUS_KINDS:
            visual_query["source"] = {"kind": str(visual_source.get("kind") or "tracking_status")}
            # Optional module filter: BARGE, SHUTTLE, FSO, TANKER, or ALL
            module_filter = str(visual_query.get("tracking_module") or "ALL").upper().strip() or "ALL"
            if module_filter not in {"ALL", "BARGE", "SHUTTLE", "FSO", "TANKER"}:
                module_filter = "ALL"
            visual_query["tracking_module"] = module_filter
            visual["query"] = visual_query
            continue

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
            if isinstance(slicer, dict) and _canonical_slicer_type(slicer.get("type")) not in ALLOWED_SLICER_TYPES:
                raise ReportDefinitionError(f"Slicer '{slicer.get('label') or slicer.get('key') or 'slicer'}' has an unsupported type.")
            raise ReportDefinitionError("Each dashboard slicer must be a valid object with a unique key.")
        key = normalized["key"]
        if key in slicer_keys:
            raise ReportDefinitionError("Every slicer needs a unique key.")
        slicer_keys.add(key)
        column_key = normalized.get("column_key")
        if not column_key:
            raise ReportDefinitionError(f"Slicer '{normalized.get('label') or key}' must be bound to a field.")
        if not normalized.get("visual_ids"):
            normalized["visual_ids"] = []
        normalized_slicers.append(normalized)
    candidate["slicers"] = normalized_slicers

    for visual in visuals:
        if _is_special_source(visual):
            continue
        query = report_definition_for_visual(visual, normalized_slicers)
        if visual.get("type") == "MATRIX" and query.get("matrix"):
            query["report_type"] = "MATRIX"
        else:
            query["report_type"] = "TABULAR"
        try:
            validate_definition(query)
        except ReportDefinitionError as exc:
            raise ReportDefinitionError(f"Visual '{visual.get('title') or visual.get('id')}': {exc}") from exc

    tank_snapshot_cols = (
        "tank_asset_code", "tank_asset_name", "location_code", "product_name",
        "current_stock", "capacity", "ullage", "fill_pct", "accounting_date",
        "stock_nsv_bbl", "stock_gsv_bbl", "stock_lt", "stock_mt",
    )
    tracking_status_cols = (
        "tracking_module", "tracking_ref", "asset_code", "asset_name", "location_code",
        "from_location_code", "to_location_code", "current_status", "voyage_status",
        "last_event_type", "last_event_at", "ticket_number", "product_name",
        "quantity_gsv_bbl", "quantity_nsv_bbl", "remarks",
    )
    exposed = {}
    for visual in visuals:
        if not isinstance(visual, dict):
            continue
        vid = str(visual.get("id"))
        source_kind = (((visual.get("query") or {}).get("source") or {}).get("kind") or "")
        vtype = str(visual.get("type") or "").upper()
        if source_kind == "tank_snapshot" or (vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns"))):
            for ckey in tank_snapshot_cols:
                exposed[(vid, ckey)] = {"key": ckey}
            continue
        if source_kind in TRACKING_STATUS_KINDS:
            for ckey in tracking_status_cols:
                exposed[(vid, ckey)] = {"key": ckey}
            continue
        for column in ((visual.get("query") or {}).get("columns") or []):
            if isinstance(column, dict) and column.get("key"):
                exposed[(vid, str(column.get("key")))] = column
    unsupported_slicer_visuals = {
        str(v.get("id")) for v in visuals
        if isinstance(v, dict) and (
            str(v.get("type") or "").upper() == "TEXT"
            or (((v.get("query") or {}).get("source") or {}).get("kind") or "") == "material_balance"
        )
    }
    for slicer in normalized_slicers:
        targets = [vid for vid in (slicer.get("visual_ids") or []) if vid in valid_ids and vid not in unsupported_slicer_visuals]
        if not targets:
            slicer["visual_ids"] = [vid for vid in (slicer.get("visual_ids") or []) if vid in valid_ids]
            continue
        slicer["visual_ids"] = targets
        column_key = str(slicer.get("column_key") or "")
        bound = any((vid, column_key) in exposed for vid in targets)
        if not bound:
            # Allow slicers bound to selected DB/source columns not currently displayed.
            resolvable = False
            for vid in targets:
                visual = next((v for v in visuals if str(v.get("id")) == str(vid)), None)
                if not visual or _is_special_source(visual):
                    continue
                q = visual.get("query") if isinstance(visual.get("query"), dict) else {}
                injected = _resolve_missing_slicer_column(q, column_key, slicer)
                if injected:
                    resolvable = True
                    break
            if not resolvable:
                raise ReportDefinitionError(
                    f"Slicer '{slicer.get('label') or slicer.get('key')}' references field '{column_key}' that is not available for its targeted visuals. "
                    "Choose a column from the selected data source or add it to the visual."
                )

    candidate["layout"] = _normalize_layout(candidate.get("layout"), visuals)
    return candidate


def _row_matches_tank_filters(row: dict, visual: dict, slicers: list[dict] | None, params: dict, ignore_source_match: bool = True) -> bool:
    vid = str(visual.get("id") or "")
    runtime_values = params.get("runtime_values") or {}
    for slicer in slicers or []:
        if not isinstance(slicer, dict):
            continue
        targets = slicer.get("visual_ids") or []
        if targets and vid not in {str(t) for t in targets}:
            continue
        skey = str(slicer.get("key") or "")
        col_key = _slicer_column_key(slicer)
        if not skey or not col_key or col_key not in row:
            continue
        val = runtime_values.get(skey)
        if val is None or val == "" or val == []:
            continue
        stype = _canonical_slicer_type(slicer.get("type"))
        cell = row.get(col_key)
        if stype == "SELECT":
            expected = val if isinstance(val, list) else [val]
            expected_norm = {str(item).strip().casefold() for item in expected if item not in (None, "")}
            if expected_norm and str(cell or "").strip().casefold() not in expected_norm:
                return False
        elif stype == "TEXT":
            if str(val).strip().casefold() not in str(cell or "").casefold():
                return False
        elif stype in {"DATE_RANGE", "NUMBER_RANGE"}:
            if isinstance(val, dict):
                lower = val.get("from", val.get("date_from", val.get("min", val.get("start"))))
                upper = val.get("to", val.get("date_to", val.get("max", val.get("end"))))
            elif isinstance(val, (list, tuple)) and len(val) == 2:
                lower, upper = val[0], val[1]
            else:
                lower, upper = None, None
            if lower in (None, "") and upper in (None, ""):
                continue
            if cell is None:
                return False
            if stype == "NUMBER_RANGE":
                try:
                    cnum = float(cell)
                    if lower not in (None, "") and cnum < float(lower):
                        return False
                    if upper not in (None, "") and cnum > float(upper):
                        return False
                except (TypeError, ValueError):
                    return False
            else:
                cstr = str(cell)[:10]
                if lower not in (None, "") and cstr < str(lower)[:10]:
                    return False
                if upper not in (None, "") and cstr > str(upper)[:10]:
                    return False
        elif stype == "NUMBER":
            try:
                if float(cell) != float(val):
                    return False
            except (TypeError, ValueError):
                return False
        else:
            if str(cell or "").strip().casefold() != str(val).strip().casefold():
                return False

    selection_filters = params.get("selection_filters") or []
    if selection_filters and (not ignore_source_match or _as_bool((visual.get("interactions") or {}).get("crossFilter"), True)):
        for sel in selection_filters[:8]:
            if not isinstance(sel, dict):
                continue
            if ignore_source_match and sel.get("source_visual_id") and str(sel.get("source_visual_id")) == vid:
                continue
            col_key = str(sel.get("column_key") or "").strip()
            if not col_key or col_key not in row:
                continue
            val = sel.get("value")
            if val is None or val == "" or val == []:
                continue
            op = str(sel.get("operator") or "eq").lower()
            cell = row.get(col_key)
            if op == "in":
                expected = val if isinstance(val, list) else [val]
                expected_norm = {str(item).strip().casefold() for item in expected if item not in (None, "")}
                if expected_norm and str(cell or "").strip().casefold() not in expected_norm:
                    return False
            elif op == "between":
                lo, hi = val, sel.get("value2")
                if cell is None:
                    return False
                if lo not in (None, "") and str(cell) < str(lo):
                    return False
                if hi not in (None, "") and str(cell) > str(hi):
                    return False
            else:
                if str(cell or "").strip().casefold() != str(val).strip().casefold():
                    return False
    return True


def _snapshot_row_matches_fixed_filters(row: dict, visual: dict) -> bool:
    query = visual.get("query") if isinstance(visual.get("query"), dict) else {}
    filters = query.get("filters") or []
    if not isinstance(filters, list) or not filters:
        return True
    logic = str(query.get("filter_logic") or "AND").upper()
    results = []
    for flt in filters:
        if not isinstance(flt, dict):
            continue
        key = str(flt.get("column_key") or "").strip()
        op = str(flt.get("operator") or "eq").lower()
        if not key:
            continue
        cell = row.get(key)
        val = flt.get("value")
        val2 = flt.get("value2")
        if op == "is_blank":
            results.append(cell is None or str(cell).strip() == "")
            continue
        if op == "is_not_blank":
            results.append(not (cell is None or str(cell).strip() == ""))
            continue
        if val is None or val == "" or val == []:
            continue
        cell_str = "" if cell is None else str(cell)
        cell_norm = cell_str.strip().casefold()
        if op in {"eq", "ne"}:
            match = cell_norm == str(val).strip().casefold()
            results.append(match if op == "eq" else not match)
        elif op in {"contains", "not_contains"}:
            match = str(val).strip().casefold() in cell_norm
            results.append(match if op == "contains" else not match)
        elif op == "starts_with":
            results.append(cell_norm.startswith(str(val).strip().casefold()))
        elif op == "ends_with":
            results.append(cell_norm.endswith(str(val).strip().casefold()))
        elif op in {"in", "not_in"}:
            expected = val if isinstance(val, list) else [s.strip() for s in str(val).split(",")]
            expected_norm = {str(item).strip().casefold() for item in expected if str(item).strip() != ""}
            match = cell_norm in expected_norm
            results.append(match if op == "in" else not match)
        elif op == "between":
            if cell is None or val in (None, "") or val2 in (None, ""):
                results.append(False)
                continue
            try:
                cnum = float(cell)
                results.append(float(val) <= cnum <= float(val2))
            except (TypeError, ValueError):
                cstr = str(cell)
                results.append(str(val) <= cstr <= str(val2))
        else:
            try:
                cnum = float(cell)
                vnum = float(val)
                cmp = (cnum > vnum) - (cnum < vnum)
                op_map = {"gt": cmp > 0, "gte": cmp >= 0, "lt": cmp < 0, "lte": cmp <= 0}
                results.append(op_map.get(op, cell_norm == str(val).strip().casefold()))
            except (TypeError, ValueError):
                cstr = str(cell)
                vstr = str(val)
                cmp = (cstr > vstr) - (cstr < vstr)
                op_map = {"gt": cmp > 0, "gte": cmp >= 0, "lt": cmp < 0, "lte": cmp <= 0}
                results.append(op_map.get(op, cell_norm == str(val).strip().casefold()))
    if not results:
        return True
    return any(results) if logic == "OR" else all(results)


def _run_tank_snapshot_visual(db, user, visual: dict, params: dict, slicers: list[dict] | None = None, ignore_source_match: bool = True) -> dict:
    from app.dependencies.permissions import get_user_report_location_codes, normalize_location_code
    from app.models import (
        Asset,
        AssetCalibrationData,
        AssetCalibrationTable,
        CalibrationTemplateColumn,
        TankStockLedger,
    )
    from app.routers.tank_stock_ledger import (
        get_ledger_operation_datetime,
        hydrate_ledger_rows_from_payload,
    )

    scope = get_user_report_location_codes(user, db)
    requested_codes = [normalize_location_code(c) for c in (params.get("location_codes") or []) if c]
    if scope is not None:
        allowed_codes = [c for c in requested_codes if c in scope] if requested_codes else sorted(scope)
    else:
        allowed_codes = requested_codes

    aq = db.query(Asset).filter(Asset.status == "Active")
    if allowed_codes:
        aq = aq.filter(func.lower(func.trim(Asset.location_code)).in_(allowed_codes))
    elif scope is not None:
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}

    assets = aq.order_by(Asset.location_code.asc(), Asset.asset_code.asc()).limit(200).all()
    unit = str((visual.get("query") or {}).get("unit") or "nsv").lower()
    unit_label = {"nsv": "NSV (BBL)", "gsv": "GSV (BBL)", "lt": "Long Tons (LT)", "mt": "Metric Tons (MT)"}.get(unit, "NSV (BBL)")
    stock_attr = {"nsv": "stock_nsv_bbl", "gsv": "stock_gsv_bbl", "lt": "stock_lt", "mt": "stock_mt"}.get(unit, "stock_nsv_bbl")

    output_columns = [
        {"key": "tank_asset_code", "label": "Tank Code", "data_type": "text"},
        {"key": "tank_asset_name", "label": "Tank Name", "data_type": "text"},
        {"key": "location_code", "label": "Location", "data_type": "text"},
        {"key": "product_name", "label": "Product", "data_type": "text"},
        {"key": "current_stock", "label": f"Current Stock ({unit.upper()})", "data_type": "number", "format": {"decimals": 2}},
        {"key": "capacity", "label": "Max Capacity", "data_type": "number", "format": {"decimals": 2}},
        {"key": "ullage", "label": "Available Ullage", "data_type": "number", "format": {"decimals": 2}},
        {"key": "fill_pct", "label": "Fill %", "data_type": "number", "format": {"decimals": 1}},
        {"key": "accounting_date", "label": "Last Accounting Date", "data_type": "date"},
    ]
    if not assets:
        return {"columns": output_columns, "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0, "unit": unit_label}}

    asset_codes = [a.asset_code for a in assets]
    lq = db.query(TankStockLedger).filter(
        TankStockLedger.status == "Active",
        TankStockLedger.tank_asset_code.in_(asset_codes),
    )
    if allowed_codes:
        lq = lq.filter(func.lower(func.trim(TankStockLedger.location_code)).in_(allowed_codes))

    hydrated = hydrate_ledger_rows_from_payload(db, lq.all())
    date_to_raw = params.get("date_to")
    as_of_date = None
    if isinstance(date_to_raw, date):
        as_of_date = date_to_raw
    elif isinstance(date_to_raw, str) and date_to_raw.strip():
        try:
            as_of_date = date.fromisoformat(date_to_raw.strip())
        except ValueError:
            as_of_date = None
    if as_of_date:
        hydrated = [r for r in hydrated if r.accounting_date is not None and r.accounting_date <= as_of_date]

    latest_key: dict[str, tuple] = {}
    latest_row: dict[str, TankStockLedger] = {}
    for row in hydrated:
        sort_key = (get_ledger_operation_datetime(row) or datetime.min, row.id)
        prev = latest_key.get(row.tank_asset_code)
        if prev is None or sort_key >= prev:
            latest_key[row.tank_asset_code] = sort_key
            latest_row[row.tank_asset_code] = row

    def _safe_float(val):
        try:
            return float(val) if val is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    # Batch-load active calibration capacities for all candidate tanks (avoids N+1 queries)
    cap_by_asset: dict[str, float] = {}
    cal_tables = (
        db.query(AssetCalibrationTable)
        .filter(AssetCalibrationTable.asset_code.in_(asset_codes), AssetCalibrationTable.status == "Active")
        .order_by(AssetCalibrationTable.id.desc())
        .all()
    )
    if cal_tables:
        template_ids = list({tbl.template_id for tbl in cal_tables if tbl.template_id is not None})
        out_key_by_template: dict[int, str] = {}
        if template_ids:
            out_cols = (
                db.query(CalibrationTemplateColumn)
                .filter(
                    CalibrationTemplateColumn.template_id.in_(template_ids),
                    CalibrationTemplateColumn.interpolation_role == "Output",
                )
                .order_by(CalibrationTemplateColumn.sort_order.asc(), CalibrationTemplateColumn.id.asc())
                .all()
            )
            for col in out_cols:
                if col.template_id not in out_key_by_template:
                    cname = str(col.column_name or "").strip()
                    if cname:
                        out_key_by_template[col.template_id] = cname

        relevant_tables = [tbl for tbl in cal_tables if tbl.template_id in out_key_by_template]
        table_ids = [tbl.id for tbl in relevant_tables]
        max_by_table: dict[int, float] = {}
        if table_ids:
            out_key_by_table = {tbl.id: out_key_by_template[tbl.template_id] for tbl in relevant_tables}
            cal_rows = (
                db.query(AssetCalibrationData.calibration_table_id, AssetCalibrationData.row_data)
                .filter(AssetCalibrationData.calibration_table_id.in_(table_ids))
                .all()
            )
            for tbl_id, row_data in cal_rows:
                if not isinstance(row_data, dict):
                    continue
                val = _safe_float(row_data.get(out_key_by_table[tbl_id]))
                if val > max_by_table.get(tbl_id, 0.0):
                    max_by_table[tbl_id] = val
        for tbl in relevant_tables:
            if tbl.asset_code not in cap_by_asset:
                max_v = max_by_table.get(tbl.id, 0.0)
                if max_v > 0:
                    cap_by_asset[tbl.asset_code] = max_v

    rows = []
    total_stock = 0.0
    total_cap = 0.0
    for asset in assets:
        ledger = latest_row.get(asset.asset_code)
        cap = cap_by_asset.get(asset.asset_code, 0.0)
        if ledger is None and cap <= 0:
            continue
        stock_val = _safe_float(getattr(ledger, stock_attr, 0.0)) if ledger else 0.0
        nsv_val = _safe_float(getattr(ledger, "stock_nsv_bbl", 0.0)) if ledger else 0.0
        gsv_val = _safe_float(getattr(ledger, "stock_gsv_bbl", 0.0)) if ledger else 0.0
        lt_val = _safe_float(getattr(ledger, "stock_lt", 0.0)) if ledger else 0.0
        mt_val = _safe_float(getattr(ledger, "stock_mt", 0.0)) if ledger else 0.0
        ullage = max(0.0, cap - stock_val) if cap > 0 else 0.0
        fill_pct = round(min(100.0, max(0.0, (stock_val / cap) * 100.0)), 2) if cap > 0 else 0.0
        row_obj = {
            "tank_asset_code": asset.asset_code,
            "tank_asset_name": asset.asset_name or asset.asset_code,
            "location_code": asset.location_code,
            "product_name": (ledger.product_name if ledger and ledger.product_name else "Unassigned"),
            "current_stock": round(stock_val, 3),
            "stock_nsv_bbl": round(nsv_val, 3),
            "stock_gsv_bbl": round(gsv_val, 3),
            "stock_lt": round(lt_val, 3),
            "stock_mt": round(mt_val, 3),
            "capacity": round(cap, 3),
            "capacity_nsv_bbl": round(cap, 3),
            "capacity_gsv_bbl": round(cap, 3),
            "ullage": round(ullage, 3),
            "fill_pct": fill_pct,
            "accounting_date": str(ledger.accounting_date) if ledger and ledger.accounting_date else None,
        }
        if not _row_matches_tank_filters(row_obj, visual, slicers, params, ignore_source_match=ignore_source_match):
            continue
        if not _snapshot_row_matches_fixed_filters(row_obj, visual):
            continue
        total_stock += stock_val
        total_cap += cap
        rows.append(row_obj)

    totals = {
        "current_stock": round(total_stock, 3),
        "capacity": round(total_cap, 3),
        "ullage": round(max(0.0, total_cap - total_stock), 3),
        "fill_pct": round((total_stock / total_cap) * 100.0, 2) if total_cap > 0 else 0.0,
    }
    return {
        "columns": output_columns,
        "rows": rows,
        "totals": totals,
        "meta": {"warnings": [], "total_rows": len(rows), "unit": unit_label},
    }


def _run_material_balance_visual(db, visual: dict, params: dict) -> dict:
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
    rows = [row for row in rows if _snapshot_row_matches_fixed_filters(row, visual)]
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


def _tracking_status_columns() -> list[dict]:
    return [
        {"key": "tracking_module", "label": "Tracking Module", "data_type": "text"},
        {"key": "tracking_ref", "label": "Tracking Ref / Convoy", "data_type": "text"},
        {"key": "asset_code", "label": "Asset Code", "data_type": "text"},
        {"key": "asset_name", "label": "Asset Name", "data_type": "text"},
        {"key": "location_code", "label": "Location", "data_type": "text"},
        {"key": "from_location_code", "label": "From Location", "data_type": "text"},
        {"key": "to_location_code", "label": "To Location", "data_type": "text"},
        {"key": "current_status", "label": "Current Status", "data_type": "text"},
        {"key": "voyage_status", "label": "Voyage Status", "data_type": "text"},
        {"key": "last_event_type", "label": "Last Event Type", "data_type": "text"},
        {"key": "last_event_at", "label": "Last Event Date/Time", "data_type": "datetime"},
        {"key": "ticket_number", "label": "Last Ticket Number", "data_type": "text"},
        {"key": "product_name", "label": "Product", "data_type": "text"},
        {"key": "quantity_gsv_bbl", "label": "Last Qty GSV (BBL)", "data_type": "number", "format": {"decimals": 2}},
        {"key": "quantity_nsv_bbl", "label": "Last Qty NSV (BBL)", "data_type": "number", "format": {"decimals": 2}},
        {"key": "remarks", "label": "Remarks / Status Detail", "data_type": "text"},
    ]


def _norm_tracking_status(value) -> str:
    return str(value or "").strip().upper()


def _derive_barge_status(trip_status: str, last_event_type: str) -> str:
    trip_norm = _norm_tracking_status(trip_status)
    evt = _norm_tracking_status(last_event_type)
    if trip_norm == "CLOSED":
        return "CLOSED"
    if not evt:
        return "OPEN" if trip_norm == "OPEN" else (trip_norm or "UNKNOWN")
    if "UNLOAD" in evt or "DISCHARGE" in evt:
        return "UNLOADED"
    if "STS_OUT" in evt:
        return "IN_TRANSIT"
    if "STS_IN" in evt or "LOAD" in evt or "RECEIPT" in evt or "TOP_UP" in evt or "TOPUP" in evt:
        return "LOADED"
    return evt.replace("_", " ")


def _scope_allows_location(scope, location_code) -> bool:
    if scope is None:
        return True
    if not location_code:
        return False
    return _norm_tracking_status(location_code).lower() in scope


def _run_tracking_status_visual(db, user, visual: dict, params: dict, slicers: list[dict] | None = None, ignore_source_match: bool = True) -> dict:
    from app.dependencies.permissions import get_user_report_location_codes, normalize_location_code
    from app.models import Asset, FSOVoyage, OperationTransaction, ShuttleVoyage, TankerReceiptAcknowledgement, Trip, TripEvent

    scope = get_user_report_location_codes(user, db)
    query = visual.get("query") if isinstance(visual.get("query"), dict) else {}
    module_filter = str(query.get("tracking_module") or "ALL").upper().strip() or "ALL"
    if module_filter not in {"ALL", "BARGE", "SHUTTLE", "FSO", "TANKER"}:
        module_filter = "ALL"

    rows: list[dict] = []
    warnings: list[str] = []

    # ---- Barge / Trip tracking ----
    if module_filter in {"ALL", "BARGE"}:
        trips = db.query(Trip).order_by(Trip.updated_at.desc(), Trip.id.desc()).limit(500).all()
        trip_ids = [t.id for t in trips]
        events_by_trip: dict[int, list[TripEvent]] = {tid: [] for tid in trip_ids}
        if trip_ids:
            events = (
                db.query(TripEvent)
                .filter(TripEvent.trip_id.in_(trip_ids))
                .order_by(TripEvent.trip_id.asc(), TripEvent.sequence_no.asc(), TripEvent.event_datetime.asc(), TripEvent.id.asc())
                .all()
            )
            for evt in events:
                events_by_trip.setdefault(evt.trip_id, []).append(evt)

        tx_ids = sorted({evt.operation_transaction_id for evts in events_by_trip.values() for evt in evts if evt.operation_transaction_id})
        tx_by_id: dict[int, OperationTransaction] = {}
        if tx_ids:
            for tx in db.query(OperationTransaction).filter(OperationTransaction.id.in_(tx_ids)).all():
                tx_by_id[tx.id] = tx

        asset_codes = sorted({(t.primary_barge_asset_code or "").strip() for t in trips if (t.primary_barge_asset_code or "").strip()})
        asset_codes.update({(evt.asset_code or "").strip() for evts in events_by_trip.values() for evt in evts if (evt.asset_code or "").strip()})
        asset_name_by_code: dict[str, str] = {}
        if asset_codes:
            for asset in db.query(Asset).filter(Asset.asset_code.in_(list(asset_codes))).all():
                asset_name_by_code[str(asset.asset_code)] = asset.asset_name or asset.asset_code

        for trip in trips:
            trip_events = events_by_trip.get(trip.id, [])
            last_evt = trip_events[-1] if trip_events else None
            last_tx = tx_by_id.get(last_evt.operation_transaction_id) if last_evt and last_evt.operation_transaction_id else None
            event_locations = [normalize_location_code(evt.location_code) for evt in trip_events if evt.location_code]
            tx_locations = []
            for evt in trip_events:
                tx = tx_by_id.get(evt.operation_transaction_id)
                if tx:
                    for attr in ("origin_location_code", "destination_location_code", "sender_location_code", "receiver_location_code", "location_code"):
                        val = normalize_location_code(getattr(tx, attr, None))
                        if val:
                            tx_locations.append(val)
            scope_locations = [loc for loc in (event_locations + tx_locations) if loc]
            if scope is not None and not any(loc in scope for loc in scope_locations):
                continue

            asset_code = (last_evt.asset_code if last_evt and last_evt.asset_code else trip.primary_barge_asset_code) or ""
            from_loc = normalize_location_code(getattr(last_tx, "sender_location_code", None) or getattr(last_tx, "origin_location_code", None) or (trip_events[0].location_code if trip_events else None)) or ""
            to_loc = normalize_location_code(getattr(last_tx, "receiver_location_code", None) or getattr(last_tx, "destination_location_code", None) or (last_evt.location_code if last_evt else None)) or ""
            status = _derive_barge_status(trip.status, last_evt.event_type if last_evt else "")
            rows.append({
                "tracking_module": "BARGE",
                "tracking_ref": trip.convoy_number or "",
                "asset_code": asset_code,
                "asset_name": asset_name_by_code.get(asset_code, asset_code),
                "location_code": normalize_location_code(last_evt.location_code if last_evt and last_evt.location_code else (to_loc or from_loc)) or "",
                "from_location_code": from_loc,
                "to_location_code": to_loc,
                "current_status": status,
                "voyage_status": str(trip.status or "").upper(),
                "last_event_type": str(last_evt.event_type or "") if last_evt else "",
                "last_event_at": last_evt.event_datetime.isoformat() if last_evt and last_evt.event_datetime else (trip.updated_at.isoformat() if trip.updated_at else None),
                "ticket_number": getattr(last_tx, "ticket_number", None) or "",
                "product_name": getattr(last_tx, "product_name", None) or "",
                "quantity_gsv_bbl": float(getattr(last_tx, "movement_gsv_bbl", 0) or 0) if last_tx else 0.0,
                "quantity_nsv_bbl": float(getattr(last_tx, "movement_nsv_bbl", 0) or 0) if last_tx else 0.0,
                "remarks": trip.remarks or (last_evt.remarks if last_evt else "") or "",
            })

    # ---- Shuttle voyages ----
    if module_filter in {"ALL", "SHUTTLE"}:
        shuttle_q = db.query(ShuttleVoyage).order_by(ShuttleVoyage.updated_at.desc(), ShuttleVoyage.id.desc()).limit(500)
        for sv in shuttle_q.all():
            loc = normalize_location_code(sv.location_code)
            if scope is not None and loc not in scope:
                continue
            rows.append({
                "tracking_module": "SHUTTLE",
                "tracking_ref": sv.shuttle_number or "",
                "asset_code": sv.shuttle_asset_code or "",
                "asset_name": sv.shuttle_asset_code or "",
                "location_code": loc or "",
                "from_location_code": "",
                "to_location_code": loc or "",
                "current_status": "CLOSED" if _norm_tracking_status(sv.status) == "CLOSED" else "OPEN",
                "voyage_status": str(sv.status or "").upper(),
                "last_event_type": "SHUTTLE_VOYAGE",
                "last_event_at": sv.updated_at.isoformat() if sv.updated_at else (sv.created_at.isoformat() if sv.created_at else None),
                "ticket_number": "",
                "product_name": "",
                "quantity_gsv_bbl": 0.0,
                "quantity_nsv_bbl": 0.0,
                "remarks": sv.closure_remarks or sv.remarks or "",
            })

    # ---- FSO voyages ----
    if module_filter in {"ALL", "FSO"}:
        fso_q = db.query(FSOVoyage).order_by(FSOVoyage.updated_at.desc(), FSOVoyage.id.desc()).limit(500)
        for fv in fso_q.all():
            loc = normalize_location_code(fv.location_code)
            if scope is not None and loc not in scope:
                continue
            rows.append({
                "tracking_module": "FSO",
                "tracking_ref": fv.shuttle_number or "",
                "asset_code": fv.fso_asset_code or "",
                "asset_name": fv.fso_asset_code or "",
                "location_code": loc or "",
                "from_location_code": "",
                "to_location_code": loc or "",
                "current_status": "CLOSED" if _norm_tracking_status(fv.status) == "CLOSED" else "OPEN",
                "voyage_status": str(fv.status or "").upper(),
                "last_event_type": "FSO_VOYAGE",
                "last_event_at": fv.updated_at.isoformat() if fv.updated_at else (fv.created_at.isoformat() if fv.created_at else None),
                "ticket_number": "",
                "product_name": "",
                "quantity_gsv_bbl": 0.0,
                "quantity_nsv_bbl": 0.0,
                "remarks": fv.closure_remarks or fv.remarks or "",
            })

    # ---- Tanker receipt acknowledgements ----
    if module_filter in {"ALL", "TANKER"}:
        tanker_q = db.query(TankerReceiptAcknowledgement).order_by(TankerReceiptAcknowledgement.acknowledged_at.desc(), TankerReceiptAcknowledgement.id.desc()).limit(500)
        sender_ids = []
        tanker_rows = tanker_q.all()
        for tr in tanker_rows:
            if tr.sender_transaction_id:
                sender_ids.append(tr.sender_transaction_id)
        sender_tx_by_id = {}
        if sender_ids:
            for tx in db.query(OperationTransaction).filter(OperationTransaction.id.in_(sorted(set(sender_ids)))).all():
                sender_tx_by_id[tx.id] = tx
        for tr in tanker_rows:
            receiver_loc = normalize_location_code(tr.receiver_location_code)
            sender_tx = sender_tx_by_id.get(tr.sender_transaction_id)
            sender_loc = normalize_location_code(getattr(sender_tx, "sender_location_code", None) or getattr(sender_tx, "origin_location_code", None))
            dest_loc = normalize_location_code(getattr(sender_tx, "receiver_location_code", None) or getattr(sender_tx, "destination_location_code", None))
            scoped = [loc for loc in [receiver_loc, sender_loc, dest_loc] if loc]
            if scope is not None and not any(loc in scope for loc in scoped):
                continue
            rows.append({
                "tracking_module": "TANKER",
                "tracking_ref": tr.convoy_number or "",
                "asset_code": tr.tanker_asset_code or tr.prime_mover_asset_code or "",
                "asset_name": tr.tanker_asset_code or tr.prime_mover_asset_code or "",
                "location_code": receiver_loc or dest_loc or sender_loc or "",
                "from_location_code": sender_loc or "",
                "to_location_code": receiver_loc or dest_loc or "",
                "current_status": "ACKNOWLEDGED",
                "voyage_status": "RECEIVED",
                "last_event_type": "TANKER_RECEIPT_ACKNOWLEDGED",
                "last_event_at": tr.acknowledged_at.isoformat() if tr.acknowledged_at else None,
                "ticket_number": getattr(sender_tx, "ticket_number", "") if sender_tx else "",
                "product_name": getattr(sender_tx, "product_name", "") if sender_tx else "",
                "quantity_gsv_bbl": float(getattr(sender_tx, "movement_gsv_bbl", 0) or 0) if sender_tx else 0.0,
                "quantity_nsv_bbl": float(getattr(sender_tx, "movement_nsv_bbl", 0) or 0) if sender_tx else 0.0,
                "remarks": f"Acknowledged by {tr.acknowledged_by}" if tr.acknowledged_by else "",
            })

    # Apply fixed visual filters / slicers / cross-filters like other special sources
    filtered_rows = [r for r in rows if _row_matches_tank_filters(r, visual, slicers, params, ignore_source_match=ignore_source_match) and _snapshot_row_matches_fixed_filters(r, visual)]
    warnings.append("Tracking status is derived from the latest available tracking records in scope. Validate critical operational decisions against the source tracking module.")

    return {
        "columns": _tracking_status_columns(),
        "rows": filtered_rows[:1000],
        "totals": {},
        "meta": {"warnings": warnings, "total_rows": len(filtered_rows)},
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


def _inject_selection_filters(
    report_definition: dict,
    visual: dict,
    selection_filters: list | None,
    params: dict | None = None,
    ignore_source_match: bool = True,
) -> tuple[dict, dict]:
    updated_params = dict(params or {})
    updated_params["runtime_values"] = dict(updated_params.get("runtime_values") or {})
    if not selection_filters or not isinstance(selection_filters, list):
        return report_definition, updated_params
    if not _as_bool((visual.get("interactions") or {}).get("crossFilter"), True) and ignore_source_match:
        return report_definition, updated_params
    available_keys = {
        str(col.get("key"))
        for col in (report_definition.get("columns") or [])
        if isinstance(col, dict) and col.get("key")
    }
    extra_filters = []
    for sel in selection_filters[:8]:
        if not isinstance(sel, dict):
            continue
        if ignore_source_match and sel.get("source_visual_id") and str(sel.get("source_visual_id")) == str(visual.get("id")):
            continue
        col_key = str(sel.get("column_key") or "").strip()
        if not col_key or col_key not in available_keys:
            continue
        op = str(sel.get("operator") or "eq").lower()
        if op not in {"eq", "in", "between"}:
            op = "eq"
        val = sel.get("value")
        if val is None or val == "" or val == []:
            continue
        rule = {"column_key": col_key, "operator": op, "value": val}
        if op == "between" and sel.get("value2") is not None:
            rule["value2"] = sel.get("value2")
        extra_filters.append(rule)

    if not extra_filters:
        return report_definition, updated_params

    cloned = copy.deepcopy(report_definition)
    if cloned.get("filter_logic") == "OR" and cloned.get("filters"):
        # Preserve existing OR filters and add cross-filter as runtime filter so it intersects with AND.
        existing_rt = cloned.setdefault("runtime_filters", [])
        existing_rt_keys = {str(item.get("key") or "") for item in existing_rt}
        for index, ef in enumerate(extra_filters):
            if len(existing_rt) >= 12:
                break
            safe_col = re.sub(r"[^a-z0-9_]", "_", ef["column_key"].lower()).strip("_") or "col"
            rt_key = f"cf_{index}_{safe_col}"
            while rt_key in existing_rt_keys:
                rt_key = f"{rt_key}_x"
            existing_rt_keys.add(rt_key)
            if ef["operator"] == "in":
                rt_type = "select"
                rt_val = ef["value"] if isinstance(ef["value"], list) else [ef["value"]]
            elif ef["operator"] == "between":
                rt_type = "number_range" if isinstance(ef["value"], (int, float)) else "date_range"
                rt_val = {"from": ef["value"], "to": ef.get("value2")}
            else:
                rt_type = "text"
                rt_val = ef["value"]
            existing_rt.append({
                "key": rt_key,
                "label": ef["column_key"],
                "type": rt_type,
                "operator": ef["operator"],
                "column_key": ef["column_key"],
                "required": False,
            })
            updated_params["runtime_values"][rt_key] = rt_val
    else:
        cloned["filter_logic"] = "AND"
        cloned.setdefault("filters", []).extend(extra_filters)
    return cloned, updated_params


def run_visual(db, user, visual: dict, definition: dict, params: dict) -> dict:
    source = ((visual.get("query") or {}).get("source") or {})
    vtype = str(visual.get("type") or "").upper()
    if vtype == "TEXT":
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}
    if source.get("kind") == "material_balance":
        from app.dependencies.permissions import require_user_permission
        require_user_permission(user, "View Material Balance Report", db)
        return _strip_hidden_columns(_run_material_balance_visual(db, visual, params), visual)
    if source.get("kind") == "tank_snapshot" or (vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns"))):
        from app.dependencies.permissions import require_any_user_permission
        require_any_user_permission(user, ["View Analytics Dashboard", "View Tank Stock Ledger", "View Analytics Definition"], db)
        return _run_tank_snapshot_visual(db, user, visual, params, slicers=definition.get("slicers") or [], ignore_source_match=True)

    if source.get("kind") in TRACKING_STATUS_KINDS:
        return _run_tracking_status_visual(db, user, visual, params, slicers=definition.get("slicers") or [], ignore_source_match=True)

    report_definition = report_definition_for_visual(visual, definition.get("slicers") or [])
    report_definition["report_type"] = "MATRIX" if vtype == "MATRIX" and report_definition.get("matrix") else "TABULAR"
    report_definition, effective_params = _inject_selection_filters(
        report_definition, visual, params.get("selection_filters"), params=params, ignore_source_match=True
    )
    result = run_report(db, user, report_definition, effective_params)
    return _strip_hidden_columns(result, visual)


def run_visual_records(db, user, visual: dict, definition: dict, params: dict) -> dict:
    """Run the underlying ungrouped rows for 'Inspect Underlying Records' drill-down."""
    source = ((visual.get("query") or {}).get("source") or {})
    vtype = str(visual.get("type") or "").upper()
    if vtype == "TEXT":
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}
    if source.get("kind") == "material_balance":
        res = run_visual(db, user, visual, definition, params)
    elif source.get("kind") == "tank_snapshot" or (vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns"))):
        from app.dependencies.permissions import require_any_user_permission
        require_any_user_permission(user, ["View Analytics Dashboard", "View Tank Stock Ledger", "View Analytics Definition"], db)
        res = _run_tank_snapshot_visual(db, user, visual, params, slicers=definition.get("slicers") or [], ignore_source_match=False)
    elif source.get("kind") in TRACKING_STATUS_KINDS:
        res = _run_tracking_status_visual(db, user, visual, params, slicers=definition.get("slicers") or [], ignore_source_match=False)
    else:
        res = None
    if res is not None:
        rows = res.get("rows") or []
        search_q = str(params.get("search") or "").strip().casefold()
        if search_q:
            rows = [r for r in rows if any(search_q in str(v).casefold() for v in r.values() if v is not None)]
        res["rows"] = rows[:1000]
        res.setdefault("meta", {})["total_rows"] = len(rows)
        return res

    report_definition = report_definition_for_visual(visual, definition.get("slicers") or [])
    report_definition["report_type"] = "TABULAR"
    report_definition["group_by"] = []
    report_definition.pop("matrix", None)
    for col in report_definition.get("columns") or []:
        if isinstance(col, dict):
            col.pop("aggregate", None)
            col["hidden"] = False
    report_definition["options"] = {"show_totals": True, "page_size": 500}
    # For underlying records, ALSO apply selection filters even if clicked on the same visual!
    report_definition, run_params = _inject_selection_filters(
        report_definition, visual, params.get("selection_filters"), params=params, ignore_source_match=False
    )
    run_params["page_size"] = 500
    result = run_report(db, user, report_definition, run_params)
    search_q = str(params.get("search") or "").strip().casefold()
    if search_q:
        filtered = [
            r for r in (result.get("rows") or [])
            if any(search_q in str(v).casefold() for k, v in r.items() if not str(k).startswith("_") and v is not None)
        ]
        result["rows"] = filtered
        result.setdefault("meta", {})["total_rows"] = len(filtered)
    return result


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
        visual_params["selection_filters"] = list((params or {}).get("selection_filters") or [])
        query = visual.get("query") or {}
        if query.get("date_basis") == "NONE":
            visual_params.pop("date_from", None)
            visual_params.pop("date_to", None)
        result = run_visual(db, user, visual, normalized, visual_params)
        result.get("meta", {}).pop("_export_rows", None)
        results[visual["id"]] = result
    return {"results": results}


def export_dashboard_workbook_bytes(results_by_id: dict, visuals: list[dict], dashboard_name: str) -> bytes:
    """Export all data visuals of a dashboard into a single multi-sheet XLSX workbook."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    workbook = Workbook()
    default_sheet = workbook.active
    header_fill = PatternFill("solid", fgColor="0B2447")
    header_font = Font(bold=True, color="FFFFFF")
    used_titles: set[str] = set()
    sheets_written = 0

    for index, visual in enumerate(visuals):
        vid = str(visual.get("id") or f"visual_{index + 1}")
        if str(visual.get("type") or "").upper() == "TEXT":
            continue
        result = results_by_id.get(vid)
        if not result or not (result.get("columns") or []):
            continue
        header, body = _export_matrix_of(result)
        base_title = re.sub(r"[^A-Za-z0-9 _-]", "", str(visual.get("title") or vid)).strip()[:28] or f"Visual_{index + 1}"
        sheet_title = base_title
        suffix = 2
        while sheet_title.casefold() in used_titles:
            sheet_title = f"{base_title[:24]}_{suffix}"
            suffix += 1
        used_titles.add(sheet_title.casefold())

        sheet = default_sheet if sheets_written == 0 else workbook.create_sheet(title=sheet_title)
        sheet.title = sheet_title
        sheets_written += 1

        for col_index, label in enumerate(header, start=1):
            cell = sheet.cell(row=1, column=col_index, value=sanitize_spreadsheet_cell(label))
            cell.fill = header_fill
            cell.font = header_font
            sheet.column_dimensions[get_column_letter(col_index)].width = min(44, max(13, len(str(label)) + 4))
        for row_index, cells in enumerate(body, start=2):
            for col_index, value in enumerate(cells, start=1):
                sheet.cell(row=row_index, column=col_index, value=sanitize_spreadsheet_cell(value))
        sheet.freeze_panes = "A2"
        if header:
            sheet.auto_filter.ref = f"A1:{get_column_letter(len(header))}{max(1, len(body) + 1)}"

    if sheets_written == 0:
        default_sheet.title = (re.sub(r"[^A-Za-z0-9 _-]", "", dashboard_name or "Analytics")[:28] or "Analytics")
        default_sheet.cell(row=1, column=1, value="No tabular data visuals to export.")

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
