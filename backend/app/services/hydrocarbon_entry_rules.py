"""Hydrocarbon Accounting pre-save & saved-ticket entry check rules.

Pure-function domain engine (no DB imports, no clock, deterministic).
Covers every operational entry screen in Hydrocarbon Accounting OTMS:

* ``tank_gauging`` — Tank Gauging (ASTM dip, water dip, temperature °C/°F,
  Observed API / Density, BS&W%, sign vs stock direction, implied flow rate,
  accounting-day cutoff & backdating chronology, duplicate detection, Tier 2 ML).
* ``multi_tank`` — Multi-Tank Before/After Barge (time inversion, compartment
  sign conflicts, CCF/VEF bounds, permanent & temporary seals, Tier 2 ML).
* ``tanker`` — Tanker Truck (sender↔receiver seal mismatch, transit NSV
  variance %, API/BS&W quality divergence, prime-mover link, Tier 2 ML).
* ``flowmeter`` — Flowmeter Reading (opening vs previous closing continuity,
  negative delta rollover/swap, m³↔BBL factor slip, overdue calibration, ML).
* ``shuttle`` & ``fso`` — Voyage opening continuity, FSO variance tolerance,
  sign direction mismatch, mandatory shuttle reference on receipt, Tier 2 ML.
* ``book_stock`` — Government Book Stock (manual opening override caution,
  missing usual producing field/sub-field, ×10 typo, large adjustment, ML).
* ``export`` — Export Operations (permit utilization > 85% / > 100%, quarter
  expiry, abnormal lifting volume).

Every finding is **advisory-only**, explains the exact numbers and basis,
carries a deterministic ``fingerprint`` (so "Keep as entered" automatically
reopens if the value changes), and offers a concrete ``suggested_value`` when
a keying slip or continuity correction is cleanly identified.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field as dc_field
from datetime import date, datetime
from typing import Any, Sequence

from app.services import entry_statistics as stats
from app.services.multivariate_anomaly_ml import (
    DEFAULT_ANOMALY_THRESHOLD,
    evaluate_multivariate_anomaly,
)

MAX_FINDINGS = 40
M3_TO_BBL = 6.289811


@dataclass
class EntryFinding:
    key: str
    code: str
    severity: str  # "warning" | "info"
    category: str  # "typo" | "physics" | "accounting" | "continuity" | "security" | "ml_multivariate"
    title: str
    message: str
    basis: str = ""
    field: str = ""
    subject_label: str = ""
    current_value: str | None = None
    current_display: str = ""
    suggested_value: str | None = None
    suggested_display: str = ""
    suggested_unit: str | None = None
    usual_display: str = ""
    history_count: int = 0
    fingerprint: str = ""
    ml_score: float | None = None
    ml_drivers: list[dict[str, Any]] = dc_field(default_factory=list)
    reviewed: bool = False
    reviewed_by: str = ""
    reviewed_at: str | None = None
    review_note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "code": self.code,
            "severity": self.severity,
            "category": self.category,
            "title": self.title,
            "message": self.message,
            "basis": self.basis,
            "field": self.field,
            "subject_label": self.subject_label,
            "current_value": self.current_value,
            "current_display": self.current_display,
            "suggested_value": self.suggested_value,
            "suggested_display": self.suggested_display,
            "suggested_unit": self.suggested_unit,
            "usual_display": self.usual_display,
            "history_count": self.history_count,
            "fingerprint": self.fingerprint,
            "ml_score": self.ml_score,
            "ml_drivers": self.ml_drivers,
            "reviewed": self.reviewed,
            "reviewed_by": self.reviewed_by,
            "reviewed_at": self.reviewed_at,
            "review_note": self.review_note,
        }


def make_fingerprint(*parts: Any) -> str:
    raw = "|".join(str(p if p is not None else "").strip() for p in parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        v = float(value)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _norm_temp_unit(unit: Any) -> str:
    txt = str(unit or "C").replace("°", "").strip().upper()
    return "F" if txt.startswith("F") else "C"


def _to_celsius(value: float | None, unit: Any) -> float | None:
    if value is None:
        return None
    return (value - 32.0) / 1.8 if _norm_temp_unit(unit) == "F" else value


def _fmt(value: float | None, dp: int = 2) -> str:
    if value is None or not math.isfinite(value):
        return "—"
    return f"{value:,.{dp}f}".rstrip("0").rstrip(".") if dp > 0 else f"{value:,.0f}"


def _parse_dt(date_str: Any, time_str: Any) -> datetime | None:
    d_txt = str(date_str or "").strip()[:10]
    if not d_txt:
        return None
    t_txt = str(time_str or "").strip()[:8] or "00:00"
    if len(t_txt) == 5:
        t_txt = f"{t_txt}:00"
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(f"{d_txt} {t_txt}", fmt)
        except ValueError:
            continue
    try:
        return datetime.strptime(d_txt, "%Y-%m-%d")
    except ValueError:
        return None


def _attach_ml_finding(
    findings: list[EntryFinding],
    *,
    key_prefix: str,
    subject_label: str,
    history_vectors: Sequence[Sequence[float | None]],
    query_vector: Sequence[float | None],
    feature_names: Sequence[str],
    feature_labels: Sequence[str],
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> dict[str, Any]:
    """Run Tier 2 Multi-Variable ML ensemble and append an explainable finding if abnormal."""
    if not ml_enabled:
        return {"enabled": False, "available": False}
    verdict = evaluate_multivariate_anomaly(
        history_vectors,
        query_vector,
        feature_names,
        feature_labels,
        confirmed_history_rows=confirmed_vectors,
        threshold=ml_threshold,
    )
    meta = {
        "enabled": True,
        "available": verdict.available,
        "score": verdict.score,
        "threshold": verdict.threshold,
        "sample_count": verdict.sample_count,
        "iforest_score": verdict.iforest_score,
        "hstree_score": verdict.hstree_score,
        "mahalanobis_score": verdict.mahalanobis_score,
        "feedback_attenuation": verdict.feedback_attenuation,
    }
    if verdict.available and verdict.is_anomaly:
        fp_vals = [round(v, 3) if v is not None else "" for v in query_vector]
        findings.append(
            EntryFinding(
                key=f"{key_prefix}:ml-multivariate",
                code="ml-multivariate-anomaly",
                severity=verdict.severity,
                category="ml_multivariate",
                title="Unusual multi-variable operating pattern (Tier 2 ML)",
                message=verdict.summary,
                basis=verdict.basis,
                field="",
                subject_label=subject_label,
                current_value=f"{verdict.score:.2f}",
                current_display=f"ML score {verdict.score:.2f} / 1.00",
                usual_display=f"Normal envelope < {verdict.threshold:.2f}",
                history_count=verdict.sample_count,
                fingerprint=make_fingerprint("ml", key_prefix, *fp_vals),
                ml_score=verdict.score,
                ml_drivers=[
                    {
                        "name": d.name,
                        "label": d.label,
                        "value": d.value,
                        "typical": d.typical,
                        "z_score": d.z_score,
                        "contribution_pct": d.contribution_pct,
                    }
                    for d in verdict.drivers
                ],
            )
        )
    return meta


# ---------------------------------------------------------------------------
# 1. Tank Gauging Rules
# ---------------------------------------------------------------------------


def evaluate_tank_gauging_rules(
    *,
    asset_code: str,
    inputs: dict[str, Any],
    calculated: dict[str, Any],
    history: Sequence[dict[str, Any]] = (),
    previous_ledger: dict[str, Any] | None = None,
    max_calibration_dip_cm: float | None = None,
    accounting_cutoff_hhmm: str | None = None,
    duplicate_tickets: Sequence[str] = (),
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    """Evaluate a Tank Gauging ticket against physics, history & Tier 2 ML."""
    findings: list[EntryFinding] = []
    label = asset_code or "Selected Tank"

    dip_cm = _num(inputs.get("dipCm"))
    water_cm = _num(inputs.get("waterLevelCm"))
    tank_temp = _num(inputs.get("tankTemperature"))
    tank_temp_unit = _norm_temp_unit(inputs.get("tankTemperatureUnit"))
    sample_temp = _num(inputs.get("sampleTemperature"))
    sample_temp_unit = _norm_temp_unit(inputs.get("sampleTemperatureUnit"))
    obs_type = str(inputs.get("observedInputType") or "Observed API").strip()
    obs_api = _num(inputs.get("observedApi"))
    obs_density = _num(inputs.get("observedDensity"))
    bsw_pct = _num(inputs.get("bswPercent"))
    op_sign = str(inputs.get("tankOperationSign") or "").strip().upper()
    op_cat = str(inputs.get("tankOperationCategory") or "").strip().upper()
    op_label = str(inputs.get("tankOperationLabel") or inputs.get("tankOperationCode") or "").strip()

    nsv_bbl = _num(calculated.get("nsvBbl"))
    gsv_bbl = _num(calculated.get("gsvBbl"))
    tov_bbl = _num(calculated.get("tovBbl"))
    api60 = _num(calculated.get("api60"))
    free_water_bbl = _num(calculated.get("freeWaterBbl"))

    tank_temp_c = _to_celsius(tank_temp, tank_temp_unit)
    sample_temp_c = _to_celsius(sample_temp, sample_temp_unit)

    # 1. Hard physics / geometry sanity
    if dip_cm is not None and water_cm is not None and water_cm > dip_cm:
        findings.append(
            EntryFinding(
                key="tank:water-exceeds-dip",
                code="water-exceeds-dip",
                severity="warning",
                category="physics",
                title="Water level exceeds total tank dip",
                message=(
                    f"Water level ({_fmt(water_cm)} cm) is greater than total dip ({_fmt(dip_cm)} cm). "
                    "Verify whether Dip and Water Level were swapped or an extra digit was keyed."
                ),
                basis="Physical tank geometry requires Water Level ≤ Total Dip.",
                field="waterLevelCm",
                subject_label=label,
                current_value=str(water_cm),
                current_display=f"{_fmt(water_cm)} cm",
                fingerprint=make_fingerprint("water-gt-dip", dip_cm, water_cm),
            )
        )

    if dip_cm is not None and max_calibration_dip_cm and max_calibration_dip_cm > 0:
        if dip_cm > max_calibration_dip_cm:
            div10 = round(dip_cm / 10.0, 2)
            suggest_val = str(div10) if 0 < div10 <= max_calibration_dip_cm else None
            findings.append(
                EntryFinding(
                    key="tank:dip-above-chart",
                    code="dip-above-calibration",
                    severity="warning",
                    category="typo",
                    title="Dip exceeds maximum calibration chart height",
                    message=(
                        f"Entered dip {_fmt(dip_cm)} cm exceeds {label}'s maximum calibration height "
                        f"({_fmt(max_calibration_dip_cm)} cm)."
                        + (f" Dividing by 10 (mm → cm) gives {_fmt(div10)} cm." if suggest_val else "")
                    ),
                    basis=f"Active calibration table max height for {label}: {_fmt(max_calibration_dip_cm)} cm.",
                    field="dipCm",
                    subject_label=label,
                    current_value=str(dip_cm),
                    current_display=f"{_fmt(dip_cm)} cm",
                    suggested_value=suggest_val,
                    suggested_display=f"{_fmt(div10)} cm" if suggest_val else "",
                    usual_display=f"≤ {_fmt(max_calibration_dip_cm)} cm",
                    fingerprint=make_fingerprint("dip-above", dip_cm, max_calibration_dip_cm),
                )
            )
        elif dip_cm >= max_calibration_dip_cm * 0.96:
            findings.append(
                EntryFinding(
                    key="tank:dip-near-safe-fill",
                    code="dip-near-safe-fill",
                    severity="info",
                    category="physics",
                    title="Tank dip is above 96% of calibration height",
                    message=(
                        f"Entered dip {_fmt(dip_cm)} cm is {dip_cm / max_calibration_dip_cm * 100:.1f}% "
                        f"of {label}'s maximum chart height ({_fmt(max_calibration_dip_cm)} cm). Confirm safe fill height."
                    ),
                    basis="High-level overfill caution (> 96% of active calibration table).",
                    field="dipCm",
                    subject_label=label,
                    current_value=str(dip_cm),
                    current_display=f"{_fmt(dip_cm)} cm",
                    fingerprint=make_fingerprint("dip-high", dip_cm, max_calibration_dip_cm),
                )
            )

    # 2. Observed API vs Density input-mode mix-up
    if "api" in obs_type.lower() and obs_api is not None and obs_api > 120:
        cand_api = round(141.5 / (obs_api / stats.WATER_DENSITY_60F) - 131.5, 2) if 500 <= obs_api <= 1100 else None
        findings.append(
            EntryFinding(
                key="tank:api-density-swap",
                code="api-density-swap",
                severity="warning",
                category="typo",
                title="Density value appears entered in Observed API field",
                message=(
                    f"Observed API is {_fmt(obs_api)}, which looks like density in kg/m³."
                    + (f" Switching input mode to Observed Density (or using ~{_fmt(cand_api)}° API) is likely intended." if cand_api else "")
                ),
                basis="Crude/product API gravity sits between 10 and 90; kg/m³ density sits between 600 and 1,000.",
                field="observedApi",
                subject_label=label,
                current_value=str(obs_api),
                current_display=f"{_fmt(obs_api)} API",
                suggested_value=str(cand_api) if cand_api else None,
                suggested_display=f"{_fmt(cand_api)} API" if cand_api else "",
                fingerprint=make_fingerprint("api-swap", obs_api),
            )
        )
    elif "density" in obs_type.lower() and obs_density is not None and 5 <= obs_density <= 100:
        cand_dens = round((141.5 / (obs_density + 131.5)) * stats.WATER_DENSITY_60F, 1)
        findings.append(
            EntryFinding(
                key="tank:density-api-swap",
                code="api-density-swap",
                severity="warning",
                category="typo",
                title="API value appears entered in Observed Density field",
                message=(
                    f"Observed Density is {_fmt(obs_density)} kg/m³, which looks like API gravity "
                    f"(equivalent to ~{_fmt(cand_dens, 1)} kg/m³)."
                ),
                basis="Observed Density in kg/m³ sits between 600 and 1,000.",
                field="observedDensity",
                subject_label=label,
                current_value=str(obs_density),
                current_display=f"{_fmt(obs_density)} kg/m³",
                suggested_value=str(cand_dens),
                suggested_display=f"{_fmt(cand_dens, 1)} kg/m³",
                fingerprint=make_fingerprint("dens-swap", obs_density),
            )
        )

    # 3. Tank Temp vs Sample Temp divergence & °C/°F unit swap
    if tank_temp_c is not None and sample_temp_c is not None and abs(tank_temp_c - sample_temp_c) > 15.0:
        findings.append(
            EntryFinding(
                key="tank:temp-divergence",
                code="temp-divergence",
                severity="warning",
                category="physics",
                title="Tank temperature and sample temperature diverge sharply",
                message=(
                    f"Tank temperature ({_fmt(tank_temp_c, 1)}°C) and sample temperature "
                    f"({_fmt(sample_temp_c, 1)}°C) differ by {abs(tank_temp_c - sample_temp_c):.1f}°C. "
                    "Check °C/°F unit selection on both fields."
                ),
                basis="Tank bulk temperature and drawn sample temperature normally stay within ±15°C.",
                field="tankTemperature",
                subject_label=label,
                current_value=str(tank_temp),
                current_display=f"{_fmt(tank_temp, 1)}°{tank_temp_unit} vs {_fmt(sample_temp, 1)}°{sample_temp_unit}",
                fingerprint=make_fingerprint("temp-div", tank_temp, tank_temp_unit, sample_temp, sample_temp_unit),
            )
        )

    hist_temps_c = [_num(h.get("tank_temp_c")) for h in history if _num(h.get("tank_temp_c")) is not None]
    if tank_temp is not None and len(hist_temps_c) >= 3:
        t_slip = stats.explain_temperature_unit_slip(tank_temp, tank_temp_unit, hist_temps_c)  # type: ignore[arg-type]
        if t_slip is not None:
            findings.append(
                EntryFinding(
                    key="tank:temp-unit-swap",
                    code="temp-unit-swap",
                    severity="warning",
                    category="typo",
                    title="Tank temperature unit (°C / °F) looks swapped",
                    message=(
                        f"Tank temperature {_fmt(tank_temp, 1)}°{tank_temp_unit} is far from {label}'s "
                        f"usual temperature ({_fmt(stats._median(sorted(hist_temps_c)), 1)}°C); {t_slip.phrase}."
                    ),
                    basis=f"Based on {len(hist_temps_c)} prior approved gauges on {label}.",
                    field="tankTemperatureUnit",
                    subject_label=label,
                    current_value=tank_temp_unit,
                    current_display=f"{_fmt(tank_temp, 1)}°{tank_temp_unit}",
                    suggested_value=t_slip.unit_override,
                    suggested_display=f"Switch unit to °{t_slip.unit_override}",
                    suggested_unit=t_slip.unit_override,
                    usual_display=f"{_fmt(stats._median(sorted(hist_temps_c)), 1)}°C",
                    history_count=len(hist_temps_c),
                    fingerprint=make_fingerprint("temp-unit", tank_temp, tank_temp_unit),
                )
            )
    elif tank_temp is not None:
        if tank_temp_unit == "C" and 62.0 <= tank_temp <= 145.0:
            c_equiv = (tank_temp - 32.0) / 1.8
            findings.append(
                EntryFinding(
                    key="tank:temp-unit-swap",
                    code="temp-unit-swap",
                    severity="warning",
                    category="typo",
                    title="Tank temperature looks like °F entered in °C",
                    message=(
                        f"Tank temperature {_fmt(tank_temp, 1)}°C is unusually hot for ambient crude storage — "
                        f"{_fmt(tank_temp, 1)}°F equals {_fmt(c_equiv, 1)}°C."
                    ),
                    basis="Physical ambient hydrocarbon temperature unit check.",
                    field="tankTemperature",
                    subject_label=label,
                    current_value=str(tank_temp),
                    current_display=f"{_fmt(tank_temp, 1)}°C",
                    suggested_value=str(tank_temp),
                    suggested_display=f"{_fmt(tank_temp, 1)}°F",
                    suggested_unit="F",
                    fingerprint=make_fingerprint("temp-unit", tank_temp, tank_temp_unit),
                )
            )
        elif tank_temp_unit == "F" and 15.0 <= tank_temp <= 48.0:
            f_equiv = tank_temp * 1.8 + 32.0
            findings.append(
                EntryFinding(
                    key="tank:temp-unit-swap",
                    code="temp-unit-swap",
                    severity="warning",
                    category="typo",
                    title="Tank temperature looks like °C entered in °F",
                    message=(
                        f"Tank temperature {_fmt(tank_temp, 1)}°F is unusually cold for crude storage — "
                        f"{_fmt(tank_temp, 1)}°C equals {_fmt(f_equiv, 1)}°F."
                    ),
                    basis="Physical ambient hydrocarbon temperature unit check.",
                    field="tankTemperature",
                    subject_label=label,
                    current_value=str(tank_temp),
                    current_display=f"{_fmt(tank_temp, 1)}°F",
                    suggested_value=str(tank_temp),
                    suggested_display=f"{_fmt(tank_temp, 1)}°C",
                    suggested_unit="C",
                    fingerprint=make_fingerprint("temp-unit", tank_temp, tank_temp_unit),
                )
            )

    # 4. Historical statistical profile checks (BS&W%, Dip, API@60)
    hist_bsw = [_num(h.get("bsw_pct")) for h in history if _num(h.get("bsw_pct")) is not None and _num(h.get("bsw_pct")) > 0]  # type: ignore[operator]
    if bsw_pct is not None and bsw_pct > 0:
        if len(hist_bsw) >= stats.MIN_HISTORY:
            bsw_prof = stats.build_profile(hist_bsw)
            if bsw_prof is not None:
                dev = stats.measure(bsw_pct, bsw_prof)
                if dev and dev.noticeable:
                    slip = stats.explain_slip(bsw_pct, bsw_prof, stats.DECIMAL_FAMILIES)
                    sev = "warning" if (slip and dev.slip_grade) or dev.strong else "info"
                    findings.append(
                        EntryFinding(
                            key="tank:unusual-bsw",
                            code="unusual-bsw",
                            severity=sev,
                            category="typo" if slip else "accounting",
                            title="BS&W % is far outside this tank's usual range",
                            message=(
                                f"Entered BS&W is {_fmt(bsw_pct, 3)}% vs {label}'s usual {_fmt(bsw_prof.usual, 3)}% "
                                f"({dev.ratio:.1f}×)."
                                + (f" Looks like {slip.phrase} → {_fmt(float(slip.corrected), 3)}%." if slip else " Confirm lab BS&W certificate.")
                            ),
                            basis=(
                                f"Last {bsw_prof.count} approved gauges on {label} carried BS&W between "
                                f"{_fmt(bsw_prof.low, 3)}% and {_fmt(bsw_prof.high, 3)}% (median {_fmt(bsw_prof.median, 3)}%)."
                            ),
                            field="bswPercent",
                            subject_label=label,
                            current_value=str(bsw_pct),
                            current_display=f"{_fmt(bsw_pct, 3)}%",
                            suggested_value=str(slip.corrected) if slip else None,
                            suggested_display=f"{_fmt(float(slip.corrected), 3)}%" if slip else "",
                            usual_display=f"{_fmt(bsw_prof.low, 3)}% – {_fmt(bsw_prof.high, 3)}%",
                            history_count=bsw_prof.count,
                            fingerprint=make_fingerprint("bsw", bsw_pct),
                        )
                    )
        elif bsw_pct >= 15.0:
            div10 = round(bsw_pct / 10.0, 3)
            findings.append(
                EntryFinding(
                    key="tank:high-bsw-static",
                    code="high-bsw-caution",
                    severity="warning",
                    category="typo",
                    title="Unusually high BS&W %",
                    message=(
                        f"BS&W is {_fmt(bsw_pct, 2)}%, which deducts a very large share of Gross Standard Volume. "
                        f"Check for a dropped decimal point (e.g., {_fmt(div10, 2)}%)."
                    ),
                    basis="Crude/product tank BS&W rarely exceeds 15% outside dedicated slop/water tanks.",
                    field="bswPercent",
                    subject_label=label,
                    current_value=str(bsw_pct),
                    current_display=f"{_fmt(bsw_pct, 2)}%",
                    fingerprint=make_fingerprint("bsw-high", bsw_pct),
                )
            )

    hist_api60 = [_num(h.get("api60")) for h in history if _num(h.get("api60")) is not None and _num(h.get("api60")) > 0]  # type: ignore[operator]
    if api60 is not None and api60 > 0 and len(hist_api60) >= stats.MIN_HISTORY:
        api_prof = stats.build_linear_profile(hist_api60, floor=0.8)
        if api_prof is not None:
            z_api, noticeable, strong = stats.measure_linear(api60, api_prof)
            if noticeable and abs(api60 - api_prof.median) >= 2.0:
                findings.append(
                    EntryFinding(
                        key="tank:api60-drift",
                        code="api60-quality-drift",
                        severity="warning" if strong else "info",
                        category="accounting",
                        title="API @ 60°F shifted sharply from tank crude quality",
                        message=(
                            f"Calculated API@60°F is {_fmt(api60, 2)}° vs {label}'s usual {_fmt(api_prof.median, 2)}° "
                            f"(shift {api60 - api_prof.median:+.2f}° API). Verify Observed API/Density and sample temperature."
                        ),
                        basis=(
                            f"Last {api_prof.count} approved gauges on {label} ranged between "
                            f"{_fmt(api_prof.low, 2)}° and {_fmt(api_prof.high, 2)}° API."
                        ),
                        field="observedApi" if "api" in obs_type.lower() else "observedDensity",
                        subject_label=label,
                        current_value=str(api60),
                        current_display=f"{_fmt(api60, 2)}° API",
                        usual_display=f"{_fmt(api_prof.low, 2)}° – {_fmt(api_prof.high, 2)}° API",
                        history_count=api_prof.count,
                        fingerprint=make_fingerprint("api60", round(api60, 2)),
                    )
                )

    hist_dips = [_num(h.get("dip_cm")) for h in history if _num(h.get("dip_cm")) is not None and _num(h.get("dip_cm")) > 0]  # type: ignore[operator]
    if dip_cm is not None and dip_cm > 0 and len(hist_dips) >= stats.MIN_HISTORY:
        dip_prof = stats.build_profile(hist_dips)
        if dip_prof is not None:
            dev = stats.measure(dip_cm, dip_prof)
            if dev and dev.noticeable:
                slip = stats.explain_slip(dip_cm, dip_prof, stats.DIP_FAMILIES)
                if slip is not None:
                    findings.append(
                        EntryFinding(
                            key="tank:unusual-dip-slip",
                            code="unusual-dip-slip",
                            severity="warning" if dev.slip_grade else "info",
                            category="typo",
                            title="Tank dip looks like a decimal or unit slip",
                            message=(
                                f"Entered dip {_fmt(dip_cm)} cm is {dev.ratio:.1f}× away from {label}'s "
                                f"usual level ({_fmt(dip_prof.usual)} cm); {slip.phrase} → {_fmt(float(slip.corrected))} cm."
                            ),
                            basis=(
                                f"Last {dip_prof.count} approved gauges on {label} ranged from "
                                f"{_fmt(dip_prof.low)} cm to {_fmt(dip_prof.high)} cm."
                            ),
                            field="dipCm",
                            subject_label=label,
                            current_value=str(dip_cm),
                            current_display=f"{_fmt(dip_cm)} cm",
                            suggested_value=str(slip.corrected),
                            suggested_display=f"{_fmt(float(slip.corrected))} cm",
                            usual_display=f"{_fmt(dip_prof.low)} – {_fmt(dip_prof.high)} cm",
                            history_count=dip_prof.count,
                            fingerprint=make_fingerprint("dip-slip", dip_cm),
                        )
                    )

    # 5. Accounting sign vs physical stock direction & chronology vs previous approved ledger
    if previous_ledger is not None:
        prev_nsv = _num(previous_ledger.get("stock_after_nsv_bbl"))
        prev_tov = _num(previous_ledger.get("stock_after_gsv_bbl"))
        prev_dt = _parse_dt(previous_ledger.get("gauging_date"), previous_ledger.get("gauging_time"))
        curr_dt = _parse_dt(inputs.get("gaugingDate"), inputs.get("gaugingTime"))

        if prev_nsv is not None and nsv_bbl is not None:
            delta_nsv = nsv_bbl - prev_nsv
            tol = max(abs(prev_nsv) * 0.002, 5.0)
            if op_sign == "IN" and delta_nsv < -tol:
                findings.append(
                    EntryFinding(
                        key="tank:sign-direction-mismatch",
                        code="operation-sign-mismatch",
                        severity="warning",
                        category="accounting",
                        title="IN operation selected, but tank stock dropped",
                        message=(
                            f"Operation '{op_label or op_sign}' is configured as IN (+), yet calculated NSV "
                            f"({_fmt(nsv_bbl)} BBL) is {_fmt(abs(delta_nsv))} BBL lower than the previous approved "
                            f"closing stock ({_fmt(prev_nsv)} BBL). Check Tank Operation selection or Dip."
                        ),
                        basis=f"Previous approved ledger ticket {previous_ledger.get('ticket_number') or '—'} closed at {_fmt(prev_nsv)} BBL NSV.",
                        field="tankOperationCode",
                        subject_label=label,
                        current_value=f"{op_sign}:{round(nsv_bbl, 2)}",
                        current_display=f"{op_label or op_sign} ({delta_nsv:+,.2f} BBL)",
                        usual_display=f"Expected ≥ {_fmt(prev_nsv)} BBL",
                        fingerprint=make_fingerprint("sign-in-drop", op_sign, round(nsv_bbl, 1), round(prev_nsv, 1)),
                    )
                )
            elif op_sign == "OUT" and delta_nsv > tol:
                findings.append(
                    EntryFinding(
                        key="tank:sign-direction-mismatch",
                        code="operation-sign-mismatch",
                        severity="warning",
                        category="accounting",
                        title="OUT operation selected, but tank stock increased",
                        message=(
                            f"Operation '{op_label or op_sign}' is configured as OUT (−), yet calculated NSV "
                            f"({_fmt(nsv_bbl)} BBL) is {_fmt(delta_nsv)} BBL higher than the previous approved "
                            f"closing stock ({_fmt(prev_nsv)} BBL). Check Tank Operation selection or Dip."
                        ),
                        basis=f"Previous approved ledger ticket {previous_ledger.get('ticket_number') or '—'} closed at {_fmt(prev_nsv)} BBL NSV.",
                        field="tankOperationCode",
                        subject_label=label,
                        current_value=f"{op_sign}:{round(nsv_bbl, 2)}",
                        current_display=f"{op_label or op_sign} ({delta_nsv:+,.2f} BBL)",
                        usual_display=f"Expected ≤ {_fmt(prev_nsv)} BBL",
                        fingerprint=make_fingerprint("sign-out-rise", op_sign, round(nsv_bbl, 1), round(prev_nsv, 1)),
                    )
                )
            elif op_sign == "NEUTRAL" and abs(delta_nsv) > max(abs(prev_nsv) * 0.015, 25.0):
                findings.append(
                    EntryFinding(
                        key="tank:neutral-stock-shift",
                        code="neutral-stock-shift",
                        severity="info",
                        category="accounting",
                        title="Static/NEUTRAL gauge shows large stock movement",
                        message=(
                            f"Operation '{op_label or 'NEUTRAL'}' is a static snapshot, yet NSV moved by "
                            f"{delta_nsv:+,.2f} BBL from previous closing ({_fmt(prev_nsv)} BBL). "
                            "Unaccounted movement on a NEUTRAL gauge will surface as Material Balance Loss/Gain."
                        ),
                        basis=f"Previous approved closing on {label}: {_fmt(prev_nsv)} BBL NSV.",
                        field="tankOperationCode",
                        subject_label=label,
                        current_value=str(round(delta_nsv, 2)),
                        current_display=f"{delta_nsv:+,.2f} BBL",
                        fingerprint=make_fingerprint("neutral-shift", round(delta_nsv, 1)),
                    )
                )

            # Implied transfer rate check (catches AM/PM slips or wrong tank)
            if prev_dt is not None and curr_dt is not None:
                elapsed_hrs = (curr_dt - prev_dt).total_seconds() / 3600.0
                if elapsed_hrs < -0.05:
                    findings.append(
                        EntryFinding(
                            key="tank:backdated-gauging",
                            code="backdated-gauging",
                            severity="info",
                            category="continuity",
                            title="Gauging date/time is earlier than latest approved gauge",
                            message=(
                                f"Payload timestamp ({curr_dt.strftime('%Y-%m-%d %H:%M')}) precedes the latest "
                                f"approved gauge ({prev_dt.strftime('%Y-%m-%d %H:%M')} · ticket "
                                f"{previous_ledger.get('ticket_number') or '—'}). Approving an out-of-order gauge "
                                "may require a Tank Stock Ledger sequence rebuild."
                            ),
                            basis="Out-Turn continuity orders tank events strictly by payload gauging date and time.",
                            field="gaugingDate",
                            subject_label=label,
                            current_value=curr_dt.isoformat(),
                            current_display=curr_dt.strftime("%Y-%m-%d %H:%M"),
                            fingerprint=make_fingerprint("backdate", curr_dt.isoformat(), prev_dt.isoformat()),
                        )
                    )
                elif 0.05 <= elapsed_hrs <= 72.0 and abs(delta_nsv) > 50.0:
                    rate_bbl_hr = abs(delta_nsv) / elapsed_hrs
                    hist_rates = [_num(h.get("rate_bbl_hr")) for h in history if _num(h.get("rate_bbl_hr")) and _num(h.get("rate_bbl_hr")) > 0]  # type: ignore[operator]
                    if len(hist_rates) >= stats.MIN_HISTORY:
                        rate_prof = stats.build_profile(hist_rates)
                        if rate_prof and rate_bbl_hr > max(rate_prof.high * 3.0, rate_prof.median * 4.5):
                            findings.append(
                                EntryFinding(
                                    key="tank:abnormal-flow-rate",
                                    code="abnormal-flow-rate",
                                    severity="warning",
                                    category="continuity",
                                    title="Implied pumping/transfer rate exceeds tank history",
                                    message=(
                                        f"Stock changed by {_fmt(abs(delta_nsv))} BBL in {elapsed_hrs:.2f} hr "
                                        f"({_fmt(rate_bbl_hr, 1)} BBL/hr vs usual ≤ {_fmt(rate_prof.high, 1)} BBL/hr). "
                                        "Verify gauging time (AM/PM), gauging date, or selected tank."
                                    ),
                                    basis=f"Based on {rate_prof.count} prior tank movement intervals on {label}.",
                                    field="gaugingTime",
                                    subject_label=label,
                                    current_value=str(round(rate_bbl_hr, 1)),
                                    current_display=f"{_fmt(rate_bbl_hr, 1)} BBL/hr",
                                    usual_display=f"≤ {_fmt(rate_prof.high, 1)} BBL/hr",
                                    history_count=rate_prof.count,
                                    fingerprint=make_fingerprint("rate", round(rate_bbl_hr, 0), curr_dt.isoformat()),
                                )
                            )

        # Free water disappearance without draining
        prev_fw = _num(previous_ledger.get("free_water_bbl"))
        if (
            prev_fw is not None
            and free_water_bbl is not None
            and prev_fw > 20.0
            and (prev_fw - free_water_bbl) > max(prev_fw * 0.5, 25.0)
            and "DRAIN" not in op_cat
        ):
            findings.append(
                EntryFinding(
                    key="tank:water-drop-no-drain",
                    code="water-drop-without-draining",
                    severity="info",
                    category="accounting",
                    title="Free water dropped sharply without a Draining operation",
                    message=(
                        f"Free water fell from {_fmt(prev_fw)} BBL to {_fmt(free_water_bbl)} BBL "
                        f"on a '{op_label or op_cat or 'non-draining'}' operation. Confirm water dip or operation category."
                    ),
                    basis="Large free-water reductions normally correspond to a Draining tank operation.",
                    field="waterLevelCm",
                    subject_label=label,
                    current_value=str(round(free_water_bbl, 2)),
                    current_display=f"{_fmt(free_water_bbl)} BBL (prev {_fmt(prev_fw)} BBL)",
                    fingerprint=make_fingerprint("fw-drop", round(free_water_bbl, 1), op_cat),
                )
            )

    # 6. Accounting-day cutoff proximity caution
    if accounting_cutoff_hhmm and inputs.get("gaugingTime"):
        try:
            c_h, c_m = (int(x) for x in str(accounting_cutoff_hhmm).strip()[:5].split(":"))
            g_h, g_m = (int(x) for x in str(inputs.get("gaugingTime")).strip()[:5].split(":"))
            diff_min = abs((g_h * 60 + g_m) - (c_h * 60 + c_m))
            diff_min = min(diff_min, 1440 - diff_min)
            if 0 < diff_min <= 20:
                findings.append(
                    EntryFinding(
                        key="tank:cutoff-proximity",
                        code="accounting-cutoff-proximity",
                        severity="info",
                        category="continuity",
                        title="Gauging time sits close to accounting-day cutoff",
                        message=(
                            f"Gauging time {str(inputs.get('gaugingTime'))[:5]} is within {diff_min} minute(s) "
                            f"of this location's accounting-day cutoff ({accounting_cutoff_hhmm}). "
                            "Confirm the intended accounting date before submitting."
                        ),
                        basis=f"Location Accounting Day Setting cutoff: {accounting_cutoff_hhmm}.",
                        field="gaugingTime",
                        subject_label=label,
                        current_value=str(inputs.get("gaugingTime"))[:5],
                        current_display=str(inputs.get("gaugingTime"))[:5],
                        fingerprint=make_fingerprint("cutoff", str(inputs.get("gaugingDate")), str(inputs.get("gaugingTime"))[:5]),
                    )
                )
        except (ValueError, TypeError):
            pass

    # 7. Potential duplicate ticket guard
    if duplicate_tickets:
        listed = ", ".join(duplicate_tickets[:4])
        findings.append(
            EntryFinding(
                key="tank:potential-duplicate",
                code="potential-duplicate-ticket",
                severity="warning",
                category="continuity",
                title="Possible duplicate gauging ticket detected",
                message=(
                    f"Another active ticket ({listed}) already exists for {label} with the same "
                    "gauging date/time or identical dip reading."
                ),
                basis="Cross-checked against active non-cancelled tickets for this tank.",
                field="gaugingTime",
                subject_label=label,
                current_value=listed,
                current_display=listed,
                fingerprint=make_fingerprint("dup", listed, dip_cm),
            )
        )

    # 8. Tier 2 Multi-Variable Anomaly ML Ensemble
    hist_vectors = [
        [
            _num(h.get("dip_cm")),
            _num(h.get("water_cm")),
            _num(h.get("tank_temp_c")),
            _num(h.get("api60")),
            _num(h.get("bsw_pct")),
            _num(h.get("delta_nsv")),
        ]
        for h in history
    ]
    prev_nsv_val = _num(previous_ledger.get("stock_after_nsv_bbl")) if previous_ledger else None
    delta_nsv_q = (nsv_bbl - prev_nsv_val) if (nsv_bbl is not None and prev_nsv_val is not None) else None
    query_vec = [dip_cm, water_cm, tank_temp_c, api60, bsw_pct, delta_nsv_q]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"tank:{label}",
        subject_label=label,
        history_vectors=hist_vectors,
        query_vector=query_vec,
        feature_names=("dip_cm", "water_cm", "tank_temp_c", "api60", "bsw_pct", "delta_nsv"),
        feature_labels=("Total Dip (cm)", "Water Dip (cm)", "Tank Temp (°C)", "API @ 60°F", "BS&W %", "Net NSV Change (BBL)"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec

    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 2. Multi-Tank Before/After (Barge) Rules
# ---------------------------------------------------------------------------


def evaluate_multi_tank_rules(
    *,
    asset_code: str,
    payload: dict[str, Any],
    history: Sequence[dict[str, Any]] = (),
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    findings: list[EntryFinding] = []
    label = asset_code or "Selected Barge"
    before = payload.get("before") or {}
    after = payload.get("after") or {}
    calc = payload.get("calculated") or {}
    seals = payload.get("seals") or {}

    before_dt = _parse_dt(before.get("date"), before.get("time"))
    after_dt = _parse_dt(after.get("date"), after.get("time"))
    if before_dt and after_dt and after_dt < before_dt:
        findings.append(
            EntryFinding(
                key="barge:time-inversion",
                code="before-after-time-inversion",
                severity="warning",
                category="continuity",
                title="After gauging timestamp is earlier than Before timestamp",
                message=(
                    f"After stage ({after_dt.strftime('%Y-%m-%d %H:%M')}) precedes Before stage "
                    f"({before_dt.strftime('%Y-%m-%d %H:%M')}). Check stage dates/times."
                ),
                basis="After-operation gauging must occur chronologically after Before-operation gauging.",
                field="after.date",
                subject_label=label,
                current_value=after_dt.isoformat(),
                current_display=after_dt.strftime("%Y-%m-%d %H:%M"),
                fingerprint=make_fingerprint("barge-time", before_dt.isoformat(), after_dt.isoformat()),
            )
        )

    for stage_name, stage in (("before", before), ("after", after)):
        ccf = _num(stage.get("ccf"))
        if ccf is not None and (ccf < 0.90 or ccf > 1.10):
            suggest = round(ccf / 10.0, 4) if 9.0 <= ccf <= 11.0 else (round(ccf * 10.0, 4) if 0.09 <= ccf <= 0.11 else None)
            findings.append(
                EntryFinding(
                    key=f"barge:ccf-range:{stage_name}",
                    code="ccf-out-of-range",
                    severity="warning",
                    category="typo",
                    title=f"Abnormal {stage_name.title()} CCF / VEF factor",
                    message=(
                        f"{stage_name.title()} CCF is {_fmt(ccf, 4)}, outside the normal 0.90–1.10 vessel factor band."
                        + (f" Did you mean {_fmt(suggest, 4)}?" if suggest else "")
                    ),
                    basis="Vessel Experience / Calibration Correction Factors normally sit near 1.000.",
                    field=f"{stage_name}.ccf",
                    subject_label=label,
                    current_value=str(ccf),
                    current_display=_fmt(ccf, 4),
                    suggested_value=str(suggest) if suggest else None,
                    suggested_display=_fmt(suggest, 4) if suggest else "",
                    fingerprint=make_fingerprint("ccf", stage_name, ccf),
                )
            )
        bsw = _num(stage.get("bswPct"))
        if bsw is not None and bsw >= 15.0:
            findings.append(
                EntryFinding(
                    key=f"barge:high-bsw:{stage_name}",
                    code="high-bsw-caution",
                    severity="warning",
                    category="typo",
                    title=f"High {stage_name.title()} BS&W % ({_fmt(bsw, 2)}%)",
                    message=(
                        f"{stage_name.title()} BS&W is {_fmt(bsw, 2)}%. Confirm whether a decimal point was dropped."
                    ),
                    basis="Marine barge crude BS&W rarely exceeds 15%.",
                    field=f"{stage_name}.bswPct",
                    subject_label=label,
                    current_value=str(bsw),
                    current_display=f"{_fmt(bsw, 2)}%",
                    fingerprint=make_fingerprint("barge-bsw", stage_name, bsw),
                )
            )

    # Compartment sign conflict detection (e.g. 5 loaded, 1 shows discharge)
    per_tank = calc.get("perTank") or calc.get("tanks") or []
    if isinstance(per_tank, list) and len(per_tank) >= 3:
        pos_tanks, neg_tanks = [], []
        for row in per_tank:
            if not isinstance(row, dict):
                continue
            net_v = _num(row.get("netTov") or row.get("net_tov") or row.get("netVolume"))
            if net_v is None:
                b_v = _num(row.get("beforeTov") or row.get("before_tov"))
                a_v = _num(row.get("afterTov") or row.get("after_tov"))
                if b_v is not None and a_v is not None:
                    net_v = a_v - b_v
            if net_v is None or abs(net_v) < 5.0:
                continue
            t_id = str(row.get("tankId") or row.get("tank") or row.get("compartment") or "Tank")
            if net_v > 0:
                pos_tanks.append((t_id, net_v))
            else:
                neg_tanks.append((t_id, net_v))
        if pos_tanks and neg_tanks:
            minority = neg_tanks if len(neg_tanks) < len(pos_tanks) else pos_tanks
            names = ", ".join(t[0] for t in minority[:4])
            findings.append(
                EntryFinding(
                    key="barge:compartment-sign-conflict",
                    code="compartment-sign-conflict",
                    severity="warning",
                    category="accounting",
                    title="Compartment volume direction conflicts with other tanks",
                    message=(
                        f"{len(pos_tanks)} compartment(s) increased while {len(neg_tanks)} decreased "
                        f"(outlier compartment(s): {names}). Check for swapped Before/After dips."
                    ),
                    basis="During a single loading or discharging cycle, compartments normally move in one direction.",
                    field="after.dips",
                    subject_label=label,
                    current_value=names,
                    current_display=f"{len(pos_tanks)} up / {len(neg_tanks)} down",
                    fingerprint=make_fingerprint("comp-conflict", len(pos_tanks), len(neg_tanks), names),
                )
            )

    # Seal master mismatch & missing temporary seals
    after_seals = seals.get("after") or {}
    tank_seals = after_seals.get("tankSeals") or {}
    mismatched_seals: list[str] = []
    if isinstance(tank_seals, dict):
        for tid, positions in tank_seals.items():
            if not isinstance(positions, dict):
                continue
            for pos, cell in positions.items():
                if not isinstance(cell, dict):
                    continue
                master = str(cell.get("master") or "").strip().upper()
                observed = str(cell.get("observed") or "").strip().upper()
                if master and observed and master != observed:
                    mismatched_seals.append(f"{tid}/{pos}")
    if mismatched_seals:
        findings.append(
            EntryFinding(
                key="barge:seal-master-mismatch",
                code="barge-seal-mismatch",
                severity="warning",
                category="security",
                title=f"{len(mismatched_seals)} permanent barge seal(s) mismatch Barge Seal Master",
                message=(
                    f"Observed permanent seals differ from Barge Seal Master on: {', '.join(mismatched_seals[:6])}. "
                    "Verify physical seal integrity and document remarks before submitting."
                ),
                basis="Cross-checked against active Barge Seal Master records.",
                field="seals.after",
                subject_label=label,
                current_value=",".join(mismatched_seals[:6]),
                current_display=f"{len(mismatched_seals)} mismatch(es)",
                fingerprint=make_fingerprint("barge-seals", *mismatched_seals[:6]),
            )
        )

    # Tier 2 Multivariate ML over net barge transfer telemetry
    net = calc.get("net") or {}
    net_nsv = _num(net.get("NSV") or net.get("net_nsv_bbl"))
    net_fw = _num(net.get("FW") or net.get("net_water_bbl"))
    after_temp_c = _to_celsius(_num(after.get("tankTemp")), after.get("tankTempUnit"))
    after_bsw = _num(after.get("bswPct"))
    after_ccf = _num(after.get("ccf"))
    query_vec = [abs(net_nsv) if net_nsv is not None else None, abs(net_fw) if net_fw is not None else None, after_temp_c, after_bsw, after_ccf]
    hist_vecs = [
        [
            abs(_num(h.get("net_nsv"))) if _num(h.get("net_nsv")) is not None else None,  # type: ignore[arg-type]
            abs(_num(h.get("net_fw"))) if _num(h.get("net_fw")) is not None else None,  # type: ignore[arg-type]
            _num(h.get("tank_temp_c")),
            _num(h.get("bsw_pct")),
            _num(h.get("ccf")),
        ]
        for h in history
    ]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"barge:{label}",
        subject_label=label,
        history_vectors=hist_vecs,
        query_vector=query_vec,
        feature_names=("net_nsv", "net_fw", "tank_temp_c", "bsw_pct", "ccf"),
        feature_labels=("Net NSV (BBL)", "Net Free Water (BBL)", "Tank Temp (°C)", "BS&W %", "CCF"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec
    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 3. Tanker Truck Rules
# ---------------------------------------------------------------------------


def evaluate_tanker_rules(
    *,
    asset_code: str,
    inputs: dict[str, Any],
    calculated: dict[str, Any],
    sender_reference: dict[str, Any] | None = None,
    expected_linked_tanker: str | None = None,
    history: Sequence[dict[str, Any]] = (),
    transit_loss_warning_pct: float = 0.35,
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    findings: list[EntryFinding] = []
    label = asset_code or "Selected Tanker"

    total_dip = _num(inputs.get("totalDipCm"))
    water_dip = _num(inputs.get("waterDipCm"))
    bsw_pct = _num(inputs.get("bswPercent"))
    tank_temp_c = _to_celsius(_num(inputs.get("tankTemperature")), inputs.get("tankTemperatureUnit"))
    sample_temp_c = _to_celsius(_num(inputs.get("sampleTemperature")), inputs.get("sampleTemperatureUnit"))
    nsv_bbl = _num(calculated.get("nsvBbl") or calculated.get("nsv_bbl"))
    api60 = _num(calculated.get("api60"))

    if total_dip is not None and water_dip is not None and water_dip > total_dip:
        findings.append(
            EntryFinding(
                key="tanker:water-exceeds-dip",
                code="water-exceeds-dip",
                severity="warning",
                category="physics",
                title="Tanker water dip exceeds total dip",
                message=f"Water dip ({_fmt(water_dip)} cm) exceeds total dip ({_fmt(total_dip)} cm).",
                basis="Physical compartment geometry requires Water Dip ≤ Total Dip.",
                field="waterDipCm",
                subject_label=label,
                current_value=str(water_dip),
                current_display=f"{_fmt(water_dip)} cm",
                fingerprint=make_fingerprint("tanker-water", total_dip, water_dip),
            )
        )

    if tank_temp_c is not None and sample_temp_c is not None and abs(tank_temp_c - sample_temp_c) > 15.0:
        findings.append(
            EntryFinding(
                key="tanker:temp-divergence",
                code="temp-divergence",
                severity="warning",
                category="physics",
                title="Tanker temperature and sample temperature diverge",
                message=(
                    f"Tanker temp ({_fmt(tank_temp_c, 1)}°C) and sample temp ({_fmt(sample_temp_c, 1)}°C) "
                    "differ by more than 15°C. Check °C/°F unit toggles."
                ),
                basis="Bulk temperature and lab sample temperature normally stay within ±15°C.",
                field="tankTemperature",
                subject_label=label,
                current_value=str(round(tank_temp_c, 1)),
                current_display=f"{_fmt(tank_temp_c, 1)}°C vs {_fmt(sample_temp_c, 1)}°C",
                fingerprint=make_fingerprint("tanker-temp", round(tank_temp_c, 1), round(sample_temp_c, 1)),
            )
        )

    # Prime Mover <-> Tanker Link check
    entered_tanker = str(inputs.get("tankerName") or "").strip()
    if expected_linked_tanker and entered_tanker and expected_linked_tanker.casefold() != entered_tanker.casefold():
        findings.append(
            EntryFinding(
                key="tanker:prime-mover-link-mismatch",
                code="prime-mover-link-mismatch",
                severity="info",
                category="continuity",
                title="Tanker trailer differs from active Prime Mover link",
                message=(
                    f"Active Prime Mover–Tanker Link pairs this prime mover with '{expected_linked_tanker}', "
                    f"but '{entered_tanker}' is entered."
                ),
                basis="Cross-checked against active Prime Mover – Tanker Link Master.",
                field="tankerName",
                subject_label=label,
                current_value=entered_tanker,
                current_display=entered_tanker,
                suggested_value=expected_linked_tanker,
                suggested_display=expected_linked_tanker,
                fingerprint=make_fingerprint("pm-link", expected_linked_tanker, entered_tanker),
            )
        )

    # Pre-save Sender <-> Receiver cross-checks (seals, transit NSV loss/gain, quality drift)
    if sender_reference:
        mismatched = []
        for seal_label, key in (("C1", "sealC1"), ("C2", "sealC2"), ("M1", "sealM1"), ("M2", "sealM2")):
            s_val = str(sender_reference.get(key) or "").strip().upper()
            r_val = str(inputs.get(key) or "").strip().upper()
            if s_val and r_val and s_val != r_val:
                mismatched.append(f"{seal_label} (sender {s_val} vs {r_val})")
        if mismatched:
            findings.append(
                EntryFinding(
                    key="tanker:sender-seal-mismatch",
                    code="tanker-seal-mismatch",
                    severity="warning",
                    category="security",
                    title="Receiver seal number(s) mismatch linked sender ticket",
                    message=(
                        f"Seal mismatch detected on {', '.join(mismatched)}. "
                        "Inspect physical seals for tampering or keying errors before saving."
                    ),
                    basis=f"Compared against linked sender ticket {sender_reference.get('ticketNumber') or '—'}.",
                    field="sealC1",
                    subject_label=label,
                    current_value="; ".join(mismatched),
                    current_display=f"{len(mismatched)} seal mismatch(es)",
                    fingerprint=make_fingerprint("tanker-seals", *mismatched),
                )
            )

        sender_nsv = _num(sender_reference.get("nsvBbl"))
        if sender_nsv and sender_nsv > 0 and nsv_bbl is not None and nsv_bbl > 0:
            diff_bbl = nsv_bbl - sender_nsv
            diff_pct = (diff_bbl / sender_nsv) * 100.0
            if abs(diff_pct) >= transit_loss_warning_pct:
                kind = "shortage/loss" if diff_bbl < 0 else "unexplained gain"
                findings.append(
                    EntryFinding(
                        key="tanker:transit-nsv-variance",
                        code="transit-nsv-variance",
                        severity="warning",
                        category="accounting",
                        title=f"Transit NSV {kind} exceeds ±{transit_loss_warning_pct:.2f}% tolerance",
                        message=(
                            f"Receiver NSV ({_fmt(nsv_bbl)} BBL) differs from sender NSV ({_fmt(sender_nsv)} BBL) "
                            f"by {diff_bbl:+,.2f} BBL ({diff_pct:+.2f}%). Re-verify dip, water dip, temperature and BS&W."
                            + (" Seal mismatch also present — escalate for security inspection." if mismatched else "")
                        ),
                        basis=f"Linked sender ticket {sender_reference.get('ticketNumber') or '—'} dispatched {_fmt(sender_nsv)} BBL NSV.",
                        field="totalDipCm",
                        subject_label=label,
                        current_value=f"{diff_pct:.3f}",
                        current_display=f"{diff_bbl:+,.2f} BBL ({diff_pct:+.2f}%)",
                        usual_display=f"Within ±{transit_loss_warning_pct:.2f}%",
                        fingerprint=make_fingerprint("transit-var", round(nsv_bbl, 1), round(sender_nsv, 1)),
                    )
                )

        sender_api60 = _num(sender_reference.get("api60"))
        if sender_api60 and api60 and abs(api60 - sender_api60) >= 1.5:
            findings.append(
                EntryFinding(
                    key="tanker:sender-api-divergence",
                    code="sender-quality-divergence",
                    severity="info",
                    category="accounting",
                    title="Receiver API @ 60°F diverges from sender ticket",
                    message=(
                        f"Receiver API@60°F ({_fmt(api60, 2)}°) differs by {api60 - sender_api60:+.2f}° "
                        f"from linked sender ({_fmt(sender_api60, 2)}°)."
                    ),
                    basis="Same cargo normally retains consistent API@60°F between loading and unloading.",
                    field="observedApi",
                    subject_label=label,
                    current_value=str(round(api60, 2)),
                    current_display=f"{_fmt(api60, 2)}° vs {_fmt(sender_api60, 2)}°",
                    fingerprint=make_fingerprint("tanker-api", round(api60, 2), round(sender_api60, 2)),
                )
            )

    query_vec = [total_dip, water_dip, tank_temp_c, api60, bsw_pct, nsv_bbl]
    hist_vecs = [
        [
            _num(h.get("total_dip_cm")),
            _num(h.get("water_dip_cm")),
            _num(h.get("tank_temp_c")),
            _num(h.get("api60")),
            _num(h.get("bsw_pct")),
            _num(h.get("nsv_bbl")),
        ]
        for h in history
    ]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"tanker:{label}",
        subject_label=label,
        history_vectors=hist_vecs,
        query_vector=query_vec,
        feature_names=("total_dip_cm", "water_dip_cm", "tank_temp_c", "api60", "bsw_pct", "nsv_bbl"),
        feature_labels=("Total Dip (cm)", "Water Dip (cm)", "Tank Temp (°C)", "API @ 60°F", "BS&W %", "NSV (BBL)"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec
    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 4. Flowmeter Reading Rules
# ---------------------------------------------------------------------------


def evaluate_flowmeter_rules(
    *,
    asset_code: str,
    meters: Sequence[dict[str, Any]],
    previous_closings: dict[str, float] | None = None,
    calibration_dates: dict[str, date | None] | None = None,
    history: Sequence[dict[str, Any]] = (),
    today: date | None = None,
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    findings: list[EntryFinding] = []
    label = asset_code or "Flowmeter Stream"
    prev_map = previous_closings or {}
    cal_map = calibration_dates or {}
    ref_today = today or date.today()

    total_bbl = 0.0
    total_delta = 0.0

    for meter in meters:
        m_label = str(meter.get("meter_label") or meter.get("meterLabel") or "Meter").strip()
        opening = _num(meter.get("opening_reading") if "opening_reading" in meter else meter.get("openingReading"))
        closing = _num(meter.get("closing_reading") if "closing_reading" in meter else meter.get("closingReading"))
        factor = _num(meter.get("meter_factor") if "meter_factor" in meter else meter.get("meterFactor")) or 1.0
        unit = str(meter.get("meter_unit") or meter.get("meterUnit") or "bbls").strip().lower()

        if opening is not None and closing is not None:
            delta = closing - opening
            total_delta += delta
            bbl = delta * factor * (M3_TO_BBL if unit == "m3" else 1.0)
            total_bbl += bbl

            if delta < 0:
                findings.append(
                    EntryFinding(
                        key=f"flowmeter:negative-delta:{m_label}",
                        code="flowmeter-negative-delta",
                        severity="warning",
                        category="typo",
                        title=f"Closing reading is lower than opening on {m_label}",
                        message=(
                            f"Closing ({_fmt(closing, 3)}) is below Opening ({_fmt(opening, 3)}) on {m_label} "
                            f"(delta {delta:+,.3f}). Verify whether Opening and Closing were swapped or a totalizer rollover occurred."
                        ),
                        basis="Cumulative flowmeter totalizers increase monotonically unless rolled over.",
                        field=f"meters.{m_label}.closing_reading",
                        subject_label=f"{label} · {m_label}",
                        current_value=str(closing),
                        current_display=f"Open {_fmt(opening, 3)} → Close {_fmt(closing, 3)}",
                        fingerprint=make_fingerprint("fm-neg", m_label, opening, closing),
                    )
                )

            # Opening continuity against previous closing totalizer
            prev_close = prev_map.get(m_label)
            if prev_close is not None and abs(opening - prev_close) > 0.01:
                gap = opening - prev_close
                findings.append(
                    EntryFinding(
                        key=f"flowmeter:opening-gap:{m_label}",
                        code="flowmeter-totalizer-gap",
                        severity="warning",
                        category="continuity",
                        title=f"Opening totalizer does not match previous closing on {m_label}",
                        message=(
                            f"Entered Opening ({_fmt(opening, 3)}) differs from the prior approved closing "
                            f"({_fmt(prev_close, 3)}) by {gap:+,.3f} {unit}. An unrecorded gap or overlap "
                            "causes direct volume loss/gain."
                        ),
                        basis=f"Last recorded closing totalizer for {m_label}: {_fmt(prev_close, 3)} {unit}.",
                        field=f"meters.{m_label}.opening_reading",
                        subject_label=f"{label} · {m_label}",
                        current_value=str(opening),
                        current_display=_fmt(opening, 3),
                        suggested_value=str(round(prev_close, 4)),
                        suggested_display=_fmt(prev_close, 3),
                        usual_display=_fmt(prev_close, 3),
                        fingerprint=make_fingerprint("fm-gap", m_label, opening, prev_close),
                    )
                )

        # Overdue calibration caution (> 365 days)
        cal_date = cal_map.get(m_label)
        if cal_date is not None and (ref_today - cal_date).days > 365:
            age_days = (ref_today - cal_date).days
            findings.append(
                EntryFinding(
                    key=f"flowmeter:calibration-overdue:{m_label}",
                    code="flowmeter-calibration-overdue",
                    severity="info",
                    category="continuity",
                    title=f"Flowmeter calibration on {m_label} is over 12 months old",
                    message=(
                        f"Last calibration date for {m_label} was {cal_date.isoformat()} ({age_days} days ago). "
                        "Stale meter factors can introduce systematic creeping loss/gain."
                    ),
                    basis="Standard custody-transfer practice recommends annual meter proving/calibration.",
                    field=f"meters.{m_label}",
                    subject_label=f"{label} · {m_label}",
                    current_value=cal_date.isoformat(),
                    current_display=f"{age_days} days since calibration",
                    fingerprint=make_fingerprint("fm-cal", m_label, cal_date.isoformat()),
                )
            )

    # Stream volume vs history (including m3 <-> BBL 6.2898x slip!)
    hist_bbls = [_num(h.get("net_bbl")) for h in history if _num(h.get("net_bbl")) and _num(h.get("net_bbl")) > 0]  # type: ignore[operator]
    if total_bbl > 0 and len(hist_bbls) >= stats.MIN_HISTORY:
        vol_prof = stats.build_profile(hist_bbls)
        if vol_prof:
            dev = stats.measure(total_bbl, vol_prof)
            if dev and dev.noticeable:
                slip = stats.explain_slip(total_bbl, vol_prof, stats.VOLUME_FAMILIES)
                sev = "warning" if (slip and dev.slip_grade) or dev.strong else "info"
                findings.append(
                    EntryFinding(
                        key="flowmeter:unusual-volume",
                        code="flowmeter-unusual-volume",
                        severity=sev,
                        category="typo" if slip else "accounting",
                        title="Flowmeter stream volume is far outside normal range",
                        message=(
                            f"Computed stream volume is {_fmt(total_bbl)} BBL vs usual {_fmt(vol_prof.usual)} BBL "
                            f"({dev.ratio:.1f}×)."
                            + (f" Possible slip: {slip.phrase}." if slip else " Verify meter readings and meter factor.")
                        ),
                        basis=f"Last {vol_prof.count} approved readings on {label}: {_fmt(vol_prof.low)} – {_fmt(vol_prof.high)} BBL.",
                        field="meters",
                        subject_label=label,
                        current_value=str(round(total_bbl, 2)),
                        current_display=f"{_fmt(total_bbl)} BBL",
                        usual_display=f"{_fmt(vol_prof.low)} – {_fmt(vol_prof.high)} BBL",
                        history_count=vol_prof.count,
                        fingerprint=make_fingerprint("fm-vol", round(total_bbl, 1)),
                    )
                )

    query_vec = [total_bbl if total_bbl > 0 else None, total_delta if total_delta != 0 else None]
    hist_vecs = [[_num(h.get("net_bbl")), _num(h.get("delta"))] for h in history]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"flowmeter:{label}",
        subject_label=label,
        history_vectors=hist_vecs,
        query_vector=query_vec,
        feature_names=("net_bbl", "delta"),
        feature_labels=("Stream Volume (BBL)", "Totalizer Delta"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec
    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 5. Shuttle & FSO Tracking Rules
# ---------------------------------------------------------------------------


def evaluate_vessel_voyage_rules(
    *,
    mode: str,  # "shuttle" | "fso"
    asset_code: str,
    inputs: dict[str, Any],
    operation_sign: str = "",
    previous_closing: dict[str, float | None] | None = None,
    history: Sequence[dict[str, Any]] = (),
    fso_variance_warning_pct: float = 0.50,
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    findings: list[EntryFinding] = []
    label = asset_code or mode.upper()

    open_stock = _num(inputs.get("opening_stock_bbl"))
    open_water = _num(inputs.get("opening_water_bbl"))
    close_stock = _num(inputs.get("closing_stock_bbl"))
    close_water = _num(inputs.get("closing_water_bbl"))
    vessel_qty = _num(inputs.get("vessel_quantity_bbl"))
    sign = (operation_sign or "").strip().upper()

    net_stock = (close_stock - open_stock) if (close_stock is not None and open_stock is not None) else None
    net_water = (close_water - open_water) if (close_water is not None and open_water is not None) else None

    if previous_closing:
        prev_s = _num(previous_closing.get("closing_stock_bbl"))
        if prev_s is not None and open_stock is not None and abs(open_stock - prev_s) > max(prev_s * 0.002, 5.0):
            findings.append(
                EntryFinding(
                    key=f"{mode}:opening-stock-gap",
                    code="vessel-opening-continuity",
                    severity="warning",
                    category="continuity",
                    title=f"{mode.upper()} opening stock differs from previous closing stock",
                    message=(
                        f"Opening stock ({_fmt(open_stock)} BBL) differs from {label}'s previous approved closing "
                        f"({_fmt(prev_s)} BBL) by {open_stock - prev_s:+,.2f} BBL."
                    ),
                    basis=f"Prior approved {mode.upper()} closing stock for {label}: {_fmt(prev_s)} BBL.",
                    field="opening_stock_bbl",
                    subject_label=label,
                    current_value=str(open_stock),
                    current_display=f"{_fmt(open_stock)} BBL",
                    suggested_value=str(round(prev_s, 3)),
                    suggested_display=f"{_fmt(prev_s)} BBL",
                    usual_display=f"{_fmt(prev_s)} BBL",
                    fingerprint=make_fingerprint(f"{mode}-open", open_stock, prev_s),
                )
            )

    if net_stock is not None:
        if sign == "IN" and net_stock < -5.0:
            findings.append(
                EntryFinding(
                    key=f"{mode}:sign-mismatch",
                    code="operation-sign-mismatch",
                    severity="warning",
                    category="accounting",
                    title=f"IN operation on {mode.upper()} shows negative net stock",
                    message=(
                        f"Closing stock ({_fmt(close_stock)} BBL) is lower than opening stock ({_fmt(open_stock)} BBL) "
                        "on an IN (receipt) operation. Verify Opening/Closing or selected operation."
                    ),
                    basis="IN operations increase vessel stock.",
                    field="closing_stock_bbl",
                    subject_label=label,
                    current_value=str(round(net_stock, 2)),
                    current_display=f"{net_stock:+,.2f} BBL",
                    fingerprint=make_fingerprint(f"{mode}-sign-in", open_stock, close_stock),
                )
            )
        elif sign == "OUT" and net_stock > 5.0:
            findings.append(
                EntryFinding(
                    key=f"{mode}:sign-mismatch",
                    code="operation-sign-mismatch",
                    severity="warning",
                    category="accounting",
                    title=f"OUT operation on {mode.upper()} shows positive net stock",
                    message=(
                        f"Closing stock ({_fmt(close_stock)} BBL) is higher than opening stock ({_fmt(open_stock)} BBL) "
                        "on an OUT (dispatch/offtake) operation."
                    ),
                    basis="OUT operations reduce vessel stock.",
                    field="closing_stock_bbl",
                    subject_label=label,
                    current_value=str(round(net_stock, 2)),
                    current_display=f"{net_stock:+,.2f} BBL",
                    fingerprint=make_fingerprint(f"{mode}-sign-out", open_stock, close_stock),
                )
            )

    # FSO Variance check: |netStock + netWater| - vesselQuantity
    variance = None
    if mode == "fso" and net_stock is not None and net_water is not None and vessel_qty and vessel_qty > 0:
        variance = abs(net_stock + net_water) - vessel_qty
        var_pct = (variance / vessel_qty) * 100.0
        if abs(var_pct) >= fso_variance_warning_pct:
            findings.append(
                EntryFinding(
                    key="fso:vessel-variance",
                    code="fso-variance-high",
                    severity="warning",
                    category="accounting",
                    title=f"FSO vs Vessel variance ({var_pct:+.2f}%) exceeds ±{fso_variance_warning_pct:.2f}%",
                    message=(
                        f"FSO net movement ({_fmt(abs(net_stock + net_water))} BBL) vs Vessel Quantity "
                        f"({_fmt(vessel_qty)} BBL) produces a variance of {variance:+,.2f} BBL ({var_pct:+.2f}%). "
                        "Cross-check Shuttle/Export figures and water change."
                    ),
                    basis="Formula: Variance = |Net Stock + Net Water| − Vessel Quantity.",
                    field="vessel_quantity_bbl",
                    subject_label=label,
                    current_value=f"{variance:.2f}",
                    current_display=f"{variance:+,.2f} BBL ({var_pct:+.2f}%)",
                    usual_display=f"Within ±{fso_variance_warning_pct:.2f}%",
                    fingerprint=make_fingerprint("fso-var", round(variance, 1), round(vessel_qty, 1)),
                )
            )

    query_vec = [
        abs(net_stock) if net_stock is not None else None,
        abs(net_water) if net_water is not None else None,
        vessel_qty,
        variance,
    ]
    hist_vecs = [
        [
            abs(_num(h.get("net_stock"))) if _num(h.get("net_stock")) is not None else None,  # type: ignore[arg-type]
            abs(_num(h.get("net_water"))) if _num(h.get("net_water")) is not None else None,  # type: ignore[arg-type]
            _num(h.get("vessel_qty")),
            _num(h.get("variance")),
        ]
        for h in history
    ]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"{mode}:{label}",
        subject_label=label,
        history_vectors=hist_vecs,
        query_vector=query_vec,
        feature_names=("net_stock", "net_water", "vessel_qty", "variance"),
        feature_labels=("Net Stock (BBL)", "Net Water (BBL)", "Vessel Quantity (BBL)", "Variance (BBL)"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec
    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 6. Book Stock Daily Entry Rules (Government Book Data)
# ---------------------------------------------------------------------------


def evaluate_book_stock_rules(
    *,
    entity_code: str,
    block_code: str,
    product_code: str,
    opening_stock: float,
    production: float,
    dispatch: float,
    adjustment: float,
    suggested_opening: float | None = None,
    field_productions: Sequence[dict[str, Any]] = (),
    usual_active_fields: Sequence[dict[str, Any]] = (),
    history: Sequence[dict[str, Any]] = (),
    confirmed_vectors: Sequence[Sequence[float | None]] = (),
    ml_enabled: bool = True,
    ml_threshold: float = DEFAULT_ANOMALY_THRESHOLD,
) -> tuple[list[EntryFinding], dict[str, Any]]:
    findings: list[EntryFinding] = []
    label = f"{entity_code} / {block_code} ({product_code})"
    closing = opening_stock + production - dispatch + adjustment

    # 1. Manual override of auto-carried opening
    if suggested_opening is not None and abs(opening_stock - suggested_opening) > 0.01:
        findings.append(
            EntryFinding(
                key="book:opening-override",
                code="book-opening-override",
                severity="info",
                category="continuity",
                title="Opening stock overridden from previous day's closing",
                message=(
                    f"Opening stock ({_fmt(opening_stock)}) differs from previous closing ({_fmt(suggested_opening)}) "
                    f"by {opening_stock - suggested_opening:+,.2f}. Manual opening overrides stop automatic "
                    "roll-forward on future edits—record remarks if intentional."
                ),
                basis="Book Stock auto-carry rule: Day N Opening = Day N−1 Closing.",
                field="opening_stock",
                subject_label=label,
                current_value=str(opening_stock),
                current_display=_fmt(opening_stock),
                suggested_value=str(round(suggested_opening, 3)),
                suggested_display=_fmt(suggested_opening),
                usual_display=_fmt(suggested_opening),
                fingerprint=make_fingerprint("bs-open", opening_stock, suggested_opening),
            )
        )

    # 2. Negative closing caution
    if closing < -0.001:
        findings.append(
            EntryFinding(
                key="book:negative-closing",
                code="book-negative-closing",
                severity="warning",
                category="accounting",
                title="Computed Book Stock closing balance is negative",
                message=(
                    f"Closing = Opening ({_fmt(opening_stock)}) + Production ({_fmt(production)}) "
                    f"− Dispatch ({_fmt(dispatch)}) + Adjustment ({adjustment:+,.2f}) = {_fmt(closing)}. "
                    "Verify Dispatch or Adjustment figures."
                ),
                basis="Negative closing stock indicates dispatch or negative adjustment exceeds available stock.",
                field="dispatch",
                subject_label=label,
                current_value=str(round(closing, 3)),
                current_display=_fmt(closing),
                fingerprint=make_fingerprint("bs-neg", round(closing, 2)),
            )
        )

    # 3. Usual producing field missing (zero today after 5 consecutive days producing)
    entered_by_code = {
        str(fp.get("field_code") or fp.get("sub_field_code") or "").strip().casefold(): _num(
            fp.get("production_qty")
        ) or 0.0
        for fp in field_productions
    }
    for usual in usual_active_fields:
        code = str(usual.get("code") or "").strip()
        name = str(usual.get("name") or code)
        med = _num(usual.get("median")) or 0.0
        if code and entered_by_code.get(code.casefold(), 0.0) <= 0.0 and med > 0:
            findings.append(
                EntryFinding(
                    key=f"book:usual-field-zero:{code}",
                    code="usual-field-missing",
                    severity="info",
                    category="continuity",
                    title=f"{name} has zero production today",
                    message=(
                        f"{name} produced on each of the last {usual.get('streak', 5)} recorded days "
                        f"(usually ~{_fmt(med)}). Confirm whether it was shut-in or missed."
                    ),
                    basis=f"Produced on {usual.get('streak', 5)} consecutive preceding entries for {label}.",
                    field=f"field.{code}",
                    subject_label=name,
                    current_value="0",
                    current_display="0",
                    usual_display=f"~{_fmt(med)}",
                    history_count=int(usual.get("streak", 5)),
                    fingerprint=make_fingerprint("bs-miss", code, 0),
                )
            )

    # 4. Statistical slip detection on Production and Dispatch
    for metric_key, field_label, val in (
        ("production", "Production", production),
        ("dispatch", "Dispatch", dispatch),
    ):
        hist_vals = [_num(h.get(metric_key)) for h in history if _num(h.get(metric_key)) and _num(h.get(metric_key)) > 0]  # type: ignore[operator]
        if val > 0 and len(hist_vals) >= stats.MIN_HISTORY:
            prof = stats.build_profile(hist_vals)
            if prof:
                dev = stats.measure(val, prof)
                if dev and dev.noticeable:
                    slip = stats.explain_slip(val, prof, stats.DECIMAL_FAMILIES)
                    sev = "warning" if (slip and dev.slip_grade) or dev.strong else "info"
                    findings.append(
                        EntryFinding(
                            key=f"book:unusual-{metric_key}",
                            code=f"book-unusual-{metric_key}",
                            severity=sev,
                            category="typo" if slip else "accounting",
                            title=f"{field_label} is far outside this block's usual range",
                            message=(
                                f"Entered {field_label} ({_fmt(val)}) is {dev.ratio:.1f}× away from usual "
                                f"{_fmt(prof.usual)}."
                                + (f" Looks like {slip.phrase} → {_fmt(float(slip.corrected))}." if slip else "")
                            ),
                            basis=f"Last {prof.count} entries for {label}: {_fmt(prof.low)} – {_fmt(prof.high)}.",
                            field=metric_key,
                            subject_label=label,
                            current_value=str(val),
                            current_display=_fmt(val),
                            suggested_value=str(slip.corrected) if slip else None,
                            suggested_display=_fmt(float(slip.corrected)) if slip else "",
                            usual_display=f"{_fmt(prof.low)} – {_fmt(prof.high)}",
                            history_count=prof.count,
                            fingerprint=make_fingerprint(f"bs-{metric_key}", val),
                        )
                    )

    # 5. Tier 2 Multivariate ML
    query_vec = [opening_stock, production, dispatch, adjustment, closing]
    hist_vecs = [
        [
            _num(h.get("opening_stock")),
            _num(h.get("production")),
            _num(h.get("dispatch")),
            _num(h.get("adjustment")),
            _num(h.get("closing_stock")),
        ]
        for h in history
    ]
    ml_meta = _attach_ml_finding(
        findings,
        key_prefix=f"book:{entity_code}:{block_code}:{product_code}",
        subject_label=label,
        history_vectors=hist_vecs,
        query_vector=query_vec,
        feature_names=("opening_stock", "production", "dispatch", "adjustment", "closing_stock"),
        feature_labels=("Opening Stock", "Production", "Dispatch", "Adjustment", "Closing Stock"),
        confirmed_vectors=confirmed_vectors,
        ml_enabled=ml_enabled,
        ml_threshold=ml_threshold,
    )
    ml_meta["query_vector"] = query_vec
    return findings[:MAX_FINDINGS], ml_meta


# ---------------------------------------------------------------------------
# 7. Export Operations Rules
# ---------------------------------------------------------------------------


def evaluate_export_rules(
    *,
    entity_code: str,
    block_code: str,
    lifting_volume: float,
    permit_number: str | None = None,
    permit_allocated: float | None = None,
    permit_used: float | None = None,
    permit_expired: bool = False,
    history_volumes: Sequence[float] = (),
) -> list[EntryFinding]:
    findings: list[EntryFinding] = []
    label = f"{entity_code} / {block_code}"

    if permit_expired and permit_number:
        findings.append(
            EntryFinding(
                key=f"export:permit-expired:{permit_number}",
                code="export-permit-expired",
                severity="warning",
                category="accounting",
                title=f"Export permit {permit_number} quarter has expired",
                message=f"Permit {permit_number} belongs to an expired quarter. Verify permit validity before posting.",
                basis="Checked against permit quarter end date.",
                field="permit_number",
                subject_label=label,
                current_value=permit_number,
                current_display=permit_number,
                fingerprint=make_fingerprint("exp-expired", permit_number),
            )
        )

    if permit_allocated and permit_allocated > 0 and permit_used is not None:
        projected = permit_used + lifting_volume
        pct = (projected / permit_allocated) * 100.0
        if pct > 100.0:
            findings.append(
                EntryFinding(
                    key=f"export:permit-exceeded:{permit_number or block_code}",
                    code="export-permit-exceeded",
                    severity="warning",
                    category="accounting",
                    title="Lifting volume exceeds remaining permit balance",
                    message=(
                        f"Adding {_fmt(lifting_volume)} BBL brings utilization on {permit_number or block_code} "
                        f"to {pct:.1f}% ({_fmt(projected)} / {_fmt(permit_allocated)} BBL)."
                    ),
                    basis="Remaining permit volume before this lifting: "
                          f"{_fmt(max(permit_allocated - permit_used, 0.0))} BBL.",
                    field="volume",
                    subject_label=label,
                    current_value=str(lifting_volume),
                    current_display=f"{pct:.1f}% of permit",
                    fingerprint=make_fingerprint("exp-over", permit_number, lifting_volume, permit_used),
                )
            )
        elif pct >= 85.0:
            findings.append(
                EntryFinding(
                    key=f"export:permit-near-limit:{permit_number or block_code}",
                    code="export-permit-near-limit",
                    severity="info",
                    category="accounting",
                    title=f"Export permit utilization reaches {pct:.1f}%",
                    message=(
                        f"After this lifting, only {_fmt(permit_allocated - projected)} BBL remains "
                        f"on permit {permit_number or block_code}. Plan renewal or reallocation."
                    ),
                    basis=f"Allocated {_fmt(permit_allocated)} BBL · Used {_fmt(permit_used)} BBL.",
                    field="volume",
                    subject_label=label,
                    current_value=str(lifting_volume),
                    current_display=f"{pct:.1f}% used",
                    fingerprint=make_fingerprint("exp-near", permit_number, round(pct, 1)),
                )
            )

    if lifting_volume > 0 and len(history_volumes) >= stats.MIN_HISTORY:
        prof = stats.build_profile(history_volumes)
        if prof:
            dev = stats.measure(lifting_volume, prof)
            if dev and dev.noticeable:
                slip = stats.explain_slip(lifting_volume, prof, stats.VOLUME_FAMILIES)
                findings.append(
                    EntryFinding(
                        key="export:unusual-volume",
                        code="export-unusual-volume",
                        severity="warning" if (slip and dev.slip_grade) or dev.strong else "info",
                        category="typo" if slip else "accounting",
                        title="Export lifting volume is unusual for this block",
                        message=(
                            f"Entered volume ({_fmt(lifting_volume)} BBL) is {dev.ratio:.1f}× away from usual "
                            f"{_fmt(prof.usual)} BBL."
                            + (f" Looks like {slip.phrase} → {_fmt(float(slip.corrected))} BBL." if slip else "")
                        ),
                        basis=f"Last {prof.count} export liftings for {label}: {_fmt(prof.low)} – {_fmt(prof.high)} BBL.",
                        field="volume",
                        subject_label=label,
                        current_value=str(lifting_volume),
                        current_display=f"{_fmt(lifting_volume)} BBL",
                        suggested_value=str(slip.corrected) if slip else None,
                        suggested_display=f"{_fmt(float(slip.corrected))} BBL" if slip else "",
                        usual_display=f"{_fmt(prof.low)} – {_fmt(prof.high)} BBL",
                        history_count=prof.count,
                        fingerprint=make_fingerprint("exp-vol", lifting_volume),
                    )
                )

    return findings[:MAX_FINDINGS]
