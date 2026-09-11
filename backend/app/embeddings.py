"""
Deterministic embedding-based similarity — used for Job Matches' match_pct
and JD alignment scoring (see jd_alignment.py, which builds on top of this).

Split out from chains.py because this is a self-contained concern (talks to
one specific Groq endpoint, does its own math) with its own failure mode
(see the circuit breaker below) that's easier to reason about in isolation.
"""

import os
import math
import logging
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

api_key = os.getenv('GROQ_API_KEY')

GROQ_EMBEDDINGS_URL = "https://api.groq.com/openai/v1/embeddings"
GROQ_EMBEDDING_MODEL = "nomic-embed-text-v1_5"

# Calibration anchors for turning raw cosine similarity into a 0-100 "match %".
#
# Raw cosine similarity between a resume and a job description typically
# clusters in a fairly narrow band (roughly 0.2-0.8 for related professional
# text, rarely near the true 0.0/1.0 extremes) — a naive `similarity * 100`
# would make every job look like a flat, unreadable "45%, 52%, 48%" instead
# of spreading meaningfully across the 0-100 range users are used to seeing.
#
# IMPORTANT — these two numbers are a reasonable *starting* heuristic based
# on typical sentence-embedding behavior, not empirically fit to this exact
# model (nomic-embed-text-v1_5) against real resume/job-description pairs.
# compute_embedding_match_pcts() logs the raw similarity alongside the
# calibrated score specifically so this can be tuned later against real
# observed data instead of staying a guess indefinitely.
SIMILARITY_FLOOR = 0.20   # at/below this raw similarity -> 0% match
SIMILARITY_CEILING = 0.75  # at/above this raw similarity -> 100% match

# Circuit breaker: in production, Groq's embeddings endpoint has been
# observed returning a hard 404 for this model/account (console.groq.com's
# own current model list doesn't include an embeddings model at all,
# confirming it's genuinely unavailable here, not a transient issue).
# Without this flag, every single analysis would waste 2 guaranteed-to-fail
# HTTP round-trips (job matching + JD alignment) on every request, adding
# latency and needless load for zero benefit — the fallback path always
# fires anyway. Once a 404 is seen, skip attempting embeddings for the rest
# of this process's lifetime rather than re-discovering the same failure on
# every request. Restarting the server re-checks (in case Groq re-enables
# it or the account gains access) — this is deliberately not persisted
# anywhere more permanent than process memory.
_embeddings_confirmed_unavailable = False


async def _get_embeddings(texts: List[str]) -> Optional[List[List[float]]]:
    """
    Calls Groq's embeddings endpoint for a batch of texts, returning one
    vector per input text in the same order. Uses the same GROQ_API_KEY
    already configured for chat completions — no separate provider/key to
    manage. Embeddings sit in their own rate-limit pool on Groq's side,
    separate from the chat-completion TPM budget the rest of the app is
    careful to stay under, so this doesn't compete with those calls, when
    it's actually available.

    :return: List of embedding vectors, or None on any failure — callers
        must fall back to a non-embedding heuristic in that case, never
        raise this up as a user-facing error.
    """
    global _embeddings_confirmed_unavailable

    if not api_key or not texts:
        return None
    if _embeddings_confirmed_unavailable:
        return None  # see the circuit-breaker comment above — skip the doomed network call entirely

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(
                GROQ_EMBEDDINGS_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": GROQ_EMBEDDING_MODEL, "input": texts},
            )
        if response.status_code == 404:
            logger.warning(
                "Groq embeddings endpoint returned 404 — treating as confirmed unavailable for this "
                "account/model and skipping further embeddings attempts this process. Falling back to "
                "keyword-overlap heuristics for the rest of this run (and all subsequent ones, until restart)."
            )
            _embeddings_confirmed_unavailable = True
            return None
        response.raise_for_status()
        data = response.json()
        # OpenAI-compatible shape: {"data": [{"index": 0, "embedding": [...]}, ...]}
        # Sort by index defensively rather than assuming response order matches request order.
        entries = sorted(data.get("data", []), key=lambda e: e.get("index", 0))
        vectors = [e.get("embedding") for e in entries]
        if len(vectors) != len(texts) or any(v is None for v in vectors):
            logger.warning(f"Groq embeddings response had unexpected shape (got {len(vectors)} vectors for {len(texts)} inputs).")
            return None
        return vectors
    except Exception as e:
        logger.warning(f"Groq embeddings call failed, will fall back to a non-embedding heuristic: {e}")
        return None


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _calibrate_similarity_to_pct(raw_similarity: float) -> int:
    """Linearly maps raw cosine similarity onto 0-100 using the calibration
    anchors above, clipped at both ends. See those constants' comment for
    why this calibration step exists at all."""
    if raw_similarity <= SIMILARITY_FLOOR:
        return 0
    if raw_similarity >= SIMILARITY_CEILING:
        return 100
    span = SIMILARITY_CEILING - SIMILARITY_FLOOR
    return round(((raw_similarity - SIMILARITY_FLOOR) / span) * 100)


async def compute_embedding_match_pcts(resume_text: str, jobs: List[Dict[str, Any]]) -> Optional[List[int]]:
    """
    Computes a deterministic match_pct per job via embedding cosine
    similarity between the resume and each job's title+description — the
    numeric "how well does this match" figure, kept separate from the LLM's
    job (see score_job_matches in chains.py), which only explains *why* via
    matched/missing requirements rather than also inventing the number
    itself. Same resume + same job text always produces the same score,
    unlike an LLM's subjective judgment.

    :return: List of ints (0-100), same order/length as `jobs`, or None if
        the embeddings call failed entirely — callers should fall back to
        the keyword-overlap heuristic in that case, exactly as they already
        do when the LLM call fails.
    """
    if not jobs:
        return None

    job_texts = [f"{job.get('title') or ''}. {(job.get('description') or '')[:600]}" for job in jobs]
    vectors = await _get_embeddings([resume_text] + job_texts)
    if not vectors:
        return None

    resume_vector, job_vectors = vectors[0], vectors[1:]
    scores = []
    for job, job_vector in zip(jobs, job_vectors):
        raw_similarity = _cosine_similarity(resume_vector, job_vector)
        pct = _calibrate_similarity_to_pct(raw_similarity)
        # Logged so raw similarity values can be reviewed later to refine
        # SIMILARITY_FLOOR/SIMILARITY_CEILING against real data instead of
        # leaving them as a permanent guess.
        logger.info(f"Embedding match for '{job.get('title')}': raw_similarity={raw_similarity:.3f} -> {pct}%")
        scores.append(pct)
    return scores