"""Payload-first gauging/operation date & time resolution (single source of truth).

The Operation Date / Start Date-Time / End Date-Time inputs were removed from
the Operation Entry metadata section: the operational moment of every ticket is
strictly the gauging/operation date and time entered inside its payload
(``inputs.gaugingDate`` + ``inputs.gaugingTime`` / ``input_gaugingDate`` +
``input_gaugingTime``, tanker transaction date/time, multi-tank before/after
date/time, flowmeter reading date/time, FSO / Shuttle operation date + event
time).

Every calculation and report (Tank Stock Ledger, Daily Summary, Tank Operation
Summary, Out-Turn Summary, Out-Turn Report, Material Balance Report, FSO
reports, tracking timelines, ...) resolves each ticket's moment from its
payload first, orders chronologically by payload date AND time, and applies the
respective location's Location Accounting Day Setting window cleanly without
gap-second or boundary-date mismatches.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time as datetime_time, timedelta

from sqlalchemy.orm import Session

from app.models import (
    LocationAccountingDaySetting,
    OperationTransaction,
    OperationTransactionValue,
)

# Payload value field codes, in resolution priority order. A ticket normally
# carries one of them (chosen by its entry layout).
PAYLOAD_FIELD_CODES = (
    "tank_gauging_payload",
    "multi_tank_payload",
    "tanker_payload",
    "flowmeter_payload",
    "meter_payload",
    "fso_payload",
    "shuttle_payload",
)

_ISO_YMD_RE = re.compile(r"^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[\sT])")
_DMY_RE = re.compile(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:$|[\sT])")
_TIME_TEXT = re.compile(
    r"^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:\s*([AaPp][Mm]))?"
)

# Date-like keys that describe reference data, never the gauging/operation moment.
_NON_OPERATION_DATE_HINTS = (
    "effective",
    "expiry",
    "expire",
    "commission",
    "created",
    "updated",
    "birth",
    "manufacture",
)


def _text(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def coerce_payload_dict(payload) -> dict:
    """Normalise a payload value (dict, JSON string, or double-encoded string) to ``dict``."""
    current = payload
    for _ in range(3):
        if isinstance(current, dict):
            return current
        if not isinstance(current, str):
            return {}
        cleaned = current.strip()
        if not cleaned or cleaned[0] not in ('{', '"'):
            return {}
        try:
            current = json.loads(cleaned)
        except (TypeError, ValueError):
            return {}
    return current if isinstance(current, dict) else {}


def parse_date_value(value) -> date | None:
    """Best-effort ``date`` from a payload value (date/datetime/ISO or slash text)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    cleaned = _text(value)
    if not cleaned:
        return None

    ymd_match = _ISO_YMD_RE.match(cleaned)
    if ymd_match:
        try:
            return date(
                int(ymd_match.group(1)),
                int(ymd_match.group(2)),
                int(ymd_match.group(3)),
            )
        except ValueError:
            return None

    dmy_match = _DMY_RE.match(cleaned)
    if dmy_match:
        first, second, year = (
            int(dmy_match.group(1)),
            int(dmy_match.group(2)),
            int(dmy_match.group(3)),
        )
        try:
            return date(year, second, first)
        except ValueError:
            try:
                return date(year, first, second)
            except ValueError:
                return None

    return None


def parse_time_value(value) -> datetime_time | None:
    """Best-effort ``time`` from a payload value ('HH:MM', 'H:MM', 'HH:MM AM/PM', or ISO datetime)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.time().replace(tzinfo=None)
    if isinstance(value, datetime_time):
        return value.replace(tzinfo=None)

    cleaned = _text(value)
    if not cleaned:
        return None

    ymd_match = _ISO_YMD_RE.match(cleaned)
    if ymd_match:
        idx = ymd_match.end()
        cleaned = cleaned[idx - 1 :].lstrip("T ") if idx <= len(cleaned) else ""
        if not cleaned:
            return None
    else:
        dmy_match = _DMY_RE.match(cleaned)
        if dmy_match:
            idx = dmy_match.end()
            cleaned = cleaned[idx - 1 :].lstrip("T ") if idx <= len(cleaned) else ""
            if not cleaned:
                return None

    match = _TIME_TEXT.match(cleaned)
    if not match:
        return None

    hour = int(match.group(1))
    minute = int(match.group(2))
    second = int(match.group(3) or 0)
    meridiem = (match.group(4) or "").upper()

    if meridiem == "PM" and 1 <= hour <= 11:
        hour += 12
    elif meridiem == "AM" and hour == 12:
        hour = 0

    try:
        return datetime_time(hour, minute, second)
    except ValueError:
        return None


def _as_dict(payload) -> dict:
    return coerce_payload_dict(payload)


def _inputs(payload: dict) -> dict:
    inputs = payload.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def _first_date(sources: tuple[dict, ...], keys) -> date | None:
    for mapping in sources:
        if not mapping:
            continue
        for key in keys:
            parsed = parse_date_value(mapping.get(key))
            if parsed is not None:
                return parsed
    return None


def _first_time(sources: tuple[dict, ...], keys) -> datetime_time | None:
    for mapping in sources:
        if not mapping:
            continue
        for key in keys:
            parsed = parse_time_value(mapping.get(key))
            if parsed is not None:
                return parsed
    return None


# Explicit payload key sets — both nested ``inputs.<key>`` and flattened
# ``input_<key>`` / snake_case forms are supported symmetrically.
_GAUGING_DATE_KEYS = (
    "gaugingDate",
    "gauging_date",
    "input_gaugingDate",
    "input_gauging_date",
)
_GAUGING_TIME_KEYS = (
    "gaugingTime",
    "gauging_time",
    "input_gaugingTime",
    "input_gauging_time",
)
_TANKER_DATE_KEYS = (
    "tankerTransactionDate",
    "tanker_transaction_date",
    "input_tankerTransactionDate",
    "input_tanker_transaction_date",
)
_TANKER_TIME_KEYS = (
    "tankerTransactionTime",
    "tanker_transaction_time",
    "input_tankerTransactionTime",
    "input_tanker_transaction_time",
)
_READING_DATE_KEYS = (
    "reading_date",
    "readingDate",
    "input_reading_date",
    "input_readingDate",
    "operation_date",
    "operationDate",
)
_OPERATION_DATE_KEYS = (
    "operation_date",
    "operationDate",
    "input_operation_date",
    "input_operationDate",
)
_EVENT_TIME_KEYS = (
    "event_time",
    "eventTime",
    "input_event_time",
    "input_eventTime",
)


def _explicit_parts(
    payload: dict, field_code: str | None
) -> tuple[date | None, datetime_time | None]:
    """(date, time) from the known keys of one payload type.

    ``field_code=None`` tries every known payload shape (used for ledger
    ``source_payload`` snapshots, which do not record their field code).
    """
    inputs = _inputs(payload)
    sources = (inputs, payload)
    code = _text(field_code)

    def gauging():
        return (
            _first_date(sources, _GAUGING_DATE_KEYS),
            _first_time(sources, _GAUGING_TIME_KEYS),
        )

    def multi_tank():
        for stage_key in ("before", "after"):
            stage = inputs.get(stage_key)
            if not isinstance(stage, dict):
                continue
            stage_date = parse_date_value(stage.get("date"))
            if stage_date is not None:
                return stage_date, parse_time_value(stage.get("time"))
        return None, None

    def tanker():
        return (
            _first_date(sources, _TANKER_DATE_KEYS),
            _first_time(sources, _TANKER_TIME_KEYS),
        )

    def reading():
        return (
            _first_date(sources, _READING_DATE_KEYS),
            _first_time(sources, _EVENT_TIME_KEYS),
        )

    def operation():
        return (
            _first_date(sources, _OPERATION_DATE_KEYS),
            _first_time(sources, _EVENT_TIME_KEYS),
        )

    by_code = {
        "tank_gauging_payload": gauging,
        "multi_tank_payload": multi_tank,
        "tanker_payload": tanker,
        "flowmeter_payload": reading,
        "meter_payload": reading,
        "fso_payload": operation,
        "shuttle_payload": operation,
    }

    if code in by_code:
        found_date, found_time = by_code[code]()
        if found_date is not None:
            return found_date, found_time

    for extractor in (gauging, multi_tank, tanker, reading, operation):
        found_date, found_time = extractor()
        if found_date is not None:
            return found_date, found_time

    return None, None


def _score_date_key(key: str) -> int:
    normalized = str(key or "").lower()
    if "date" not in normalized:
        return -1
    if any(hint in normalized for hint in _NON_OPERATION_DATE_HINTS):
        return -1
    if "datetime" in normalized or normalized.endswith("time"):
        return 0
    if "gauging" in normalized:
        return 8
    if "reading" in normalized or "transaction" in normalized:
        return 6
    if "operation" in normalized:
        return 5
    if "event" in normalized:
        return 3
    return 2


def _score_time_key(key: str) -> int:
    normalized = str(key or "").lower()
    if "time" not in normalized:
        return -1
    if "gauging" in normalized:
        return 8
    if "transaction" in normalized:
        return 6
    if "event" in normalized:
        return 3
    return 2


def _generic_parts(payload, depth: int = 0):
    """Scored recursive search for unknown payload shapes."""
    if depth > 6 or payload is None:
        return None, -1, None, -1

    if isinstance(payload, str):
        cleaned = payload.strip()
        if cleaned.startswith(("{", "[", '"')):
            try:
                return _generic_parts(json.loads(cleaned), depth + 1)
            except (TypeError, ValueError):
                pass
        parsed_date = parse_date_value(cleaned)
        if parsed_date is not None:
            return parsed_date, 1, parse_time_value(cleaned), 1
        return None, -1, None, -1

    if isinstance(payload, list):
        best = (None, -1, None, -1)
        for item in payload:
            candidate = _generic_parts(item, depth + 1)
            if candidate[1] > best[1]:
                best = (candidate[0], candidate[1], best[2], best[3])
            if candidate[3] > best[3]:
                best = (best[0], best[1], candidate[2], candidate[3])
        return best

    if not isinstance(payload, dict):
        return None, -1, None, -1

    best_date, best_date_score = None, -1
    best_time, best_time_score = None, -1

    for key, value in payload.items():
        date_score = _score_date_key(key)
        if date_score >= 0:
            parsed_date = parse_date_value(value)
            if parsed_date is not None and date_score > best_date_score:
                best_date, best_date_score = parsed_date, date_score
                parsed_time = parse_time_value(value)
                if parsed_time is not None and date_score > best_time_score:
                    best_time, best_time_score = parsed_time, date_score
                continue

        time_score = _score_time_key(key)
        if time_score >= 0 and isinstance(value, (str, datetime_time, datetime)):
            parsed_time = parse_time_value(value)
            if parsed_time is not None and time_score > best_time_score:
                best_time, best_time_score = parsed_time, time_score
                continue

        nested = _generic_parts(value, depth + 1)
        if nested[0] is not None and nested[1] > best_date_score:
            best_date, best_date_score = nested[0], nested[1]
        if nested[2] is not None and nested[3] > best_time_score:
            best_time, best_time_score = nested[2], nested[3]

    return best_date, best_date_score, best_time, best_time_score


def get_payload_operation_parts(
    payload, field_code: str | None = None
) -> tuple[date | None, datetime_time | None]:
    """``(gauging_or_operation_date, gauging_or_operation_time)`` from a payload."""
    payload_dict = _as_dict(payload)

    found_date, found_time = _explicit_parts(payload_dict, field_code)
    if found_date is not None:
        if found_time is None:
            _, _, generic_time, _ = _generic_parts(payload_dict)
            found_time = generic_time
        return found_date, found_time

    generic_date, _, generic_time, _ = _generic_parts(payload_dict)
    return generic_date, generic_time


def get_payload_operation_date(payload, field_code: str | None = None) -> date | None:
    return get_payload_operation_parts(payload, field_code)[0]


def get_payload_operation_time(
    payload, field_code: str | None = None
) -> datetime_time | None:
    return get_payload_operation_parts(payload, field_code)[1]


def get_payload_operation_datetime(
    payload, field_code: str | None = None
) -> datetime | None:
    """Payload gauging/operation moment; ``None`` only when it has no date at all."""
    found_date, found_time = get_payload_operation_parts(payload, field_code)
    if found_date is None:
        return None
    return datetime.combine(found_date, found_time or datetime_time(0, 0))


def format_time_hhmm(value: datetime_time | None) -> str | None:
    """Format a ``time`` cleanly as ``HH:MM`` (or ``HH:MM:SS`` when seconds != 0)."""
    if value is None:
        return None
    if value.second:
        return value.strftime("%H:%M:%S")
    return value.strftime("%H:%M")


# --------------------------------------------------------------------------
# Transaction-value level resolution
# --------------------------------------------------------------------------


def _value_code_and_payload(value) -> tuple[str, object]:
    """Normalise ORM rows / dicts / pydantic values to (field_code, value)."""
    if isinstance(value, dict):
        code = value.get("field_code") or value.get("fieldCode") or ""
        if "field_value" in value:
            return str(code), value.get("field_value")
        return str(code), value.get("fieldValue")

    code = getattr(value, "field_code", None) or getattr(value, "fieldCode", "") or ""
    raw = getattr(value, "field_value", None)
    if raw is None:
        raw = getattr(value, "fieldValue", None)
    return str(code), raw


def operation_parts_from_values(values) -> tuple[date | None, datetime_time | None]:
    """Resolve (date, time) from a transaction's stored values."""
    normalised = [_value_code_and_payload(value) for value in (values or [])]

    for wanted_code in PAYLOAD_FIELD_CODES:
        for code, raw in normalised:
            if code != wanted_code:
                continue
            found_date, found_time = get_payload_operation_parts(raw, code)
            if found_date is not None:
                return found_date, found_time

    for code, raw in normalised:
        if code in PAYLOAD_FIELD_CODES:
            continue
        if isinstance(raw, (dict, list)) or (
            isinstance(raw, str) and raw.strip().startswith(("{", "[", '"'))
        ):
            found_date, found_time = get_payload_operation_parts(raw, code)
            if found_date is not None:
                return found_date, found_time

    # Flat template fields (e.g. ``input_gaugingDate`` + ``input_gaugingTime``).
    best_date, best_date_score = None, -1
    best_time, best_time_score = None, -1
    for code, raw in normalised:
        date_score = _score_date_key(code)
        if date_score >= 0:
            parsed_date = parse_date_value(raw)
            if parsed_date is not None and date_score > best_date_score:
                best_date, best_date_score = parsed_date, date_score
        time_score = _score_time_key(code)
        if time_score >= 0:
            parsed_time = parse_time_value(raw)
            if parsed_time is not None and time_score > best_time_score:
                best_time, best_time_score = parsed_time, time_score

    return best_date, best_time


def operation_parts_from_value_map(
    value_map: dict | None,
) -> tuple[date | None, datetime_time | None]:
    """Same as :func:`operation_parts_from_values` for ``{field_code: value}``."""
    values = [
        {"field_code": code, "field_value": raw}
        for code, raw in (value_map or {}).items()
    ]
    return operation_parts_from_values(values)


def operation_date_from_values(values) -> date | None:
    return operation_parts_from_values(values)[0]


def operation_date_from_value_map(value_map: dict | None) -> date | None:
    return operation_parts_from_value_map(value_map)[0]


def operation_datetime_from_values(values) -> datetime | None:
    found_date, found_time = operation_parts_from_values(values)
    if found_date is None:
        return None
    return datetime.combine(found_date, found_time or datetime_time(0, 0))


# --------------------------------------------------------------------------
# Transaction level resolution (payload strictly first; metadata fallback only
# when a legacy/non-payload ticket has no date in its payload at all)
# --------------------------------------------------------------------------


def resolve_transaction_operation_parts(
    transaction: OperationTransaction | None,
    values=None,
    payload=None,
    field_code: str | None = None,
) -> tuple[date | None, datetime_time | None]:
    """Gauging / operation (date, time) of a ticket — strictly payload-first."""
    if payload is not None:
        found_date, found_time = get_payload_operation_parts(payload, field_code)
        if found_date is not None:
            return found_date, found_time

    if values is not None:
        found_date, found_time = operation_parts_from_values(values)
        if found_date is not None:
            return found_date, found_time

    if transaction is None:
        return None, None

    start = getattr(transaction, "operation_start_datetime", None)
    if start is not None:
        return start.date(), start.time().replace(tzinfo=None)

    operation_date = getattr(transaction, "operation_date", None)
    if operation_date is not None:
        return operation_date, None

    return None, None


def resolve_transaction_operation_date(
    transaction: OperationTransaction | None,
    values=None,
    payload=None,
    field_code: str | None = None,
) -> date | None:
    return resolve_transaction_operation_parts(
        transaction, values=values, payload=payload, field_code=field_code
    )[0]


def resolve_transaction_operation_datetime(
    transaction: OperationTransaction | None,
    values=None,
    payload=None,
    field_code: str | None = None,
) -> datetime | None:
    found_date, found_time = resolve_transaction_operation_parts(
        transaction, values=values, payload=payload, field_code=field_code
    )
    if found_date is None:
        return None
    return datetime.combine(found_date, found_time or datetime_time(0, 0))


def load_payload_values_map(
    db: Session, transaction_ids
) -> dict[int, list[OperationTransactionValue]]:
    """Batch-load transaction values for many transactions in one query."""
    ids = [tx_id for tx_id in dict.fromkeys(transaction_ids or []) if tx_id is not None]
    if not ids:
        return {}

    rows = (
        db.query(OperationTransactionValue)
        .filter(OperationTransactionValue.transaction_id.in_(ids))
        .all()
    )

    values_map: dict[int, list[OperationTransactionValue]] = {}
    for row in rows:
        values_map.setdefault(row.transaction_id, []).append(row)
    return values_map


def load_transaction_operation_parts_map(
    db: Session, transactions
) -> dict[int, tuple[date | None, datetime_time | None]]:
    """Resolved (date, time) per transaction id, payloads batch-loaded."""
    tx_list = list(transactions or [])
    values_map = load_payload_values_map(db, [tx.id for tx in tx_list])
    return {
        tx.id: resolve_transaction_operation_parts(
            tx, values=values_map.get(tx.id) or []
        )
        for tx in tx_list
    }


def resolve_transaction_operation_datetime_from_db(
    db: Session, transaction: OperationTransaction | None
) -> datetime | None:
    if transaction is None:
        return None
    values_map = load_payload_values_map(db, [transaction.id])
    return resolve_transaction_operation_datetime(
        transaction, values=values_map.get(transaction.id) or []
    )


# --------------------------------------------------------------------------
# Unified Location Accounting Day Window Engine
# --------------------------------------------------------------------------


def _load_active_location_settings(
    db: Session,
    location_code: str | None,
    setting_cache: dict | None = None,
) -> list[LocationAccountingDaySetting]:
    cleaned_location = _text(location_code)
    if not cleaned_location:
        return []

    cache_key = ("_settings", cleaned_location.lower())
    if setting_cache is not None and cache_key in setting_cache:
        return setting_cache[cache_key]

    settings = (
        db.query(LocationAccountingDaySetting)
        .filter(
            LocationAccountingDaySetting.location_code.ilike(cleaned_location),
            LocationAccountingDaySetting.status == "Active",
        )
        .order_by(
            LocationAccountingDaySetting.effective_from.desc(),
            LocationAccountingDaySetting.id.desc(),
        )
        .all()
    )
    if setting_cache is not None:
        setting_cache[cache_key] = settings
    return settings


def calculate_window_from_setting_parts(
    setting: LocationAccountingDaySetting,
    operation_date: date,
    operation_time: datetime_time | None,
) -> dict:
    """Compute continuous 24-hour accounting day window for ``(operation_date, operation_time)``.

    Any moment strictly before ``setting.day_start_time`` belongs to
    ``operation_date - 1 day``; any moment at or after ``day_start_time``
    (or when no time was recorded) belongs to ``operation_date``. This avoids
    false gap errors on seconds between ``day_end_time`` (e.g. ``06:00:00``)
    and ``day_start_time`` (e.g. ``06:01:00``).
    """
    start_time = setting.day_start_time
    end_time = setting.day_end_time
    accounting_date = accounting_date_from_parts(
        operation_date, operation_time, start_time
    )
    accounting_day_start = datetime.combine(accounting_date, start_time)
    if end_time <= start_time:
        accounting_day_end = datetime.combine(
            accounting_date + timedelta(days=1),
            end_time,
        )
    else:
        accounting_day_end = datetime.combine(accounting_date, end_time)

    return {
        "setting_id": setting.id,
        "setting": setting,
        "accounting_date": accounting_date,
        "accounting_day_start": accounting_day_start,
        "accounting_day_end": accounting_day_end,
    }


def resolve_location_accounting_window(
    db: Session,
    location_code: str | None,
    operation_date: date | None,
    operation_time: datetime_time | None = None,
    setting_cache: dict | None = None,
) -> dict | None:
    """Resolve the active accounting window for ``(location_code, operation_date, operation_time)``.

    Selection order:
      1. Newest Active setting whose effective range covers the resolved
         accounting date or calendar gauging date.
      2. Earliest Active open-ended/covering setting for the location when
         historical gauging dates precede ``effective_from`` (so configuring a
         location's accounting window today still applies to earlier tickets).
      3. ``None`` only when the location has no Active setting at all.
    """
    if operation_date is None:
        return None

    active_settings = _load_active_location_settings(
        db, location_code, setting_cache=setting_cache
    )
    if not active_settings:
        return None

    for setting in active_settings:
        window = calculate_window_from_setting_parts(
            setting, operation_date, operation_time
        )
        effective_to = setting.effective_to or date.max
        acc_date = window["accounting_date"]
        if (
            setting.effective_from <= acc_date <= effective_to
            or setting.effective_from <= operation_date <= effective_to
        ):
            return window

    # Fallback: tickets gauged earlier than the earliest configured
    # ``effective_from`` use the earliest Active setting for that location
    # whose ``effective_to`` has not expired before the gauging date.
    earliest_candidates = sorted(
        active_settings,
        key=lambda s: (s.effective_from or date.min, -(s.id or 0)),
    )
    for setting in earliest_candidates:
        effective_to = setting.effective_to or date.max
        window = calculate_window_from_setting_parts(
            setting, operation_date, operation_time
        )
        if window["accounting_date"] <= effective_to or operation_date <= effective_to:
            return window

    return calculate_window_from_setting_parts(
        active_settings[0], operation_date, operation_time
    )


def get_active_day_setting(
    db: Session,
    location_code: str | None,
    on_date: date | None,
    operation_time: datetime_time | None = None,
    setting_cache: dict | None = None,
) -> LocationAccountingDaySetting | None:
    """Active Location Accounting Day Setting for ``location_code`` on ``on_date``."""
    window = resolve_location_accounting_window(
        db,
        location_code=location_code,
        operation_date=on_date,
        operation_time=operation_time,
        setting_cache=setting_cache,
    )
    return window["setting"] if window else None


def accounting_date_from_parts(
    operation_date: date,
    operation_time: datetime_time | None,
    day_start_time: datetime_time | None,
) -> date:
    """Accounting date of a gauging moment under a location's ``day_start_time``."""
    if operation_time is None or day_start_time is None:
        return operation_date
    if operation_time < day_start_time:
        return operation_date - timedelta(days=1)
    return operation_date


def resolve_accounting_date(
    db: Session,
    location_code: str | None,
    operation_date: date | None,
    operation_time: datetime_time | None = None,
    setting_cache: dict | None = None,
) -> date | None:
    """Accounting date for ``(operation_date, operation_time)`` at ``location_code``."""
    if operation_date is None:
        return None

    window = resolve_location_accounting_window(
        db,
        location_code=location_code,
        operation_date=operation_date,
        operation_time=operation_time,
        setting_cache=setting_cache,
    )
    if window is not None:
        return window["accounting_date"]
    return operation_date


def resolve_transaction_accounting(
    db: Session,
    transaction: OperationTransaction,
    values=None,
    payload=None,
    field_code: str | None = None,
    setting_cache: dict | None = None,
) -> tuple[date | None, datetime_time | None, datetime | None, date | None]:
    """``(gauging_date, gauging_time, gauging_datetime, accounting_date)``."""
    operation_date, operation_time = resolve_transaction_operation_parts(
        transaction, values=values, payload=payload, field_code=field_code
    )

    operation_datetime = None
    if operation_date is not None:
        operation_datetime = datetime.combine(
            operation_date, operation_time or datetime_time(0, 0)
        )

    accounting_date = resolve_accounting_date(
        db,
        getattr(transaction, "origin_location_code", None),
        operation_date,
        operation_time,
        setting_cache=setting_cache,
    )

    return operation_date, operation_time, operation_datetime, accounting_date
