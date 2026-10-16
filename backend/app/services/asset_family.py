"""
Asset family classification (Barge / Tanker / Shuttle / FSO / Vessel).

Why this module exists
----------------------
Tracking used to decide whether a ticket belonged to Barge Tracking by looking
for the literal text ``barge`` inside the asset type code (``Asset.asset_type_code``
/ ``OperationTransaction.primary_asset_type_code``). Real installations give
their asset types their own codes - the reported one is ``YADE`` for a barge
fleet - so those tickets were never captured, the Open / Closed voyage lists
stayed empty, and the Tracking Module Configuration page refused to map the
operation type ("Operation type BARGE_MOVE applies to asset type 'YADE'. Barge
Tracking only captures operation types for barge assets.").

Classification is now layered, cheapest and most specific first:

  1. **Tracking Module Configuration** - an Active row mapping the ticket's
     operation type to a module (BARGE / TANKER) is the admin's statement of
     intent and wins over every guess below.
  2. **Asset type master** - code, name and description of the asset type
     (keyword aliases, e.g. ``YADE`` = barge).
  3. **Asset master** - the ticket's primary asset code / name / type.
  4. **Operation type master** - applicable asset type first (a barge stage
     like ``SHUTTLE_RECEIPT`` must not classify its own operation type as a
     shuttle), then the operation type code / name.
  5. **Entry layout** - ``Multi-Tank Before/After`` is the Barge / YADE entry
     layout of this application.

Every lookup is cached on the SQLAlchemy session (``db.info``) so the list
endpoints do not re-query the masters for each ticket they loop over.
"""

from sqlalchemy.orm import Session

from app.models import Asset, AssetType, OperationTemplate, OperationType

FAMILY_BARGE = "BARGE"
FAMILY_TANKER = "TANKER"
FAMILY_SHUTTLE = "SHUTTLE"
FAMILY_FSO = "FSO"
FAMILY_VESSEL = "VESSEL"

FAMILY_LABELS = {
    FAMILY_BARGE: "barge",
    FAMILY_TANKER: "tanker",
    FAMILY_SHUTTLE: "shuttle",
    FAMILY_FSO: "FSO",
    FAMILY_VESSEL: "vessel",
}

# Keyword aliases used when a master record does not say what it is.
#   * "yade" - the client's barge class (the Barge entry layout is titled
#     "Multi-Tank Before/After (Barge / YADE)").
#   * tanker keywords follow the Tanker Tracking module (truck / trailer /
#     prime mover tickets are tanker movements of this application).
ASSET_FAMILY_KEYWORDS: dict[str, tuple[str, ...]] = {
    FAMILY_BARGE: ("barge", "yade"),
    FAMILY_FSO: ("fso", "fpso", "floating storage"),
    FAMILY_SHUTTLE: ("shuttle",),
    FAMILY_VESSEL: ("vessel", "ship"),
    FAMILY_TANKER: ("tanker", "truck", "trailer", "prime mover", "primemover"),
}

# Matching order: the first family whose keyword appears in the text wins.
# BARGE / FSO / SHUTTLE are checked before TANKER because "tank" style words
# are the most generic ones in this domain.
FAMILY_MATCH_ORDER = (
    FAMILY_BARGE,
    FAMILY_FSO,
    FAMILY_SHUTTLE,
    FAMILY_VESSEL,
    FAMILY_TANKER,
)

# Entry layouts that identify a tracking module on their own.
LAYOUT_FAMILY_KEYWORDS: dict[str, tuple[str, ...]] = {
    FAMILY_BARGE: ("multi-tank",),
    FAMILY_TANKER: ("tanker",),
    FAMILY_SHUTTLE: ("shuttle tracking",),
    FAMILY_FSO: ("fso tracking",),
}


def normalize_text(value) -> str:
    return str(value or "").strip().lower()


def family_from_text(*values, keywords: dict[str, tuple[str, ...]] | None = None):
    """First asset family whose keyword appears in any of the given texts."""
    keyword_map = keywords or ASSET_FAMILY_KEYWORDS
    haystack = " ".join(normalize_text(value) for value in values if value not in (None, ""))
    if not haystack:
        return None

    for family in FAMILY_MATCH_ORDER:
        for keyword in keyword_map.get(family, ()):  # pragma: no branch - tiny loop
            if keyword in haystack:
                return family
    return None


def _cache(db: Session) -> dict:
    return db.info.setdefault("asset_family_cache", {})


def _cached(db: Session, key, loader):
    cache = _cache(db)
    if key not in cache:
        cache[key] = loader()
    return cache[key]


def invalidate_asset_family_cache(db: Session) -> None:
    db.info.pop("asset_family_cache", None)


def get_asset_type_record(db: Session, asset_type_code):
    code = normalize_text(asset_type_code)
    if not code:
        return None
    return _cached(
        db,
        ("asset_type", code),
        lambda: db.query(AssetType)
        .filter(AssetType.asset_type_code.ilike(code))
        .first(),
    )


def get_asset_record(db: Session, asset_code):
    code = normalize_text(asset_code)
    if not code:
        return None
    return _cached(
        db,
        ("asset", code),
        lambda: db.query(Asset).filter(Asset.asset_code.ilike(code)).first(),
    )


def get_operation_type_record(db: Session, operation_type_code):
    code = normalize_text(operation_type_code)
    if not code:
        return None
    return _cached(
        db,
        ("operation_type", code),
        lambda: db.query(OperationType)
        .filter(OperationType.operation_type_code.ilike(code))
        .first(),
    )


def get_template_record(db: Session, template_id):
    if template_id in (None, ""):
        return None
    try:
        key = int(template_id)
    except (TypeError, ValueError):
        return None
    return _cached(
        db,
        ("operation_template", key),
        lambda: db.query(OperationTemplate)
        .filter(OperationTemplate.id == key)
        .first(),
    )


def resolve_asset_type_family(db: Session, asset_type_code):
    """
    Family of an asset type code (asset type master first, then the raw code).

    The master row is consulted for its code, name and description so an
    installation whose barge type is called ``YADE`` (code and name) is only
    recognised through the alias list, while ``Barge Barge-T-2`` is recognised
    from the name even if its code is unexpected.
    """
    code = normalize_text(asset_type_code)
    if not code:
        return None

    record = get_asset_type_record(db, code)
    if record is not None:
        family = family_from_text(
            record.asset_type_code, record.asset_type_name, record.description
        )
        if family:
            return family

    return family_from_text(code)


def resolve_asset_family(db: Session, asset_code):
    """Family of a registered asset (code, name and its asset type)."""
    code = normalize_text(asset_code)
    if not code:
        return None

    record = get_asset_record(db, code)
    if record is not None:
        family = family_from_text(record.asset_code, record.asset_name)
        if family:
            return family
        family = resolve_asset_type_family(db, record.asset_type_code)
        if family:
            return family

    return family_from_text(code)


def resolve_operation_type_family(db: Session, operation_type_code):
    """
    Family of an operation type.

    The applicable asset type is checked before the operation type text on
    purpose: barge stages such as ``SHUTTLE_RECEIPT`` or ``STS_OUT`` belong to
    barge movement operation types and must not classify the operation type as
    a shuttle movement.
    """
    code = normalize_text(operation_type_code)
    if not code:
        return None

    record = get_operation_type_record(db, code)
    if record is not None:
        family = resolve_asset_type_family(db, record.applicable_asset_type_code)
        if family:
            return family
        return family_from_text(record.operation_type_code, record.operation_type_name)

    return family_from_text(code)


def resolve_template_family(db: Session, template_id):
    """Family implied by the entry layout of the ticket's template."""
    template = get_template_record(db, template_id)
    if template is None:
        return None
    return family_from_text(
        template.entry_layout_type, template.calculation_engine,
        keywords=LAYOUT_FAMILY_KEYWORDS,
    )


def configured_module_for_operation_type(db: Session, operation_type_code):
    """
    Active Tracking Module Configuration module of an operation type, or None.

    Imported lazily: ``tracking_config`` imports this module.
    """
    from app.services.tracking_config import TRACKING_MODULES, get_active_config_row

    for module_code in TRACKING_MODULES:
        if get_active_config_row(db, module_code, operation_type_code) is not None:
            return module_code
    return None


def resolve_ticket_family(db: Session, transaction):
    """
    Asset family of an operation ticket, or None when it cannot be resolved.

    Used as the legacy rule (no Tracking Module Configuration): a barge ticket
    is recognised from the configuration, the asset type / asset masters, the
    operation type and finally the entry layout - never from the literal word
    "barge" alone.
    """
    if transaction is None:
        return None

    configured = configured_module_for_operation_type(db, transaction.operation_type_code)
    if configured:
        return configured

    family = resolve_asset_type_family(db, transaction.primary_asset_type_code)
    if family:
        return family

    family = resolve_asset_family(db, transaction.primary_asset_code)
    if family:
        return family

    family = resolve_operation_type_family(db, transaction.operation_type_code)
    if family:
        return family

    return resolve_template_family(db, transaction.operation_template_id)


def resolve_operation_type_family_with_config(db: Session, operation_type_code):
    """
    Family of an operation type including its Tracking Module Configuration
    row (admin intent first, then the masters).
    """
    configured = configured_module_for_operation_type(db, operation_type_code)
    if configured:
        return configured
    return resolve_operation_type_family(db, operation_type_code)


def operation_type_is_barge(db: Session, operation_type) -> bool:
    """True when the operation type belongs to barge movements."""
    if operation_type is None:
        return False
    family = resolve_operation_type_family_with_config(
        db, getattr(operation_type, "operation_type_code", None)
    )
    return family == FAMILY_BARGE


def asset_type_conflicting_module(db: Session, operation_type, module_code: str):
    """
    Module that should own this operation type instead of ``module_code``.

    Returns the conflicting tracking module code (a module defined in
    ``TRACKING_MODULES``, i.e. BARGE or TANKER) or None. Unknown and
    non-tracking asset families (custom codes, tanks, vessels, layouts) are
    left to the admin: only a *different* tracking module blocks the mapping.
    """
    from app.services.tracking_config import TRACKING_MODULES

    if operation_type is None:
        return None

    family = resolve_operation_type_family(
        db, getattr(operation_type, "operation_type_code", None)
    )
    if not family or family == module_code:
        return None
    if family not in TRACKING_MODULES:
        return None
    return family
