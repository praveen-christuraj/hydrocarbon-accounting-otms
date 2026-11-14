"""Tier 2 Multi-Variable Anomaly ML Engine (Pure Vectorized NumPy).

Designed for low-RAM, offline/air-gapped enterprise oil terminal deployments:
zero PyTorch, zero external model downloads, ~2-4 ms CPU inference, seeded
determinism, and full feature-level explainability.

Ensemble Architecture
---------------------
Combines three complementary multivariate anomaly detectors:

1. **NumpyIsolationForest** (Liu, Ting & Zhou, ICDM 2008):
   Builds an ensemble of random axis-aligned binary isolation trees over
   robustly standardized multi-variable telemetry vectors (e.g.
   ``[dip_cm, water_level_cm, tank_temp_c, api60, bsw_pct, net_nsv_delta]``).
   Anomalous combinations isolate at shallow depths, yielding normalized
   anomaly scores in ``(0, 1)`` plus per-feature depth attribution.

2. **StreamingHalfSpaceForest** (Tan, Ting & Liu, IJCAI 2011):
   Streaming Half-Space Trees — the exact online algorithm underlying
   ``river.anomaly.HalfSpaceTrees`` — scoring mass rarity across shifted
   multi-dimensional hyper-rectangles in ``[0, 1]^d`` space.

3. **RobustMahalanobisDetector**:
   Coordinate-wise median/MAD standardization followed by shrinkage-regularized
   covariance inversion (``Sigma_reg = (1 - lam) * Sigma + lam * I``) to catch
   **correlation breaks** between coupled physical variables (e.g., Tank Temp
   shifts sharply while API/VCF or BS&W behaves inconsistently).

4. **Operator Feedback Calibration**:
   Incorporates audited ``EntryCheckReview`` ("Keep as entered") feature
   vectors for the same asset so previously verified operating points smoothly
   attenuate repeat false positives without blinding the detector to novel
   abnormalities.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

MIN_MULTIVARIATE_SAMPLES = 10
DEFAULT_ANOMALY_THRESHOLD = 0.64
DEFAULT_STRONG_THRESHOLD = 0.74
MAD_SCALE = 1.4826


@dataclass(frozen=True)
class FeatureDriver:
    """One variable's contribution to a multivariate anomaly alert."""

    name: str
    label: str
    value: float
    typical: float
    z_score: float
    contribution_pct: float


@dataclass(frozen=True)
class MultivariateVerdict:
    """Explainable verdict produced by the Tier 2 Multi-Variable ML ensemble."""

    available: bool
    is_anomaly: bool
    severity: str  # "warning" | "info" | "ok"
    score: float
    threshold: float
    iforest_score: float
    hstree_score: float
    mahalanobis_score: float
    feedback_attenuation: float
    sample_count: int
    drivers: list[FeatureDriver] = field(default_factory=list)
    summary: str = ""
    basis: str = ""


def _euler_c(n: int) -> float:
    """Average path length of unsuccessful search in a BST of size ``n``."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1.0) + 0.5772156649) - (2.0 * (n - 1.0) / n)


def _robust_standardize(
    X: np.ndarray,
    x_query: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Median/MAD standardization with safe handling of constant columns & NaNs."""
    medians = np.nanmedian(X, axis=0)
    medians = np.where(np.isfinite(medians), medians, 0.0)

    X_imp = np.where(np.isfinite(X), X, medians)
    q_imp = np.where(np.isfinite(x_query), x_query, medians)

    abs_dev = np.abs(X_imp - medians)
    mad = np.median(abs_dev, axis=0) * MAD_SCALE
    # Fall back to IQR/1.349 or std when MAD collapses on discrete/steady columns
    q75 = np.percentile(X_imp, 75, axis=0)
    q25 = np.percentile(X_imp, 25, axis=0)
    iqr_scale = (q75 - q25) / 1.349
    std_scale = np.std(X_imp, axis=0)
    scale = np.maximum(mad, np.maximum(iqr_scale * 0.85, std_scale * 0.5))
    # Floor at 1% of |median| or 0.05 so steady measurements keep finite z-scores
    floor = np.maximum(np.abs(medians) * 0.015, 0.05)
    scale = np.maximum(scale, floor)

    Z = (X_imp - medians) / scale
    z_q = (q_imp - medians) / scale
    # Clip extreme historical outliers during model fitting so past mistakes do
    # not inflate the normal envelope.
    Z_fit = np.clip(Z, -6.0, 6.0)
    return Z_fit, z_q, medians, scale


# ---------------------------------------------------------------------------
# 1. Pure NumPy Isolation Forest with Per-Feature Isolation Attribution
# ---------------------------------------------------------------------------


class _ITreeNode:
    __slots__ = ("feature", "threshold", "left", "right", "size")

    def __init__(
        self,
        size: int,
        feature: int = -1,
        threshold: float = 0.0,
        left: _ITreeNode | None = None,
        right: _ITreeNode | None = None,
    ):
        self.size = size
        self.feature = feature
        self.threshold = threshold
        self.left = left
        self.right = right


class NumpyIsolationForest:
    """Seeded, lightweight Isolation Forest with feature-level path attribution."""

    def __init__(
        self,
        n_trees: int = 48,
        max_samples: int = 128,
        seed: int = 42,
    ):
        self.n_trees = n_trees
        self.max_samples = max_samples
        self.seed = seed
        self._trees: list[_ITreeNode] = []
        self._sample_size: int = 0
        self._n_features: int = 0

    def _build_tree(
        self,
        X: np.ndarray,
        depth: int,
        max_depth: int,
        rng: np.random.Generator,
    ) -> _ITreeNode:
        n_samples, n_features = X.shape
        if depth >= max_depth or n_samples <= 1:
            return _ITreeNode(size=n_samples)

        mins = X.min(axis=0)
        maxs = X.max(axis=0)
        spans = maxs - mins
        valid = np.flatnonzero(spans > 1e-9)
        if valid.size == 0:
            return _ITreeNode(size=n_samples)

        feat = int(valid[rng.integers(0, valid.size)])
        split = float(rng.uniform(mins[feat], maxs[feat]))
        mask = X[:, feat] < split
        left_count = int(mask.sum())
        if left_count == 0 or left_count == n_samples:
            return _ITreeNode(size=n_samples)

        return _ITreeNode(
            size=n_samples,
            feature=feat,
            threshold=split,
            left=self._build_tree(X[mask], depth + 1, max_depth, rng),
            right=self._build_tree(X[~mask], depth + 1, max_depth, rng),
        )

    def fit(self, X: np.ndarray) -> NumpyIsolationForest:
        n_samples, n_features = X.shape
        self._n_features = n_features
        self._sample_size = min(n_samples, self.max_samples)
        max_depth = max(3, int(math.ceil(math.log2(max(self._sample_size, 2)))))
        rng = np.random.default_rng(self.seed)
        self._trees = []
        for _ in range(self.n_trees):
            if n_samples > self._sample_size:
                idx = rng.choice(n_samples, size=self._sample_size, replace=False)
                sub = X[idx]
            else:
                sub = X
            self._trees.append(self._build_tree(sub, 0, max_depth, rng))
        return self

    def score_one(self, x: np.ndarray) -> tuple[float, np.ndarray]:
        """Return ``(anomaly_score in [0, 1], feature_importance_weights)``."""
        if not self._trees or self._sample_size <= 1:
            return 0.0, np.zeros(self._n_features, dtype=float)

        c_n = _euler_c(self._sample_size)
        depths = 0.0
        feat_pressure = np.zeros(self._n_features, dtype=float)

        for tree in self._trees:
            node = tree
            depth = 0
            while node.feature != -1:
                # Shallow splits carry much higher isolation weight
                feat_pressure[node.feature] += 1.0 / (depth + 1.0)
                if x[node.feature] < node.threshold:
                    node = node.left  # type: ignore[assignment]
                else:
                    node = node.right  # type: ignore[assignment]
                depth += 1
            depths += depth + _euler_c(node.size)

        avg_depth = depths / len(self._trees)
        score = float(2.0 ** (-avg_depth / max(c_n, 1e-6)))
        total_pressure = float(feat_pressure.sum())
        if total_pressure > 0:
            feat_pressure /= total_pressure
        return min(max(score, 0.0), 1.0), feat_pressure


# ---------------------------------------------------------------------------
# 2. Streaming Half-Space Trees (HS-Trees — Tan et al., IJCAI 2011)
# ---------------------------------------------------------------------------


class _HSNode:
    __slots__ = ("feature", "mid", "left", "right", "mass", "depth")

    def __init__(
        self,
        depth: int,
        feature: int = -1,
        mid: float = 0.5,
        left: _HSNode | None = None,
        right: _HSNode | None = None,
    ):
        self.depth = depth
        self.feature = feature
        self.mid = mid
        self.left = left
        self.right = right
        self.mass = 0


class StreamingHalfSpaceForest:
    """Lightweight online Half-Space Trees operating in normalized ``[0, 1]^d``."""

    def __init__(
        self,
        n_trees: int = 20,
        height: int = 6,
        seed: int = 107,
    ):
        self.n_trees = n_trees
        self.height = height
        self.seed = seed
        self._trees: list[_HSNode] = []
        self._mins: np.ndarray | None = None
        self._maxs: np.ndarray | None = None
        self._n_seen: int = 0

    def _build_workspace(
        self,
        lo: np.ndarray,
        hi: np.ndarray,
        depth: int,
        rng: np.random.Generator,
    ) -> _HSNode:
        if depth >= self.height:
            return _HSNode(depth=depth)
        feat = int(rng.integers(0, lo.size))
        mid = float(0.5 * (lo[feat] + hi[feat]))

        left_hi = hi.copy()
        left_hi[feat] = mid
        right_lo = lo.copy()
        right_lo[feat] = mid
        return _HSNode(
            depth=depth,
            feature=feat,
            mid=mid,
            left=self._build_workspace(lo, left_hi, depth + 1, rng),
            right=self._build_workspace(right_lo, hi, depth + 1, rng),
        )

    def _normalize(self, x: np.ndarray) -> np.ndarray:
        assert self._mins is not None and self._maxs is not None
        span = np.maximum(self._maxs - self._mins, 1e-6)
        return (x - self._mins) / span

    def fit(self, X: np.ndarray) -> StreamingHalfSpaceForest:
        n_samples, n_features = X.shape
        self._mins = X.min(axis=0)
        self._maxs = X.max(axis=0)
        rng = np.random.default_rng(self.seed)
        self._trees = []
        for _ in range(self.n_trees):
            # Random workspace shift per Tan et al. (2011)
            s = rng.uniform(0.0, 1.0, size=n_features)
            max_r = np.maximum(s, 1.0 - s)
            lo = s - 2.0 * max_r
            hi = s + 2.0 * max_r
            self._trees.append(self._build_workspace(lo, hi, 0, rng))

        self._n_seen = 0
        for i in range(n_samples):
            self.learn_one(X[i])
        return self

    def learn_one(self, x: np.ndarray) -> None:
        u = self._normalize(x)
        for tree in self._trees:
            node = tree
            while node is not None:
                node.mass += 1
                if node.feature == -1:
                    break
                node = node.left if u[node.feature] < node.mid else node.right
        self._n_seen += 1

    def score_one(self, x: np.ndarray) -> float:
        """Return normalized anomaly score in ``[0, 1]`` (higher = rarer)."""
        if not self._trees or self._n_seen <= 0:
            return 0.0
        u = self._normalize(x)
        # Check out-of-hull excursion first: HS-trees naturally yield mass=0 outside
        mass_score_sum = 0.0
        max_possible = float(self._n_seen * (2 ** self.height))
        for tree in self._trees:
            node = tree
            while node.feature != -1:
                nxt = node.left if u[node.feature] < node.mid else node.right
                if nxt is None:
                    break
                node = nxt
                if node.mass == 0:
                    break
            mass_score_sum += node.mass * (2 ** node.depth)

        avg_mass = mass_score_sum / len(self._trees)
        # Convert mass profile to [0, 1] rarity score using log compression
        rarity = 1.0 - math.log1p(avg_mass) / max(math.log1p(max_possible * 0.35), 1e-6)
        return min(max(rarity, 0.0), 1.0)


# ---------------------------------------------------------------------------
# 3. Shrinkage-Regularized Robust Mahalanobis Detector
# ---------------------------------------------------------------------------


class RobustMahalanobisDetector:
    """Detects joint correlation breaks via shrinkage-regularized covariance."""

    def __init__(self, shrinkage: float = 0.25):
        self.shrinkage = shrinkage
        self._inv_cov: np.ndarray | None = None
        self._center: np.ndarray | None = None
        self._d: int = 0

    def fit(self, Z: np.ndarray) -> RobustMahalanobisDetector:
        n_samples, d = Z.shape
        self._d = d
        self._center = np.median(Z, axis=0)
        centered = Z - self._center
        if n_samples > 2:
            cov = (centered.T @ centered) / max(n_samples - 1, 1)
        else:
            cov = np.eye(d)
        # Ledoit-Wolf style diagonal shrinkage prevents singular matrices on
        # collinear hydrocarbon telemetry (e.g. API & Density or TOV & NSV).
        trace_mean = float(np.trace(cov)) / max(d, 1)
        lam = self.shrinkage
        reg_cov = (1.0 - lam) * cov + lam * max(trace_mean, 1.0) * np.eye(d)
        try:
            self._inv_cov = np.linalg.pinv(reg_cov)
        except np.linalg.LinAlgError:
            self._inv_cov = np.eye(d)
        return self

    def score_one(self, z: np.ndarray) -> float:
        """Map Mahalanobis distance ``d_M`` to ``[0, 1]`` calibrated to dimension ``d``."""
        if self._inv_cov is None or self._center is None or self._d <= 0:
            return 0.0
        diff = z - self._center
        quad = float(max(diff @ self._inv_cov @ diff, 0.0))
        d_m = math.sqrt(quad)
        # Expected chi-distribution median is approx sqrt(d). Scale relative to
        # sqrt(d) so a 3D and 7D vector share a consistent [0, 1] anomaly scale.
        expected = math.sqrt(max(self._d, 1))
        rel = d_m / max(expected, 1.0)
        # Smooth sigmoid centered at rel = 2.6 (~99% multivariate contour)
        score = 1.0 / (1.0 + math.exp(-1.55 * (rel - 2.6)))
        return min(max(score, 0.0), 1.0)


# ---------------------------------------------------------------------------
# 4. Unified Tier 2 Multi-Variable Anomaly ML Ensemble
# ---------------------------------------------------------------------------


def _feedback_attenuation(
    z_query: np.ndarray,
    confirmed_z_vectors: Sequence[np.ndarray],
) -> float:
    """Attenuate anomaly score when operator already confirmed a very similar state."""
    if not confirmed_z_vectors:
        return 0.0
    d = max(z_query.size, 1)
    min_rms = min(
        float(np.sqrt(np.mean((z_query - vec) ** 2)))
        for vec in confirmed_z_vectors
        if vec.size == d
    )
    # Within 0.45 MAD-RMS of a confirmed operating point -> up to 0.25 attenuation
    if min_rms <= 0.45:
        return 0.25 * (1.0 - min_rms / 0.45)
    return 0.0


def evaluate_multivariate_anomaly(
    history_rows: Sequence[Sequence[float | None]],
    query_row: Sequence[float | None],
    feature_names: Sequence[str],
    feature_labels: Sequence[str] | None = None,
    *,
    confirmed_history_rows: Sequence[Sequence[float | None]] = (),
    threshold: float = DEFAULT_ANOMALY_THRESHOLD,
    strong_threshold: float = DEFAULT_STRONG_THRESHOLD,
    min_samples: int = MIN_MULTIVARIATE_SAMPLES,
    seed: int = 42,
) -> MultivariateVerdict:
    """Run the Tier 2 Multi-Variable ML ensemble on one candidate record.

    Parameters
    ----------
    history_rows:
        Matrix of prior approved observations ``(N, D)`` for the same asset/stream.
    query_row:
        Candidate observation ``(D,)`` being entered or inspected.
    feature_names:
        Machine-readable names of the ``D`` features.
    feature_labels:
        Human-readable labels shown to operators in the explanation sentence.
    confirmed_history_rows:
        Feature vectors previously accepted via audited ``Keep as entered`` reviews.
    """
    d = len(feature_names)
    labels = list(feature_labels) if feature_labels else list(feature_names)
    if d < 2 or len(history_rows) < min_samples or len(query_row) != d:
        return MultivariateVerdict(
            available=False,
            is_anomaly=False,
            severity="ok",
            score=0.0,
            threshold=threshold,
            iforest_score=0.0,
            hstree_score=0.0,
            mahalanobis_score=0.0,
            feedback_attenuation=0.0,
            sample_count=len(history_rows),
            summary="Collecting baseline telemetry before activating multi-variable ML.",
        )

    def _to_float_row(row: Sequence[float | None]) -> list[float]:
        out = []
        for item in row:
            if item is None:
                out.append(float("nan"))
            else:
                try:
                    val = float(item)
                    out.append(val if math.isfinite(val) else float("nan"))
                except (TypeError, ValueError):
                    out.append(float("nan"))
        return out

    X_raw = np.array([_to_float_row(r) for r in history_rows], dtype=float)
    q_raw = np.array(_to_float_row(query_row), dtype=float)

    # Drop features that are completely missing in query or all-NaN in history
    valid_cols = [
        j
        for j in range(d)
        if np.isfinite(q_raw[j]) and int(np.isfinite(X_raw[:, j]).sum()) >= max(5, min_samples // 2)
    ]
    if len(valid_cols) < 2:
        return MultivariateVerdict(
            available=False,
            is_anomaly=False,
            severity="ok",
            score=0.0,
            threshold=threshold,
            iforest_score=0.0,
            hstree_score=0.0,
            mahalanobis_score=0.0,
            feedback_attenuation=0.0,
            sample_count=len(history_rows),
            summary="Need at least two active telemetry variables for multi-variable ML.",
        )

    X_sub = X_raw[:, valid_cols]
    q_sub = q_raw[valid_cols]
    sub_names = [feature_names[j] for j in valid_cols]
    sub_labels = [labels[j] for j in valid_cols]

    Z_fit, z_q, medians, scale = _robust_standardize(X_sub, q_sub)

    # Fit & score all three lightweight detectors
    iforest = NumpyIsolationForest(n_trees=48, max_samples=128, seed=seed).fit(Z_fit)
    iforest_score, iforest_weights = iforest.score_one(z_q)

    hstree = StreamingHalfSpaceForest(n_trees=20, height=6, seed=seed + 65).fit(Z_fit)
    hstree_score = hstree.score_one(z_q)

    mahal = RobustMahalanobisDetector(shrinkage=0.25).fit(Z_fit)
    mahal_score = mahal.score_one(z_q)

    raw_ensemble = 0.45 * iforest_score + 0.25 * hstree_score + 0.30 * mahal_score

    # Calibrate with confirmed operator feedback vectors if available
    confirmed_z: list[np.ndarray] = []
    for crow in confirmed_history_rows:
        if len(crow) == d:
            c_arr = np.array(_to_float_row(crow), dtype=float)[valid_cols]
            c_imp = np.where(np.isfinite(c_arr), c_arr, medians)
            confirmed_z.append((c_imp - medians) / scale)
    attenuation = _feedback_attenuation(z_q, confirmed_z)
    final_score = max(0.0, min(1.0, raw_ensemble - attenuation))

    # Build explainable per-feature driver breakdown
    abs_z = np.abs(z_q)
    # Blend robust deviation magnitude with tree-isolation pressure
    raw_contrib = abs_z * (0.5 + iforest_weights * len(valid_cols))
    contrib_sum = float(raw_contrib.sum())
    drivers: list[FeatureDriver] = []
    for idx in range(len(valid_cols)):
        pct = (float(raw_contrib[idx]) / contrib_sum * 100.0) if contrib_sum > 0 else 0.0
        drivers.append(
            FeatureDriver(
                name=sub_names[idx],
                label=sub_labels[idx],
                value=round(float(q_sub[idx]), 4),
                typical=round(float(medians[idx]), 4),
                z_score=round(float(z_q[idx]), 2),
                contribution_pct=round(pct, 1),
            )
        )
    drivers.sort(key=lambda item: (-item.contribution_pct, -abs(item.z_score)))
    top_drivers = drivers[:3]

    is_anomaly = final_score >= threshold and (
        mahal_score >= 0.45 or iforest_score >= 0.62 or float(np.max(abs_z)) >= 2.2
    )
    if is_anomaly and final_score >= strong_threshold:
        severity = "warning"
    elif is_anomaly:
        severity = "info"
    else:
        severity = "ok"

    driver_phrase = ", ".join(
        f"{drv.label} ({drv.value:g} vs usual {drv.typical:g}, {drv.z_score:+.1f}σ)"
        for drv in top_drivers
        if abs(drv.z_score) >= 1.0 or drv.contribution_pct >= 25.0
    ) or ", ".join(f"{drv.label} ({drv.value:g})" for drv in top_drivers[:2])

    summary = (
        f"Multi-variable telemetry combination deviates from this asset's learned operating envelope "
        f"(ML score {final_score:.2f} vs threshold {threshold:.2f}). Primary interacting drivers: "
        f"{driver_phrase}."
        if is_anomaly
        else f"Multi-variable telemetry sits inside the learned operating envelope (ML score {final_score:.2f})."
    )
    basis = (
        f"Tier 2 Multi-Variable ML ensemble (Isolation Forest {iforest_score:.2f} · "
        f"Half-Space Trees {hstree_score:.2f} · Robust Mahalanobis {mahal_score:.2f}) "
        f"trained on {len(history_rows)} approved historical records across {len(valid_cols)} coupled variables."
    )

    return MultivariateVerdict(
        available=True,
        is_anomaly=is_anomaly,
        severity=severity,
        score=round(final_score, 4),
        threshold=round(threshold, 4),
        iforest_score=round(iforest_score, 4),
        hstree_score=round(hstree_score, 4),
        mahalanobis_score=round(mahal_score, 4),
        feedback_attenuation=round(attenuation, 4),
        sample_count=len(history_rows),
        drivers=top_drivers,
        summary=summary,
        basis=basis,
    )
