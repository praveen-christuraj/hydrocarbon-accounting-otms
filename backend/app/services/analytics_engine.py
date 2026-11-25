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
            "showLabels": _as_bool(chart.get("showLabels"), False),
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
            "bins": _clamp_int(plotly_cfg.get("bins"), 5, 100, 20),
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


def _is_special_source(visual: dict) -> bool:
    vtype = str(visual.get("type") or "").upper()
    if vtype == "TEXT":
        return True
    source_kind = (((visual.get("query") or {}).get("source") or {}).get("kind") or "")
    if source_kind in {"material_balance", "tank_snapshot"}:
        return True
    if vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns")):
        return True
    return False


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
        if isinstance(v, dict) and _is_special_source(v)
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
            raise ReportDefinitionError(
                f"Slicer '{slicer.get('label') or slicer.get('key')}' references field '{column_key}' that is not present in its targeted visuals. "
                "Add that field to the visual (or recreate the slicer) so it can be filtered."
            )

    candidate["layout"] = _normalize_layout(candidate.get("layout"), visuals)
    return candidate


def _run_tank_snapshot_visual(db, user, visual: dict, params: dict) -> dict:
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

    def _max_capacity(asset_code: str) -> float:
        tables = (
            db.query(AssetCalibrationTable)
            .filter(AssetCalibrationTable.asset_code == asset_code, AssetCalibrationTable.status == "Active")
            .order_by(AssetCalibrationTable.id.desc())
            .all()
        )
        for tbl in tables:
            out_cols = (
                db.query(CalibrationTemplateColumn)
                .filter(CalibrationTemplateColumn.template_id == tbl.template_id, CalibrationTemplateColumn.interpolation_role == "Output")
                .order_by(CalibrationTemplateColumn.sort_order.asc(), CalibrationTemplateColumn.id.asc())
                .all()
            )
            if not out_cols:
                continue
            out_key = str(out_cols[0].column_name or "").strip()
            if not out_key:
                continue
            cal_rows = db.query(AssetCalibrationData).filter(AssetCalibrationData.calibration_table_id == tbl.id).all()
            max_v = max((_safe_float((cr.row_data or {}).get(out_key)) for cr in cal_rows if isinstance(cr.row_data, dict)), default=0.0)
            if max_v > 0:
                return max_v
        return 0.0

    rows = []
    total_stock = 0.0
    total_cap = 0.0
    for asset in assets:
        ledger = latest_row.get(asset.asset_code)
        cap = _max_capacity(asset.asset_code)
        if ledger is None and cap <= 0:
            continue
        stock_val = _safe_float(getattr(ledger, stock_attr, 0.0)) if ledger else 0.0
        ullage = max(0.0, cap - stock_val) if cap > 0 else 0.0
        fill_pct = round(min(100.0, max(0.0, (stock_val / cap) * 100.0)), 2) if cap > 0 else 0.0
        total_stock += stock_val
        total_cap += cap
        rows.append({
            "tank_asset_code": asset.asset_code,
            "tank_asset_name": asset.asset_name or asset.asset_code,
            "location_code": asset.location_code,
            "product_name": (ledger.product_name if ledger and ledger.product_name else "Unassigned"),
            "current_stock": round(stock_val, 3),
            "capacity": round(cap, 3),
            "ullage": round(ullage, 3),
            "fill_pct": fill_pct,
            "accounting_date": str(ledger.accounting_date) if ledger and ledger.accounting_date else None,
        })

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


def _inject_selection_filters(report_definition: dict, visual: dict, selection_filters: list | None, ignore_source_match: bool = True) -> dict:
    if not selection_filters or not isinstance(selection_filters, list):
        return report_definition
    if not _as_bool((visual.get("interactions") or {}).get("crossFilter"), True) and ignore_source_match:
        return report_definition
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
        return report_definition

    cloned = copy.deepcopy(report_definition)
    if cloned.get("filter_logic") == "OR" and cloned.get("filters"):
        # Preserve existing OR filters and add cross-filter as runtime filter so it intersects with AND.
        for index, ef in enumerate(extra_filters):
            rt_key = f"__cf_{index}_{ef['column_key']}"
            cloned.setdefault("runtime_filters", []).append({
                "key": rt_key,
                "label": ef["column_key"],
                "type": "select" if ef["operator"] == "in" else "text",
                "column_key": ef["column_key"],
                "required": False,
            })
    else:
        cloned["filter_logic"] = "AND"
        cloned.setdefault("filters", []).extend(extra_filters)
    return cloned


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
        return _run_tank_snapshot_visual(db, user, visual, params)

    report_definition = report_definition_for_visual(visual, definition.get("slicers") or [])
    report_definition["report_type"] = "MATRIX" if vtype == "MATRIX" and report_definition.get("matrix") else "TABULAR"
    report_definition = _inject_selection_filters(report_definition, visual, params.get("selection_filters"), ignore_source_match=True)
    result = run_report(db, user, report_definition, params)
    return _strip_hidden_columns(result, visual)


def run_visual_records(db, user, visual: dict, definition: dict, params: dict) -> dict:
    """Run the underlying ungrouped rows for 'Inspect Underlying Records' drill-down."""
    source = ((visual.get("query") or {}).get("source") or {})
    vtype = str(visual.get("type") or "").upper()
    if vtype == "TEXT":
        return {"columns": [], "rows": [], "totals": {}, "meta": {"warnings": [], "total_rows": 0}}
    if source.get("kind") in {"material_balance", "tank_snapshot"} or (vtype == "TANK_VISUAL" and not ((visual.get("query") or {}).get("columns"))):
        res = run_visual(db, user, visual, definition, params)
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
    report_definition = _inject_selection_filters(report_definition, visual, params.get("selection_filters"), ignore_source_match=False)
    run_params = dict(params or {})
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
