"""Robust statistical profiling, hydrocarbon keying-slip explanation & CUSUM drift.

Pure Python standard-library module (no DB, no clock, deterministic).
Provides three complementary engines:

1. Ratio-scale :class:`Profile` (median + max(MAD, trimmed range) on ``ln(x)``)
   for strictly positive operational quantities (dips, volumes, BS&W, rates),
   widened automatically for short histories.
2. Signed linear :class:`LinearProfile` (median + robust MAD spread) for
   bounded/signed physical and accounting metrics (temperature, API@60,
   Material Balance Loss/Gain %, transit variance %, Book Stock adjustments).
3. Hydrocarbon keying-slip solver (:func:`explain_slip` and
   :func:`explain_linear_slip`) covering decimal shifts (x10/x100/x1000),
   doubled/swapped digits, °C↔°F unit swaps, m³↔BBL swaps, mm↔cm swaps, and
   Observed API ↔ Density swaps.
4. Two-sided Page's CUSUM + EWMA creeping-loss / meter-drift detector
   (:func:`detect_cusum_drift`) that catches persistent directional bias even
   when no individual day violates daily tolerance.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Iterable, Sequence

# Minimum comparable historical points before issuing a statistical opinion.
MIN_HISTORY = 5
# Student-t inspired widening for short histories: 2x at n=5, 1.4x at n=8, 1.1x at n=20.
SMALL_SAMPLE_WIDENING = 2.0
SPREAD_FLOOR = 0.12
MAD_TO_SIGMA = 1.4826
RANGE_TRIM_EVERY = 8

NOTICE_Z = 3.5
NOTICE_RATIO = 2.2
SLIP_Z = 4.0
STRONG_Z = 6.0
STRONG_RATIO = 4.5
FIT_BAND = 1.5
DIGIT_FIT = 0.05
EXACT = 1e-9

M3_TO_BBL = Decimal("6.289811")
WATER_DENSITY_60F = 999.012

# Keying slip families (ordered by frequency for deterministic tie-breaking).
SCALE_10 = "scale10"
SCALE_100 = "scale100"
SCALE_1000 = "scale1000"
DOUBLED_DIGIT = "doubled-digit"
SWAPPED_DIGITS = "swapped-digits"
CELSIUS_FAHRENHEIT = "celsius-fahrenheit"
M3_BBL = "m3-bbl"
MM_CM = "mm-cm"
API_DENSITY = "api-density"

DECIMAL_FAMILIES: tuple[str, ...] = (
    SCALE_10,
    DOUBLED_DIGIT,
    SCALE_100,
    SCALE_1000,
    SWAPPED_DIGITS,
)

VOLUME_FAMILIES: tuple[str, ...] = (
    SCALE_10,
    M3_BBL,
    DOUBLED_DIGIT,
    SCALE_100,
    SCALE_1000,
    SWAPPED_DIGITS,
)

DIP_FAMILIES: tuple[str, ...] = (
    MM_CM,
    SCALE_10,
    DOUBLED_DIGIT,
    SCALE_100,
    SWAPPED_DIGITS,
)

_EXPECTED_RANGE = {
    2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847,
    9: 2.970, 10: 3.078, 11: 3.173, 12: 3.258, 13: 3.336, 14: 3.407, 15: 3.472,
    16: 3.532, 17: 3.588, 18: 3.640, 19: 3.689, 20: 3.735,
}


@dataclass(frozen=True)
class Profile:
    """Ratio-scale profile for strictly positive operational values."""

    count: int
    median: float
    spread: float
    low: float
    high: float
    common: float | None = None

    @property
    def tolerance(self) -> float:
        scale = max(self.spread, SPREAD_FLOOR)
        if self.count > 3:
            scale *= 1.0 + SMALL_SAMPLE_WIDENING / (self.count - 3)
        else:
            scale *= 1.0 + SMALL_SAMPLE_WIDENING
        return scale

    @property
    def usual(self) -> float:
        return self.common if self.common is not None else self.median


@dataclass(frozen=True)
class LinearProfile:
    """Linear-scale robust profile for signed/bounded physical metrics."""

    count: int
    median: float
    spread: float
    low: float
    high: float
    floor: float = 0.25

    @property
    def tolerance(self) -> float:
        scale = max(self.spread, self.floor)
        if self.count > 3:
            scale *= 1.0 + SMALL_SAMPLE_WIDENING / (self.count - 3)
        else:
            scale *= 1.0 + SMALL_SAMPLE_WIDENING
        return scale


@dataclass(frozen=True)
class Deviation:
    """How far a positive value sits from its ratio profile."""

    ratio: float
    z: float
    noticeable: bool
    slip_grade: bool
    strong: bool


@dataclass(frozen=True)
class Slip:
    """A concrete keying slip that maps an entered value onto the usual regime."""

    kind: str
    corrected: Decimal
    phrase: str
    unit_override: str | None = None


@dataclass(frozen=True)
class CusumDriftResult:
    """Result of two-sided Page's CUSUM & rolling-bias creeping-loss scan."""

    sample_count: int
    direction: str  # "loss" | "gain" | "none"
    cusum_pos: float
    cusum_neg: float
    cusum_peak: float
    threshold: float
    rolling_mean: float
    cumulative_sum: float
    streak_length: int
    severity: str  # "warning" | "info" | "ok"
    summary: str


def _positive(values: Iterable[Decimal | float | int | None]) -> list[float]:
    out: list[float] = []
    for value in values:
        if value is None:
            continue
        try:
            num = float(value)
        except (TypeError, ValueError, InvalidOperation):
            continue
        if num > 0 and math.isfinite(num):
            out.append(num)
    out.sort()
    return out


def _finite(values: Iterable[Decimal | float | int | None]) -> list[float]:
    out: list[float] = []
    for value in values:
        if value is None:
            continue
        try:
            num = float(value)
        except (TypeError, ValueError, InvalidOperation):
            continue
        if math.isfinite(num):
            out.append(num)
    out.sort()
    return out


def _median(ordered: Sequence[float]) -> float:
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def _percentile(ordered: Sequence[float], fraction: float) -> float:
    rank = max(1, math.ceil(fraction * len(ordered)))
    return ordered[min(rank, len(ordered)) - 1]


def _expected_range(count: int) -> float:
    if count in _EXPECTED_RANGE:
        return _EXPECTED_RANGE[count]
    return 3.735 + 0.865 * math.log(max(count, 20) / 20.0)


def _range_spread(values: Sequence[float], centre: float) -> float:
    kept = sorted(values, key=lambda v: abs(v - centre))
    trim = len(kept) // RANGE_TRIM_EVERY
    if trim:
        kept = kept[:-trim]
    if len(kept) < 2:
        return 0.0
    return (max(kept) - min(kept)) / _expected_range(len(kept))


def _same(left: float, right: float) -> bool:
    return abs(left - right) <= EXACT * max(abs(left), abs(right), 1.0)


def build_profile(values: Iterable[Decimal | float | int | None]) -> Profile | None:
    """Build a robust ratio-scale profile from positive historical values."""
    numbers = _positive(values)
    if not numbers:
        return None
    centre = _median(numbers)
    log_centre = math.log(centre)
    logs = [math.log(n) for n in numbers]
    deviations = sorted(abs(v - log_centre) for v in logs)
    spread = max(MAD_TO_SIGMA * _median(deviations), _range_spread(logs, log_centre))

    common: float | None = None
    top_value, occurrences = Counter(round(n, 8) for n in numbers).most_common(1)[0]
    if occurrences >= 2 and occurrences * 10 >= len(numbers) * 3:
        common = top_value

    return Profile(
        count=len(numbers),
        median=centre,
        spread=spread,
        low=_percentile(numbers, 0.10),
        high=_percentile(numbers, 0.90),
        common=common,
    )


def build_linear_profile(
    values: Iterable[Decimal | float | int | None],
    *,
    floor: float = 0.25,
) -> LinearProfile | None:
    """Build a robust linear-scale profile for signed or bounded metrics."""
    numbers = _finite(values)
    if not numbers:
        return None
    centre = _median(numbers)
    deviations = sorted(abs(n - centre) for n in numbers)
    spread = max(MAD_TO_SIGMA * _median(deviations), _range_spread(numbers, centre))
    return LinearProfile(
        count=len(numbers),
        median=centre,
        spread=spread,
        low=_percentile(numbers, 0.10),
        high=_percentile(numbers, 0.90),
        floor=floor,
    )


def measure(value: Decimal | float | int, profile: Profile) -> Deviation | None:
    """Compare a positive value against its ratio profile."""
    try:
        num = float(value)
    except (TypeError, ValueError, InvalidOperation):
        return None
    if num <= 0 or not math.isfinite(num) or profile.median <= 0:
        return None
    ratio = num / profile.median
    z = math.log(ratio) / profile.tolerance
    far = ratio >= NOTICE_RATIO or ratio <= 1.0 / NOTICE_RATIO
    very_far = ratio >= STRONG_RATIO or ratio <= 1.0 / STRONG_RATIO
    return Deviation(
        ratio=ratio,
        z=z,
        noticeable=abs(z) >= NOTICE_Z and far,
        slip_grade=abs(z) >= SLIP_Z and far,
        strong=abs(z) >= STRONG_Z and very_far,
    )


def measure_linear(value: Decimal | float | int, profile: LinearProfile) -> tuple[float, bool, bool]:
    """Return ``(z_score, noticeable, strong)`` on a linear robust profile."""
    try:
        num = float(value)
    except (TypeError, ValueError, InvalidOperation):
        return 0.0, False, False
    if not math.isfinite(num):
        return 0.0, False, False
    z = (num - profile.median) / profile.tolerance
    return z, abs(z) >= 3.2, abs(z) >= 5.0


def _clean_decimal(value: Decimal) -> Decimal:
    normalized = value.normalize()
    text = format(normalized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return Decimal(text or "0")


def _to_decimal(value: Decimal | float | int | str) -> Decimal | None:
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None
    if not dec.is_finite():
        return None
    return dec


def _digit_slips(value: Decimal, *, kind: str) -> list[tuple[Decimal, str]]:
    text = format(_clean_decimal(value), "f")
    candidates: list[tuple[Decimal, str]] = []
    seen: set[Decimal] = set()
    if kind == DOUBLED_DIGIT:
        for i in range(len(text) - 1):
            if text[i].isdigit() and text[i] == text[i + 1]:
                reduced = text[:i] + text[i + 1:]
                dec = _to_decimal(reduced)
                if dec is not None and dec > 0 and dec not in seen:
                    seen.add(dec)
                    candidates.append((_clean_decimal(dec), f"digit '{text[i]}' keyed twice"))
    elif kind == SWAPPED_DIGITS:
        chars = list(text)
        for i in range(len(chars) - 1):
            if chars[i].isdigit() and chars[i + 1].isdigit() and chars[i] != chars[i + 1]:
                swapped = chars[:]
                swapped[i], swapped[i + 1] = swapped[i + 1], swapped[i]
                dec = _to_decimal("".join(swapped))
                if dec is not None and dec > 0 and dec not in seen:
                    seen.add(dec)
                    candidates.append(
                        (_clean_decimal(dec), f"digits '{chars[i]}{chars[i + 1]}' swapped"),
                    )
    return candidates


def _candidate_slips(value: Decimal, families: Sequence[str], *, unit: str = "") -> list[Slip]:
    slips: list[Slip] = []
    for family in families:
        if family == SCALE_10:
            slips.append(Slip(SCALE_10, _clean_decimal(value / Decimal("10")), "one zero too many (or decimal shifted right)"))
            slips.append(Slip(SCALE_10, _clean_decimal(value * Decimal("10")), "one zero missing (or decimal shifted left)"))
        elif family == MM_CM:
            slips.append(Slip(MM_CM, _clean_decimal(value / Decimal("10")), "entered in millimetres instead of centimetres (÷10)"))
            slips.append(Slip(MM_CM, _clean_decimal(value * Decimal("10")), "decimal shifted by one place (×10)"))
        elif family == SCALE_100:
            slips.append(Slip(SCALE_100, _clean_decimal(value / Decimal("100")), "two zeros too many (or decimal dropped)"))
            slips.append(Slip(SCALE_100, _clean_decimal(value * Decimal("100")), "two zeros missing"))
        elif family == SCALE_1000:
            slips.append(Slip(SCALE_1000, _clean_decimal(value / Decimal("1000")), "three zeros too many"))
            slips.append(Slip(SCALE_1000, _clean_decimal(value * Decimal("1000")), "three zeros missing"))
        elif family == M3_BBL:
            slips.append(Slip(M3_BBL, _clean_decimal(value * M3_TO_BBL), "entered in cubic metres instead of barrels (×6.2898)", unit_override="bbls"))
            slips.append(Slip(M3_BBL, _clean_decimal(value / M3_TO_BBL), "entered in barrels instead of cubic metres (÷6.2898)", unit_override="m3"))
        elif family == CELSIUS_FAHRENHEIT:
            as_c = (value - Decimal("32")) / Decimal("1.8")
            as_f = value * Decimal("1.8") + Decimal("32")
            if as_c > 0:
                slips.append(
                    Slip(
                        CELSIUS_FAHRENHEIT,
                        _clean_decimal(as_c.quantize(Decimal("0.1"))),
                        "temperature looks entered in °F while unit is °C",
                        unit_override="F",
                    )
                )
            if as_f > 0:
                slips.append(
                    Slip(
                        CELSIUS_FAHRENHEIT,
                        _clean_decimal(as_f.quantize(Decimal("0.1"))),
                        "temperature looks entered in °C while unit is °F",
                        unit_override="C",
                    )
                )
        elif family == API_DENSITY:
            v_f = float(value)
            if 500.0 <= v_f <= 1100.0:
                sg = v_f / WATER_DENSITY_60F
                api_val = 141.5 / sg - 131.5
                if 5.0 <= api_val <= 100.0:
                    slips.append(
                        Slip(
                            API_DENSITY,
                            _clean_decimal(Decimal(str(round(api_val, 2)))),
                            "density (kg/m³) appears entered in Observed API field",
                            unit_override="Observed Density",
                        )
                    )
            elif 5.0 <= v_f <= 100.0:
                dens_val = (141.5 / (v_f + 131.5)) * WATER_DENSITY_60F
                slips.append(
                    Slip(
                        API_DENSITY,
                        _clean_decimal(Decimal(str(round(dens_val, 1)))),
                        "API gravity appears entered in Observed Density field",
                        unit_override="Observed API",
                    )
                )
        elif family in (DOUBLED_DIGIT, SWAPPED_DIGITS):
            for dec, phrase in _digit_slips(value, kind=family):
                slips.append(Slip(family, dec, phrase))
    return slips


def explain_slip(
    value: Decimal | float | int,
    profile: Profile,
    families: Sequence[str] = DECIMAL_FAMILIES,
    *,
    unit: str = "",
) -> Slip | None:
    """Find the most plausible keying slip that lands ``value`` inside ``profile``."""
    dec = _to_decimal(value)
    if dec is None or dec <= 0 or profile.median <= 0:
        return None
    rank_of = {fam: idx for idx, fam in enumerate(families)}
    matches: list[tuple[int, int, float, Slip]] = []

    for slip in _candidate_slips(dec, families, unit=unit):
        cand = float(slip.corrected)
        if cand <= 0 or not math.isfinite(cand) or _same(cand, float(dec)):
            continue
        log_dist = abs(math.log(cand / profile.usual))
        z_dist = log_dist / profile.tolerance

        if slip.kind in (DOUBLED_DIGIT, SWAPPED_DIGITS):
            exact_common = profile.common is not None and _same(cand, profile.common)
            close_enough = abs(cand - profile.usual) <= DIGIT_FIT * profile.usual
            if not (exact_common or close_enough):
                continue
        else:
            if z_dist > FIT_BAND:
                continue

        hits_common = 0 if (profile.common is not None and _same(cand, profile.common)) else 1
        matches.append((hits_common, rank_of.get(slip.kind, 99), log_dist, slip))

    if not matches:
        return None
    matches.sort(key=lambda item: (item[0], item[1], item[2]))
    return matches[0][3]


def explain_temperature_unit_slip(
    entered_value: float,
    entered_unit: str,
    historical_celsius: Sequence[float],
) -> Slip | None:
    """Detect °C ↔ °F unit confusion against a tank's Celsius temperature history."""
    if len(historical_celsius) < 3:
        return None
    profile = build_linear_profile(historical_celsius, floor=1.5)
    if profile is None:
        return None
    unit = (entered_unit or "C").replace("°", "").strip().upper()
    if unit == "C":
        # User entered value with unit C; check if interpreting it as F fits history!
        as_c = (entered_value - 32.0) / 1.8
        dist_current = abs(entered_value - profile.median)
        dist_swapped = abs(as_c - profile.median)
        if dist_current >= max(12.0, 3.0 * profile.tolerance) and dist_swapped <= max(5.0, 1.5 * profile.tolerance):
            return Slip(
                kind=CELSIUS_FAHRENHEIT,
                corrected=_clean_decimal(Decimal(str(round(as_c, 1)))),
                phrase=f"entered {entered_value:g}°C matches {entered_value:g}°F ({as_c:.1f}°C)",
                unit_override="F",
            )
    elif unit == "F":
        as_c_if_f = (entered_value - 32.0) / 1.8
        # User left unit on F but typed a Celsius figure (e.g. 32°F when tank is 32°C)
        dist_current = abs(as_c_if_f - profile.median)
        dist_as_c = abs(entered_value - profile.median)
        if dist_current >= max(12.0, 3.0 * profile.tolerance) and dist_as_c <= max(5.0, 1.5 * profile.tolerance):
            return Slip(
                kind=CELSIUS_FAHRENHEIT,
                corrected=_clean_decimal(Decimal(str(round(entered_value * 1.8 + 32.0, 1)))),
                phrase=f"entered {entered_value:g}°F looks like {entered_value:g}°C ({entered_value * 1.8 + 32.0:.1f}°F)",
                unit_override="C",
            )
    return None


def detect_cusum_drift(
    series: Sequence[float],
    *,
    target: float = 0.0,
    min_points: int = 6,
    slack_k: float = 0.45,
    warning_h: float = 3.8,
    info_h: float = 2.6,
    scale_floor: float = 0.15,
    unit_label: str = "%",
) -> CusumDriftResult:
    """Detect creeping directional losses or gains via two-sided standardized CUSUM.

    Works on signed daily series such as Material Balance Loss/Gain (%) or
    custody-transfer transit variance (%).
    """
    clean = [float(v) for v in series if v is not None and math.isfinite(float(v))]
    n = len(clean)
    if n < min_points:
        return CusumDriftResult(
            sample_count=n,
            direction="none",
            cusum_pos=0.0,
            cusum_neg=0.0,
            cusum_peak=0.0,
            threshold=warning_h,
            rolling_mean=sum(clean) / n if n else 0.0,
            cumulative_sum=sum(clean),
            streak_length=0,
            severity="ok",
            summary="Insufficient history for creeping-loss drift detection.",
        )

    # Estimate noise scale from first differences (robust against a mean shift!).
    diffs = [abs(clean[i] - clean[i - 1]) / math.sqrt(2.0) for i in range(1, n)]
    diffs.sort()
    sigma = max(MAD_TO_SIGMA * _median(diffs), scale_floor)

    s_pos = 0.0
    s_neg = 0.0
    max_pos = 0.0
    max_neg = 0.0
    for val in clean:
        z = (val - target) / sigma
        s_pos = max(0.0, s_pos + z - slack_k)
        s_neg = max(0.0, s_neg - z - slack_k)
        max_pos = max(max_pos, s_pos)
        max_neg = max(max_neg, s_neg)

    # Trailing same-sign streak length
    streak = 0
    last_sign = 0
    for val in reversed(clean):
        delta = val - target
        if abs(delta) < 1e-6:
            break
        sign = 1 if delta > 0 else -1
        if last_sign == 0:
            last_sign = sign
            streak = 1
        elif sign == last_sign:
            streak += 1
        else:
            break

    rolling_mean = sum(clean[-min(14, n):]) / min(14, n)
    cumulative = sum(clean)

    # Prefer active trailing CUSUM, falling back to peak if strongly sustained
    if s_neg >= s_pos and s_neg >= info_h:
        direction = "loss"
        peak = s_neg
    elif s_pos > s_neg and s_pos >= info_h:
        direction = "gain"
        peak = s_pos
    elif streak >= 5 and abs(rolling_mean) >= scale_floor:
        direction = "loss" if rolling_mean < 0 else "gain"
        peak = max(s_neg, s_pos, info_h)
    else:
        direction = "none"
        peak = max(s_pos, s_neg)

    if direction != "none" and (peak >= warning_h or (streak >= 7 and abs(rolling_mean) >= scale_floor)):
        severity = "warning"
    elif direction != "none":
        severity = "info"
    else:
        severity = "ok"

    if direction == "loss":
        summary = (
            f"Persistent creeping loss detected across {n} readings: rolling average "
            f"{rolling_mean:+.3f}{unit_label} (CUSUM {s_neg:.2f} vs limit {warning_h:.1f}, "
            f"{streak} consecutive negative reading(s)). Inspect calibration charts, meter factor, "
            "BS&W sampling, or unrecorded withdrawals."
        )
    elif direction == "gain":
        summary = (
            f"Persistent creeping gain detected across {n} readings: rolling average "
            f"{rolling_mean:+.3f}{unit_label} (CUSUM {s_pos:.2f} vs limit {warning_h:.1f}, "
            f"{streak} consecutive positive reading(s)). Inspect temperature/VCF bias, "
            "calibration table shift, or unposted receipts."
        )
    else:
        summary = (
            f"No systematic directional drift detected across {n} readings "
            f"(rolling average {rolling_mean:+.3f}{unit_label})."
        )

    return CusumDriftResult(
        sample_count=n,
        direction=direction,
        cusum_pos=round(s_pos, 3),
        cusum_neg=round(s_neg, 3),
        cusum_peak=round(peak, 3),
        threshold=warning_h,
        rolling_mean=round(rolling_mean, 4),
        cumulative_sum=round(cumulative, 4),
        streak_length=streak,
        severity=severity,
        summary=summary,
    )
