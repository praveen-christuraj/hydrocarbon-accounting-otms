"""Report Builder execution engine.

Turns a saved report *definition* (plain JSON designed in the browser) into
rows, safely and reproducibly:

1. the definition is validated against the live catalog — every table,
   column, payload field and JSON path must be known and non-sensitive, so a
   hand-crafted definition cannot reach passwords or invent SQL;
2. base rows are loaded with SQLAlchemy (bound parameters only), already
   restricted to the runner's location scope;
3. JSON payloads are split into columns (dot paths, with optional
   "one row per item" explosion for per-tank maps / arrays);
4. calculated columns run through the Decimal formula engine in dependency
   order; per-cell errors (e.g. divide-by-zero) blank the cell and are
   counted in the result warnings instead of failing the report;
5. per-column comparison rules can blank only a matching measure (without
   dropping the source row), then fixed + runtime filters, grouping/aggregation
   or matrix pivoting, sorting, totals and pagination are applied in that order.

Definition schema (``schema_version: 1``) — see REPORT_BUILDER.md for the
full reference with examples.
"""

from __future__ import annotations

import csv
import io
import math
import re
import time as time_module
from collections import Counter, defaultdict
from datetime import date, datetime, time as datetime_time, timedelta
from decimal import Decimal, DecimalException

from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session

from app.database import Base
from app.dependencies.permissions import get_user_location_codes, normalize_location_code
from app.models import (
    Asset,
    ExportLocationEntity,
    Location,
    OperationTemplate,
    OperationTransaction,
    OperationTransactionValue,
    OperationType,
    User,
)
from app.services.operation_datetime import (
    PAYLOAD_FIELD_CODES,
    coerce_payload_dict,
    operation_parts_from_values,
    parse_date_value,
    resolve_accounting_date,
)
from app.services.report_catalog import (
    LEDGER_VIRTUAL_FIELDS,
    TICKET_VIRTUAL_FIELDS,
    allowed_columns,
    explode_prefix_of,
    get_explode_items,
    get_path,
    humanize,
    resolve_wildcard,
    reportable_relationships,
    split_path,
)
from app.services.report_formula import (
    FormulaError,
    is_blank,
    parse_formula,
    referenced_columns,
    to_decimal,
    to_json_value,
    evaluate as evaluate_formula,
    _compare as compare_values,
)

# Government Data / Book Stock tables carry entity_code instead of a single
# location_code. The generic table source applies the Export Operations
# location-to-entity mapping so a location-scoped report never leaks another
# entity's stock.
BOOK_STOCK_SCOPED_TABLES = {
    "book_stock_daily_entries",
    "book_stock_field_productions",
    "book_stock_fields",
}

SCAN_CAP = 50_000
EXPLODED_CAP = 100_000
EXPORT_CAP = 50_000
MAX_MATRIX_COLUMNS = 60
TIME_BUDGET_SECONDS = 25
MAX_COLUMNS = 60
MAX_TEXT_CELL = 2000
MAX_VALUE_CONDITIONS_PER_COLUMN = 20
MAX_VALUE_CONDITIONS = 100

COLUMN_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")
FIELD_CODE_RE = re.compile(r"^[A-Za-z0-9_]+$")
PATH_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_@*\- ]+$|^\[\]$|^[A-Za-z0-9_\- ]+\[\]$")

REPORT_TYPES = {"TABULAR", "MATRIX"}
SOURCE_KINDS = {"operation_tickets", "tank_stock_ledger", "table"}
DATE_BASES = {"PAYLOAD_OPERATION_DATE", "ACCOUNTING_DATE", "OPERATION_DATE", "CREATED_AT", "COLUMN", "NONE"}
AGGREGATES = {"SUM", "AVG", "COUNT", "MIN", "MAX", "PRODUCT", "FIRST", "LAST"}
BUCKETS = {"VALUE", "DAY", "WEEK", "MONTH", "QUARTER", "YEAR"}
FILTER_OPERATORS = {
    "eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains",
    "starts_with", "ends_with", "in", "not_in", "between", "is_blank", "is_not_blank",
}
RUNTIME_TYPES = {"location", "operation_type", "status", "asset", "text", "number", "date", "select"}
BUILTIN_RUNTIME_TYPES = {"location", "operation_type", "status", "asset"}


class ReportDefinitionError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Validation / normalisation
# ---------------------------------------------------------------------------

def _source_table_for(definition: dict) -> str:
    kind = definition.get("source", {}).get("kind") or definition.get("source_kind")
    if kind == "operation_tickets":
        return "operation_transactions"
    if kind == "tank_stock_ledger":
        return "tank_stock_ledger"
    return str(definition.get("source", {}).get("table") or "")


def _virtual_fields_for(kind: str) -> set[str]:
    if kind == "operation_tickets":
        return {f["field"] for f in TICKET_VIRTUAL_FIELDS}
    if kind == "tank_stock_ledger":
        return {f["field"] for f in LEDGER_VIRTUAL_FIELDS}
    return set()


def _validate_path(path: str, errors: list[str], owner: str):
    if not str(path or "").strip():
        errors.append(f"{owner}: JSON path is empty.")
        return
    if ".." in path or path.startswith(".") or path.endswith("."):
        errors.append(f"{owner}: JSON path '{path}' is not valid.")
        return
    for segment in split_path(path):
        cleaned = segment + ("[]" if segment == "[]" else "")
        probe = segment if segment != "[]" else "x[]"
        if not PATH_SEGMENT_RE.match(probe):
            errors.append(f"{owner}: JSON path segment '{segment}' contains unsupported characters.")
            return
        _ = cleaned


def _validate_source_spec(spec, kind: str, table_columns: dict, errors: list[str], owner: str, table_name=None):
    if not isinstance(spec, dict):
        errors.append(f"{owner}: data source is missing.")
        return
    spec_type = spec.get("type")
    if spec_type == "column":
        column = spec.get("column")
        if column not in table_columns:
            errors.append(f"{owner}: column '{column}' is not available for this data source.")
    elif spec_type == "related_column":
        relation = {"local_column": spec.get("local_column"), "table": spec.get("table"), "remote_column": spec.get("remote_column")}
        if kind != "table" or relation not in reportable_relationships(table_name) or spec.get("column") not in allowed_columns(spec.get("table")):
            errors.append(f"{owner}: related column or relationship is not available for this data source.")
    elif spec_type == "virtual":
        if spec.get("field") not in _virtual_fields_for(kind):
            errors.append(f"{owner}: field '{spec.get('field')}' is not available for this data source.")
    elif spec_type == "ticket_field":
        if kind != "operation_tickets":
            errors.append(f"{owner}: ticket answer fields only exist on Operation Tickets reports.")
        elif not FIELD_CODE_RE.match(str(spec.get("field_code") or "")):
            errors.append(f"{owner}: field code is not valid.")
    elif spec_type == "payload_path":
        if kind == "operation_tickets":
            if not FIELD_CODE_RE.match(str(spec.get("field_code") or "")):
                errors.append(f"{owner}: payload field code is not valid.")
        elif kind == "tank_stock_ledger":
            if spec.get("json_column") not in table_columns or not table_columns.get(spec.get("json_column"), {}).get("is_json"):
                errors.append(f"{owner}: '{spec.get('json_column')}' is not a JSON column of the ledger.")
        else:
            errors.append(f"{owner}: payload paths need the tickets or ledger data source (use a JSON column path).")
        _validate_path(spec.get("path"), errors, owner)
    elif spec_type == "json_path":
        json_column = spec.get("json_column")
        if json_column not in table_columns or not table_columns.get(json_column, {}).get("is_json"):
            errors.append(f"{owner}: '{json_column}' is not a JSON column of this table.")
        _validate_path(spec.get("path"), errors, owner)
    else:
        errors.append(f"{owner}: unknown data source type '{spec_type}'.")


def _json_ref_of(spec: dict) -> str | None:
    """Identity of the JSON document a path reads from (for explode checks)."""
    if not isinstance(spec, dict):
        return None
    if spec.get("type") == "payload_path":
        return f"payload:{spec.get('field_code') or spec.get('json_column')}"
    if spec.get("type") == "json_path":
        return f"json:{spec.get('json_column')}"
    return None


def _register_explode_ref(spec: dict, explode_refs: set[tuple[str, str]]):
    """Add a source's repeated-JSON section to the single-explosion check."""
    json_ref = _json_ref_of(spec)
    if not json_ref or not spec.get("path"):
        return
    prefix = explode_prefix_of(spec["path"])
    if prefix is None and str(spec["path"]).endswith(".@key"):
        prefix = str(spec["path"])[: -len(".@key")]
    if prefix is not None:
        explode_refs.add((json_ref, prefix))


def _value_condition_target(column_key: str, index: int) -> str:
    """Private extracted-cell key for one conditional-measure rule."""
    return f"__cv_{column_key}_{index}"


def _validate_value_conditions(column: dict, kind: str, table_columns: dict, errors: list[str], owner: str, explode_refs: set[tuple[str, str]], table_name=None):
    """Validate per-column conditions used to make conditional measures.

    Unlike report ``filters``, these rules never remove a source row. They only
    decide whether this one output column receives the row's source value.
    """
    conditions = column.get("value_conditions")
    if conditions is None:
        return
    if not isinstance(conditions, list):
        errors.append(f"{owner}: comparison rules must be a list.")
        return
    if len(conditions) > MAX_VALUE_CONDITIONS_PER_COLUMN:
        errors.append(f"{owner}: use at most {MAX_VALUE_CONDITIONS_PER_COLUMN} comparison rules.")
    logic = str(column.get("value_condition_logic") or "AND").upper()
    if logic not in {"AND", "OR"}:
        errors.append(f"{owner}: comparison rules must use ALL (AND) or ANY (OR).")
    else:
        column["value_condition_logic"] = logic
    for position, entry in enumerate(conditions):
        condition_owner = f"{owner} comparison rule {position + 1}"
        if not isinstance(entry, dict):
            errors.append(f"{condition_owner} is not valid.")
            continue
        if entry.get("operator") not in FILTER_OPERATORS:
            errors.append(f"{condition_owner}: choose a valid condition.")
        spec = entry.get("source")
        _validate_source_spec(spec, kind, table_columns, errors, condition_owner, table_name)
        if isinstance(spec, dict):
            _register_explode_ref(spec, explode_refs)


def validate_definition(definition) -> dict:
    """Validate + normalise a definition. Raises ReportDefinitionError."""
    if not isinstance(definition, dict):
        raise ReportDefinitionError("Report design must be an object.")
    errors: list[str] = []
    import copy as _copy

    definition = _copy.deepcopy(definition)
    definition.setdefault("schema_version", 1)
    if definition["schema_version"] != 1:
        errors.append("Unsupported report design version.")

    report_type = str(definition.get("report_type") or "TABULAR").upper()
    if report_type not in REPORT_TYPES:
        errors.append("Report type must be Tabular or Matrix.")
    definition["report_type"] = report_type

    source = dict(definition.get("source") or {})
    kind = source.get("kind") or definition.get("source_kind") or "operation_tickets"
    if kind not in SOURCE_KINDS:
        errors.append(f"Unknown data source '{kind}'.")
        kind = "operation_tickets"
    source["kind"] = kind
    if kind == "table":
        table_name = source.get("table")
        if not table_name or not allowed_columns(table_name):
            errors.append(f"Table '{table_name}' is not available for reporting.")
    definition["source"] = source
    table_name = _source_table_for(definition)
    table_columns = allowed_columns(table_name) if table_name else {}

    date_basis = str(definition.get("date_basis") or "ACCOUNTING_DATE").upper()
    if date_basis not in DATE_BASES:
        errors.append(f"Unknown date basis '{date_basis}'.")
    if date_basis == "COLUMN" and definition.get("date_column") not in table_columns:
        errors.append("Choose a valid date column for the date filter.")
    definition["date_basis"] = date_basis

    columns = definition.get("columns")
    if not isinstance(columns, list) or not columns:
        errors.append("Add at least one column to the report.")
        columns = []
    if len(columns) > MAX_COLUMNS:
        errors.append(f"A report can have at most {MAX_COLUMNS} columns.")

    keys: set[str] = set()
    explode_refs: set[tuple[str, str]] = set()
    parsed_formulas: dict[str, object] = {}
    value_condition_count = 0
    for index, column in enumerate(columns):
        if not isinstance(column, dict):
            errors.append(f"Column {index + 1} is not valid.")
            continue
        key = str(column.get("key") or "")
        owner = f"Column '{column.get('label') or key or index + 1}'"
        if not COLUMN_KEY_RE.match(key):
            errors.append(f"{owner}: column key '{key}' must start with a small letter and use only a–z, 0–9 and _.")
        elif key in keys:
            errors.append(f"{owner}: column key '{key}' is used twice.")
        keys.add(key)
        if not str(column.get("label") or "").strip():
            errors.append(f"{owner}: give the column a heading.")
        column_kind = column.get("kind") or "data"
        if column_kind == "calculated":
            if column.get("value_conditions") is not None:
                errors.append(f"{owner}: comparison rules can only be used on a saved data column, not a calculated column.")
            try:
                node = parse_formula(str(column.get("formula") or ""))
                parsed_formulas[key] = node
            except FormulaError as exc:
                errors.append(f"{owner}: formula error — {exc}")
        elif column_kind == "data":
            spec = column.get("source") or {}
            _validate_source_spec(spec, kind, table_columns, errors, owner, table_name)
            _register_explode_ref(spec, explode_refs)
            value_conditions = column.get("value_conditions")
            if isinstance(value_conditions, list):
                value_condition_count += len(value_conditions)
            _validate_value_conditions(column, kind, table_columns, errors, owner, explode_refs, table_name)
        else:
            errors.append(f"{owner}: unknown column kind '{column_kind}'.")
        aggregate = column.get("aggregate")
        if aggregate and str(aggregate).upper() not in AGGREGATES:
            errors.append(f"{owner}: unknown summary type '{aggregate}'.")

    if value_condition_count > MAX_VALUE_CONDITIONS:
        errors.append(f"A report can have at most {MAX_VALUE_CONDITIONS} comparison rules across all columns.")

    if len(explode_refs) > 1:
        errors.append(
            "Only one 'one row per item' JSON split can be used in a report "
            f"(found {len(explode_refs)}). Keep columns from a single repeated section."
        )

    # Formula references + cycle check
    for key, node in parsed_formulas.items():
        for ref in sorted(referenced_columns(node)):
            if ref not in keys:
                errors.append(f"Calculated column '{key}' uses unknown column [{ref}].")
    if parsed_formulas and not errors:
        try:
            _calculation_order(columns, parsed_formulas)
        except ReportDefinitionError as exc:
            errors.append(str(exc))

    filters = definition.get("filters") or []
    if len(filters) > 30:
        errors.append("Too many fixed filters (maximum 30).")
    for position, entry in enumerate(filters):
        owner = f"Filter {position + 1}"
        if not isinstance(entry, dict):
            errors.append(f"{owner} is not valid.")
            continue
        if entry.get("operator") not in FILTER_OPERATORS:
            errors.append(f"{owner}: choose a valid condition.")
        if entry.get("column_key"):
            if entry["column_key"] not in keys:
                errors.append(f"{owner}: column [{entry['column_key']}] does not exist.")
        elif entry.get("source"):
            _validate_source_spec(entry["source"], kind, table_columns, errors, owner, table_name)
        else:
            errors.append(f"{owner}: choose what to filter on.")

    runtime_filters = definition.get("runtime_filters") or []
    if len(runtime_filters) > 12:
        errors.append("Too many report-user filters (maximum 12).")
    runtime_keys: set[str] = set()
    for position, entry in enumerate(runtime_filters):
        owner = f"Report-user filter {position + 1}"
        if not isinstance(entry, dict):
            errors.append(f"{owner} is not valid.")
            continue
        rkey = str(entry.get("key") or "")
        if not COLUMN_KEY_RE.match(rkey) or rkey in runtime_keys:
            errors.append(f"{owner}: filter key is missing or duplicated.")
        runtime_keys.add(rkey)
        if entry.get("type") not in RUNTIME_TYPES:
            errors.append(f"{owner}: unknown filter type.")
        if entry.get("type") not in BUILTIN_RUNTIME_TYPES and entry.get("type") is not None:
            if entry.get("column_key") and entry["column_key"] not in keys:
                errors.append(f"{owner}: column [{entry['column_key']}] does not exist.")
            if entry.get("source"):
                _validate_source_spec(entry["source"], kind, table_columns, errors, owner, table_name)

    group_by = definition.get("group_by") or []
    group_keys = []
    for entry in group_by:
        gkey = entry.get("key") if isinstance(entry, dict) else entry
        bucket = (entry.get("bucket") if isinstance(entry, dict) else None) or "VALUE"
        if gkey not in keys:
            errors.append(f"Grouping uses unknown column [{gkey}].")
        if str(bucket).upper() not in BUCKETS:
            errors.append(f"Grouping period '{bucket}' is not valid.")
        group_keys.append(gkey)
    if group_keys and report_type == "TABULAR":
        for column in columns:
            if column.get("key") in group_keys:
                continue
            if not column.get("aggregate"):
                errors.append(
                    f"Column '{column.get('label')}' needs a summary (Total / Average / Count …) "
                    "because this report is grouped."
                )

    if report_type == "MATRIX":
        matrix = definition.get("matrix") or {}
        row_keys = matrix.get("row_keys") or []
        if not (1 <= len(row_keys) <= 3):
            errors.append("Matrix reports need 1 to 3 row headings.")
        for rkey in row_keys:
            kk = rkey.get("key") if isinstance(rkey, dict) else rkey
            if kk not in keys:
                errors.append(f"Matrix row heading [{kk}] does not exist.")
        if matrix.get("column_key") not in keys:
            errors.append("Choose an existing column for the matrix columns.")
        if matrix.get("value_key") not in keys:
            errors.append("Choose an existing column for the matrix values.")
        if str(matrix.get("aggregate") or "SUM").upper() not in {"SUM", "AVG", "COUNT", "MIN", "MAX", "PRODUCT"}:
            errors.append("Matrix values need a Total / Average / Count / Min / Max / Product summary.")
        if str(matrix.get("column_bucket") or "VALUE").upper() not in BUCKETS:
            errors.append("Matrix column period is not valid.")

    for entry in definition.get("sort") or []:
        skey = entry.get("key") if isinstance(entry, dict) else None
        if skey not in keys:
            errors.append(f"Sorting uses unknown column [{skey}].")

    if errors:
        raise ReportDefinitionError(" ".join(dict.fromkeys(errors)))
    definition["_parsed_formulas"] = parsed_formulas
    definition["_explode_ref"] = next(iter(explode_refs), None)
    return definition


def _calculation_order(columns: list[dict], parsed: dict) -> list[str]:
    """Topological order of calculated columns; raises on cycles."""
    calc_keys = [c["key"] for c in columns if (c.get("kind") or "data") == "calculated"]
    deps = {
        key: {ref for ref in referenced_columns(parsed[key]) if ref in parsed}
        for key in calc_keys
        if key in parsed
    }
    order: list[str] = []
    done: set[str] = set()
    visiting: list[str] = []

    def visit(key: str):
        if key in done:
            return
        if key in visiting:
            chain = " → ".join(visiting[visiting.index(key):] + [key])
            raise ReportDefinitionError(f"Calculated columns refer to each other in a circle: {chain}.")
        visiting.append(key)
        for dep in sorted(deps.get(key, ())):
            visit(dep)
        visiting.pop()
        done.add(key)
        order.append(key)

    for key in calc_keys:
        visit(key)
    return order


def public_definition(definition: dict) -> dict:
    """Definition safe to store/return (strips private parse artefacts)."""
    return {k: v for k, v in (definition or {}).items() if not k.startswith("_")}


# ---------------------------------------------------------------------------
# Extraction plan
# ---------------------------------------------------------------------------

def _extraction_plan(definition: dict) -> list[dict]:
    """[{target, spec}] for data columns + filter-only source references."""
    plan: list[dict] = []
    seen_targets: set[str] = set()
    for column in definition.get("columns") or []:
        if (column.get("kind") or "data") == "data":
            plan.append({"target": column["key"], "spec": column.get("source") or {}})
            seen_targets.add(column["key"])
            # A comparison condition reads its own source field privately. It
            # must be part of the plan even when Location / Operation Category
            # is not displayed as a report column.
            for index, condition in enumerate(column.get("value_conditions") or []):
                target = _value_condition_target(column["key"], index)
                if target not in seen_targets:
                    plan.append({"target": target, "spec": condition.get("source") or {}})
                    seen_targets.add(target)
    extras = list(definition.get("filters") or []) + list(definition.get("runtime_filters") or [])
    for index, entry in enumerate(extras):
        if entry.get("source"):
            target = entry.get("_target") or f"__f{index}"
            entry["_target"] = target
            if target not in seen_targets:
                plan.append({"target": target, "spec": entry["source"]})
                seen_targets.add(target)
    return plan


def _needed_from_plan(plan: list[dict]):
    plain: set[str] = set()
    virtuals: set[str] = set()
    ticket_fields: set[str] = set()
    json_refs: set[str] = set()
    for item in plan:
        spec = item["spec"]
        stype = spec.get("type")
        if stype == "column":
            plain.add(spec.get("column"))
        elif stype == "virtual":
            virtuals.add(spec.get("field"))
        elif stype == "ticket_field":
            ticket_fields.add(spec.get("field_code"))
        elif stype in ("payload_path", "json_path"):
            json_refs.add(_json_ref_of(spec))
            if stype == "payload_path" and spec.get("field_code"):
                ticket_fields.add(spec.get("field_code"))
    return plain, virtuals, ticket_fields, json_refs


# ---------------------------------------------------------------------------
# Row loading
# ---------------------------------------------------------------------------

def _requested_locations(db: Session, user: User, params: dict, definition: dict) -> tuple[set[str] | None, list[str]]:
    """(runner scope casefolded or None, effective requested codes upper)."""
    scope = get_user_location_codes(user, db)
    requested: list[str] = []
    for value in (params.get("location_codes") or []):
        if str(value or "").strip():
            requested.append(str(value).strip())
    runtime_values = params.get("runtime_values") or {}
    for entry in definition.get("runtime_filters") or []:
        if entry.get("type") == "location":
            value = runtime_values.get(entry.get("key"))
            if isinstance(value, list):
                requested.extend(str(v).strip() for v in value if str(v or "").strip())
            elif value:
                requested.append(str(value).strip())
    requested = list(dict.fromkeys(requested))
    if scope is not None:
        requested = [code for code in requested if normalize_location_code(code) in scope]
        if not requested:
            # No explicit (in-scope) choice: whole runner scope applies.
            requested = sorted(scope)
    return scope, requested


def _builtin_runtime(definition: dict, params: dict, runtime_type: str):
    runtime_values = params.get("runtime_values") or {}
    for entry in definition.get("runtime_filters") or []:
        if entry.get("type") == runtime_type:
            return runtime_values.get(entry.get("key"))
    return None


def _as_list(value) -> list:
    if value is None or value == "":
        return []
    return value if isinstance(value, list) else [value]


def _load_ticket_rows(db, user, definition, params, plan, warnings):
    source = definition.get("source") or {}
    plain_needed, virtuals_needed, ticket_fields_needed, _ = _needed_from_plan(plan)
    scope, effective_locations = _requested_locations(db, user, params, definition)
    if scope is not None and not effective_locations:
        return []

    query = db.query(OperationTransaction)
    type_codes = [c for c in (source.get("operation_type_codes") or []) if str(c or "").strip()]
    runtime_types = [str(v) for v in _as_list(_builtin_runtime(definition, params, "operation_type"))]
    if runtime_types:
        # The runtime question can only narrow the designer's fixed set; an
        # empty intersection must return no rows (never "everything").
        type_codes = [c for c in type_codes if c in runtime_types] if type_codes else runtime_types
        if not type_codes:
            return []
    if type_codes:
        query = query.filter(OperationTransaction.operation_type_code.in_(type_codes))
    template_ids = [int(t) for t in (source.get("template_ids") or []) if str(t).strip().isdigit()]
    if template_ids:
        query = query.filter(OperationTransaction.operation_template_id.in_(template_ids))
    statuses = [s for s in (source.get("statuses") or []) if str(s or "").strip()]
    runtime_status = [str(v) for v in _as_list(_builtin_runtime(definition, params, "status"))]
    if runtime_status:
        # Same narrowing rule as operation types: a report fixed to Approved
        # tickets cannot be widened to Drafts by the runtime question.
        statuses = [s for s in statuses if s in runtime_status] if statuses else runtime_status
        if not statuses:
            return []
    if statuses:
        query = query.filter(OperationTransaction.status.in_(statuses))
    runtime_assets = [str(v) for v in _as_list(_builtin_runtime(definition, params, "asset"))]
    if runtime_assets:
        query = query.filter(OperationTransaction.primary_asset_code.in_(runtime_assets))
    if effective_locations:
        upper_codes = [code.upper() for code in effective_locations]
        query = query.filter(or_(
            func.upper(OperationTransaction.origin_location_code).in_(upper_codes),
            func.upper(OperationTransaction.destination_location_code).in_(upper_codes),
            func.upper(OperationTransaction.sender_location_code).in_(upper_codes),
            func.upper(OperationTransaction.receiver_location_code).in_(upper_codes),
        ))

    transactions = (
        query.order_by(OperationTransaction.operation_date, OperationTransaction.id)
        .limit(SCAN_CAP + 1)
        .all()
    )
    truncated = len(transactions) > SCAN_CAP
    transactions = transactions[:SCAN_CAP]
    if truncated:
        warnings.append(f"More than {SCAN_CAP:,} tickets matched; only the first {SCAN_CAP:,} were read. Narrow the dates or filters for a complete report.")
    tx_ids = [tx.id for tx in transactions]

    # Ticket answer values (only the fields this report needs + payloads for dates)
    value_codes = set(ticket_fields_needed) | set(PAYLOAD_FIELD_CODES)
    values_map: dict[int, list[OperationTransactionValue]] = defaultdict(list)
    field_map: dict[int, dict[str, object]] = defaultdict(dict)
    if tx_ids and value_codes:
        value_rows = (
            db.query(OperationTransactionValue)
            .filter(
                OperationTransactionValue.transaction_id.in_(tx_ids),
                OperationTransactionValue.field_code.in_(sorted(value_codes)),
            )
            .all()
        )
        for row in value_rows:
            values_map[row.transaction_id].append(row)
            field_map[row.transaction_id][row.field_code] = row.field_value

    name_virtuals = {
        "operation_type_name", "operation_category", "template_name",
        "origin_location_name", "destination_location_name",
        "sender_location_name", "receiver_location_name", "primary_asset_name",
    }
    locations_by_code, assets_by_code, types_by_code, templates_by_id = {}, {}, {}, {}
    if virtuals_needed & name_virtuals:
        locations_by_code = {loc.location_code: loc.location_name for loc in db.query(Location).all()}
        assets_by_code = {a.asset_code: a.asset_name for a in db.query(Asset).all()}
        types_by_code = {t.operation_type_code: t for t in db.query(OperationType).all()}
        templates_by_id = {t.id: t.template_name for t in db.query(OperationTemplate).all()}

    date_basis = definition.get("date_basis") or "ACCOUNTING_DATE"
    setting_cache: dict = {}
    allowed_scope = scope  # casefolded set or None
    contexts = []
    for tx in transactions:
        if allowed_scope is not None:
            party = {
                normalize_location_code(code)
                for code in (tx.origin_location_code, tx.destination_location_code, tx.sender_location_code, tx.receiver_location_code)
                if code
            }
            if not (party & allowed_scope):
                continue
        values = values_map.get(tx.id, [])
        op_date, op_time = operation_parts_from_values(values)
        if op_date is None:
            op_date = tx.operation_start_datetime.date() if tx.operation_start_datetime else tx.operation_date
            if op_time is None and tx.operation_start_datetime:
                op_time = tx.operation_start_datetime.time().replace(tzinfo=None)
        accounting = resolve_accounting_date(db, tx.origin_location_code, op_date, op_time, setting_cache=setting_cache)
        op_datetime = datetime.combine(op_date, op_time or datetime_time(0, 0)) if op_date else None
        type_row = types_by_code.get(tx.operation_type_code)
        virtuals = {
            "payload_operation_date": op_date,
            "payload_operation_time": op_time.strftime("%H:%M") if op_time else None,
            "payload_operation_datetime": op_datetime,
            "accounting_date": accounting,
            "operation_type_name": getattr(type_row, "operation_type_name", None),
            "operation_category": getattr(type_row, "operation_category", None),
            "template_name": templates_by_id.get(tx.operation_template_id),
            "origin_location_name": locations_by_code.get(tx.origin_location_code),
            "destination_location_name": locations_by_code.get(tx.destination_location_code),
            "sender_location_name": locations_by_code.get(tx.sender_location_code),
            "receiver_location_name": locations_by_code.get(tx.receiver_location_code),
            "primary_asset_name": assets_by_code.get(tx.primary_asset_code),
        }
        if date_basis == "PAYLOAD_OPERATION_DATE":
            row_date = op_date
        elif date_basis == "ACCOUNTING_DATE":
            row_date = accounting
        elif date_basis == "CREATED_AT":
            row_date = tx.created_at.date() if tx.created_at else None
        elif date_basis == "COLUMN":
            raw = getattr(tx, definition.get("date_column") or "operation_date", None)
            row_date = raw.date() if isinstance(raw, datetime) else raw
        elif date_basis == "NONE":
            row_date = None
        else:  # OPERATION_DATE
            row_date = tx.operation_date
        contexts.append({
            "plain": {col: getattr(tx, col, None) for col in plain_needed if col},
            "virtuals": virtuals,
            "ticket_fields": field_map.get(tx.id, {}),
            "json": {},
            "row_date": row_date,
        })
    return contexts


def _book_stock_entity_codes(db, scope) -> list[str]:
    """Entity codes linked to the given location scope (Export Operations)."""
    if scope is None:
        return []
    rows = (
        db.query(ExportLocationEntity.entity_code)
        .filter(
            func.lower(func.trim(ExportLocationEntity.location_code)).in_(
                [normalize_location_code(code) for code in scope if normalize_location_code(code)]
            ),
            func.lower(func.trim(ExportLocationEntity.status)) == "active",
        )
        .all()
    )
    return [str(code).strip() for (code,) in rows if str(code or "").strip()]


def _load_table_rows(db, user, definition, params, plan, warnings, table_name):
    plain_needed, virtuals_needed, _, _ = _needed_from_plan(plan)
    table = Base.metadata.tables[table_name]
    columns_meta = allowed_columns(table_name)
    json_columns_needed = {
        item["spec"].get("json_column")
        for item in plan
        if item["spec"].get("type") in ("json_path", "payload_path") and item["spec"].get("json_column")
    }
    select_names = [name for name in (plain_needed | json_columns_needed) if name in columns_meta]
    date_basis = definition.get("date_basis") or "ACCOUNTING_DATE"
    date_column = _table_date_column(definition, table_name, columns_meta)
    if date_column and date_column not in select_names:
        select_names.append(date_column)
    location_columns = [name for name, meta in columns_meta.items() if meta.get("is_location")]
    for name in location_columns:
        if name not in select_names:
            select_names.append(name)

    scope, effective_locations = _requested_locations(db, user, params, definition)
    book_stock_scope = table_name in BOOK_STOCK_SCOPED_TABLES and scope is not None
    allowed_entities: list[str] = []
    if book_stock_scope and "entity_code" in columns_meta:
        allowed_entities = _book_stock_entity_codes(db, scope)
        if "entity_code" not in select_names:
            select_names.append("entity_code")
    if not select_names:
        select_names = list(columns_meta)[:1]
    related_specs = [item for item in plan if item["spec"].get("type") == "related_column"]
    related_selects = []
    for index, item in enumerate(related_specs):
        spec = item["spec"]
        parent = Base.metadata.tables[spec["table"]].alias(f"related_{index}")
        subquery = select(parent.c[spec["column"]]).where(parent.c[spec["remote_column"]] == table.c[spec["local_column"]])
        parent_locations = [name for name, meta in allowed_columns(spec["table"]).items() if meta.get("is_location")]
        if scope is not None and parent_locations:
            subquery = subquery.where(or_(*[func.upper(parent.c[name]).in_([code.upper() for code in scope]) for name in parent_locations]))
        related_selects.append(subquery.correlate(table).scalar_subquery().label(f"__related_{index}"))
    stmt = select(*[table.c[name] for name in select_names], *related_selects)
    if location_columns and (effective_locations or scope is not None):
        upper_codes = [code.upper() for code in effective_locations]
        stmt = stmt.where(or_(*[func.upper(table.c[name]).in_(upper_codes) for name in location_columns]))
    if book_stock_scope and "entity_code" in columns_meta:
        if not allowed_entities:
            stmt = stmt.where(false())
        else:
            stmt = stmt.where(func.upper(table.c["entity_code"]).in_([item.upper() for item in allowed_entities]))
    runtime_status = [str(v) for v in _as_list(_builtin_runtime(definition, params, "status"))]
    if runtime_status and "status" in columns_meta:
        stmt = stmt.where(table.c["status"].in_(runtime_status))
    if date_column and params.get("date_from") and params.get("date_to"):
        stmt = stmt.where(
            func.date(table.c[date_column]) >= params["date_from"],
            func.date(table.c[date_column]) <= params["date_to"],
        )
    if "id" in table.c:
        stmt = stmt.order_by(table.c["id"])
    stmt = stmt.limit(SCAN_CAP + 1)
    result_rows = db.execute(stmt).mappings().all()
    if len(result_rows) > SCAN_CAP:
        warnings.append(f"More than {SCAN_CAP:,} rows matched; only the first {SCAN_CAP:,} were read. Narrow the dates or filters for a complete report.")
        result_rows = result_rows[:SCAN_CAP]

    locations_by_code, assets_by_code = {}, {}
    if virtuals_needed:
        locations_by_code = {loc.location_code: loc.location_name for loc in db.query(Location).all()}
        assets_by_code = {a.asset_code: a.asset_name for a in db.query(Asset).all()}

    contexts = []
    for mapping in result_rows:
        plain = {name: mapping.get(name) for name in select_names}
        # Python-side scope re-check (case-insensitive, defence in depth)
        if scope is not None and location_columns:
            codes = {normalize_location_code(plain.get(name)) for name in location_columns if plain.get(name)}
            if codes and not (codes & scope):
                continue
        if book_stock_scope:
            if normalize_location_code(plain.get("entity_code")) not in {
                normalize_location_code(item) for item in allowed_entities
            }:
                continue
        virtuals = {
            "tank_asset_name_lookup": plain.get("tank_asset_name") or assets_by_code.get(plain.get("tank_asset_code")),
            "location_name_lookup": locations_by_code.get(plain.get("location_code")),
        }
        row_date = None
        if date_column:
            raw = plain.get(date_column)
            row_date = raw.date() if isinstance(raw, datetime) else raw
            if isinstance(row_date, str):
                row_date = parse_date_value(row_date)
        contexts.append({
            "plain": plain,
            "related": {item["target"]: mapping.get(f"__related_{index}") for index, item in enumerate(related_specs)},
            "virtuals": virtuals,
            "ticket_fields": {},
            "json": {name: plain.get(name) for name in json_columns_needed},
            "row_date": row_date,
        })
    _ = date_basis
    return contexts


def _table_date_column(definition, table_name, columns_meta):
    basis = definition.get("date_basis") or "ACCOUNTING_DATE"
    if basis == "NONE":
        return None
    if basis == "COLUMN":
        candidate = definition.get("date_column")
        return candidate if candidate in columns_meta else None
    if basis == "CREATED_AT":
        return "created_at" if "created_at" in columns_meta else None
    if table_name == "tank_stock_ledger":
        if basis == "ACCOUNTING_DATE" and "accounting_date" in columns_meta:
            return "accounting_date"
        return "operation_date" if "operation_date" in columns_meta else None
    for candidate in ("operation_date", "accounting_date", "date", "created_at"):
        if candidate in columns_meta and columns_meta[candidate].get("is_date"):
            return candidate
    dates = [name for name, meta in columns_meta.items() if meta.get("is_date")]
    return dates[0] if dates else None


# ---------------------------------------------------------------------------
# Extraction (+ JSON explosion)
# ---------------------------------------------------------------------------

def _json_document(context, spec, kind):
    if spec.get("type") == "payload_path":
        if kind == "operation_tickets":
            return context["ticket_fields"].get(spec.get("field_code"))
        return context["json"].get(spec.get("json_column"))
    if spec.get("type") == "json_path":
        return context["json"].get(spec.get("json_column"))
    return None


def _extract_value(context, spec, kind, target=None):
    stype = spec.get("type")
    if stype == "related_column":
        return context.get("related", {}).get(target)
    if stype == "column":
        return context["plain"].get(spec.get("column"))
    if stype == "virtual":
        return context["virtuals"].get(spec.get("field"))
    if stype == "ticket_field":
        value = context["ticket_fields"].get(spec.get("field_code"))
        if isinstance(value, (dict, list)):
            return value  # serialised later; payload_path is the split route
        return value
    if stype in ("payload_path", "json_path"):
        return get_path(_json_document(context, spec, kind), spec.get("path") or "")
    return None


def _extract_rows(contexts, definition, plan, warnings):
    kind = (definition.get("source") or {}).get("kind")
    explode_ref = definition.get("_explode_ref")  # (json_ref, prefix) or None
    keep_empty = bool((definition.get("options") or {}).get("explode_keep_empty_rows"))
    rows: list[dict] = []
    dropped_empty = 0
    for context in contexts:
        if not explode_ref:
            row = {item["target"]: _extract_value(context, item["spec"], kind, item["target"]) for item in plan}
            _apply_value_conditions(row, definition)
            row["__date"] = context["row_date"]
            rows.append(row)
            continue
        json_ref, prefix = explode_ref
        explode_spec = next(item["spec"] for item in plan if _json_ref_of(item["spec"]) == json_ref)
        document = _json_document(context, explode_spec, kind)
        items = get_explode_items(document, prefix)
        if not items:
            dropped_empty += 1
            if not keep_empty:
                continue
            items = [(None, None)]
        for item_key, item_value in items:
            row = {}
            for plan_item in plan:
                spec = plan_item["spec"]
                spec_path = spec.get("path") or ""
                belongs_to_explode = explode_prefix_of(spec_path) == prefix or spec_path == f"{prefix}.@key"
                if _json_ref_of(spec) == json_ref and belongs_to_explode:
                    row[plan_item["target"]] = (
                        resolve_wildcard(item_key, item_value, spec.get("path") or "", prefix)
                        if item_value is not None or (spec.get("path") or "").endswith("@key")
                        else None
                    )
                else:
                    row[plan_item["target"]] = _extract_value(context, spec, kind, plan_item["target"])
            _apply_value_conditions(row, definition)
            row["__date"] = context["row_date"]
            rows.append(row)
            if len(rows) > EXPLODED_CAP:
                warnings.append(f"The 'one row per item' split produced more than {EXPLODED_CAP:,} rows and was stopped. Narrow the dates or filters.")
                return rows, dropped_empty
    return rows, dropped_empty


# ---------------------------------------------------------------------------
# Filters / calculations / grouping / matrix
# ---------------------------------------------------------------------------

def _apply_operator(operator: str, value, expected, expected2=None) -> bool:
    if operator == "is_blank":
        return is_blank(value)
    if operator == "is_not_blank":
        return not is_blank(value)
    if operator in ("contains", "not_contains", "starts_with", "ends_with"):
        haystack = "" if value is None else str(value).casefold()
        needle = "" if expected is None else str(expected).casefold()
        if operator == "contains":
            return needle in haystack
        if operator == "not_contains":
            return needle not in haystack
        if operator == "starts_with":
            return haystack.startswith(needle)
        return haystack.endswith(needle)
    if operator in ("in", "not_in"):
        options = expected if isinstance(expected, list) else [expected]
        found = any(compare_values("=", value, option) for option in options)
        return found if operator == "in" else not found
    if operator == "between":
        return compare_values(">=", value, expected) and compare_values("<=", value, expected2)
    symbol = {"eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}.get(operator, "=")
    return compare_values(symbol, value, expected)


def _row_passes_value_conditions(row: dict, column: dict) -> bool:
    """Whether one source row contributes to this conditional data column."""
    conditions = column.get("value_conditions") or []
    if not conditions:
        return True
    verdicts = []
    for index, condition in enumerate(conditions):
        if condition.get("enabled") is False:
            continue
        target = _value_condition_target(column["key"], index)
        verdicts.append(_apply_operator(
            condition.get("operator") or "eq",
            row.get(target),
            condition.get("value"),
            condition.get("value2"),
        ))
    if not verdicts:
        return True
    logic = str(column.get("value_condition_logic") or "AND").upper()
    return any(verdicts) if logic == "OR" else all(verdicts)


def _apply_value_conditions(row: dict, definition: dict):
    """Blank only measures that do not match their own comparison rules.

    Rows themselves stay available to other comparison measures, formulas and
    fixed report filters. Grouped SUMs then naturally place each matching
    measure into its own column without dropping the counterpart's row.
    """
    for column in definition.get("columns") or []:
        if (column.get("kind") or "data") != "data" or not column.get("value_conditions"):
            continue
        if not _row_passes_value_conditions(row, column):
            row[column["key"]] = None


def _row_passes_filters(row, definition, params):
    logic = str(definition.get("filter_logic") or "AND").upper()
    verdicts = []
    for entry in definition.get("filters") or []:
        if entry.get("enabled") is False:
            continue
        target = entry.get("column_key") or entry.get("_target")
        verdicts.append(_apply_operator(entry.get("operator") or "eq", row.get(target), entry.get("value"), entry.get("value2")))
    if verdicts:
        if logic == "OR" and not any(verdicts):
            return False
        if logic != "OR" and not all(verdicts):
            return False

    runtime_values = params.get("runtime_values") or {}
    for entry in definition.get("runtime_filters") or []:
        if entry.get("type") in BUILTIN_RUNTIME_TYPES:
            continue
        value = runtime_values.get(entry.get("key"))
        if value is None or value == "" or value == []:
            continue
        target = entry.get("column_key") or entry.get("_target")
        if not target:
            continue
        operator = entry.get("operator") or ("contains" if entry.get("type") == "text" else "eq" if entry.get("type") != "select" else "in")
        expected = value
        if operator == "in" and not isinstance(expected, list):
            expected = [expected]
        if not _apply_operator(operator, row.get(target), expected, entry.get("value2")):
            return False
    return True


def _check_required_runtime(definition, params):
    runtime_values = params.get("runtime_values") or {}
    for entry in definition.get("runtime_filters") or []:
        if entry.get("required"):
            value = runtime_values.get(entry.get("key"))
            if value is None or value == "" or value == []:
                if entry.get("default") not in (None, "", []):
                    runtime_values[entry["key"]] = entry["default"]
                    continue
                raise ReportDefinitionError(f"Please choose '{entry.get('label') or entry.get('key')}' before running this report.")


def _apply_calculations(rows, definition, warnings, deadline):
    parsed = definition.get("_parsed_formulas") or {}
    if not parsed:
        return
    order = _calculation_order(definition.get("columns") or [], parsed)
    error_counts: Counter[str] = Counter()
    today = date.today()
    for index, row in enumerate(rows):
        if index % 1000 == 0 and time_module.monotonic() > deadline:
            raise ReportDefinitionError("The report took too long to calculate. Narrow the date range or filters and try again.")
        errors = {}
        for key in order:
            try:
                row[key] = evaluate_formula(parsed[key], row, today)
            except FormulaError as exc:
                row[key] = None
                errors[key] = str(exc)
                error_counts[exc.code] += 1
        if errors:
            row["_errors"] = errors
    for code, count in error_counts.most_common():
        label = {"DIV0": "division by zero", "TYPE": "text used as a number", "NUM": "number out of range"}.get(code, "calculation error")
        warnings.append(f"{count:,} cell(s) could not be calculated ({label}) and are shown blank. Use IFERROR(…, 0) in the formula to substitute a value.")


def _bucket_value(value, bucket: str):
    if not bucket or bucket == "VALUE" or value is None:
        return value
    parsed = value.date() if isinstance(value, datetime) else value
    if isinstance(parsed, str):
        parsed = parse_date_value(parsed)
    if not isinstance(parsed, date):
        return value
    if bucket == "DAY":
        return parsed.isoformat()
    if bucket == "WEEK":
        return (parsed - timedelta(days=parsed.weekday())).isoformat()
    if bucket == "MONTH":
        return f"{parsed.year:04d}-{parsed.month:02d}"
    if bucket == "QUARTER":
        return f"{parsed.year:04d}-Q{(parsed.month - 1) // 3 + 1}"
    if bucket == "YEAR":
        return f"{parsed.year:04d}"
    return value


def _aggregate(values: list, aggregate: str):
    aggregate = str(aggregate or "SUM").upper()
    if aggregate == "FIRST":
        return values[0] if values else None
    if aggregate == "LAST":
        return values[-1] if values else None
    if aggregate == "COUNT":
        return sum(1 for value in values if not is_blank(value))
    numbers = [number for value in values if (number := to_decimal(value)) is not None]
    if not numbers:
        return None
    if aggregate == "SUM":
        return sum(numbers, Decimal(0))
    if aggregate == "PRODUCT":
        # Test zero first so a large partial product cannot overflow when
        # the mathematical result would ultimately be zero.
        if any(number == 0 for number in numbers):
            return Decimal(0)
        try:
            result = Decimal(1)
            for number in numbers:
                result *= number
            if not math.isfinite(float(result)):
                raise ReportDefinitionError("Product is too large to display. Narrow the date range or filters.")
        except DecimalException as exc:
            raise ReportDefinitionError("Product is too large to display. Narrow the date range or filters.") from exc
        return result
    if aggregate == "AVG":
        return sum(numbers, Decimal(0)) / Decimal(len(numbers))
    if aggregate == "MIN":
        return min(numbers)
    if aggregate == "MAX":
        return max(numbers)
    return sum(numbers, Decimal(0))


def _apply_grouping(rows, definition):
    group_by = definition.get("group_by") or []
    if not group_by:
        return rows
    dimensions = [
        ((entry.get("key") if isinstance(entry, dict) else entry),
         str((entry.get("bucket") if isinstance(entry, dict) else None) or "VALUE").upper())
        for entry in group_by
    ]
    dimension_keys = {dim for dim, _bucket in dimensions}
    groups: dict[tuple, list[dict]] = {}
    order: list[tuple] = []
    for row in rows:
        key = tuple(_bucket_value(row.get(dim), bucket) for dim, bucket in dimensions)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(row)
    grouped = []
    columns = definition.get("columns") or []
    for key in order:
        members = groups[key]
        out = {}
        for (dim, _bucket), value in zip(dimensions, key):
            out[dim] = value
        for column in columns:
            col_key = column["key"]
            if col_key in out:
                continue
            out[col_key] = _aggregate([member.get(col_key) for member in members], column.get("aggregate") or "FIRST")
        out["__aggregate_values"] = {column["key"]: [member.get(column["key"]) for member in members] for column in (definition.get("columns") or []) if column["key"] not in dimension_keys}
        out["__group_count"] = len(members)
        grouped.append(out)
    return grouped


def _matrix_transform(rows, definition, warnings):
    matrix = definition.get("matrix") or {}
    columns_by_key = {c["key"]: c for c in definition.get("columns") or []}
    row_dims = [
        ((entry.get("key") if isinstance(entry, dict) else entry),
         str((entry.get("bucket") if isinstance(entry, dict) else None) or "VALUE").upper())
        for entry in (matrix.get("row_keys") or [])
    ]
    column_key = matrix.get("column_key")
    column_bucket = str(matrix.get("column_bucket") or "VALUE").upper()
    value_key = matrix.get("value_key")
    aggregate = str(matrix.get("aggregate") or "SUM").upper()

    cells: dict[tuple, dict[object, list]] = defaultdict(lambda: defaultdict(list))
    column_values: list = []
    seen_columns: set = set()
    row_order: list[tuple] = []
    for row in rows:
        row_key = tuple(_bucket_value(row.get(dim), bucket) for dim, bucket in row_dims)
        col_value = _bucket_value(row.get(column_key), column_bucket)
        col_label = "—" if col_value is None or col_value == "" else str(col_value)
        if row_key not in cells:
            row_order.append(row_key)
        if col_label not in seen_columns:
            seen_columns.add(col_label)
            column_values.append(col_label)
        cells[row_key][col_label].append(row.get(value_key))

    def column_sort_key(label):
        parsed = parse_date_value(label)
        if parsed is not None:
            return (0, parsed.isoformat(), "")
        if re.match(r"^\d{4}-\d{2}$", label):
            return (0, label, "")
        number = to_decimal(label)
        if number is not None:
            return (1, "", f"{number:030f}")
        return (2, "", label.casefold())

    column_values.sort(key=column_sort_key)
    overflow_label = None
    if len(column_values) > MAX_MATRIX_COLUMNS:
        overflow_label = "Other"
        warnings.append(
            f"The matrix has more than {MAX_MATRIX_COLUMNS} columns; the remaining ones are combined into 'Other' so totals stay correct."
        )
        kept = column_values[: MAX_MATRIX_COLUMNS - 1]
        dropped = set(column_values[MAX_MATRIX_COLUMNS - 1:])
        for row_key in cells:
            merged: list = []
            for label in list(cells[row_key]):
                if label in dropped:
                    merged.extend(cells[row_key].pop(label))
            if merged:
                cells[row_key][overflow_label].extend(merged)
        column_values = kept + [overflow_label]

    out_columns = []
    for dim, _bucket in row_dims:
        base = dict(columns_by_key.get(dim) or {"key": dim, "label": humanize(dim), "data_type": "text"})
        base["key"] = dim
        base["is_matrix_row_dim"] = True
        out_columns.append(base)
    value_column = columns_by_key.get(value_key) or {}
    matrix_keys = []
    for index, label in enumerate(column_values):
        mkey = f"__m{index}"
        matrix_keys.append((mkey, label))
        out_columns.append({
            "key": mkey,
            "label": label,
            "kind": "data",
            "data_type": "number",
            "format": value_column.get("format") or {},
            "aggregate": aggregate,
            "show_total": True,
            "is_matrix_value": True,
        })
    show_row_totals = matrix.get("show_row_totals", True)
    if show_row_totals:
        out_columns.append({
            "key": "__row_total", "label": "Total", "kind": "data", "data_type": "number",
            "format": value_column.get("format") or {}, "aggregate": aggregate, "show_total": True, "is_matrix_total": True,
        })

    out_rows = []
    for row_key in row_order:
        out = {"__aggregate_values": {}}
        for (dim, _bucket), value in zip(row_dims, row_key):
            out[dim] = value
        all_values: list = []
        for mkey, label in matrix_keys:
            values = list(cells[row_key].get(label, []))
            all_values.extend(values)
            out[mkey] = _aggregate(values, aggregate) if values else None
            out["__aggregate_values"][mkey] = values
        if show_row_totals:
            out["__row_total"] = _aggregate(all_values, aggregate) if all_values else None
            out["__aggregate_values"]["__row_total"] = all_values
        out_rows.append(out)
    return out_rows, out_columns


# ---------------------------------------------------------------------------
# Output shaping
# ---------------------------------------------------------------------------

def _sort_rows(rows, sort_spec):
    def sort_value(value):
        if value is None:
            return (2, "")
        number = to_decimal(value)
        if number is not None and not isinstance(value, bool):
            return (0, float(number))
        if isinstance(value, (date, datetime)):
            return (1, value.isoformat())
        return (1, str(value).casefold())

    for entry in reversed(sort_spec or []):
        key = entry.get("key") if isinstance(entry, dict) else None
        direction = str((entry.get("direction") if isinstance(entry, dict) else "asc") or "asc").lower()
        if not key:
            continue
        rows.sort(key=lambda row: sort_value(row.get(key)), reverse=direction == "desc")
    return rows


def _serialise(value, warnings_counter: Counter):
    value = to_json_value(value)
    if isinstance(value, (dict, list)):
        value = str(value)
    if isinstance(value, datetime_time):
        value = value.strftime("%H:%M")
    if isinstance(value, str) and len(value) > MAX_TEXT_CELL:
        warnings_counter["truncated_text"] += 1
        value = value[:MAX_TEXT_CELL] + "…"
    return value


def _output_columns(definition, matrix_columns=None):
    if matrix_columns is not None:
        source_columns = matrix_columns
    else:
        source_columns = definition.get("columns") or []
    out = []
    for column in source_columns:
        if column.get("hidden"):
            continue
        out.append({
            "key": column["key"],
            "label": column.get("label") or humanize(column["key"]),
            "kind": column.get("kind") or "data",
            "data_type": column.get("data_type") or "text",
            "format": column.get("format") or {},
            "aggregate": column.get("aggregate"),
            "show_total": bool(column.get("show_total")),
            "formula": column.get("formula") if (column.get("kind") or "data") == "calculated" else None,
            "unit": column.get("unit"),
        })
    return out


def _validate_date_drill(definition: dict, drill: dict):
    """Only regroup a visible date dimension already authorised by the definition."""
    if not isinstance(drill, dict) or definition.get("report_type") != "TABULAR":
        raise ReportDefinitionError("Date drill-down is available for grouped tabular reports only.")
    key = drill.get("key")
    columns = {c.get("key"): c for c in definition.get("columns", [])}
    if not isinstance(key, str):
        raise ReportDefinitionError("Invalid date drill-down column.")
    column = columns.get(key) or {}
    group_keys = [g.get("key") if isinstance(g, dict) else g for g in definition.get("group_by", [])]
    if key not in group_keys or column.get("hidden") or column.get("data_type") not in ("date", "datetime"):
        raise ReportDefinitionError("Date drill-down requires a visible grouped date column.")
    if not isinstance(drill.get("bucket"), str) or drill["bucket"] not in {"DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "DETAIL"}:
        raise ReportDefinitionError("Invalid date drill-down period.")
    path = drill.get("path", [])
    if not isinstance(path, list) or len(path) > 5:
        raise ReportDefinitionError("Invalid date drill-down path.")
    for parent in path:
        if not isinstance(parent, dict) or not isinstance(parent.get("bucket"), str) or parent["bucket"] not in {"DAY", "WEEK", "MONTH", "QUARTER", "YEAR"} or not isinstance(parent.get("value"), str) or len(parent["value"]) > 10:
            raise ReportDefinitionError("Invalid date drill-down path.")


def run_report(db: Session, user: User, definition_in: dict, params_in: dict | None = None) -> dict:
    """Execute a definition for ``user`` and return the result payload."""
    started = time_module.monotonic()
    deadline = started + TIME_BUDGET_SECONDS
    definition = validate_definition(definition_in)
    params = dict(params_in or {})
    params.setdefault("runtime_values", {})
    _check_required_runtime(definition, params)
    drill = params.get("date_drill")
    if drill:
        _validate_date_drill(definition, drill)
    warnings: list[str] = []
    plan = _extraction_plan(definition)
    kind = (definition.get("source") or {}).get("kind")

    if kind == "operation_tickets":
        contexts = _load_ticket_rows(db, user, definition, params, plan, warnings)
        table_name = "operation_transactions"
    elif kind == "tank_stock_ledger":
        contexts = _load_table_rows(db, user, definition, params, plan, warnings, "tank_stock_ledger")
        table_name = "tank_stock_ledger"
    else:
        table_name = _source_table_for(definition)
        contexts = _load_table_rows(db, user, definition, params, plan, warnings, table_name)
    scanned = len(contexts)

    rows, dropped_empty = _extract_rows(contexts, definition, plan, warnings)
    if dropped_empty:
        warnings.append(f"{dropped_empty:,} row(s) had no data in the 'one row per item' JSON section and were left out.")

    # Date-range filter on the report's date basis
    date_from, date_to = params.get("date_from"), params.get("date_to")
    missing_dates = 0
    if date_from or date_to:
        kept = []
        for row in rows:
            row_date = row.get("__date")
            if row_date is None:
                missing_dates += 1
                continue
            if isinstance(row_date, datetime):
                row_date = row_date.date()
            if date_from and row_date < date_from:
                continue
            if date_to and row_date > date_to:
                continue
            kept.append(row)
        rows = kept
        if missing_dates:
            warnings.append(f"{missing_dates:,} row(s) have no {date_basis_label(definition)} and were excluded by the date range.")

    _apply_calculations(rows, definition, warnings, deadline)
    rows = [row for row in rows if _row_passes_filters(row, definition, params)]
    if drill:
        for parent in drill.get("path", []):
            rows = [row for row in rows if _bucket_value(row.get(drill["key"]), parent["bucket"]) == parent["value"]]
        if drill["bucket"] == "DETAIL":
            definition["group_by"] = []
        else:
            definition["group_by"] = [
                {"key": entry.get("key") if isinstance(entry, dict) else entry,
                 "bucket": drill["bucket"] if (entry.get("key") if isinstance(entry, dict) else entry) == drill["key"] else (entry.get("bucket", "VALUE") if isinstance(entry, dict) else "VALUE")}
                for entry in definition["group_by"]
            ]
    filtered_count = len(rows)

    matrix_columns = None
    if definition.get("report_type") == "MATRIX":
        rows, matrix_columns = _matrix_transform(rows, definition, warnings)
    else:
        rows = _apply_grouping(rows, definition)

    search = str(params.get("search") or "").strip().casefold()
    display_columns = _output_columns(definition, matrix_columns)
    if search:
        display_keys = [c["key"] for c in display_columns]
        rows = [
            row for row in rows
            if any(search in ("" if row.get(k) is None else str(row.get(k)).casefold()) for k in display_keys)
        ]

    sort_spec = params.get("sort") or definition.get("sort") or []
    if definition.get("report_type") == "MATRIX" and not params.get("sort"):
        row_dims = [
            (entry.get("key") if isinstance(entry, dict) else entry)
            for entry in ((definition.get("matrix") or {}).get("row_keys") or [])
        ]
        sort_spec = [{"key": key, "direction": "asc"} for key in row_dims]
    rows = _sort_rows(rows, sort_spec)

    # Totals over the full (pre-pagination) result
    totals: dict[str, object] = {}
    show_totals = (definition.get("options") or {}).get("show_totals", True)
    serialise_warnings: Counter = Counter()
    if show_totals:
        total_sources = matrix_columns if matrix_columns is not None else (definition.get("columns") or [])
        for column in total_sources:
            if not column.get("show_total"):
                continue
            aggregate = str(column.get("aggregate") or "SUM").upper()
            if aggregate in ("FIRST", "LAST"):
                continue
            values = []
            for row in rows:
                values.extend(row.get("__aggregate_values", {}).get(column["key"], [row.get(column["key"])]))
            totals[column["key"]] = _serialise(_aggregate(values, aggregate), serialise_warnings)

    total_rows = len(rows)
    for_export = bool(params.get("for_export"))
    page = max(1, int(params.get("page") or 1))
    page_size = min(500, max(1, int(params.get("page_size") or (definition.get("options") or {}).get("page_size") or 50)))
    if for_export:
        page_rows = rows[:EXPORT_CAP]
        if total_rows > EXPORT_CAP:
            warnings.append(f"Export limited to the first {EXPORT_CAP:,} rows.")
        page, page_size = 1, len(page_rows) or 1
    else:
        start = (page - 1) * page_size
        page_rows = rows[start:start + page_size]

    output_rows = []
    visible_keys = [c["key"] for c in display_columns]
    for row in page_rows:
        out = {key: _serialise(row.get(key), serialise_warnings) for key in visible_keys}
        if row.get("_errors"):
            out["_errors"] = row["_errors"]
        output_rows.append(out)
    if serialise_warnings.get("truncated_text"):
        warnings.append("Some very long text values were shortened for display.")

    return {
        "columns": display_columns,
        "rows": output_rows,
        "totals": totals,
        "meta": {
            "total_rows": total_rows,
            "page": page,
            "page_size": page_size,
            "total_pages": max(1, -(-total_rows // page_size)) if page_size else 1,
            "scanned_rows": scanned,
            "filtered_rows": filtered_count,
            "warnings": list(dict.fromkeys(warnings)),
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "generated_in_ms": int((time_module.monotonic() - started) * 1000),
            "date_basis": definition.get("date_basis"),
            "date_basis_label": date_basis_label(definition),
            "source_kind": kind,
            "source_table": table_name,
            "report_type": definition.get("report_type"),
            "grouped": bool(definition.get("group_by")),
            "_export_rows": rows if for_export else None,
        },
    }


def date_basis_label(definition: dict) -> str:
    basis = (definition or {}).get("date_basis") or "ACCOUNTING_DATE"
    return {
        "PAYLOAD_OPERATION_DATE": "Operation / Gauging Date (from ticket answers)",
        "ACCOUNTING_DATE": "Accounting Date",
        "OPERATION_DATE": "Operation Date (ticket header)",
        "CREATED_AT": "Created Date",
        "COLUMN": humanize((definition or {}).get("date_column") or "Date"),
        "NONE": "date",
    }.get(basis, "Accounting Date")


# ---------------------------------------------------------------------------
# Exports (server-side, full result set)
# ---------------------------------------------------------------------------

def _export_matrix_of(result: dict) -> tuple[list[str], list[list]]:
    columns = result.get("columns") or []
    header = [c["label"] for c in columns]
    keys = [c["key"] for c in columns]
    body = []
    serialise_warnings: Counter = Counter()
    for row in result["meta"].pop("_export_rows", None) or result.get("rows") or []:
        body.append([_serialise(row.get(key), serialise_warnings) for key in keys])
    totals = result.get("totals") or {}
    if totals:
        total_row = []
        for index, column in enumerate(columns):
            if column["key"] in totals:
                total_row.append(totals[column["key"]])
            elif index == 0:
                total_row.append("TOTAL")
            else:
                total_row.append(None)
        body.append(total_row)
    return header, body


def export_csv_bytes(result: dict) -> bytes:
    header, body = _export_matrix_of(result)
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(header)
    for cells in body:
        safe = []
        for cell in cells:
            text = "" if cell is None else str(cell)
            if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
                text = "'" + text  # spreadsheet formula-injection guard
            safe.append(text)
        writer.writerow(safe)
    return ("﻿" + buffer.getvalue()).encode("utf-8")


def export_xlsx_bytes(result: dict, title: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    from openpyxl.utils import get_column_letter

    header, body = _export_matrix_of(result)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = re.sub(r"[^A-Za-z0-9 _-]", "", title or "Report")[:31] or "Report"
    header_fill = PatternFill("solid", fgColor="0F3556")
    header_font = Font(bold=True, color="FFFFFF")
    for col_index, label in enumerate(header, start=1):
        cell = sheet.cell(row=1, column=col_index, value=label)
        cell.fill = header_fill
        cell.font = header_font
        sheet.column_dimensions[get_column_letter(col_index)].width = min(42, max(12, len(str(label)) + 4))
    for row_index, cells in enumerate(body, start=2):
        for col_index, value in enumerate(cells, start=1):
            sheet.cell(row=row_index, column=col_index, value=value)
    sheet.freeze_panes = "A2"
    if header:
        sheet.auto_filter.ref = f"A1:{get_column_letter(len(header))}{max(1, len(body) + 1)}"
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# Starter report designs (one-click starting points for non-technical users)
# ---------------------------------------------------------------------------

def _col(key, label, source, data_type="text", **extra):
    column = {"key": key, "label": label, "kind": "data", "source": source, "data_type": data_type, "format": {}}
    column.update(extra)
    return column


def _calc(key, label, formula, **extra):
    column = {"key": key, "label": label, "kind": "calculated", "formula": formula, "data_type": "number", "format": {"decimals": 3}}
    column.update(extra)
    return column


def starter_templates() -> list[dict]:
    ticket_register = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "operation_tickets", "operation_type_codes": [], "statuses": []},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            _col("ticket_number", "Ticket No", {"type": "column", "column": "operation_ticket_number"}),
            _col("operation_number", "Operation No", {"type": "column", "column": "operation_number"}),
            _col("operation_type", "Operation Type", {"type": "virtual", "field": "operation_type_name"}),
            _col("operation_type_code", "Type Code", {"type": "column", "column": "operation_type_code"}, hidden=False),
            _col("operation_date", "Operation Date", {"type": "virtual", "field": "payload_operation_date"}, data_type="date"),
            _col("accounting_date", "Accounting Date", {"type": "virtual", "field": "accounting_date"}, data_type="date"),
            _col("origin_location", "Origin Location", {"type": "virtual", "field": "origin_location_name"}),
            _col("asset", "Asset", {"type": "virtual", "field": "primary_asset_name"}),
            _col("asset_code", "Asset Code", {"type": "column", "column": "primary_asset_code"}),
            _col("product", "Product", {"type": "column", "column": "product_name"}),
            _col("status", "Status", {"type": "column", "column": "status"}),
            _col("created_by", "Created By", {"type": "column", "column": "created_by"}),
        ],
        "filters": [], "filter_logic": "AND",
        "runtime_filters": [
            {"key": "location", "label": "Location", "type": "location"},
            {"key": "operation_type", "label": "Operation Type", "type": "operation_type"},
            {"key": "status", "label": "Status", "type": "status", "default": ["Approved"]},
        ],
        "group_by": [], "sort": [{"key": "operation_date", "direction": "asc"}, {"key": "ticket_number", "direction": "asc"}],
        "options": {"show_totals": False, "page_size": 50},
    }

    gauging_quantities = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "operation_tickets", "operation_type_codes": [], "statuses": ["Approved"]},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            _col("ticket_number", "Ticket No", {"type": "column", "column": "operation_ticket_number"}),
            _col("accounting_date", "Accounting Date", {"type": "virtual", "field": "accounting_date"}, data_type="date"),
            _col("location_code", "Location", {"type": "column", "column": "origin_location_code"}),
            _col("tank", "Tank / Asset", {"type": "column", "column": "primary_asset_code"}),
            _col("tank_operation", "Tank Operation", {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "inputs.tankOperationLabel"}),
            _col("gsv_bbl", "GSV (BBL)", {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.gsvBbl"}, data_type="number", format={"decimals": 3}, show_total=True),
            _col("nsv_bbl", "NSV (BBL)", {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.nsvBbl"}, data_type="number", format={"decimals": 3}, show_total=True),
            _calc("water_etc_bbl", "GSV − NSV (BBL)", "[gsv_bbl] - [nsv_bbl]", show_total=True),
            _calc("nsv_pct_of_gsv", "NSV % of GSV", "IFERROR([nsv_bbl] % [gsv_bbl], 0)", format={"decimals": 2, "suffix": " %"}),
            _col("lt", "LT", {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.lt"}, data_type="number", format={"decimals": 3}, show_total=True),
            _col("mt", "MT", {"type": "payload_path", "field_code": "tank_gauging_payload", "path": "calculated.mt"}, data_type="number", format={"decimals": 3}, show_total=True),
        ],
        "filters": [], "filter_logic": "AND",
        "runtime_filters": [{"key": "location", "label": "Location", "type": "location"}],
        "group_by": [], "sort": [{"key": "accounting_date", "direction": "asc"}],
        "options": {"show_totals": True, "page_size": 50},
    }

    daily_movements = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "tank_stock_ledger"},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            _col("accounting_date", "Accounting Date", {"type": "column", "column": "accounting_date"}, data_type="date"),
            _col("location_code", "Location", {"type": "column", "column": "location_code"}),
            _col("tank", "Tank", {"type": "column", "column": "tank_asset_code"}),
            _col("operation_label", "Tank Operation", {"type": "column", "column": "tank_operation_label"}),
            _col("movement_nsv", "Movement NSV (BBL)", {"type": "column", "column": "movement_nsv_bbl"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("movement_gsv", "Movement GSV (BBL)", {"type": "column", "column": "movement_gsv_bbl"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("movement_mt", "Movement (MT)", {"type": "column", "column": "movement_mt"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _calc("tickets", "Tickets", "1", data_type="number", format={"decimals": 0}, aggregate="SUM", show_total=True),
        ],
        "filters": [{"column_key": "location_code", "operator": "is_not_blank"}],
        "filter_logic": "AND",
        "runtime_filters": [{"key": "location", "label": "Location", "type": "location"}],
        "group_by": [{"key": "accounting_date", "bucket": "DAY"}, {"key": "location_code"}, {"key": "tank"}, {"key": "operation_label"}],
        "sort": [{"key": "accounting_date", "direction": "asc"}, {"key": "tank", "direction": "asc"}],
        "options": {"show_totals": True, "page_size": 100},
    }

    location_matrix = {
        "schema_version": 1, "report_type": "MATRIX",
        "source": {"kind": "tank_stock_ledger"},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            _col("location_code", "Location", {"type": "column", "column": "location_code"}),
            _col("tank", "Tank", {"type": "column", "column": "tank_asset_code"}),
            _col("operation_category", "Operation Category", {"type": "column", "column": "tank_operation_category"}),
            _col("movement_nsv", "Movement NSV (BBL)", {"type": "column", "column": "movement_nsv_bbl"}, data_type="number", format={"decimals": 3}),
        ],
        "filters": [], "filter_logic": "AND",
        "runtime_filters": [{"key": "location", "label": "Location", "type": "location"}],
        "group_by": [],
        "matrix": {"row_keys": ["location_code", "tank"], "column_key": "operation_category", "column_bucket": "VALUE", "value_key": "movement_nsv", "aggregate": "SUM", "show_row_totals": True, "show_column_totals": True},
        "sort": [], "options": {"show_totals": True, "page_size": 100},
    }

    monthly_matrix = {
        "schema_version": 1, "report_type": "MATRIX",
        "source": {"kind": "tank_stock_ledger"},
        "date_basis": "ACCOUNTING_DATE",
        "columns": [
            _col("location_code", "Location", {"type": "column", "column": "location_code"}),
            _col("tank", "Tank", {"type": "column", "column": "tank_asset_code"}),
            _col("accounting_date", "Accounting Month", {"type": "column", "column": "accounting_date"}, data_type="date"),
            _col("closing_nsv", "Closing NSV (BBL)", {"type": "column", "column": "running_balance_nsv_bbl"}, data_type="number", format={"decimals": 3}),
        ],
        "filters": [], "filter_logic": "AND",
        "runtime_filters": [{"key": "location", "label": "Location", "type": "location"}],
        "group_by": [],
        "matrix": {"row_keys": ["location_code", "tank"], "column_key": "accounting_date", "column_bucket": "MONTH", "value_key": "closing_nsv", "aggregate": "SUM", "show_row_totals": True, "show_column_totals": True},
        "sort": [], "options": {"show_totals": True, "page_size": 100},
    }

    book_stock_daily = {
        "schema_version": 1, "report_type": "TABULAR",
        "source": {"kind": "table", "table": "book_stock_daily_entries"},
        "date_basis": "COLUMN", "date_column": "entry_date",
        "columns": [
            _col("entry_date", "Stock Date", {"type": "column", "column": "entry_date"}, data_type="date"),
            _col("entity", "Entity", {"type": "column", "column": "entity_code"}),
            _col("block", "Block", {"type": "column", "column": "block_code"}),
            _col("product", "Product", {"type": "column", "column": "product_code"}),
            _col("opening", "Opening Stock", {"type": "column", "column": "opening_stock"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("production", "Production", {"type": "column", "column": "production"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("dispatch", "Dispatch", {"type": "column", "column": "dispatch"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("adjustment", "Adjustment", {"type": "column", "column": "adjustment"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _col("closing", "Closing Stock", {"type": "column", "column": "closing_stock"}, data_type="number", format={"decimals": 3}, aggregate="SUM", show_total=True),
            _calc("net_movement", "Net Movement (Production − Dispatch + Adjustment)", "[production] - [dispatch] + [adjustment]", aggregate="SUM", show_total=True),
        ],
        "filters": [], "filter_logic": "AND",
        "runtime_filters": [
            {"key": "product", "label": "Product", "type": "text"},
        ],
        "group_by": [{"key": "entry_date", "bucket": "DAY"}, {"key": "entity"}, {"key": "block"}, {"key": "product"}],
        "sort": [{"key": "entry_date", "direction": "asc"}, {"key": "entity", "direction": "asc"}],
        "options": {"show_totals": True, "page_size": 100},
    }

    return [
        {"id": "book-stock-daily", "name": "Book Stock — Daily Stock by Entity, Block & Product", "description": "Government Data Book Stock Management: opening, field production, dispatch, signed adjustment and closing stock per day, entity, block and product. Products stay separate.", "report_type": "TABULAR", "definition": book_stock_daily},
        {"id": "ticket-register", "name": "Operation Ticket Register", "description": "All approved tickets with payload operation dates and accounting dates. Filter by location, operation type and status.", "report_type": "TABULAR", "definition": ticket_register},
        {"id": "gauging-quantities", "name": "Tank Gauging Quantities (payload split)", "description": "GSV / NSV / LT / MT pulled out of the saved Tank Gauging payload JSON, with calculated GSV−NSV and NSV % of GSV columns.", "report_type": "TABULAR", "definition": gauging_quantities},
        {"id": "daily-movements", "name": "Daily Stock Movements by Tank & Operation", "description": "Grouped Tank Stock Ledger movements per accounting day, tank and tank operation, with totals.", "report_type": "TABULAR", "definition": daily_movements},
        {"id": "location-operation-matrix", "name": "Matrix — Tank × Operation Category (NSV)", "description": "Cross-tab of movement NSV: tanks down the side, operation categories across the top, with row and column totals.", "report_type": "MATRIX", "definition": location_matrix},
        {"id": "monthly-stock-matrix", "name": "Matrix — Tank × Month (Running Balance NSV)", "description": "Monthly running-balance cross-tab per tank — change the period to Day / Week / Year in the designer.", "report_type": "MATRIX", "definition": monthly_matrix},
    ]
