"""Pure Book Stock Management calculations (Government Data).

No database or FastAPI imports live here so the arithmetic can be unit-tested
and reused by the API, the bulk uploader and the frontend preview tests.

Rules
-----
* Stock is kept **per product**. Nothing in this module ever adds two products
  together in a stock calculation; a product_code is part of every key.
* ``closing stock = opening stock + production - dispatch + adjustment``.
* ``production`` of a block is the sum of its fields' production for that day.
* A block's closing stock rolls up into its entity's closing stock.
* Adjustments are signed: a negative adjustment is deducted, a positive one is
  added. Opening / production / dispatch are non-negative quantities.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime

PRODUCT_LIMIT = 2

DEFAULT_SETTINGS = {
    "auto_carry_opening": "Yes",
    "allow_negative_closing": "Yes",
    "default_unit": "BBL",
    "max_active_products": str(PRODUCT_LIMIT),
    "allow_negative_adjustment": "Yes",
}

SETTING_DESCRIPTIONS = {
    "auto_carry_opening": (
        "Yes: a new day's opening stock is suggested / carried from the previous "
        "day's closing stock for the same entity, block and product. The value "
        "stays editable."
    ),
    "allow_negative_closing": (
        "Yes: a closing stock may go below zero (for example after a large "
        "negative adjustment). No: saving a negative closing stock is blocked."
    ),
    "default_unit": "Default unit shown for new products (BBL, MT, LT, m3 …).",
    "max_active_products": "How many products may be active at the same time (fixed at 2).",
    "allow_negative_adjustment": "Yes: adjustments may be positive or negative.",
}

QTY_PRECISION = 6


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------

def normalize_code(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def to_float(value, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def round_qty(value, digits: int = QTY_PRECISION) -> float:
    return round(to_float(value), digits)


def yes_no(value, default: str = "No") -> str:
    if value is None:
        return default
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = str(value).strip().casefold()
    if text in {"yes", "y", "true", "1"}:
        return "Yes"
    if text in {"no", "n", "false", "0"}:
        return "No"
    return default


def is_yes(value) -> bool:
    return yes_no(value, "No") == "Yes"


# ---------------------------------------------------------------------------
# Core stock arithmetic
# ---------------------------------------------------------------------------

def compute_closing_stock(
    opening_stock=0,
    production=0,
    dispatch=0,
    adjustment=0,
) -> float:
    """Opening + Production - Dispatch + Adjustment (signed adjustment)."""
    return round_qty(
        to_float(opening_stock)
        + to_float(production)
        - to_float(dispatch)
        + to_float(adjustment)
    )


def sum_field_productions(lines) -> float:
    """Total production of a block for one day (all field lines summed)."""
    total = 0.0
    for line in lines or []:
        if isinstance(line, dict):
            total += to_float(line.get("production_qty", line.get("quantity", 0)))
        else:
            total += to_float(getattr(line, "production_qty", 0))
    return round_qty(total)


def apply_production_lines(entry, lines):
    """Attach field lines to an entry payload dict and return the production."""
    production = sum_field_productions(lines)
    entry["production"] = production
    return production


def validate_quantities(
    opening_stock=None,
    production=None,
    dispatch=None,
    adjustment=None,
    *,
    allow_negative_adjustment=True,
):
    """Return a list of human readable problems (empty when the values are fine)."""
    problems: list[str] = []
    for label, value in (
        ("Opening stock", opening_stock),
        ("Production", production),
        ("Dispatch", dispatch),
    ):
        if value is not None and to_float(value) < 0:
            problems.append(f"{label} cannot be negative.")
    if adjustment is not None and not allow_negative_adjustment:
        if to_float(adjustment) < 0:
            problems.append("Negative adjustments are disabled in Book Stock settings.")
    return problems


def validate_closing(closing, *, allow_negative_closing=True):
    if to_float(closing) < 0 and not allow_negative_closing:
        return [
            "Closing stock would be negative. Change the opening stock, dispatch or "
            "adjustment, or enable negative closing stock in Book Stock settings."
        ]
    return []


def as_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Aggregation (never mixes products)
# ---------------------------------------------------------------------------

def _row_value(row, key, default=0):
    if isinstance(row, dict):
        return row.get(key, default)
    return getattr(row, key, default)


def _row_date(row):
    return as_date(_row_value(row, "entry_date", None))


def _group_key(row, keys):
    return tuple(str(_row_value(row, key, "") or "").strip().casefold() for key in keys)


def aggregate_block_rows(rows, keys=("entity_code", "block_code", "product_code")):
    """One row per entity + block + product over the rows supplied.

    Movement columns are summed. ``opening_stock`` is the opening of the first
    date and ``closing_stock`` is the closing of the last date in the period —
    adding daily closing stocks together would double count stock.
    """
    groups: dict[tuple, dict] = {}
    for row in rows or []:
        key = _group_key(row, keys)
        group = groups.get(key)
        if group is None:
            group = {
                "entity_code": _row_value(row, "entity_code", ""),
                "block_code": _row_value(row, "block_code", ""),
                "product_code": _row_value(row, "product_code", ""),
                "opening_stock": 0.0,
                "production": 0.0,
                "dispatch": 0.0,
                "adjustment": 0.0,
                "closing_stock": 0.0,
                "entry_count": 0,
                "first_date": None,
                "last_date": None,
                "_first_opening": None,
                "_last_closing": None,
            }
            groups[key] = group
        row_date = _row_date(row)
        opening = round_qty(_row_value(row, "opening_stock", 0))
        closing = round_qty(_row_value(row, "closing_stock", 0))
        group["production"] = round_qty(group["production"] + to_float(_row_value(row, "production", 0)))
        group["dispatch"] = round_qty(group["dispatch"] + to_float(_row_value(row, "dispatch", 0)))
        group["adjustment"] = round_qty(group["adjustment"] + to_float(_row_value(row, "adjustment", 0)))
        group["entry_count"] += 1
        if row_date is not None:
            if group["first_date"] is None or row_date < group["first_date"]:
                group["first_date"] = row_date
                group["_first_opening"] = opening
            if group["last_date"] is None or row_date > group["last_date"]:
                group["last_date"] = row_date
                group["_last_closing"] = closing
    result = []
    for group in groups.values():
        group["opening_stock"] = round_qty(group.pop("_first_opening") or 0)
        group["closing_stock"] = round_qty(group.pop("_last_closing") or 0)
        group["first_date"] = group["first_date"].isoformat() if group["first_date"] else None
        group["last_date"] = group["last_date"].isoformat() if group["last_date"] else None
        result.append(group)
    result.sort(key=lambda item: (
        str(item.get("product_code") or ""),
        str(item.get("entity_code") or ""),
        str(item.get("block_code") or ""),
    ))
    return result


def aggregate_entity_day_rows(rows):
    """One row per date + entity + product, summing that date's blocks.

    This is the entity-level closing stock the owner asked for: all blocks'
    closing stock for the same product and date, added together. Products stay
    separate.
    """
    groups: dict[tuple, dict] = {}
    for row in rows or []:
        d = _row_date(row)
        if d is None:
            continue
        key = (
            d.isoformat(),
            str(_row_value(row, "entity_code", "") or "").strip().casefold(),
            str(_row_value(row, "product_code", "") or "").strip().casefold(),
        )
        group = groups.get(key)
        if group is None:
            group = {
                "entry_date": d.isoformat(),
                "entity_code": _row_value(row, "entity_code", ""),
                "product_code": _row_value(row, "product_code", ""),
                "opening_stock": 0.0,
                "production": 0.0,
                "dispatch": 0.0,
                "adjustment": 0.0,
                "closing_stock": 0.0,
                "block_count": 0,
            }
            groups[key] = group
        for column in ("opening_stock", "production", "dispatch", "adjustment", "closing_stock"):
            group[column] = round_qty(group[column] + to_float(_row_value(row, column, 0)))
        group["block_count"] += 1
    result = list(groups.values())
    result.sort(key=lambda item: (item["entry_date"], item["product_code"], item["entity_code"]))
    return result


def latest_entity_totals(rows):
    """Latest date's entity totals per entity + product (for dashboards)."""
    day_rows = aggregate_entity_day_rows(rows)
    latest: dict[tuple, dict] = {}
    for row in day_rows:
        key = (
            str(row["entity_code"]).casefold(),
            str(row["product_code"]).casefold(),
        )
        current = latest.get(key)
        if current is None or row["entry_date"] > current["entry_date"]:
            latest[key] = row
    return sorted(
        latest.values(),
        key=lambda item: (str(item["product_code"]), str(item["entity_code"])),
    )


def totals_by_product(rows):
    """Per-product totals over the supplied rows (products remain separate).

    ``closing_stock`` is the sum of each block's latest closing stock, so a
    product produced by several blocks is reported at entity level without
    adding several days of the same block together.
    """
    groups: dict[str, dict] = {}
    for row in rows or []:
        code = str(_row_value(row, "product_code", "") or "")
        key = code.casefold()
        group = groups.get(key)
        if group is None:
            group = {
                "product_code": code,
                "opening_stock": 0.0,
                "production": 0.0,
                "dispatch": 0.0,
                "adjustment": 0.0,
                "closing_stock": 0.0,
                "entry_count": 0,
                "block_count": 0,
                "closing_date": None,
            }
            groups[key] = group
        for column in ("production", "dispatch", "adjustment"):
            group[column] = round_qty(group[column] + to_float(_row_value(row, column, 0)))
        group["entry_count"] += 1

    block_totals = aggregate_block_rows(rows)
    for block in block_totals:
        key = str(block.get("product_code") or "").casefold()
        group = groups.get(key)
        if group is None:
            continue
        group["block_count"] += 1
        group["opening_stock"] = round_qty(group["opening_stock"] + to_float(block.get("opening_stock", 0)))
        group["closing_stock"] = round_qty(group["closing_stock"] + to_float(block.get("closing_stock", 0)))
        if block.get("last_date") and (group["closing_date"] is None or block["last_date"] > group["closing_date"]):
            group["closing_date"] = block["last_date"]

    result = list(groups.values())
    result.sort(key=lambda item: str(item.get("product_code") or ""))
    return result


def daily_trend(rows):
    """Closing stock per date + product, summed across blocks (for charts)."""
    groups: dict[tuple, dict] = {}
    for row in rows or []:
        d = _row_date(row)
        if d is None:
            continue
        key = (d.isoformat(), str(_row_value(row, "product_code", "") or "").casefold())
        group = groups.get(key)
        if group is None:
            group = {
                "entry_date": d.isoformat(),
                "product_code": _row_value(row, "product_code", ""),
                "production": 0.0,
                "dispatch": 0.0,
                "adjustment": 0.0,
                "closing_stock": 0.0,
            }
            groups[key] = group
        for column in ("production", "dispatch", "adjustment", "closing_stock"):
            group[column] = round_qty(group[column] + to_float(_row_value(row, column, 0)))
    return sorted(groups.values(), key=lambda item: (item["entry_date"], item["product_code"]))


def build_dashboard(rows, products=None):
    """Dashboard payload: per-product totals, entity / block totals and trend."""
    product_rows = list(products or [])
    product_by_code = {
        str(item.get("product_code") or "").casefold(): item for item in product_rows
    }
    totals = totals_by_product(rows)
    for total in totals:
        product = product_by_code.get(str(total["product_code"]).casefold())
        total["product_name"] = (product or {}).get("product_name") or total["product_code"]
        total["unit"] = (product or {}).get("unit") or ""
    return {
        "totals_by_product": totals,
        "entity_totals": latest_entity_totals(rows),
        "block_totals": aggregate_block_rows(rows),
        "daily_trend": daily_trend(rows),
    }
