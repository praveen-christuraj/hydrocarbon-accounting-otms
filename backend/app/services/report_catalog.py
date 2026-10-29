"""Data catalog for the Report Builder.

Everything a non-technical user picks from is discovered from the live
SQLAlchemy metadata (every table / column), the Operation Template field
masters and — for JSON payloads — by sampling real saved values and
flattening them into pickable "JSON paths" that become report columns.

Safety rules
------------
* Security tables/columns (passwords, TOTP secrets, backup codes, tokens)
  are never listed and never extractable, even from a hand-crafted
  definition — the engine re-checks every reference against this catalog.
* Labels are plain English ("Movement NSV (BBL)") with the technical name
  kept alongside, so terminal staff never need to know a column name.
"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, Integer, Numeric, Time
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON
from sqlalchemy.orm import Session

from app.database import Base
from app.services.operation_datetime import coerce_payload_dict, parse_date_value

# Tables that must never be reportable (credentials / session internals).
DENIED_TABLES = {"token_blacklist", "auth_login_challenges"}

_SENSITIVE_RE = re.compile(
    r"(password|passwd|secret|totp|otp_secret|backup_code|api_key|private_key"
    r"|refresh_token|access_token|auth_token|passphrase|mfa_secret)",
    re.IGNORECASE,
)

# Friendly names for the busiest tables (everything else is humanised).
TABLE_LABELS = {
    "operation_transactions": "Operation Tickets (header)",
    "operation_transaction_values": "Operation Ticket Answers (field values)",
    "tank_stock_ledger": "Tank Stock Ledger",
    "vessel_stock_ledger": "Vessel Stock Ledger",
    "operation_types": "Operation Types",
    "operation_templates": "Operation Templates",
    "operation_template_fields": "Operation Template Fields",
    "tank_operations": "Tank Operations (location)",
    "vessel_operations": "Vessel Operations",
    "locations": "Locations",
    "assets": "Assets",
    "asset_types": "Asset Types",
    "asset_assignments": "Asset Assignments",
    "asset_calibration_tables": "Asset Calibration Tables",
    "asset_calibration_data": "Asset Calibration Data (chart rows)",
    "flowmeter_configs": "Flowmeter Configuration",
    "flowmeter_records": "Flowmeter Records",
    "trips": "Barge / Tanker Trips",
    "trip_events": "Trip Events",
    "trip_comparisons": "Trip Comparisons",
    "shuttle_voyages": "Shuttle Voyages",
    "fso_voyages": "FSO Voyages",
    "movement_mappings": "Movement Mappings",
    "movement_mapping_items": "Movement Mapping Items",
    "movement_mapping_comparisons": "Movement Mapping Comparisons",
    "export_transactions": "Export Transactions",
    "export_permits": "Export Permits",
    "material_balance_templates": "Material Balance Templates",
    "audit_logs": "Audit Logs",
    "users": "Users (no passwords)",
    "roles": "Roles",
}

TABLE_GROUPS = [
    ("Operations & Accounting", ["operation_transactions", "operation_transaction_values", "tank_stock_ledger", "vessel_stock_ledger", "flowmeter_records", "movement_mappings", "movement_mapping_items", "movement_mapping_comparisons"]),
    ("Tracking & Voyages", ["trips", "trip_events", "trip_comparisons", "shuttle_voyages", "fso_voyages", "tanker_receipt_acknowledgements"]),
    ("Masters — Locations & Assets", ["locations", "location_accounting_day_settings", "assets", "asset_types", "asset_assignments", "prime_mover_tanker_links", "asset_calibration_tables", "asset_calibration_data", "calibration_templates", "calibration_template_columns"]),
    ("Configuration Masters", ["operation_types", "operation_templates", "operation_template_fields", "tank_operations", "vessel_operations", "location_operation_availability", "material_balance_templates", "material_balance_template_columns", "flowmeter_configs", "flowmeter_config_history", "table11_factors", "company_report_profiles", "barge_seal_master", "tracking_module_configs", "out_turn_summary_configs"]),
    ("Export Operations", ["export_transactions", "export_permits", "export_locations", "export_entities", "export_blocks", "export_consignees", "export_configs", "export_location_entities", "export_entity_blocks", "export_permit_block_assignments"]),
    ("Users, Roles & Audit", ["users", "roles", "permissions", "role_permissions", "user_roles", "user_locations", "role_locations", "audit_logs", "system_notifications"]),
]

_ABBREVIATIONS = {
    "gsv": "GSV", "nsv": "NSV", "gov": "GOV", "bbl": "BBL", "lt": "LT", "mt": "MT",
    "api": "API", "bsw": "BS&W", "id": "ID", "json": "JSON", "fso": "FSO",
    "url": "URL", "ip": "IP", "2fa": "2FA", "mtr": "MTR", "vcf": "VCF", "wcf": "WCF",
}


def is_sensitive_column(column_name: str) -> bool:
    return bool(_SENSITIVE_RE.search(str(column_name or "")))


def humanize(name: str) -> str:
    """`movement_nsv_bbl` -> `Movement NSV BBL`; camelCase handled too."""
    text = str(name or "").strip()
    if not text:
        return ""
    # camelCase / PascalCase -> words (payload keys are camelCase)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text)
    text = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", text)
    words = []
    for part in re.split(r"[_\s]+", text):
        if not part:
            continue
        words.append(_ABBREVIATIONS.get(part.casefold(), part[:1].upper() + part[1:]))
    label = " ".join(words)
    label = label.replace(" Bbl", " (BBL)").replace("BBL)", "BBL)")
    return label


def _column_data_type(column) -> tuple[str, bool]:
    """(builder data type, is_json) for one SQLAlchemy column."""
    col_type = column.type
    if isinstance(col_type, (JSONB, JSON)):
        return "json", True
    if isinstance(col_type, (Integer, Float, Numeric)):
        return "number", False
    if isinstance(col_type, DateTime):
        return "datetime", False
    if isinstance(col_type, Date):
        return "date", False
    if isinstance(col_type, Time):
        return "time", False
    return "text", False


def table_group(table_name: str) -> str:
    for group, tables in TABLE_GROUPS:
        if table_name in tables:
            return group
    return "Other Tables"


# Virtual (derived) fields of the flattened Operation Tickets dataset.  The
# first four are the payload-first date/time every accounting report uses.
TICKET_VIRTUAL_FIELDS = [
    {"field": "payload_operation_date", "label": "Operation / Gauging Date (from ticket answers)", "data_type": "date", "group": "Dates (from ticket answers)", "help": "The gauging/operation date typed inside the ticket (payload). This is the date accounting reports use."},
    {"field": "payload_operation_time", "label": "Operation / Gauging Time (from ticket answers)", "data_type": "time", "group": "Dates (from ticket answers)", "help": "The gauging/operation time typed inside the ticket (payload)."},
    {"field": "payload_operation_datetime", "label": "Operation Date & Time (from ticket answers)", "data_type": "datetime", "group": "Dates (from ticket answers)", "help": "Payload date and time combined."},
    {"field": "accounting_date", "label": "Accounting Date (location accounting day)", "data_type": "date", "group": "Dates (from ticket answers)", "help": "Payload date/time converted with the origin location's Accounting Day Setting (e.g. 06:01–06:00)."},
    {"field": "operation_type_name", "label": "Operation Type Name", "data_type": "text", "group": "Names (looked up)", "help": "Full name of the operation type."},
    {"field": "operation_category", "label": "Operation Category (of the type)", "data_type": "text", "group": "Names (looked up)", "help": "Category of the operation type, e.g. Movement."},
    {"field": "template_name", "label": "Entry Form (Template) Name", "data_type": "text", "group": "Names (looked up)", "help": "Operation Template used to enter the ticket."},
    {"field": "origin_location_name", "label": "Origin Location Name", "data_type": "text", "group": "Names (looked up)", "help": ""},
    {"field": "destination_location_name", "label": "Destination Location Name", "data_type": "text", "group": "Names (looked up)", "help": ""},
    {"field": "sender_location_name", "label": "Sender Location Name", "data_type": "text", "group": "Names (looked up)", "help": ""},
    {"field": "receiver_location_name", "label": "Receiver Location Name", "data_type": "text", "group": "Names (looked up)", "help": ""},
    {"field": "primary_asset_name", "label": "Asset Name", "data_type": "text", "group": "Names (looked up)", "help": "Name of the ticket's main asset (tank / barge / tanker …)."},
]

LEDGER_VIRTUAL_FIELDS = [
    {"field": "tank_asset_name_lookup", "label": "Tank Name (looked up)", "data_type": "text", "group": "Names (looked up)", "help": "Asset Master name for the tank code, when the ledger row has no name."},
    {"field": "location_name_lookup", "label": "Location Name (looked up)", "data_type": "text", "group": "Names (looked up)", "help": ""},
]


def reportable_relationships(table_name: str) -> list[dict]:
    """Direct many-to-one foreign keys, never arbitrary or composite joins."""
    table = Base.metadata.tables.get(table_name)
    if table is None or table_name in DENIED_TABLES or table_name.startswith("report_"):
        return []
    result = []
    for constraint in table.foreign_key_constraints:
        if len(constraint.elements) != 1:
            continue
        fk = constraint.elements[0]
        try:
            target = fk.column
        except Exception:
            continue
        parent = target.table
        if parent is table or parent.name in DENIED_TABLES or parent.name.startswith("report_"):
            continue
        if is_sensitive_column(fk.parent.name) or is_sensitive_column(target.name):
            continue
        if not (target.primary_key and len(parent.primary_key.columns) == 1) and not target.unique:
            continue
        result.append({"local_column": fk.parent.name, "table": parent.name, "remote_column": target.name})
    return sorted(result, key=lambda r: (r["table"], r["local_column"]))


def build_catalog() -> dict:
    """Full pickable catalog: featured datasets + every reportable table."""
    tables = []
    for table_name in sorted(Base.metadata.tables):
        if table_name in DENIED_TABLES or table_name.startswith("report_"):
            continue
        table = Base.metadata.tables[table_name]
        columns = []
        for column in table.columns:
            if is_sensitive_column(column.name):
                continue
            data_type, is_json = _column_data_type(column)
            columns.append({
                "column": column.name,
                "label": humanize(column.name),
                "data_type": data_type,
                "is_json": is_json,
                "is_location": column.name == "location_code" or column.name.endswith("_location_code"),
                "is_date": data_type in ("date", "datetime"),
                "nullable": bool(column.nullable),
            })
        tables.append({
            "table": table_name,
            "label": TABLE_LABELS.get(table_name) or humanize(table_name),
            "group": table_group(table_name),
            "columns": columns,
            "json_columns": [c["column"] for c in columns if c["is_json"]],
            "location_columns": [c["column"] for c in columns if c["is_location"]],
            "date_columns": [c["column"] for c in columns if c["is_date"]],
            "relationships": reportable_relationships(table_name),
        })

    by_name = {t["table"]: t for t in tables}
    tickets = by_name.get("operation_transactions", {"columns": []})
    ledger = by_name.get("tank_stock_ledger", {"columns": []})

    datasets = [
        {
            "id": "operation_tickets",
            "kind": "operation_tickets",
            "name": "Operation Tickets — with all form answers & payloads split into columns",
            "description": (
                "Every operation ticket (Tank Gauging, Tanker, Barge / Multi-Tank, Flowmeter, "
                "FSO, Shuttle and standard forms) with its header, every answered field and every "
                "value inside its saved JSON payloads available as separate columns. Dates come "
                "from inside the ticket, exactly like the accounting reports."
            ),
            "icon": "clipboardList",
            "columns": tickets["columns"],
            "virtual_fields": TICKET_VIRTUAL_FIELDS,
            "supports_template_fields": True,
            "supports_payload_json": True,
            "default_date_basis": "ACCOUNTING_DATE",
        },
        {
            "id": "tank_stock_ledger",
            "kind": "tank_stock_ledger",
            "name": "Tank Stock Ledger — movements, stock snapshots & running balances",
            "description": (
                "The approved-ticket stock ledger: opening/closing stock, movements and running "
                "balances per tank with accounting dates. The ticket answers stored with each "
                "ledger row (source payload) can also be split into columns."
            ),
            "icon": "database",
            "columns": ledger["columns"],
            "virtual_fields": LEDGER_VIRTUAL_FIELDS,
            "supports_template_fields": False,
            "supports_payload_json": True,
            "default_date_basis": "ACCOUNTING_DATE",
        },
    ]
    return {"datasets": datasets, "tables": tables}


def get_table_catalog(table_name: str) -> dict | None:
    for entry in build_catalog()["tables"]:
        if entry["table"] == table_name:
            return entry
    return None


def allowed_columns(table_name: str) -> dict[str, dict]:
    entry = get_table_catalog(table_name)
    if not entry:
        return {}
    return {c["column"]: c for c in entry["columns"]}


# ---------------------------------------------------------------------------
# JSON flattening / path discovery ("split JSON into columns")
# ---------------------------------------------------------------------------

MAX_JSON_DEPTH = 8
MAX_JSON_PATHS = 400


def _scalar_type(value) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return "text"
        try:
            float(cleaned.replace(",", ""))
            return "number"
        except ValueError:
            pass
        if parse_date_value(cleaned) is not None:
            return "date"
        if re.match(r"^\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?$", cleaned):
            return "time"
        return "text"
    if isinstance(value, (date, datetime)):
        return "date"
    return "text"


def _flatten_into(value, prefix: str, out: list[tuple[str, object]], depth: int):
    if depth > MAX_JSON_DEPTH or len(out) >= MAX_JSON_PATHS:
        return
    if isinstance(value, dict):
        if not value:
            out.append((prefix, None))
            return
        for key in value:
            child_prefix = f"{prefix}.{key}" if prefix else str(key)
            _flatten_into(value[key], child_prefix, out, depth + 1)
        return
    if isinstance(value, list):
        if not value:
            out.append((prefix, None))
            return
        if all(isinstance(item, dict) for item in value):
            for item in value:
                _flatten_into(item, f"{prefix}[]", out, depth + 1)
            return
        # list of scalars (or mixed): one "joined" leaf
        out.append((prefix, value))
        return
    out.append((prefix, value))


def flatten_json(value) -> list[tuple[str, object]]:
    """Flatten one JSON value into ``(dot.path, scalar)`` leaves.

    Objects of objects keep concrete keys (``inputs.before.dips.T1.total``);
    arrays of objects use ``[]`` (``tanks[].nsvBbl``).
    """
    if isinstance(value, str):
        coerced = coerce_payload_dict(value)
        value = coerced if coerced else value
    if isinstance(value, (dict, list)):
        out: list[tuple[str, object]] = []
        _flatten_into(value, "", out, 0)
        return out
    return [("", value)]


def _wildcard_templates(concrete_paths: set[str], map_parents: set[str]) -> list[str]:
    """Suggest ``*`` templates for "map" objects such as per-tank dips.

    A parent qualifies when, in the samples, it is an object whose values are
    themselves objects (e.g. ``dips: {"T1": {...}, "T2": {...}}``).  For each
    leaf under such a parent we offer ``parent.*.leaf`` plus ``parent.@key``
    (the map key, e.g. the tank id) so the report can make one row per tank.
    """
    templates = set()
    for path in concrete_paths:
        segments = path.split(".")
        for index in range(1, len(segments)):
            parent = ".".join(segments[: index - 1]) if index > 1 else ""
            candidate_parent = ".".join(segments[:index])
            if candidate_parent in map_parents:
                rest = ".".join(segments[index + 1:]) if index + 1 < len(segments) else ""
                template = f"{candidate_parent}.*" + (f".{rest}" if rest else "")
                templates.add(template)
                templates.add(f"{candidate_parent}.@key")
            _ = parent
    return sorted(templates)


def _collect_map_parents(value, prefix: str, out: set[str], depth: int = 0):
    if depth > MAX_JSON_DEPTH or not isinstance(value, dict):
        if isinstance(value, list):
            for item in value:
                _collect_map_parents(item, f"{prefix}[]", out, depth + 1)
        return
    children = list(value.values())
    if prefix and children and all(isinstance(child, dict) for child in children) and len(children) >= 1:
        # Heuristic: keys look like codes/ids (not one of the structural words)
        keys = [str(k) for k in value.keys()]
        structural = {"inputs", "calculated", "meta", "before", "after", "net", "seals", "summary"}
        if not any(k.casefold() in structural for k in keys):
            out.add(prefix)
    for key, child in value.items():
        _collect_map_parents(child, f"{prefix}.{key}" if prefix else str(key), out, depth + 1)


def discover_json_paths(values: list, sample_count: int) -> dict:
    """Aggregate flattened paths over sampled JSON values.

    Returns pickable paths with occurrence counts, inferred types, example
    values and wildcard ("one row per item") templates.
    """
    counts: Counter[str] = Counter()
    types: dict[str, Counter] = defaultdict(Counter)
    examples: dict[str, list] = defaultdict(list)
    map_parents: set[str] = set()
    usable = 0

    for raw in values:
        value = raw
        if isinstance(value, str):
            coerced = coerce_payload_dict(value)
            if coerced:
                value = coerced
        if value is None:
            continue
        usable += 1
        if isinstance(value, (dict, list)):
            _collect_map_parents(value, "", map_parents)
        seen_in_row = set()
        for path, leaf in flatten_json(value):
            if not path:
                continue
            if path not in seen_in_row:
                counts[path] += 1
                seen_in_row.add(path)
            if isinstance(leaf, list):
                types[path]["list"] += 1
                example = ", ".join(str(item) for item in leaf[:4])
            else:
                types[path][_scalar_type(leaf)] += 1
                example = leaf
            if example is not None and str(example).strip() != "":
                bucket = examples[path]
                text = str(example)
                if text not in bucket and len(bucket) < 3:
                    bucket.append(text[:80])

    paths = []
    for path in sorted(counts):
        type_counts = types[path]
        inferred = type_counts.most_common(1)[0][0] if type_counts else "text"
        segments = [seg for seg in path.replace("[]", " item").split(".")]
        paths.append({
            "path": path,
            "label": " › ".join(humanize(seg) for seg in segments),
            "short_label": humanize(segments[-1]) if segments else path,
            "data_type": inferred,
            "present_in": counts[path],
            "examples": examples.get(path, []),
            "is_array_item": "[]" in path,
        })

    wildcard = []
    for template in _wildcard_templates(set(counts), map_parents):
        segments = template.split(".")
        is_key = template.endswith(".@key")
        wildcard.append({
            "path": template,
            "label": " › ".join(
                ("Item name / Tank ID" if seg == "@key" else "Each item" if seg == "*" else humanize(seg))
                for seg in segments
            ),
            "short_label": "Item / Tank ID" if is_key else humanize(segments[-1]),
            "data_type": "text" if is_key else "number",
            "present_in": usable,
            "examples": [],
            "is_wildcard": True,
        })

    return {
        "sampled_rows": sample_count,
        "rows_with_json": usable,
        "paths": paths,
        "wildcard_paths": wildcard,
    }


# ---------------------------------------------------------------------------
# Path extraction (used by the engine at run time)
# ---------------------------------------------------------------------------

def split_path(path: str) -> list[str]:
    """`a.b[].c` / `a.*.c` / `a.@key` -> segment list keeping [] and *."""
    segments: list[str] = []
    for part in str(path or "").split("."):
        if part.endswith("[]") and len(part) > 2:
            segments.append(part[:-2])
            segments.append("[]")
        elif part:
            segments.append(part)
    return segments


def explode_prefix_of(path: str) -> str | None:
    """Path up to & excluding the first wildcard segment, or None."""
    segments = split_path(path)
    for index, segment in enumerate(segments):
        if segment in ("*", "[]"):
            return ".".join(segments[:index])
    return None


def get_path(value, path: str):
    """Resolve a non-wildcard dot path inside a JSON value.

    ``[]`` without explosion collects every item's remainder and joins the
    scalar results; list-of-scalars leaves join with ``", "``.
    """
    if value is None:
        return None
    if isinstance(value, str):
        coerced = coerce_payload_dict(value)
        if coerced:
            value = coerced
        elif not path:
            return value
    segments = split_path(path)
    return _get_segments(value, segments)


def _get_segments(value, segments: list[str]):
    if not segments:
        if isinstance(value, list):
            parts = [str(item) for item in value if item is not None and not isinstance(item, (dict, list))]
            return ", ".join(parts) if parts else None
        if isinstance(value, dict):
            return None
        return value
    head, rest = segments[0], segments[1:]
    if head in ("*", "[]"):
        items = []
        if isinstance(value, dict):
            items = list(value.values())
        elif isinstance(value, list):
            items = value
        collected = []
        for item in items:
            resolved = _get_segments(item, rest)
            if resolved is not None:
                collected.append(resolved)
        if not collected:
            return None
        if len(collected) == 1:
            return collected[0]
        return " | ".join(str(item) for item in collected)
    if head == "@key":
        return None  # only meaningful while exploding
    if isinstance(value, dict):
        if head in value:
            return _get_segments(value[head], rest)
        # payloads appear in both nested (`inputs.gaugingDate`) and flattened
        # (`input_gaugingDate`) shapes — accept the flattened twin.
        return None
    if isinstance(value, list):
        if head.isdigit() and int(head) < len(value):
            return _get_segments(value[int(head)], rest)
        return None
    return None


def get_explode_items(value, prefix: str) -> list[tuple[str, object]]:
    """``[(key, item), …]`` for the collection at ``prefix`` (dict or list)."""
    # get_path() collapses object leaves to None, so walk to the raw node.
    target = _raw_at(value, split_path(prefix)) if prefix else value
    if isinstance(target, str):
        coerced = coerce_payload_dict(target)
        target = coerced if coerced else target
    if isinstance(target, dict):
        return [(str(key), target[key]) for key in sorted(target, key=lambda k: str(k))]
    if isinstance(target, list):
        return [(str(index), item) for index, item in enumerate(target)]
    return []


def _raw_at(value, segments: list[str]):
    current = value
    if isinstance(current, str):
        coerced = coerce_payload_dict(current)
        current = coerced if coerced else current
    for segment in segments:
        if isinstance(current, dict) and segment in current:
            current = current[segment]
        elif isinstance(current, list) and segment.isdigit() and int(segment) < len(current):
            current = current[int(segment)]
        else:
            return None
    return current


def resolve_wildcard(item_key: str, item, full_path: str, prefix: str):
    """Value of a wildcard path inside one exploded item."""
    segments = split_path(full_path)
    prefix_segments = split_path(prefix)
    remainder = segments[len(prefix_segments):]
    if remainder and remainder[0] in ("*", "[]"):
        remainder = remainder[1:]
    if remainder == ["@key"] or (len(remainder) == 1 and remainder[0] == "@key"):
        return item_key
    if remainder and remainder[-1] == "@key":
        return item_key
    return _get_segments(item, remainder)


# ---------------------------------------------------------------------------
# Operation template / ticket field discovery
# ---------------------------------------------------------------------------

def discover_operation_fields(
    db: Session,
    operation_type_codes: list[str] | None = None,
) -> dict:
    """Template fields + actually-saved ticket value fields, for the picker."""
    from app.models import (
        OperationTemplate,
        OperationTemplateField,
        OperationTransactionValue,
    )
    from sqlalchemy import func as sql_func

    templates_query = db.query(OperationTemplate).filter(OperationTemplate.status == "Active")
    codes = [c for c in (operation_type_codes or []) if str(c or "").strip()]
    if codes:
        templates_query = templates_query.filter(OperationTemplate.operation_type_code.in_(codes))
    templates = templates_query.order_by(OperationTemplate.template_name).all()
    template_ids = [t.id for t in templates]

    fields_by_template: dict[int, list] = defaultdict(list)
    if template_ids:
        field_rows = (
            db.query(OperationTemplateField)
            .filter(OperationTemplateField.template_id.in_(template_ids))
            .order_by(OperationTemplateField.sort_order, OperationTemplateField.id)
            .all()
        )
        for field in field_rows:
            fields_by_template[field.template_id].append(field)

    template_payloads = []
    for template in templates:
        fields = []
        for field in fields_by_template.get(template.id, []):
            data_type = str(field.data_type or "Text")
            is_payload = field.field_code.endswith("_payload") or data_type.upper() == "JSON"
            fields.append({
                "field_code": field.field_code,
                "field_name": field.field_name,
                "label": field.field_name or humanize(field.field_code),
                "field_group": field.field_group or "General",
                "data_type": "json" if is_payload else _template_data_type(data_type),
                "unit": field.unit,
                "input_mode": field.input_mode,
                "calculation_role": field.calculation_role,
                "is_payload": is_payload,
            })
        template_payloads.append({
            "id": template.id,
            "template_name": template.template_name,
            "operation_type_code": template.operation_type_code,
            "entry_layout_type": template.entry_layout_type,
            "fields": fields,
        })

    # Fields that actually occur in saved tickets (covers custom/legacy codes
    # that are no longer on an active template).
    saved_rows = (
        db.query(
            OperationTransactionValue.field_code,
            OperationTransactionValue.field_name,
            OperationTransactionValue.data_type,
            OperationTransactionValue.unit,
            sql_func.count(OperationTransactionValue.id),
        )
        .group_by(
            OperationTransactionValue.field_code,
            OperationTransactionValue.field_name,
            OperationTransactionValue.data_type,
            OperationTransactionValue.unit,
        )
        .order_by(OperationTransactionValue.field_code)
        .all()
    )
    saved_fields = []
    seen: set[tuple] = set()
    for field_code, field_name, data_type, unit, count in saved_rows:
        marker = (field_code, field_name)
        if marker in seen:
            continue
        seen.add(marker)
        is_payload = str(field_code).endswith("_payload") or str(data_type or "").upper() == "JSON"
        saved_fields.append({
            "field_code": field_code,
            "field_name": field_name,
            "label": field_name or humanize(field_code),
            "data_type": "json" if is_payload else _template_data_type(str(data_type or "Text")),
            "unit": unit,
            "saved_count": int(count or 0),
            "is_payload": is_payload,
        })

    return {"templates": template_payloads, "saved_fields": saved_fields}


def _template_data_type(data_type: str) -> str:
    lowered = data_type.casefold()
    if "number" in lowered or "decimal" in lowered or "float" in lowered or "int" in lowered:
        return "number"
    if "date" in lowered and "time" in lowered:
        return "datetime"
    if "date" in lowered:
        return "date"
    if "time" in lowered:
        return "time"
    if "bool" in lowered or "yes" in lowered:
        return "boolean"
    return "text"
