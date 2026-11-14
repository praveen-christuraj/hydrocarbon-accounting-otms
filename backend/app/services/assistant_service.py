"""Local AI Guide & Curated Memory Service for Hydrocarbon Accounting OTMS.

Combines three reliable pillars with zero hallucination and zero external API calls:

1. **Curated Constant Memory (``SYSTEM_MEMORY``)** seeded idempotently into
   ``assistant_memory`` (immutable via API — edits/deletes return HTTP 409)
   plus admin-managed custom company/location SOP directives.
2. **Ultra-Light Local Semantic Retrieval** (:class:`LocalSemanticIndex`:
   Hydrocarbon Synonym Expansion + BM25+ + Typo-Tolerant Character N-gram &
   Word Truncated SVD / LSA) over both ``assistant_memory`` and the repository's
   54 ``Manuals/pages/*.md`` page guides.
3. **Permission- & Scope-Checked Live Hydrocarbon Analytics**: operational
   questions ("show losses and gains at LOC001", "what is the latest stock on
   T-101?", "which drafts have abnormalities?", "what is missing before
   month-end close?") query the exact same canonical models/services used by
   the application screens, enforcing RBAC, Location Scope, and Party Scope.
"""

from __future__ import annotations

import re
import threading
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import AI_EMBEDDING_BACKEND, AI_ML_ANOMALY_ENABLED
from app.dependencies.permissions import (
    apply_location_filter,
    apply_transaction_party_scope_filter,
    user_has_permission,
)
from app.models import (
    AssistantConversation,
    AssistantMemory,
    BookStockDailyEntry,
    ExportPermit,
    ExportTransaction,
    FlowmeterRecord,
    Location,
    TankStockLedger,
    User,
)
from app.services.audit_service import create_audit_log
from app.services.entry_checks_service import list_open_ticket_abnormalities
from app.services.local_semantic_index import (
    IndexedDoc,
    LocalSemanticIndex,
    load_repository_manual_docs,
)
from app.services.stock_anomaly_service import (
    get_stock_anomaly_overview,
    get_terminal_readiness_checks,
)
from app.utils.helpers import get_current_user_display_name, safe_float

TRANSCRIPT_LIMIT = 50
VALID_MEMORY_CATEGORIES = (
    "workflow",
    "calculation",
    "data-entry",
    "accounting-analysis",
    "navigation",
    "policy",
    "faq",
)

# ---------------------------------------------------------------------------
# Shipped System Memory (seeded once, immutable via API)
# ---------------------------------------------------------------------------

SYSTEM_MEMORY: tuple[dict[str, Any], ...] = (
    {
        "memory_key": "workflow-terminal-setup",
        "title": "Terminal Onboarding: Initial Setup Order from Locations to Operation Entry",
        "category": "workflow",
        "keywords": "start setup onboarding order location asset calibration template availability workflow policy accounting day",
        "route": "/locations",
        "permission": "",
        "sort_order": 10,
        "body": (
            "Before operators can log tickets and generate Material Balance reports, configure five layers in order: "
            "(1) Master Data: Locations, Asset Types, Assets, Calibration Templates, Active Asset Calibration Tables, and Asset Assignments; "
            "(2) Accounting & Operations Setup: Location Accounting Day Settings, Operation Types, Tank/Vessel Operations, Operation Templates, "
            "Location Operation Availability, and Workflow Policies; "
            "(3) Tracking & Reconciliation: Tracking Module Configuration, Table 11 Factors, Barge Seal Master, Prime Mover–Tanker Links, "
            "Flowmeter Configs, and Material Balance Templates; "
            "(4) Company Report Profiles for branded printing; and "
            "(5) RBAC: Roles, Permissions, and User/Role Location Assignments."
        ),
        "steps": (
            "Create active Locations and set each location's Accounting Day Setting (cutoff time & timezone).\n"
            "Create Asset Types, Assets, upload active Calibration Tables, and assign assets to locations.\n"
            "Configure Operation Types, Tank/Vessel Operations, Operation Templates, and enable Location Operation Availability.\n"
            "Set up Material Balance Template columns for each location and Company Report Profiles for printing.\n"
            "Assign Roles, Permissions, and Location Scopes to operators and supervisors."
        ),
    },
    {
        "memory_key": "workflow-ticket-lifecycle",
        "title": "Operation Ticket Lifecycle: Draft → Submitted → Approved → Stock Ledger",
        "category": "workflow",
        "keywords": "ticket lifecycle draft submit review approve reject recall cancel correction hold revoke ledger",
        "route": "/operation-transactions",
        "permission": "View Operation Transaction",
        "sort_order": 15,
        "body": (
            "Every Operation Entry starts as a Draft ticket. Submitting a ticket routes it through the active "
            "Operation Workflow Policy into the Task Manager. Only Approved tickets post to the Tank Stock Ledger, "
            "Out-Turn Summary, Material Balance Report, and custody tracking modules. Once approved, a ticket is "
            "locked; errors require an Approved Transaction Correction Request and Admin Revoke."
        ),
        "steps": (
            "Create or bulk-upload the ticket in Operation Entry and verify all pre-save Entry Quality Checks.\n"
            "Review saved measurements in Operation Transaction Detail and Submit the ticket.\n"
            "Supervisors open Task Manager or Operation Transaction Register, verify any 'Kept as entered' check notes, and Approve.\n"
            "If a mistake is discovered after approval, file a Correction Request rather than editing raw history."
        ),
    },
    {
        "memory_key": "workflow-month-end-close",
        "title": "Month-End Hydrocarbon Accounting Close Routine",
        "category": "workflow",
        "keywords": "month end close reconciliation checklist readiness sequence rebuild audit period",
        "route": "/stock-anomaly-analytics",
        "permission": "View Stock Anomaly Analytics",
        "sort_order": 20,
        "body": (
            "A clean month-end close requires zero unposted Draft/Submitted tickets in the closing window, "
            "zero pending Correction Hold requests, verified Out-Turn stock continuity per tank, reconciled "
            "custody-transfer movements (Tanker acknowledgements, Barge comparisons, Shuttle/FSO voyages, "
            "Movement Mappings), and investigated Material Balance Loss/Gain or CUSUM drift alerts."
        ),
        "steps": (
            "Open Stock Anomaly Analytics → Terminal Readiness and clear pending Draft/Submitted tickets.\n"
            "Resolve any Out-Turn sequence breaks via Tank Stock Ledger validation/rebuild.\n"
            "Investigate daily Material Balance Loss/Gain alerts (> ±0.30%) and CUSUM creeping-loss warnings.\n"
            "Close reconciled Movement Mappings, Barge Trips, Tanker Acknowledgements, Shuttle and FSO Voyages.\n"
            "Print final Material Balance, Out-Turn Summary, and Export/Book Stock reports with the Company Report Profile."
        ),
    },
    {
        "memory_key": "calc-tank-gauging-astm",
        "title": "How Tank Gauging Quantities Are Calculated (TOV, GOV, VCF, GSV, NSV, LT, MT)",
        "category": "calculation",
        "keywords": "tov gov gsv nsv vcf api60 density15 bsw free water astm table 54b 6b table 11 lt mt formula",
        "route": "/operation-entry",
        "permission": "",
        "sort_order": 25,
        "body": (
            "Tank quantities follow ASTM petroleum measurement equations: "
            "TOV (Total Observed Volume) and Free Water are interpolated from the tank's active Calibration Table using Total Dip and Water Dip; "
            "GOV = TOV − Free Water; Observed API (or Observed Density at Sample Temp) is iteratively corrected to API@60°F and Density@15°C; "
            "VCF (Volume Correction Factor) is computed from API@60°F and Tank Temperature; "
            "GSV = GOV × VCF; BS&W Volume = GSV × (BS&W% / 100); NSV = GSV − BS&W Volume; "
            "Long Tons (LT) = NSV × Table 11 LT Factor; Metric Tons (MT) = LT × 1.01605."
        ),
        "steps": (
            "Ensure the tank has an Active Calibration Table uploaded in Asset Calibration Table.\n"
            "Confirm °C vs °F units on both Tank Temperature and Sample Temperature before saving.\n"
            "Use Observed API OR Observed Density (never enter kg/m³ inside Observed API).\n"
            "Confirm Table 11 Factors are populated in Table 11 Factor Master for accurate LT/MT conversion."
        ),
    },
    {
        "memory_key": "calc-material-balance",
        "title": "How Material Balance Book Closing and Loss/Gain Are Calculated",
        "category": "calculation",
        "keywords": "material balance book closing actual physical closing loss gain internal transfer template formula",
        "route": "/material-balance-report",
        "permission": "View Material Balance Report",
        "sort_order": 30,
        "body": (
            "Material Balance compares theoretical Book Closing against gauged Physical (Actual) Closing per accounting day: "
            "Book Closing = Opening Stock + Eligible Receipts/Production (IN) − Eligible Dispatches/Draining (OUT). "
            "Internal transfers marked 'Is Internal Transfer = Yes' cancel out across tanks and are excluded from location-level Book Closing. "
            "Loss / Gain = Actual Closing − Book Closing (negative indicates a loss/shortage; positive indicates a gain)."
        ),
        "steps": (
            "Configure active Material Balance Template columns per location with correct IN/OUT and internal-transfer flags.\n"
            "Check both NSV and GSV units when a Loss/Gain appears to distinguish BS&W/water issues from physical crude variance.\n"
            "Ensure all tickets for the accounting day are Approved before final reconciliation."
        ),
    },
    {
        "memory_key": "calc-accounting-day-datetime",
        "title": "How Operation Date/Time & Accounting Day Cutoff Work (Payload-Only Rule)",
        "category": "calculation",
        "keywords": "accounting date cutoff payload datetime gauging time timezone out turn sequence chronological",
        "route": "/location-accounting-day-settings",
        "permission": "",
        "sort_order": 35,
        "body": (
            "A ticket's authoritative timestamp always comes from its operation payload (gauging date+time, "
            "tanker transaction date+time, multi-tank Before date+time, flowmeter reading date+time, or Shuttle/FSO operation date+time). "
            "Each location's active Location Accounting Day Setting (day start time & timezone) maps that payload timestamp "
            "to an Accounting Date, and Out-Turn chains order same-day tickets strictly chronologically by payload date and time."
        ),
        "steps": (
            "Double-check gauging time whenever an entry falls within ±20 minutes of the location's cutoff (e.g., 06:00).\n"
            "Avoid backdating gauges behind already-approved gauges unless you intend to run a Tank Stock Ledger sequence rebuild."
        ),
    },
    {
        "memory_key": "calc-fso-variance",
        "title": "How FSO Variance and Shuttle Net Stock Are Calculated",
        "category": "calculation",
        "keywords": "fso variance shuttle net stock water vessel quantity formula offtake receipt",
        "route": "/fso-tracking",
        "permission": "View FSO Tracking",
        "sort_order": 40,
        "body": (
            "On Shuttle and FSO tickets, Net Stock (NSV) = Closing Stock − Opening Stock and Net Water = Closing Water − Opening Water. "
            "FSO Variance is computed as |Net Stock + Net Water| − Vessel Quantity. "
            "For receipt-like (IN) operations from a Shuttle, the Shuttle Number is mandatory so the FSO receipt reconciles cleanly."
        ),
        "steps": (
            "Verify Opening Stock and Opening Water match the prior approved voyage closing snapshot.\n"
            "Investigate any FSO variance exceeding ±0.50% of Vessel Quantity before closing the FSO voyage."
        ),
    },
    {
        "memory_key": "calc-book-stock",
        "title": "How Book Stock Management (Government Book Data) Calculates & Rolls Forward",
        "category": "calculation",
        "keywords": "book stock government data opening production dispatch adjustment closing auto carry roll forward two products",
        "route": "/book-stock/daily-entries",
        "permission": "View Book Stock Entry",
        "sort_order": 45,
        "body": (
            "Book Stock is a self-contained Government Data ledger supporting up to two active products that are never mixed. "
            "Closing Stock = Opening Stock + Production − Dispatch + Adjustment (adjustments are signed). "
            "Main-field production equals the sum of its sub-field productions, blocks sum their main fields, and entities roll up blocks. "
            "Opening Stock auto-carries from the previous day's Closing Stock; editing an earlier day rolls forward all subsequent auto-carried openings "
            "while leaving manually overridden openings untouched."
        ),
        "steps": (
            "Select the exact Entity, Block, and Product before entering sub-field productions.\n"
            "Only override an auto-carried Opening Stock when correcting an official baseline, and record clear remarks.\n"
            "Confirm zero-production warnings when a normally producing field is left blank."
        ),
    },
    {
        "memory_key": "calc-flowmeter-volume",
        "title": "How Flowmeter Totalizer Readings & Volumes Are Calculated",
        "category": "calculation",
        "keywords": "flowmeter totalizer opening closing delta meter factor m3 bbl 6.289811 rollover calibration",
        "route": "/flowmeter-records",
        "permission": "View Flowmeter Record",
        "sort_order": 50,
        "body": (
            "For each configured meter in a stream, Delta = Closing Reading − Opening Reading and Gross Observed = Delta × Meter Factor. "
            "If the meter unit is cubic metres (m³), barrels are converted using 1 m³ = 6.289811 BBL. "
            "VCF (from API@60°F and temperature) and BS&W% then yield Net Standard BBL. "
            "Each new reading's Opening Totalizer must match the previous approved Closing Totalizer to avoid silent loss/gain."
        ),
        "steps": (
            "Verify Opening Reading matches the prior Closing Reading (use the one-click Apply suggestion if flagged).\n"
            "If Closing < Opening due to a totalizer rollover, document the rollover limit in Remarks.\n"
            "Maintain annual meter calibration dates in Flowmeter Config to prevent creeping meter-factor drift."
        ),
    },
    {
        "memory_key": "analysis-loss-gain-diagnosis",
        "title": "Accounting Skill: How to Diagnose Material Balance Losses and Gains",
        "category": "accounting-analysis",
        "keywords": "diagnose loss gain root cause gsv nsv bsw water temperature vcf unapproved internal transfer",
        "route": "/stock-anomaly-analytics",
        "permission": "View Stock Anomaly Analytics",
        "sort_order": 55,
        "body": (
            "Follow a four-step hydrocarbon accounting triage whenever Actual Closing diverges from Book Closing: "
            "(1) Compare GSV Loss/Gain vs NSV Loss/Gain — if GSV is balanced while NSV shows loss/gain, the cause is almost certainly BS&W% or Free Water measurement, not missing crude; "
            "(2) Compare GOV vs GSV — divergence points to Tank Temperature (°C/°F swap) or API@60°F / VCF error; "
            "(3) Check unposted Draft/Submitted/Correction-Hold tickets and Out-Turn sequence breaks on that tank; "
            "(4) Check same-day Internal Transfers to verify both sender and receiver tanks posted."
        ),
        "steps": (
            "Open Stock Anomaly Analytics → Loss & Gain Diagnostics to see the automated root-cause classification.\n"
            "Check Material Balance Report in both NSV and GSV units side-by-side.\n"
            "Inspect Tank Stock Ledger / Out-Turn Summary for missing or mis-signed (IN vs OUT) operations."
        ),
    },
    {
        "memory_key": "analysis-cusum-creeping-loss",
        "title": "Accounting Skill: Detecting Creeping Losses & Meter Drift (CUSUM Radar)",
        "category": "accounting-analysis",
        "keywords": "cusum creeping loss drift meter factor calibration bias rolling trend silent loss",
        "route": "/stock-anomaly-analytics",
        "permission": "View Stock Anomaly Analytics",
        "sort_order": 60,
        "body": (
            "Single-day tolerances (±0.30%) cannot catch a steady −0.15%/day loss that accumulates to −4.5% over a month. "
            "OTMS runs Page's two-sided Cumulative Sum (CUSUM) over every tank's daily Material Balance Loss/Gain % and "
            "custody-transfer transit variance %. Sustained directional drift flags a Creeping Loss or Creeping Gain warning "
            "even when every single day looked acceptable on its own."
        ),
        "steps": (
            "Review the CUSUM Creeping-Loss Radar tab in Stock Anomaly Analytics weekly.\n"
            "For creeping tank losses, audit calibration tables, tank bottom buildup, vapor recovery, and BS&W sampling consistency.\n"
            "For creeping meter or transit losses, schedule meter proving or barge VEF / strapping verification."
        ),
    },
    {
        "memory_key": "analysis-custody-transfer-variance",
        "title": "Accounting Skill: Custody Transfer Variance, Barge/Tanker Losses & Seal Security",
        "category": "accounting-analysis",
        "keywords": "custody transfer transit loss shortage barge tanker seal mismatch tamper movement mapping comparison",
        "route": "/stock-anomaly-analytics",
        "permission": "View Stock Anomaly Analytics",
        "sort_order": 65,
        "body": (
            "Custody transfers across Tanker Tracking, Barge Trip Comparisons, Shuttle/FSO, and Movement Mappings "
            "(BARGE_TO_SHUTTLE, SHUTTLE_TO_FSO, BARGE_TO_FSO) compare dispatched Source NSV against received Target NSV. "
            "Any transit shortage exceeding ±0.35% triggers a variance warning; when a transit loss coincides with a "
            "Seal Mismatch (C1/C2/M1/M2 or Barge permanent/manifold seals), it is automatically escalated as a High-Priority security event."
        ),
        "steps": (
            "Always link receiver tanker tickets to their approved sender ticket so seal and NSV comparisons run pre-save.\n"
            "Investigate chronic asset bias where a specific barge or tanker repeatedly loses > 0.30% across multiple voyages.\n"
            "Escalate any simultaneous Seal Mismatch + NSV Shortage immediately with photos and remarks."
        ),
    },
    {
        "memory_key": "entry-checks-and-tier2-ml",
        "title": "How Pre-Save Entry Checks & Tier 2 Multi-Variable ML Protect Data Quality",
        "category": "data-entry",
        "keywords": "entry checks typo abnormality warning ml isolation forest half space mahalanobis keep as entered apply",
        "route": "/operation-entry",
        "permission": "",
        "sort_order": 70,
        "body": (
            "Every operational form runs two local intelligence layers before saving: "
            "(1) Instant Physics, Continuity & Keying-Slip Checks (catching ×10/×100 zeros, °C↔°F swaps, mm↔cm dips, "
            "m³↔BBL swaps, API↔Density swaps, IN/OUT sign mismatches, flowmeter totalizer gaps, and sender-receiver seal mismatches); and "
            "(2) Tier 2 Multi-Variable Anomaly ML (a pure-NumPy ensemble of Isolation Forest, Streaming Half-Space Trees, and Robust Mahalanobis) "
            "that detects abnormal *combinations* of variables (e.g., Dip + Temp + API + BS&W + Delta) even when each field alone passes limits. "
            "Checks are strictly advisory, explain their exact historical basis, offer one-click Apply, and record audited 'Keep as entered' decisions "
            "that calibrate the ML model and automatically reopen if the underlying value changes."
        ),
        "steps": (
            "Review the Entry Quality Checks panel directly above Save on Operation Entry, Flowmeter, and Book Stock forms.\n"
            "Click 'Apply <value>' to fix a recognised typo in the unsaved form, then verify the recalculated totals.\n"
            "If an unusual reading is genuinely valid, save the Draft and click 'Keep as entered' with an explanation note for supervisors."
        ),
    },
    {
        "memory_key": "entry-bulk-upload-tickets",
        "title": "Bulk Uploading Operation Entries & Master Records (.xlsx / .csv)",
        "category": "data-entry",
        "keywords": "bulk upload import excel csv template draft tickets rows fix validation",
        "route": "/operation-entry",
        "permission": "Create Operation Entry",
        "sort_order": 75,
        "body": (
            "Every list page supports .xlsx and .csv bulk upload through DataTableToolbar, and Operation Entry provides "
            "'Bulk Upload Tickets' which creates one Draft ticket per valid spreadsheet row (including payload columns such as "
            "`payload.tank_gauging_payload.inputs.dipCm`). Tank-gauging quantities and pre-save anomaly screening run in Step 3 "
            "Preview before saving, and failed rows can be downloaded as a 'Rows to fix' file."
        ),
        "steps": (
            "Download the XLSX or CSV template for the chosen Operation Type and Template.\n"
            "Fill metadata and payload columns, then upload and inspect validation and AI abnormality flags in Step 3 Preview.\n"
            "Import valid rows as Drafts, fix any failed rows from the downloaded error sheet, and re-upload."
        ),
    },
    {
        "memory_key": "policy-rbac-location-party-scope",
        "title": "Permissions, Location Scope & Cross-Location Party Involvement Rule",
        "category": "policy",
        "keywords": "rbac permission role location scope party rule sender receiver origin destination access denied",
        "route": "/access-summary",
        "permission": "",
        "sort_order": 80,
        "body": (
            "Access in Hydrocarbon Accounting OTMS is governed by four criteria: (1) granular CRUD & workflow permissions "
            "(View / Create / Edit / Delete / named workflow actions — no legacy 'Manage' permissions); "
            "(2) Location Scope (union of user locations and role locations, or All Locations); "
            "(3) the Cross-Location Party Rule — a user at Location B can view and acknowledge a movement addressed to B "
            "even without access to Origin Location A; and (4) Workflow Policy & Location Operation Availability. "
            "Every AI assistant answer and anomaly report enforces these exact same boundaries."
        ),
        "steps": (
            "Open User Management → Access Summary to inspect a user's effective roles, permissions, and locations.\n"
            "Use Role Permission Assignment and Permission Presets to grant granular capabilities cleanly."
        ),
    },
    {
        "memory_key": "policy-print-report-profile",
        "title": "Printing Reports: Mandatory Company Report Profile Selection",
        "category": "policy",
        "keywords": "print report company profile branding header footer logo dialog",
        "route": "/company-report-profiles",
        "permission": "",
        "sort_order": 85,
        "body": (
            "Every Print action across all modules opens the global Company Report Profile selector first so reports "
            "never print with a hidden or hard-coded default header. Once an administrator saves profiles in Company "
            "Report Profile Master, any authenticated operator can choose the required entity profile before printing."
        ),
        "steps": (
            "Configure company logos, titles, and footer notes in Configurations → Company Report Profile Master.\n"
            "Click Print on any report, select the target Company Report Profile, and confirm."
        ),
    },
    {
        "memory_key": "policy-audit-security",
        "title": "Auditing, 2FA Security & Dialog Safety Conventions",
        "category": "policy",
        "keywords": "audit log trail security 2fa password activity log modal dialog backup",
        "route": "/audit-logs",
        "permission": "",
        "sort_order": 90,
        "body": (
            "Every create, edit, delete, approval, entry-check decision, and memory update writes an immutable server-side "
            "AuditLog row with actor, timestamp, entity, and before/after context. Client-side navigation, exports, imports, "
            "and prints are also recorded in the User Menu Activity panel. Dialogs never close on accidental backdrop clicks."
        ),
        "steps": (
            "Administrators inspect complete mutation history in Administration → Audit Logs.\n"
            "Every user manages password policy and TOTP 2FA in User Management → Profile & Security."
        ),
    },
    {
        "memory_key": "nav-modules-overview",
        "title": "Navigation Map: Where Every Module Lives in the Top Menu",
        "category": "navigation",
        "keywords": "where find menu navigation screen page module map home",
        "route": "/",
        "permission": "",
        "sort_order": 95,
        "body": (
            "The top navigation organizes the application into 9 groups: "
            "User Management (users, roles, permissions, scopes, security), "
            "Master Data Management (locations, assets, calibration tables, prime mover links), "
            "Configurations (operation/tank/vessel masters, templates, workflow policies, Table 11, accounting days, Material Balance templates, flowmeters, Report Builder), "
            "Operations (Operation Entry, Transaction Register, Movement Mapping, Flowmeter Records), "
            "Operation Tracking (Barge, Tanker, Shuttle, FSO), "
            "Export Operations (permits, liftings, consignees, reports), "
            "Book Data (Government Book Stock dashboard, daily entries, block/entity summaries), "
            "Reporting (Tank/Out-Turn Summaries, Material Balance, Tanker Report, Stock Anomaly Analytics, AI Guide, Custom Reports), and "
            "Administration (Notifications, Backup Recovery, Database Browser, Audit Logs)."
        ),
        "steps": (
            "Press Alt+G from any screen to open this route-aware AI Guide drawer.\n"
            "Click any source link inside an answer card to jump directly to the relevant page."
        ),
    },
)


# ---------------------------------------------------------------------------
# Cached Local Semantic Index (invalidated automatically when memory changes)
# ---------------------------------------------------------------------------

_INDEX_LOCK = threading.Lock()
_CACHED_INDEX: LocalSemanticIndex | None = None
_CACHED_SIGNATURE: tuple[int, str] | None = None
_MANUAL_DOCS_CACHE: list[IndexedDoc] | None = None


def _get_manual_docs() -> list[IndexedDoc]:
    global _MANUAL_DOCS_CACHE
    if _MANUAL_DOCS_CACHE is None:
        _MANUAL_DOCS_CACHE = load_repository_manual_docs()
    return _MANUAL_DOCS_CACHE


def invalidate_semantic_index() -> None:
    global _CACHED_INDEX, _CACHED_SIGNATURE
    with _INDEX_LOCK:
        _CACHED_INDEX = None
        _CACHED_SIGNATURE = None


def seed_system_memory(db: Session) -> int:
    """Idempotently seed shipped ``SYSTEM_MEMORY`` entries without overwriting existing rows."""
    existing_keys = {
        row[0]
        for row in db.query(AssistantMemory.memory_key).all()
    }
    added = 0
    for item in SYSTEM_MEMORY:
        if item["memory_key"] in existing_keys:
            continue
        db.add(
            AssistantMemory(
                memory_key=item["memory_key"],
                title=item["title"],
                category=item["category"],
                keywords=item["keywords"],
                body=item["body"],
                steps=item["steps"],
                route=item["route"],
                location_code=None,
                permission=item["permission"],
                is_system=True,
                is_active=True,
                sort_order=item["sort_order"],
                created_by="System",
            )
        )
        added += 1
    if added:
        db.commit()
        invalidate_semantic_index()
    return added


def _get_semantic_index(db: Session, rows: list[AssistantMemory]) -> LocalSemanticIndex:
    global _CACHED_INDEX, _CACHED_SIGNATURE
    sig = (
        len(rows),
        "|".join(f"{r.id}:{r.memory_key}:{r.is_active}:{r.updated_at}" for r in rows[:120]),
    )
    with _INDEX_LOCK:
        if _CACHED_INDEX is not None and _CACHED_SIGNATURE == sig:
            return _CACHED_INDEX
        docs: list[IndexedDoc] = []
        for r in rows:
            if not r.is_active:
                continue
            docs.append(
                IndexedDoc(
                    doc_id=f"memory:{r.memory_key}",
                    title=r.title,
                    keywords=r.keywords,
                    body=r.body,
                    route=r.route or "",
                    permission=r.permission or "",
                    category=r.category or "faq",
                    source_kind="memory",
                    sort_order=r.sort_order or 100,
                )
            )
        docs.extend(_get_manual_docs())
        idx = LocalSemanticIndex(svd_dim=48).fit(docs)
        _CACHED_INDEX = idx
        _CACHED_SIGNATURE = sig
        return idx


# ---------------------------------------------------------------------------
# Memory CRUD (Admin-Managed Custom Directives; Shipped Entries -> 409)
# ---------------------------------------------------------------------------


def serialize_memory(row: AssistantMemory) -> dict[str, Any]:
    return {
        "id": row.id,
        "memory_key": row.memory_key,
        "title": row.title,
        "category": row.category,
        "keywords": row.keywords,
        "body": row.body,
        "steps": [line.strip() for line in (row.steps or "").splitlines() if line.strip()],
        "route": row.route or "",
        "location_code": row.location_code or "",
        "permission": row.permission or "",
        "is_system": bool(row.is_system),
        "is_active": bool(row.is_active),
        "sort_order": row.sort_order,
        "created_by": row.created_by or "",
        "updated_by": row.updated_by or "",
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def list_memory(db: Session, *, include_inactive: bool = True) -> list[dict[str, Any]]:
    seed_system_memory(db)
    q = db.query(AssistantMemory)
    if not include_inactive:
        q = q.filter(AssistantMemory.is_active.is_(True))
    rows = q.order_by(AssistantMemory.sort_order.asc(), AssistantMemory.title.asc()).all()
    return [serialize_memory(r) for r in rows]


def _clean_memory_key(raw: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", (raw or "").strip().casefold()).strip("-")[:95]
    return cleaned or "custom-directive"


def create_memory(db: Session, current_user: User, data: dict[str, Any]) -> dict[str, Any]:
    seed_system_memory(db)
    title = str(data.get("title") or "").strip()
    if not title:
        raise ValueError("Title is required")
    key = _clean_memory_key(str(data.get("memory_key") or title))
    if db.query(AssistantMemory).filter(AssistantMemory.memory_key == key).first():
        raise ValueError(f"Memory key '{key}' already exists")

    category = str(data.get("category") or "policy").strip().lower()
    if category not in VALID_MEMORY_CATEGORIES:
        category = "faq"
    steps_raw = data.get("steps") or []
    if isinstance(steps_raw, list):
        steps_str = "\n".join(str(s).strip() for s in steps_raw if str(s).strip())
    else:
        steps_str = str(steps_raw).strip()

    actor = get_current_user_display_name(current_user)
    row = AssistantMemory(
        memory_key=key,
        title=title[:200],
        category=category,
        keywords=" ".join(str(data.get("keywords") or "").casefold().split())[:500],
        body=str(data.get("body") or "").strip(),
        steps=steps_str,
        route=str(data.get("route") or "").strip()[:200],
        location_code=str(data.get("location_code") or "").strip() or None,
        permission=str(data.get("permission") or "").strip()[:120],
        is_system=False,
        is_active=bool(data.get("is_active", True)),
        sort_order=int(data.get("sort_order", 120)),
        created_by=actor,
        updated_by=actor,
    )
    db.add(row)
    db.flush()
    create_audit_log(
        db=db,
        module_name="Assistant Memory",
        action="Create Assistant Memory",
        current_user=current_user,
        entity_type="assistant_memory",
        entity_id=row.id,
        entity_label=f"{row.memory_key} · {row.title}",
        remarks=f"Created custom AI guide memory entry ({row.category})",
        request_path="/assistant/memory",
        details={"memory_key": row.memory_key, "category": row.category, "location_code": row.location_code},
    )
    db.commit()
    db.refresh(row)
    invalidate_semantic_index()
    return serialize_memory(row)


def update_memory(db: Session, current_user: User, memory_id: int, data: dict[str, Any]) -> dict[str, Any]:
    row = db.query(AssistantMemory).filter(AssistantMemory.id == memory_id).first()
    if row is None:
        raise LookupError("Memory entry not found")
    if row.is_system:
        raise PermissionError(
            "Shipped application memory is immutable. Create a custom directive beside it with your site wording."
        )
    for field in ("title", "body", "route", "permission"):
        if field in data and data[field] is not None:
            setattr(row, field, str(data[field]).strip())
    if "category" in data and data["category"] in VALID_MEMORY_CATEGORIES:
        row.category = str(data["category"])
    if "keywords" in data and data["keywords"] is not None:
        row.keywords = " ".join(str(data["keywords"]).casefold().split())[:500]
    if "steps" in data and data["steps"] is not None:
        raw_steps = data["steps"]
        row.steps = (
            "\n".join(str(s).strip() for s in raw_steps if str(s).strip())
            if isinstance(raw_steps, list)
            else str(raw_steps).strip()
        )
    if "location_code" in data:
        row.location_code = str(data["location_code"] or "").strip() or None
    if "is_active" in data and data["is_active"] is not None:
        row.is_active = bool(data["is_active"])
    if "sort_order" in data and data["sort_order"] is not None:
        row.sort_order = int(data["sort_order"])
    row.updated_by = get_current_user_display_name(current_user)
    row.updated_at = datetime.utcnow()
    db.flush()
    create_audit_log(
        db=db,
        module_name="Assistant Memory",
        action="Update Assistant Memory",
        current_user=current_user,
        entity_type="assistant_memory",
        entity_id=row.id,
        entity_label=f"{row.memory_key} · {row.title}",
        remarks="Updated custom AI guide memory entry",
        request_path=f"/assistant/memory/{memory_id}",
        details={"memory_key": row.memory_key, "is_active": row.is_active},
    )
    db.commit()
    db.refresh(row)
    invalidate_semantic_index()
    return serialize_memory(row)


def delete_memory(db: Session, current_user: User, memory_id: int) -> None:
    row = db.query(AssistantMemory).filter(AssistantMemory.id == memory_id).first()
    if row is None:
        raise LookupError("Memory entry not found")
    if row.is_system:
        raise PermissionError("Shipped application memory cannot be deleted.")
    key, title = row.memory_key, row.title
    db.delete(row)
    db.flush()
    create_audit_log(
        db=db,
        module_name="Assistant Memory",
        action="Delete Assistant Memory",
        current_user=current_user,
        entity_type="assistant_memory",
        entity_id=memory_id,
        entity_label=f"{key} · {title}",
        remarks="Deleted custom AI guide memory entry",
        request_path=f"/assistant/memory/{memory_id}",
        details={"memory_key": key},
    )
    db.commit()
    invalidate_semantic_index()


# ---------------------------------------------------------------------------
# Intent Detection & Live Analytical Handlers
# ---------------------------------------------------------------------------

EXPLANATION_CUES = (
    "how is ", "how are ", "how do ", "how does ", "how should ", "how can ",
    "how to ", "explain", "formula", "calculated", "calculation", "definition",
    "meaning of", "difference between", "what does ", "what is the rule",
)

INTENT_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        "data_health",
        (
            "missing", "readiness", "month end", "month-end", "ready to close", "check my data",
            "data health", "hygiene", "what is left", "outstanding", "pending close",
        ),
    ),
    (
        "entry_checks",
        (
            "open abnormalities", "abnormal draft", "flagged ticket", "typo ticket",
            "which draft", "entry check", "abnormal entries", "suspicious ticket",
        ),
    ),
    (
        "loss_gain",
        (
            "loss", "losses", "gain", "gains", "creeping", "cusum", "imbalance",
            "material balance anomal", "shrinkage", "why did tank",
        ),
    ),
    (
        "transit_variance",
        (
            "transit variance", "transit loss", "short landing", "seal mismatch",
            "barge loss", "tanker loss", "convoy variance", "custody transfer",
        ),
    ),
    (
        "stock_position",
        (
            "closing stock", "latest stock", "current stock", "stock on tank",
            "tank balance", "nsv on", "inventory on", "tank stock",
        ),
    ),
    (
        "book_stock",
        ("book stock balance", "book stock position", "book stock for", "block stock"),
    ),
    (
        "export_permits",
        ("export permit", "permit balance", "remaining permit", "permit utilization"),
    ),
)

_CODE_REFERENCE = re.compile(r"\b[A-Z]{2,}[-_ ]?\d+[A-Z0-9-]*\b")


def _detect_intent(question: str) -> str:
    text = (question or "").casefold()
    asks_explanation = (
        "how many" not in text
        and "how much" not in text
        and "which " not in text
        and "show " not in text
        and not _CODE_REFERENCE.search(question)
        and any(cue in text for cue in EXPLANATION_CUES)
    )
    if asks_explanation:
        return "knowledge"
    for intent, needles in INTENT_RULES:
        if any(needle in text for needle in needles):
            return intent
    return "knowledge"


def _extract_location_from_question(db: Session, current_user: User, question: str) -> str | None:
    q = apply_location_filter(
        db.query(Location).filter(Location.status == "Active"),
        Location,
        current_user,
        db,
    )
    text = (question or "").casefold()
    for loc in q.all():
        if loc.location_code and loc.location_code.casefold() in text:
            return loc.location_code
        if loc.location_name and len(loc.location_name) >= 4 and loc.location_name.casefold() in text:
            return loc.location_code
    return None


def _permission_refusal(permission_name: str) -> dict[str, Any]:
    return {
        "answer": (
            f"That answer requires the '{permission_name}' permission, which your current role does not hold. "
            "Ask an administrator to assign it in User Management → Role Permission Assignment."
        ),
        "intent": "permission",
        "memory_key": "",
        "confidence": "high",
        "category": "policy",
        "retrieval_mode": "rbac_guard",
        "facts": [],
        "steps": [],
        "sources": [{"label": "Access Summary", "route": "/access-summary"}],
        "follow_ups": [
            "How do permissions and location scopes work?",
            "What is missing before month-end close?",
        ],
    }


def _answer_data_health(db: Session, current_user: User, location_code: str | None) -> dict[str, Any]:
    checks = get_terminal_readiness_checks(db, current_user, location_code=location_code)
    if not checks:
        return {
            "answer": (
                "No blocking readiness gaps were found in the locations and modules you can access. "
                "Pending tickets, accounting-day configurations, calibrations, and open voyages all look clear."
            ),
            "intent": "data_health",
            "memory_key": "",
            "confidence": "high",
            "category": "workflow",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"}],
            "follow_ups": ["Show losses and gains", "Which draft tickets have open abnormalities?"],
        }
    lines = "\n".join(f"• {c['label']}: {c['value']} — {c['hint']}" for c in checks[:8])
    return {
        "answer": f"Operational and month-end readiness checks needing attention:\n{lines}",
        "intent": "data_health",
        "memory_key": "",
        "confidence": "high",
        "category": "workflow",
        "retrieval_mode": "live_service",
        "facts": [
            {
                "label": c["label"],
                "value": c["value"],
                "hint": c["hint"],
                "route": c["route"],
                "permission": c["permission"],
            }
            for c in checks[:8]
        ],
        "steps": [],
        "sources": [{"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"}],
        "follow_ups": [
            "Show losses and gains",
            "Which draft tickets have open abnormalities?",
            "How does the month-end close routine work?",
        ],
    }


def _answer_loss_gain(db: Session, current_user: User, location_code: str | None) -> dict[str, Any]:
    if not (
        user_has_permission(current_user, "View Stock Anomaly Analytics", db)
        or user_has_permission(current_user, "View Material Balance Report", db)
    ):
        return _permission_refusal("View Stock Anomaly Analytics")

    overview = get_stock_anomaly_overview(db, current_user, location_code=location_code)
    events = overview["loss_gain_events"]
    cusum = overview["cusum_alerts"]
    kpis = overview["kpis"]

    if not events and not cusum:
        return {
            "answer": (
                f"No Material Balance Loss/Gain events beyond tolerance or CUSUM creeping-loss trends were detected"
                + (f" for location {location_code}" if location_code else " across your accessible locations")
                + " in the last 45 days."
            ),
            "intent": "loss_gain",
            "memory_key": "",
            "confidence": "high",
            "category": "accounting-analysis",
            "retrieval_mode": "live_service",
            "facts": [
                {"label": "Loss/Gain Events", "value": "0", "hint": "Within tolerance", "route": "/material-balance-report", "permission": "View Material Balance Report"},
                {"label": "CUSUM Drift Alerts", "value": "0", "hint": "No systematic creeping bias", "route": "/stock-anomaly-analytics", "permission": "View Stock Anomaly Analytics"},
            ],
            "steps": [],
            "sources": [
                {"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"},
                {"label": "Material Balance Report", "route": "/material-balance-report"},
            ],
            "follow_ups": ["How do I diagnose Material Balance losses and gains?", "Show custody transfer transit variances"],
        }

    summary_lines: list[str] = []
    facts: list[dict[str, Any]] = [
        {"label": "Loss/Gain Events", "value": str(kpis["loss_gain_events"]), "hint": f"{kpis['loss_gain_warnings']} warning(s)", "route": "/material-balance-report", "permission": "View Material Balance Report"},
        {"label": "CUSUM Creeping Drift", "value": str(kpis["cusum_drift_alerts"]), "hint": "Sustained multi-day directional bias", "route": "/stock-anomaly-analytics", "permission": "View Stock Anomaly Analytics"},
    ]
    for ev in events[:5]:
        summary_lines.append(
            f"• {ev['location_code']} / {ev['tank_asset_code']} ({ev['accounting_date']}): "
            f"{ev['loss_gain_nsv_bbl']:+,.2f} BBL ({ev['loss_gain_nsv_pct']:+.2f}%) — {ev['root_cause']}"
        )
    for dr in cusum[:3]:
        summary_lines.append(
            f"• [CUSUM {dr['direction']}] {dr['location_code']} / {dr['tank_asset_code']}: "
            f"rolling {dr['rolling_mean_pct']:+.3f}% across {dr['sample_count']} days ({dr['streak_length']}-day streak)"
        )
    return {
        "answer": (
            f"Detected {kpis['loss_gain_events']} Material Balance Loss/Gain event(s) and "
            f"{kpis['cusum_drift_alerts']} CUSUM creeping-drift alert(s):\n" + "\n".join(summary_lines)
        ),
        "intent": "loss_gain",
        "memory_key": "",
        "confidence": "high",
        "category": "accounting-analysis",
        "retrieval_mode": "live_service",
        "facts": facts,
        "steps": [
            "Open Stock Anomaly Analytics to review automated GSV vs NSV root-cause classifications.",
            "Cross-check pending Draft/Submitted tickets and Out-Turn sequence continuity on flagged tanks.",
        ],
        "sources": [
            {"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"},
            {"label": "Material Balance Report", "route": "/material-balance-report"},
        ],
        "follow_ups": [
            "How do I diagnose Material Balance losses and gains?",
            "How does CUSUM creeping-loss detection work?",
            "What is missing before month-end close?",
        ],
    }


def _answer_transit_variance(db: Session, current_user: User, location_code: str | None) -> dict[str, Any]:
    if not (
        user_has_permission(current_user, "View Stock Anomaly Analytics", db)
        or user_has_permission(current_user, "View Tanker Tracking", db)
        or user_has_permission(current_user, "View Barge Tracking", db)
        or user_has_permission(current_user, "View Movement Mapping", db)
    ):
        return _permission_refusal("View Stock Anomaly Analytics")

    overview = get_stock_anomaly_overview(db, current_user, location_code=location_code)
    alerts = overview["transit_alerts"]
    bias = overview["chronic_bias"]
    if not alerts and not bias:
        return {
            "answer": "No custody-transfer transit variances or seal-mismatch security escalations were found in your accessible records.",
            "intent": "transit_variance",
            "memory_key": "",
            "confidence": "high",
            "category": "accounting-analysis",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"}],
            "follow_ups": ["Show losses and gains", "What is missing before month-end close?"],
        }

    lines = [
        f"• [{a['module']}] {a['reference']} ({a['asset_code']}): {a['variance_bbl']:+,.2f} BBL ({a['variance_pct']:+.2f}%)"
        + (" — SEAL MISMATCH" if a["seal_issue"] else "")
        for a in alerts[:6]
    ]
    return {
        "answer": (
            f"Found {len(alerts)} custody-transfer variance alert(s) "
            f"({overview['kpis']['seal_security_escalations']} with seal mismatches) "
            f"and {len(bias)} chronic asset bias profile(s):\n" + "\n".join(lines)
        ),
        "intent": "transit_variance",
        "memory_key": "",
        "confidence": "high",
        "category": "accounting-analysis",
        "retrieval_mode": "live_service",
        "facts": [
            {"label": "Transit Alerts", "value": str(len(alerts)), "hint": "Exceeds ±0.35% or seal mismatch", "route": "/stock-anomaly-analytics", "permission": "View Stock Anomaly Analytics"},
            {"label": "Seal Escalations", "value": str(overview["kpis"]["seal_security_escalations"]), "hint": "High-priority security correlation", "route": "/tanker-tracking", "permission": "View Tanker Tracking"},
            {"label": "Chronic Bias Assets", "value": str(len(bias)), "hint": "Repeated multi-voyage drift", "route": "/stock-anomaly-analytics", "permission": "View Stock Anomaly Analytics"},
        ],
        "steps": [],
        "sources": [
            {"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"},
            {"label": "Tanker Tracking", "route": "/tanker-tracking"},
            {"label": "Barge Tracking", "route": "/barge-tracking"},
        ],
        "follow_ups": ["How are custody-transfer losses investigated?", "Show losses and gains"],
    }


def _answer_entry_checks(db: Session, current_user: User, location_code: str | None) -> dict[str, Any]:
    if not user_has_permission(current_user, "View Entry Checks", db):
        return _permission_refusal("View Entry Checks")
    flagged = list_open_ticket_abnormalities(db, current_user, location_code=location_code, limit=30)
    if not flagged:
        return {
            "answer": "No open Draft or Submitted tickets currently carry unresolved entry-check abnormalities.",
            "intent": "entry_checks",
            "memory_key": "",
            "confidence": "high",
            "category": "data-entry",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Operation Transaction Register", "route": "/operation-transactions"}],
            "follow_ups": ["How do pre-save entry checks and Tier 2 ML work?", "What is missing before month-end close?"],
        }
    lines = [
        f"• {f['ticket_number']} ({f['status']} · {f['asset_code'] or '—'}): "
        f"{f['open_warnings']} warning(s), {f['open_notices']} notice(s) — {f['top_finding']}"
        for f in flagged[:6]
    ]
    return {
        "answer": f"{len(flagged)} open ticket(s) carry unresolved abnormality checks:\n" + "\n".join(lines),
        "intent": "entry_checks",
        "memory_key": "",
        "confidence": "high",
        "category": "data-entry",
        "retrieval_mode": "live_service",
        "facts": [
            {
                "label": f["ticket_number"],
                "value": f"{f['open_warnings']}W / {f['open_notices']}N",
                "hint": f["top_finding"],
                "route": f"/operation-transactions/{f['transaction_id']}",
                "permission": "View Operation Transaction",
            }
            for f in flagged[:6]
        ],
        "steps": [],
        "sources": [{"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"}],
        "follow_ups": ["How do pre-save entry checks and Tier 2 ML work?"],
    }


def _answer_stock_position(
    db: Session,
    current_user: User,
    question: str,
    location_code: str | None,
) -> dict[str, Any]:
    if not (
        user_has_permission(current_user, "View Tank Stock Ledger", db)
        or user_has_permission(current_user, "View Material Balance Report", db)
        or user_has_permission(current_user, "View Out-Turn Summary", db)
    ):
        return _permission_refusal("View Tank Stock Ledger")

    q = apply_location_filter(
        db.query(TankStockLedger).filter(TankStockLedger.status == "Active"),
        TankStockLedger,
        current_user,
        db,
    )
    if location_code:
        q = q.filter(TankStockLedger.location_code.ilike(location_code))

    rows = q.order_by(TankStockLedger.operation_date.desc(), TankStockLedger.id.desc()).limit(500).all()
    text_lower = question.casefold()
    latest_by_tank: dict[tuple[str, str], TankStockLedger] = {}
    for r in rows:
        key = (r.location_code or "", r.tank_asset_code or "")
        if key not in latest_by_tank:
            latest_by_tank[key] = r

    matched = [
        r for (_loc, tank), r in latest_by_tank.items()
        if tank and tank.casefold() in text_lower
    ]
    selected = matched if matched else list(latest_by_tank.values())[:8]
    if not selected:
        return {
            "answer": "No active Tank Stock Ledger snapshots were found in your accessible locations.",
            "intent": "stock_position",
            "memory_key": "",
            "confidence": "medium",
            "category": "calculation",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Tank Operation Summary", "route": "/tank-operation-summary"}],
            "follow_ups": ["How are tank gauging quantities calculated?"],
        }

    lines = []
    facts = []
    for r in selected[:8]:
        nsv = safe_float(r.stock_nsv_bbl or r.running_balance_nsv_bbl)
        gsv = safe_float(r.stock_gsv_bbl or r.running_balance_gsv_bbl)
        mt = safe_float(r.stock_mt or r.running_balance_mt)
        dt_str = (r.accounting_date or r.operation_date).isoformat() if (r.accounting_date or r.operation_date) else "—"
        lines.append(
            f"• {r.location_code} / {r.tank_asset_code}: {nsv:,.2f} BBL NSV ({gsv:,.2f} BBL GSV · {mt:,.2f} MT) as of {dt_str}"
        )
        facts.append({
            "label": f"{r.location_code} · {r.tank_asset_code}",
            "value": f"{nsv:,.2f} BBL NSV",
            "hint": f"GSV {gsv:,.2f} BBL · {dt_str} · {r.ticket_number or '—'}",
            "route": "/tank-operation-summary",
            "permission": "View Tank Operation Summary",
        })
    return {
        "answer": "Latest approved tank stock positions:\n" + "\n".join(lines),
        "intent": "stock_position",
        "memory_key": "",
        "confidence": "high",
        "category": "calculation",
        "retrieval_mode": "live_service",
        "facts": facts,
        "steps": [],
        "sources": [
            {"label": "Tank Operation Summary", "route": "/tank-operation-summary"},
            {"label": "Material Balance Report", "route": "/material-balance-report"},
        ],
        "follow_ups": ["Show losses and gains", "What is missing before month-end close?"],
    }


def _answer_book_stock(db: Session, current_user: User, question: str) -> dict[str, Any]:
    if not (
        user_has_permission(current_user, "View Book Stock Entry", db)
        or user_has_permission(current_user, "View Book Stock Report", db)
    ):
        return _permission_refusal("View Book Stock Report")

    rows = (
        db.query(BookStockDailyEntry)
        .order_by(BookStockDailyEntry.entry_date.desc(), BookStockDailyEntry.id.desc())
        .limit(200)
        .all()
    )
    latest: dict[tuple[str, str, str], BookStockDailyEntry] = {}
    for r in rows:
        key = (r.entity_code, r.block_code, r.product_code)
        if key not in latest:
            latest[key] = r
    text_lower = question.casefold()
    matched = [
        r for (ent, blk, _prod), r in latest.items()
        if (blk and blk.casefold() in text_lower) or (ent and ent.casefold() in text_lower)
    ]
    selected = matched if matched else list(latest.values())[:6]
    if not selected:
        return {
            "answer": "No Book Stock daily entries have been recorded yet.",
            "intent": "book_stock",
            "memory_key": "",
            "confidence": "medium",
            "category": "calculation",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Book Stock Dashboard", "route": "/book-stock/dashboard"}],
            "follow_ups": ["How does Book Stock roll-forward work?"],
        }
    lines = [
        f"• {r.entity_code} / {r.block_code} ({r.product_code}) on {r.entry_date.isoformat()}: "
        f"Closing {safe_float(r.closing_stock):,.2f} (Prod {safe_float(r.production):,.2f}, Disp {safe_float(r.dispatch):,.2f})"
        for r in selected[:6]
    ]
    return {
        "answer": "Latest Book Stock closing balances (kept strictly per product):\n" + "\n".join(lines),
        "intent": "book_stock",
        "memory_key": "",
        "confidence": "high",
        "category": "calculation",
        "retrieval_mode": "live_service",
        "facts": [
            {
                "label": f"{r.block_code} · {r.product_code}",
                "value": f"{safe_float(r.closing_stock):,.2f}",
                "hint": f"{r.entity_code} · {r.entry_date.isoformat()}",
                "route": "/book-stock/block-summary",
                "permission": "View Book Stock Report",
            }
            for r in selected[:6]
        ],
        "steps": [],
        "sources": [{"label": "Book Stock Dashboard", "route": "/book-stock/dashboard"}],
        "follow_ups": ["How does Book Stock roll-forward work?"],
    }


def _answer_export_permits(db: Session, current_user: User, location_code: str | None) -> dict[str, Any]:
    if not user_has_permission(current_user, "View Export Permit", db):
        return _permission_refusal("View Export Permit")
    q = db.query(ExportPermit).filter(ExportPermit.status == "Active")
    if location_code:
        q = q.filter(ExportPermit.location_code.ilike(location_code))
    permits = q.order_by(ExportPermit.id.desc()).limit(10).all()
    if not permits:
        return {
            "answer": "No active Export Permits were found for the selected scope.",
            "intent": "export_permits",
            "memory_key": "",
            "confidence": "medium",
            "category": "calculation",
            "retrieval_mode": "live_service",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Export Permits", "route": "/export-operations/permits"}],
            "follow_ups": ["What is missing before month-end close?"],
        }
    lines = []
    facts = []
    for p in permits[:6]:
        alloc = safe_float(p.permit_volume) + safe_float(p.supplementary_permit)
        used = safe_float(
            db.query(func.coalesce(func.sum(ExportTransaction.volume), 0.0))
            .filter(ExportTransaction.permit_number == p.permit_number, ExportTransaction.status != "Deleted")
            .scalar()
        )
        rem = alloc - used
        pct = (used / alloc * 100.0) if alloc > 0 else 0.0
        lines.append(f"• {p.permit_number} ({p.entity_code}/{p.block_code} · {p.quarter}): {rem:,.0f} BBL remaining ({pct:.1f}% used)")
        facts.append({
            "label": p.permit_number,
            "value": f"{rem:,.0f} BBL left",
            "hint": f"{pct:.1f}% of {alloc:,.0f} BBL · {p.quarter}",
            "route": "/export-operations/permits",
            "permission": "View Export Permit",
        })
    return {
        "answer": "Active Export Permit utilization:\n" + "\n".join(lines),
        "intent": "export_permits",
        "memory_key": "",
        "confidence": "high",
        "category": "calculation",
        "retrieval_mode": "live_service",
        "facts": facts,
        "steps": [],
        "sources": [{"label": "Export Permits", "route": "/export-operations/permits"}],
        "follow_ups": ["What is missing before month-end close?"],
    }


def _answer_from_knowledge(
    db: Session,
    current_user: User,
    question: str,
    route: str,
    location_code: str | None,
) -> dict[str, Any]:
    rows = db.query(AssistantMemory).filter(AssistantMemory.is_active.is_(True)).all()
    index = _get_semantic_index(db, rows)
    by_key = {f"memory:{r.memory_key}": r for r in rows}

    def _allowed(doc: IndexedDoc) -> bool:
        if doc.permission and not user_has_permission(current_user, doc.permission, db):
            return False
        mem = by_key.get(doc.doc_id)
        if mem and mem.location_code and location_code and mem.location_code.casefold() != location_code.casefold():
            return False
        return True

    hits = index.search(question, route=route, allowed_filter=_allowed, top_k=5)
    if not hits or hits[0].score < 1.35:
        topics = "\n".join(
            f"• {r.title}"
            for r in sorted(rows, key=lambda x: x.sort_order)[:12]
            if not r.permission or user_has_permission(current_user, r.permission, db)
        )
        return {
            "answer": (
                "I could not match that to the curated hydrocarbon accounting memory or page guides I am allowed to cite. "
                "I never invent figures or procedures. Ask about a workflow, ASTM/Material Balance formula, "
                "loss/gain diagnostics, entry checks, or live terminal readiness.\n\nTopics in memory:\n"
                + topics
            ),
            "intent": "knowledge",
            "memory_key": "",
            "confidence": "low",
            "category": "faq",
            "retrieval_mode": f"semantic_{index.backend_name}",
            "facts": [],
            "steps": [],
            "sources": [{"label": "Stock Anomaly Analytics", "route": "/stock-anomaly-analytics"}],
            "follow_ups": [
                "How are tank gauging quantities calculated?",
                "Show losses and gains",
                "What is missing before month-end close?",
            ],
        }

    top = hits[0]
    mem = by_key.get(top.doc.doc_id)
    steps = [s.strip() for s in (mem.steps or "").splitlines() if s.strip()] if mem else []
    sources: list[dict[str, str]] = []
    if top.doc.route:
        sources.append({"label": top.doc.title, "route": top.doc.route})
    for extra in hits[1:4]:
        if extra.score >= 1.1 and extra.doc.route:
            src = {"label": extra.doc.title, "route": extra.doc.route}
            if src not in sources:
                sources.append(src)

    confidence = "high" if (top.lexical_score >= 1.8 or top.semantic_score >= 0.45) else "medium"
    return {
        "answer": top.doc.body,
        "intent": "knowledge",
        "memory_key": mem.memory_key if mem else top.doc.doc_id,
        "confidence": confidence,
        "category": top.doc.category,
        "retrieval_mode": f"semantic_{index.backend_name}",
        "facts": [],
        "steps": steps,
        "sources": sources,
        "follow_ups": _follow_ups_for_category(top.doc.category),
    }


def _follow_ups_for_category(category: str) -> list[str]:
    if category == "accounting-analysis":
        return [
            "Show losses and gains",
            "Show custody transfer transit variances",
            "What is missing before month-end close?",
        ]
    if category == "calculation":
        return [
            "How do I diagnose Material Balance losses and gains?",
            "How do pre-save entry checks and Tier 2 ML work?",
            "What is missing before month-end close?",
        ]
    return [
        "How are tank gauging quantities calculated?",
        "Show losses and gains",
        "Which draft tickets have open abnormalities?",
    ]


def get_assistant_overview(
    db: Session,
    current_user: User,
    *,
    route: str = "",
) -> dict[str, Any]:
    seed_system_memory(db)
    total_memory = db.query(AssistantMemory).filter(AssistantMemory.is_active.is_(True)).count()
    custom_memory = (
        db.query(AssistantMemory)
        .filter(AssistantMemory.is_active.is_(True), AssistantMemory.is_system.is_(False))
        .count()
    )
    checks = get_terminal_readiness_checks(db, current_user)
    manual_count = len(_get_manual_docs())

    # Route-aware contextual quick prompts
    norm = (route or "").strip().lower()
    if "/operation-entry" in norm:
        prompts = [
            "How do pre-save entry checks and Tier 2 ML work?",
            "How are tank gauging quantities calculated?",
            "How does the accounting day cutoff work?",
            "Which draft tickets have open abnormalities?",
        ]
    elif "/material-balance" in norm or "/out-turn" in norm or "/stock-anomaly" in norm:
        prompts = [
            "Show losses and gains",
            "How do I diagnose Material Balance losses and gains?",
            "How does CUSUM creeping-loss detection work?",
            "What is missing before month-end close?",
        ]
    elif "/book-stock" in norm:
        prompts = [
            "How does Book Stock roll-forward work?",
            "Show latest Book Stock balance",
            "What is missing before month-end close?",
        ]
    elif "/barge" in norm or "/tanker" in norm or "/fso" in norm or "/shuttle" in norm or "/movement" in norm:
        prompts = [
            "Show custody transfer transit variances",
            "How are FSO variance and shuttle net stock calculated?",
            "How are custody-transfer losses investigated?",
            "What is missing before month-end close?",
        ]
    else:
        prompts = [
            "Show losses and gains",
            "What is missing before month-end close?",
            "Which draft tickets have open abnormalities?",
            "How are tank gauging quantities calculated?",
        ]

    return {
        "memory_count": total_memory,
        "custom_memory_count": custom_memory,
        "manual_guides_indexed": manual_count,
        "outstanding_checks": len(checks),
        "quick_prompts": prompts,
        "ai_engine": {
            "semantic_backend": AI_EMBEDDING_BACKEND,
            "multivariate_ml_enabled": AI_ML_ANOMALY_ENABLED,
            "ml_models": [
                "NumpyIsolationForest (48 trees)",
                "StreamingHalfSpaceForest (20 trees)",
                "RobustMahalanobis (Ledoit-Wolf shrinkage)",
                "Page Two-Sided CUSUM",
            ],
            "local_only": True,
        },
    }


def ask_assistant(
    db: Session,
    current_user: User,
    question: str,
    *,
    route: str = "",
    location_code: str | None = None,
    save_history: bool = True,
) -> dict[str, Any]:
    """Answer a question using Local Semantic Memory + Live Permission-Scoped Services."""
    if not user_has_permission(current_user, "View AI Assistant", db):
        return _permission_refusal("View AI Assistant")

    seed_system_memory(db)
    clean_q = " ".join((question or "").strip().split())
    if not clean_q:
        return {
            "answer": "Ask about a hydrocarbon accounting formula, workflow, loss/gain anomaly, or terminal readiness.",
            "intent": "knowledge",
            "memory_key": "",
            "confidence": "low",
            "category": "faq",
            "retrieval_mode": "prompt",
            "facts": [],
            "steps": [],
            "sources": [],
            "follow_ups": ["Show losses and gains", "What is missing before month-end close?"],
        }

    resolved_loc = location_code or _extract_location_from_question(db, current_user, clean_q)
    intent = _detect_intent(clean_q)

    try:
        if intent == "data_health":
            result = _answer_data_health(db, current_user, resolved_loc)
        elif intent == "loss_gain":
            result = _answer_loss_gain(db, current_user, resolved_loc)
        elif intent == "transit_variance":
            result = _answer_transit_variance(db, current_user, resolved_loc)
        elif intent == "entry_checks":
            result = _answer_entry_checks(db, current_user, resolved_loc)
        elif intent == "stock_position":
            result = _answer_stock_position(db, current_user, clean_q, resolved_loc)
        elif intent == "book_stock":
            result = _answer_book_stock(db, current_user, clean_q)
        elif intent == "export_permits":
            result = _answer_export_permits(db, current_user, resolved_loc)
        else:
            result = _answer_from_knowledge(db, current_user, clean_q, route, resolved_loc)
    except Exception:  # noqa: BLE001 - never crash assistant on unexpected data
        result = {
            "answer": (
                "I could not read that live figure right now because one of the underlying records could not be parsed. "
                "Open the corresponding report screen to inspect it directly — the guide never guesses a figure."
            ),
            "intent": intent,
            "memory_key": "",
            "confidence": "low",
            "category": "faq",
            "retrieval_mode": "fallback",
            "facts": [],
            "steps": [],
            "sources": [],
            "follow_ups": ["What is missing before month-end close?"],
        }

    if save_history and getattr(current_user, "id", None) is not None:
        db.add(
            AssistantConversation(
                user_id=current_user.id,
                question=clean_q[:500],
                intent=str(result.get("intent") or "")[:60],
                memory_key=str(result.get("memory_key") or "")[:100],
                confidence=str(result.get("confidence") or "medium")[:20],
                route=(route or "")[:200],
            )
        )
        db.commit()
    return result


def get_user_history(db: Session, current_user: User, limit: int = 30) -> list[dict[str, Any]]:
    rows = (
        db.query(AssistantConversation)
        .filter(AssistantConversation.user_id == current_user.id)
        .order_by(AssistantConversation.created_at.desc(), AssistantConversation.id.desc())
        .limit(min(limit, TRANSCRIPT_LIMIT))
        .all()
    )
    return [
        {
            "id": r.id,
            "question": r.question,
            "intent": r.intent,
            "memory_key": r.memory_key,
            "confidence": r.confidence,
            "route": r.route,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]
