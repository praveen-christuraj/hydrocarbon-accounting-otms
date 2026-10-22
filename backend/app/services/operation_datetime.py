"""Payload-first operation date/time resolution (single source of truth).

The Operation Date / Start Date-Time / End Date-Time inputs were removed from
the Operation Entry *metadata* section: the operation date and time of a
ticket are whatever the operator entered inside the respective operation
type's data-entry **payload** (tank gauging date/time, tanker transaction
date/time, multi-tank before/after date/time, flowmeter reading date/time,
FSO / Shuttle operation date + event time).

Every calculation and report (Tank Stock Ledger, Tank Operation Summary,
Out-Turn Summary / Report, Material Balance, FSO reports, tracking
timelines, ...) must therefore resolve a ticket's operation moment from its
payload first and only fall back to the legacy ticket metadata
(``operation_start_datetime`` / ``operation_date``) when a payload carries no
date/time at all. ``operation_transactions.operation_date`` is kept as a
derived cache column (it is NOT NULL and heavily indexed/filtered); the
write path and a start-up backfill keep it equal to the payload date.

Chronological ordering always uses the full payload date **and time**, and
the accounting date is the payload operation moment shifted by the
respective location's Location Accounting Day Setting (an operation before
the location's day-start time belongs to the previous accounting day).

Multi-tank (before/after) payloads resolve to the *before* date/time first -
the moment the operation starts - falling back to *after*. This matches the
frontend resolver (``frontend/src/utils/operationDate.js``) so the ticket
date derived in the browser and the dates derived here never disagree.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, time as datetime_time, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import (
    LocationAccountingDaySetting,
    OperationTransaction,
    OperationTransactionValue,
)

# Payload value field codes, in resolution priority order. A ticket normally
# carries exactly one of them (chosen by its entry layout).
PAYLOAD_FIELD_CODES = (
    "tank_gauging_payload",
    "multi_tank_payload",
    "tanker_payload",
    "flowmeter_payload",
    "meter_payload",
    "fso_payload",
    "shuttle_payload",
)

_DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}")
_TIME_TEXT = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?")

# Date-like keys that describe reference data, never the operation moment.
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


def parse_date_value(value) -> date | None:
    """Best-effort ``date`` from a payload value (date/datetime/ISO text)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    cleaned = _text(value)
    if not cleaned or not _DATE_PREFIX.match(cleaned):
        return None

    try:
        return date.fromisoformat(cleaned[:10])
    except ValueError:
        return None


def parse_time_value(value) -> datetime_time | None:
    """Best-effort ``time`` from a payload value ("HH:MM" or ISO datetime)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.time().replace(tzinfo=None)
    if isinstance(value, datetime_time):
        return value.replace(tzinfo=None)

    cleaned = _text(value)
    if not cleaned:
        return None

    # Full ISO datetime text: take the time part after ``T``/space.
    if _DATE_PREFIX.match(cleaned) and len(cleaned) > 10:
        cleaned = cleaned[10:].lstrip("T ")

    match = _TIME_TEXT.match(cleaned)
    if not match:
        return None

    try:
        return datetime_time(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3) or 0),
        )
    except ValueError:
        return None


def _as_dict(payload) -> dict:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        cleaned = payload.strip()
        if cleaned.startswith("{"):
            try:
                parsed = json.loads(cleaned)
            except (TypeError, ValueError):
                return {}
            return parsed if isinstance(parsed, dict) else {}
    return {}


def _inputs(payload: dict) -> dict:
    inputs = payload.get("inputs")
    return inputs if isinstance(inputs, dict) else {}


def _first_date(inputs: dict, keys) -> date | None:
    for key in keys:
        parsed = parse_date_value(inputs.get(key))
        if parsed is not None:
            return parsed
    return None


def _first_time(inputs: dict, keys) -> datetime_time | None:
    for key in keys:
        parsed = parse_time_value(inputs.get(key))
        if parsed is not None:
            return parsed
    return None


# Explicit payload key sets. Both the camelCase keys the current layouts
# write and snake_case variants seen in older payloads are accepted.
_GAUGING_DATE_KEYS = ("gaugingDate", "gauging_date")
_GAUGING_TIME_KEYS = ("gaugingTime", "gauging_time")
_TANKER_DATE_KEYS = ("tankerTransactionDate", "tanker_transaction_date")
_TANKER_TIME_KEYS = ("tankerTransactionTime", "tanker_transaction_time")
_READING_DATE_KEYS = ("reading_date", "readingDate", "operation_date", "operationDate")
_OPERATION_DATE_KEYS = ("operation_date", "operationDate")
_EVENT_TIME_KEYS = ("event_time", "eventTime")


def _explicit_parts(
    payload: dict, field_code: str | None
) -> tuple[date | None, datetime_time | None]:
    """(date, time) from the known keys of one payload type.

    ``field_code=None`` tries every known payload shape (used for ledger
    ``source_payload`` snapshots, which do not record their field code).
    """
    inputs = _inputs(payload)
    code = _text(field_code)

    def gauging():
        return (
            _first_date(inputs, _GAUGING_DATE_KEYS),
            _first_time(inputs, _GAUGING_TIME_KEYS),
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
            _first_date(inputs, _TANKER_DATE_KEYS),
            _first_time(inputs, _TANKER_TIME_KEYS),
        )

    def reading():
        return (
            _first_date(inputs, _READING_DATE_KEYS),
            _first_time(inputs, _EVENT_TIME_KEYS),
        )

    def operation():
        return (
            _first_date(inputs, _OPERATION_DATE_KEYS),
            _first_time(inputs, _EVENT_TIME_KEYS),
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
        # The payload of a known type may still date itself through one of
        # the other known key sets (older layout versions) - fall through.

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
    if "reading" in normalized or "gauging" in normalized or "transaction" in normalized:
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
    if "gauging" in normalized or "transaction" in normalized:
        return 6
    if "event" in normalized:
        return 3
    return 2


def _generic_parts(payload, depth: int = 0):
    """Scored recursive search for unknown payload shapes.

    Mirrors ``frontend/src/utils/operationDate.js`` so a payload the explicit
    extractors do not know still resolves the same way in browser and server.
    Returns ``(date, date_score, time, time_score)``.
    """
    if depth > 6 or payload is None:
        return None, -1, None, -1

    if isinstance(payload, str):
        cleaned = payload.strip()
        if cleaned.startswith(("{", "[")):
            try:
                return _generic_parts(json.loads(cleaned), depth + 1)
            except (TypeError, ValueError):
                return None, -1, None, -1
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
                # A full datetime in a date key also supplies the time.
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
    """``(operation_date, operation_time)`` entered inside one payload.

    Either part is ``None`` when the payload does not carry it. Explicit
    per-layout keys win; a scored generic walk covers unknown shapes.
    """
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
    """Payload operation moment; ``None`` only when it has no date at all.

    A payload date without a time resolves to midnight of that date - use
    :func:`get_payload_operation_parts` when the caller must distinguish
    "no time entered" (accounting-date calculation does).
    """
    found_date, found_time = get_payload_operation_parts(payload, field_code)
    if found_date is None:
        return None
    return datetime.combine(found_date, found_time or datetime_time(0, 0))


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
    """Resolve (date, time) from a transaction's stored values.

    Known ``*_payload`` values are tried first (in layout priority order),
    then any other JSON value, then flat date/time template fields. Returns
    ``(None, None)`` when no value carries an operation date - callers then
    fall back to the legacy ticket metadata.
    """
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
            isinstance(raw, str) and raw.strip().startswith(("{", "["))
        ):
            found_date, found_time = get_payload_operation_parts(raw, code)
            if found_date is not None:
                return found_date, found_time

    # Flat template fields (e.g. a custom layout with a ``reading_date``
    # field): best scored date-like / time-like field codes.
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
# Transaction level resolution (payload first, legacy metadata last)
# --------------------------------------------------------------------------


def resolve_transaction_operation_parts(
    transaction: OperationTransaction | None,
    values=None,
    payload=None,
    field_code: str | None = None,
) -> tuple[date | None, datetime_time | None]:
    """Operation (date, time) of a ticket - payload first, metadata last.

    The metadata (``operation_start_datetime`` / ``operation_date``) is only
    consulted when no payload/value supplies a date, so tickets recorded
    before the metadata inputs were removed still account on the date/time
    typed inside their payloads.
    """
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
    """Batch-load the ``*_payload`` values of many transactions in one query."""
    ids = [tx_id for tx_id in dict.fromkeys(transaction_ids or []) if tx_id is not None]
    if not ids:
        return {}

    rows = (
        db.query(OperationTransactionValue)
        .filter(
            OperationTransactionValue.transaction_id.in_(ids),
            OperationTransactionValue.field_code.in_(PAYLOAD_FIELD_CODES),
        )
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
# Location Accounting Day
# --------------------------------------------------------------------------


def get_active_day_setting(
    db: Session, location_code: str | None, on_date: date | None
) -> LocationAccountingDaySetting | None:
    """Active Location Accounting Day Setting effective on ``on_date``.

    Same selection rule the Tank Stock Ledger has always used: newest
    ``effective_from`` (then newest id) whose effective range contains the
    operation date. The *respective location's* setting is always used.
    """
    cleaned_location = _text(location_code)
    if not cleaned_location or on_date is None:
        return None

    return (
        db.query(LocationAccountingDaySetting)
        .filter(
            LocationAccountingDaySetting.location_code.ilike(cleaned_location),
            LocationAccountingDaySetting.status == "Active",
            LocationAccountingDaySetting.effective_from <= on_date,
            or_(
                LocationAccountingDaySetting.effective_to.is_(None),
                LocationAccountingDaySetting.effective_to >= on_date,
            ),
        )
        .order_by(
            LocationAccountingDaySetting.effective_from.desc(),
            LocationAccountingDaySetting.id.desc(),
        )
        .first()
    )


def accounting_date_from_parts(
    operation_date: date,
    operation_time: datetime_time | None,
    day_start_time: datetime_time | None,
) -> date:
    """Accounting date of an operation moment under a location's day-start.

    An operation earlier than the day-start time belongs to the previous
    accounting day. No entered time (or no configured setting) keeps the
    operation date itself - the long-standing behaviour of
    ``compute_accounting_date``.
    """
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
    """Accounting date for one operation moment at one location.

    ``setting_cache`` (optional) memoises setting lookups per
    (location, operation date) for report builders resolving many rows.
    Locations without an Active setting keep the calendar operation date,
    exactly as reports behaved before this centralisation.
    """
    if operation_date is None:
        return None

    cache_key = (str(location_code or "").strip().lower(), operation_date)
    if setting_cache is not None and cache_key in setting_cache:
        setting = setting_cache[cache_key]
    else:
        setting = get_active_day_setting(db, location_code, operation_date)
        if setting_cache is not None:
            setting_cache[cache_key] = setting

    day_start = setting.day_start_time if setting else None
    return accounting_date_from_parts(operation_date, operation_time, day_start)


def resolve_transaction_accounting(
    db: Session,
    transaction: OperationTransaction,
    values=None,
    payload=None,
    field_code: str | None = None,
    setting_cache: dict | None = None,
) -> tuple[date | None, datetime_time | None, datetime | None, date | None]:
    """``(operation_date, operation_time, operation_datetime, accounting_date)``.

    The one call report/calculation builders need: operation moment from the
    payload, accounting date from the origin location's accounting-day
    setting applied to that moment.
    """
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
