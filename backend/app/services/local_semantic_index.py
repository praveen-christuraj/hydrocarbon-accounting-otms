"""Ultra-Light Local Semantic Retriever (Phase 2 — CPU-only, Offline, ~3 ms).

Combines four lightweight local techniques with zero external downloads:

1. **Hydrocarbon Accounting Synonym Expander**: bridges operator jargon and
   canonical OTMS terminology (e.g., ``water cut`` ↔ ``bsw``, ``short landing``
   ↔ ``transit loss``, ``ullage/sounding`` ↔ ``dip``, ``totalizer`` ↔
   ``flowmeter``, ``table 54b/6b`` ↔ ``vcf``, ``cutoff`` ↔ ``accounting day``).
2. **BM25+ Lexical Scorer** over curated keywords and titles (preserving
   WellCostIQ's strict anti-hallucination guardrail against stray stopwords).
3. **Typo-Tolerant Character N-gram (3-4) + Word TF-IDF Truncated SVD (LSA)**
   computed in pure NumPy (``np.linalg.svd``): catches spelling mistakes
   (``matrial balnce``, ``gaugging``, ``flowmetr``) and latent topic links
   across both ``assistant_memory`` and the repository's 54 ``Manuals/pages``.
4. **Optional Pluggable Embedding Adapter** (``AI_EMBEDDING_BACKEND=model2vec``
   or ``fastembed``): transparently uses an installed local neural embedding
   model if an operator explicitly installs one; otherwise runs ``local_lsa``
   out of the box with zero extra RAM or network calls.
"""

from __future__ import annotations

import difflib
import logging
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from app.config import AI_EMBEDDING_BACKEND

logger = logging.getLogger(__name__)

STOPWORDS = frozenset(
    """
    a about above after again against all am an and any are as at be because been
    before being below between both but by can could did do does doing down during
    each few for from further had has have having he her here hers him his how i if
    in into is it its just me more most my no nor not now of off on once only or
    other our out over own same she should so some such than that the their them
    then there these they this those through to too under until up very was we were
    what when where which while who whom why will with would you your please tell
    show give help explain
    """.split()
)

# Domain synonym clusters: matching any term softly injects its canonical root.
DOMAIN_SYNONYM_GROUPS: tuple[tuple[str, ...], ...] = (
    ("bsw", "bs&w", "watercut", "water", "sediment", "emulsion", "freewater"),
    ("vcf", "table54b", "table6b", "54b", "6b", "thermal", "expansion", "temperature"),
    ("table11", "lt", "mt", "tonnage", "longton", "metricton", "mass", "weight"),
    ("api", "api60", "gravity", "density", "density15", "hydrometer", "observed"),
    ("tov", "gov", "gsv", "nsv", "barrel", "bbl", "bbls", "volume", "quantity"),
    ("dip", "ullage", "sounding", "gauging", "gauge", "calibration", "strapping"),
    ("loss", "gain", "variance", "shortage", "shrinkage", "discrepancy", "shortlanding", "short", "imbalance"),
    ("cusum", "creeping", "drift", "bias", "chronic", "trend", "systematic"),
    ("balance", "reconcile", "reconciliation", "material", "bookclosing", "physicalclosing"),
    ("outturn", "otr", "sequence", "continuity", "chain", "previousstock", "rebuild"),
    ("cutoff", "accountingday", "daystart", "midnight", "window", "timezone"),
    ("flowmeter", "meter", "totalizer", "rollover", "meterfactor", "skid", "stream"),
    ("barge", "convoy", "multitank", "compartment", "seal", "seals", "manifold", "vef", "ccf"),
    ("tanker", "truck", "primemover", "chassis", "acknowledgement", "acknowledge", "sender", "receiver"),
    ("shuttle", "fso", "vessel", "voyage", "offtake", "lifting", "cargo"),
    ("export", "permit", "consignee", "quarter", "quota", "allocation"),
    ("bookstock", "bookdata", "government", "producing", "field", "subfield", "rollforward", "carry"),
    ("workflow", "approval", "approve", "submit", "reject", "recall", "correction", "revoke", "task"),
    ("permission", "rbac", "role", "scope", "party", "location", "access", "security", "audit", "2fa"),
    ("upload", "import", "bulk", "excel", "xlsx", "csv", "template", "exportfile", "print", "profile"),
    ("typo", "mistype", "error", "abnormality", "anomaly", "check", "guardrail", "warning", "caution"),
)

_TOKEN_TO_CANONICAL: dict[str, set[str]] = {}
for _group in DOMAIN_SYNONYM_GROUPS:
    _root = _group[0]
    for _term in _group:
        _TOKEN_TO_CANONICAL.setdefault(_term, set()).add(_root)

_WORD_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Extract lowercase content tokens excluding stopwords."""
    raw = _WORD_RE.findall((text or "").casefold())
    return [tok for tok in raw if len(tok) > 1 and tok not in STOPWORDS]


def expand_tokens(tokens: Sequence[str]) -> list[str]:
    """Expand tokens with canonical hydrocarbon domain roots."""
    expanded = list(tokens)
    seen = set(tokens)
    # Also test concatenated bigrams ("water cut" -> "watercut", "book stock" -> "bookstock")
    bigrams = [f"{tokens[i]}{tokens[i + 1]}" for i in range(len(tokens) - 1)]
    for tok in list(tokens) + bigrams:
        for root in _TOKEN_TO_CANONICAL.get(tok, ()):
            if root not in seen:
                expanded.append(root)
                seen.add(root)
        # Prefix match for domain roots >= 4 chars (catches plurals & mild stems)
        if len(tok) >= 4:
            for key, roots in _TOKEN_TO_CANONICAL.items():
                if len(key) >= 4 and (tok.startswith(key) or key.startswith(tok)):
                    for root in roots:
                        if root not in seen:
                            expanded.append(root)
                            seen.add(root)
    return expanded


def _char_ngrams(text: str, n_min: int = 3, n_max: int = 4) -> list[str]:
    cleaned = " ".join(tokenize(text))
    if not cleaned:
        return []
    grams: list[str] = []
    for word in cleaned.split():
        if len(word) < n_min:
            grams.append(f"w:{word}")
            continue
        padded = f"^{word}$"
        for n in range(n_min, n_max + 1):
            for i in range(len(padded) - n + 1):
                grams.append(f"c:{padded[i:i + n]}")
    return grams


@dataclass(frozen=True)
class IndexedDoc:
    """One searchable unit (a memory entry or a repository manual excerpt)."""

    doc_id: str
    title: str
    keywords: str
    body: str
    route: str
    permission: str
    category: str
    source_kind: str  # "memory" | "manual"
    sort_order: int = 100


@dataclass(frozen=True)
class SearchHit:
    doc: IndexedDoc
    score: float
    lexical_score: float
    semantic_score: float
    route_boost: float


class LocalSemanticIndex:
    """In-memory hybrid BM25 + Character/Word LSA Semantic Retriever."""

    def __init__(self, svd_dim: int = 48):
        self.svd_dim = svd_dim
        self.docs: list[IndexedDoc] = []
        self._doc_tokens: list[list[str]] = []
        self._title_kw_tokens: list[set[str]] = []
        self._idf_bm25: dict[str, float] = {}
        self._avg_dl: float = 1.0
        self._vocab: dict[str, int] = {}
        self._idf_vec: np.ndarray | None = None
        self._u_proj: np.ndarray | None = None  # (V, k) right singular projection
        self._doc_vecs: np.ndarray | None = None  # (N, k) normalized dense vectors
        self._optional_model = None
        self._backend_name = "local_lsa"
        self._try_load_optional_backend()

    def _try_load_optional_backend(self) -> None:
        if AI_EMBEDDING_BACKEND == "model2vec":
            try:
                from model2vec import StaticModel  # type: ignore[import-not-found]

                self._optional_model = StaticModel.from_pretrained("minishlab/potion-base-8M")
                self._backend_name = "model2vec"
            except Exception as exc:  # pragma: no cover - optional runtime
                logger.info("model2vec unavailable (%s); using local_lsa", exc)
        elif AI_EMBEDDING_BACKEND == "fastembed":
            try:
                from fastembed import TextEmbedding  # type: ignore[import-not-found]

                self._optional_model = TextEmbedding(model_name="BAAI/bge-small-en-v1.5")
                self._backend_name = "fastembed"
            except Exception as exc:  # pragma: no cover - optional runtime
                logger.info("fastembed unavailable (%s); using local_lsa", exc)

    @property
    def backend_name(self) -> str:
        return self._backend_name

    def _encode_optional(self, texts: Sequence[str]) -> np.ndarray | None:
        if self._optional_model is None:
            return None
        try:
            if self._backend_name == "model2vec":
                mat = np.asarray(self._optional_model.encode(list(texts)), dtype=float)
            else:
                mat = np.asarray(list(self._optional_model.embed(list(texts))), dtype=float)
            norms = np.linalg.norm(mat, axis=1, keepdims=True)
            return mat / np.maximum(norms, 1e-9)
        except Exception:  # pragma: no cover - graceful fallback
            return None

    def fit(self, docs: Sequence[IndexedDoc]) -> LocalSemanticIndex:
        self.docs = list(docs)
        n = len(self.docs)
        if n == 0:
            self._doc_vecs = None
            return self

        self._doc_tokens = []
        self._title_kw_tokens = []
        df_bm25: dict[str, int] = {}

        # Feature bags for TF-IDF + LSA: title (x2) + keywords (x2) + char ngrams (title+keywords)
        # Body tokens are included at light weight only in dense SVD so stray body
        # stopwords never trigger lexical false positives.
        doc_feature_bags: list[dict[str, float]] = []
        df_feat: dict[str, int] = {}

        for doc in self.docs:
            title_toks = expand_tokens(tokenize(doc.title))
            kw_toks = expand_tokens(tokenize(doc.keywords))
            body_toks = expand_tokens(tokenize(doc.body[:600]))

            # BM25 operates strictly on title + curated keywords (WellCostIQ rule #4)
            tk = title_toks + kw_toks
            self._doc_tokens.append(tk)
            self._title_kw_tokens.append(set(tk))
            for tok in set(tk):
                df_bm25[tok] = df_bm25.get(tok, 0) + 1

            bag: dict[str, float] = {}
            for tok in title_toks:
                k = f"t:{tok}"
                bag[k] = bag.get(k, 0.0) + 2.2
            for tok in kw_toks:
                k = f"t:{tok}"
                bag[k] = bag.get(k, 0.0) + 2.0
            for tok in body_toks[:60]:
                k = f"t:{tok}"
                bag[k] = bag.get(k, 0.0) + 0.45
            for gram in _char_ngrams(f"{doc.title} {doc.keywords}"):
                bag[gram] = bag.get(gram, 0.0) + 0.75

            doc_feature_bags.append(bag)
            for feat in bag:
                df_feat[feat] = df_feat.get(feat, 0) + 1

        self._avg_dl = sum(len(t) for t in self._doc_tokens) / max(n, 1)
        self._idf_bm25 = {
            tok: math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            for tok, df in df_bm25.items()
        }

        # Optional neural embedding override
        opt_vecs = self._encode_optional(
            [f"{d.title}. {d.keywords}. {d.body[:350]}" for d in self.docs]
        )
        if opt_vecs is not None:
            self._doc_vecs = opt_vecs
            return self

        # Build compact TF-IDF matrix & Truncated SVD (LSA)
        # Cap vocabulary to top 2400 informative terms to keep RAM < 4 MB
        ranked_feats = sorted(
            df_feat.items(),
            key=lambda kv: (-kv[1] if kv[1] <= max(2, int(n * 0.85)) else 0, kv[0]),
        )[:2400]
        self._vocab = {feat: idx for idx, (feat, _) in enumerate(ranked_feats)}
        v_size = len(self._vocab)
        if v_size == 0:
            self._doc_vecs = None
            return self

        idf_arr = np.array(
            [math.log((n + 1.0) / (df_feat[feat] + 1.0)) + 1.0 for feat, _ in ranked_feats],
            dtype=float,
        )
        self._idf_vec = idf_arr

        tfidf = np.zeros((n, v_size), dtype=float)
        for row_idx, bag in enumerate(doc_feature_bags):
            for feat, tf in bag.items():
                col = self._vocab.get(feat)
                if col is not None:
                    tfidf[row_idx, col] = math.log1p(tf) * idf_arr[col]

        # Row L2-normalize before SVD
        row_norms = np.linalg.norm(tfidf, axis=1, keepdims=True)
        tfidf /= np.maximum(row_norms, 1e-9)

        k = min(self.svd_dim, n, v_size)
        if k >= 2:
            # Thin SVD on (N, V): tfidf = U @ diag(S) @ Vt
            u, s, vt = np.linalg.svd(tfidf, full_matrices=False)
            u_k = u[:, :k]
            s_k = s[:k]
            vt_k = vt[:k, :]
            # Project query vector q via q @ vt_k.T -> dense latent space
            self._u_proj = vt_k.T  # (V, k)
            doc_dense = u_k * s_k  # (N, k)
            d_norms = np.linalg.norm(doc_dense, axis=1, keepdims=True)
            self._doc_vecs = doc_dense / np.maximum(d_norms, 1e-9)
        else:
            self._u_proj = None
            self._doc_vecs = tfidf
        return self

    def _query_vector(self, question: str) -> np.ndarray | None:
        if self._doc_vecs is None:
            return None
        if self._optional_model is not None:
            encoded = self._encode_optional([question])
            return encoded[0] if encoded is not None else None
        if not self._vocab or self._idf_vec is None:
            return None

        q_toks = expand_tokens(tokenize(question))
        q_grams = _char_ngrams(question)
        vec = np.zeros(len(self._vocab), dtype=float)
        for tok in q_toks:
            col = self._vocab.get(f"t:{tok}")
            if col is not None:
                vec[col] += 2.0
        for gram in q_grams:
            col = self._vocab.get(gram)
            if col is not None:
                vec[col] += 0.8

        if not np.any(vec):
            return None
        vec = np.log1p(vec) * self._idf_vec
        norm = float(np.linalg.norm(vec))
        if norm <= 1e-9:
            return None
        vec /= norm
        if self._u_proj is not None:
            # vec is already L2-normalized and _u_proj = V_k^T has orthonormal
            # columns, so ||dense|| <= 1 measures true projection energy into
            # the corpus subspace. Never re-inflate tiny out-of-domain norms.
            dense = vec @ self._u_proj
            d_norm = float(np.linalg.norm(dense))
            if d_norm > 1.0:
                return dense / d_norm
            return dense
        return vec

    def search(
        self,
        question: str,
        *,
        route: str = "",
        allowed_filter=None,
        top_k: int = 5,
    ) -> list[SearchHit]:
        """Rank indexed documents by hybrid BM25 + Local Semantic Cosine + Route."""
        if not self.docs:
            return []

        q_raw = tokenize(question)
        q_exp = expand_tokens(q_raw)
        q_vec = self._query_vector(question)
        cos_scores = (
            (self._doc_vecs @ q_vec)
            if (q_vec is not None and self._doc_vecs is not None)
            else np.zeros(len(self.docs), dtype=float)
        )

        text_lower = (question or "").casefold()
        norm_route = (route or "").strip().rstrip("/")
        k1, b = 1.4, 0.70

        hits: list[SearchHit] = []
        for idx, doc in enumerate(self.docs):
            if allowed_filter is not None and not allowed_filter(doc):
                continue

            # 1. BM25+ lexical score on title + curated keywords
            doc_toks = self._doc_tokens[idx]
            dl = max(len(doc_toks), 1)
            lex = 0.0
            if q_exp and doc_toks:
                tf_map: dict[str, int] = {}
                for t in doc_toks:
                    tf_map[t] = tf_map.get(t, 0) + 1
                for qt in set(q_exp):
                    tf = tf_map.get(qt, 0)
                    if tf > 0:
                        idf = self._idf_bm25.get(qt, 1.0)
                        lex += idf * ((tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * dl / self._avg_dl)))
                    elif len(qt) >= 4:
                        # Soft prefix or typo-tolerant match (1-2 char edits, e.g. 'materal' -> 'material')
                        best_fuzzy = 0.0
                        for dt in tf_map:
                            if len(dt) < 4:
                                continue
                            if dt.startswith(qt) or qt.startswith(dt):
                                best_fuzzy = max(best_fuzzy, 0.75)
                            elif abs(len(dt) - len(qt)) <= 2 and len(qt) >= 5:
                                ratio = difflib.SequenceMatcher(None, qt, dt).ratio()
                                if ratio >= 0.80:
                                    best_fuzzy = max(best_fuzzy, ratio * self._idf_bm25.get(dt, 1.0))
                        lex += best_fuzzy

            # 2. Semantic cosine similarity (handles typos via char n-grams + LSA)
            sem = float(max(cos_scores[idx], 0.0))

            # 3. Contextual route boost (only adds tie-break if there is real signal)
            route_boost = 0.0
            doc_route = (doc.route or "").strip().rstrip("/")
            if doc_route and norm_route and (
                doc_route == norm_route or norm_route.startswith(f"{doc_route}/")
            ):
                route_boost = 1.15

            # Mild category cue
            cat_boost = 0.0
            if ("how" in text_lower or "formula" in text_lower or "calc" in text_lower) and doc.category == "calculation":
                cat_boost = 0.35
            elif ("where" in text_lower or "find" in text_lower or "open" in text_lower) and doc.category == "navigation":
                cat_boost = 0.35
            elif ("loss" in text_lower or "gain" in text_lower or "variance" in text_lower) and doc.category == "accounting-analysis":
                cat_boost = 0.45

            # Guardrail: route boost alone must never match an unrelated question
            signal = lex + (sem * 4.2)
            if signal < 0.85:
                continue

            # Curated memory gets slight priority over auto-parsed raw manual chunks
            source_bonus = 0.35 if doc.source_kind == "memory" else 0.0
            total = signal + route_boost + cat_boost + source_bonus
            hits.append(
                SearchHit(
                    doc=doc,
                    score=round(total, 4),
                    lexical_score=round(lex, 4),
                    semantic_score=round(sem, 4),
                    route_boost=round(route_boost, 4),
                )
            )

        hits.sort(key=lambda h: (-h.score, h.doc.sort_order, h.doc.title))
        return hits[:top_k]


def load_repository_manual_docs(manuals_dir: Path | None = None) -> list[IndexedDoc]:
    """Parse concise, read-only guide cards from ``Manuals/pages/*.md``.

    Gracefully returns an empty list if the folder is absent (e.g., stripped
    container images), keeping startup fast and completely resilient.
    """
    if manuals_dir is None:
        # Resolve repo root from backend/app/services/local_semantic_index.py
        manuals_dir = Path(__file__).resolve().parents[3] / "Manuals" / "pages"
    if not manuals_dir.exists() or not manuals_dir.is_dir():
        return []

    docs: list[IndexedDoc] = []
    for md_path in sorted(manuals_dir.glob("*.md")):
        if md_path.name.startswith("50_INDEX") or md_path.name.startswith("00_"):
            continue
        try:
            raw = md_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = [line.strip() for line in raw.splitlines()]
        title = ""
        route = ""
        paragraphs: list[str] = []
        for line in lines:
            if not title and line.startswith("# "):
                title = line[2:].strip()
            if not route:
                m = re.search(r"`(/[a-z0-9/-]+)`", line)
                if m and not m.group(1).startswith("/api"):
                    route = m.group(1)
            if (
                line
                and not line.startswith("#")
                and not line.startswith("|")
                and not line.startswith("```")
                and not line.startswith("---")
            ):
                cleaned = re.sub(r"[`*]", "", line).strip("- ").strip()
                if len(cleaned) >= 24:
                    paragraphs.append(cleaned)
                if len(paragraphs) >= 3:
                    break
        if not title or not paragraphs:
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", md_path.stem.casefold()).strip("-")
        docs.append(
            IndexedDoc(
                doc_id=f"manual:{slug}",
                title=f"Page Guide · {title[:140]}",
                keywords=f"{md_path.stem.replace('_', ' ')} {title} {route.replace('/', ' ')}",
                body=" ".join(paragraphs)[:650],
                route=route,
                permission="",
                category="navigation",
                source_kind="manual",
                sort_order=220,
            )
        )
    return docs
