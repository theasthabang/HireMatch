"""
Deterministic, embedding-based alignment between a resume and an optional
pasted target job description. Builds on top of embeddings.py's low-level
Groq embeddings call + cosine similarity.

This replaces what used to be pure LLM judgment: previously,
JD_TAILORING_INSTRUCTION left ATS/Skills/Rewrite/Cover Letter to each
independently decide, via prompt reasoning alone, which JD requirements
were satisfied. Now that matching decision is made once, deterministically,
and handed to all 4 tailored chains as shared grounding.

What this still can't replace: actually *writing* tailored content
(rewritten bullets, a cover letter) is inherently generative — an embedding
similarity score can tell you a requirement is unmet, it can't produce a
sentence. Those chains remain LLM-based (see chains.py).
"""

import logging
import re
from typing import Any, Dict, List, Optional

from app.embeddings import _get_embeddings, _cosine_similarity, _calibrate_similarity_to_pct

logger = logging.getLogger(__name__)

# Per-requirement-line matching (below) behaves differently from
# whole-document-vs-whole-document similarity (Job Matches, in embeddings.py)
# — a single short requirement phrase embedded and compared against a resume
# will generally sit at a different raw-similarity range than two full
# documents compared against each other. This threshold is a separate,
# equally-unvalidated starting heuristic — see compute_jd_alignment()'s
# logging for how to tune it against real data over time.
JD_REQUIREMENT_MATCH_THRESHOLD = 0.35

# A JD requirement line shorter than this is almost always a fragment from a
# bad split (e.g. a lone bullet glyph or a one-word leftover), not a real
# requirement worth embedding — skip it rather than let it dilute the list.
MIN_REQUIREMENT_LINE_CHARS = 12
MAX_REQUIREMENT_LINES = 25  # keeps the embeddings batch call bounded on a very long pasted JD


def _split_into_requirement_lines(job_description: str) -> List[str]:
    """
    Heuristically splits a pasted job description into individual
    requirement-ish lines for per-line embedding comparison, rather than
    treating the whole JD as one blob. Handles the common real-world shapes:
    already-bulleted text (splits on newlines), and a single unbulleted
    paragraph (splits on sentence-ending punctuation as a fallback).

    This is a plain heuristic, not a real NLP requirement-extractor — it
    will occasionally split awkwardly (mid-clause, or lump two short
    requirements into one line) on unusually formatted postings. That's an
    acceptable trade-off here: matched/missing is a human-readable list the
    user reviews themselves, not a hard gate, so an imperfect split doesn't
    silently corrupt anything the way a bad split feeding straight into a
    score with no human in the loop would.
    """
    if not job_description:
        return []

    # Try line-based splitting first (handles bulleted/newline-separated JDs).
    candidate_lines = [line.strip(" \t•-–*·") for line in job_description.splitlines()]
    candidate_lines = [line for line in candidate_lines if len(line) >= MIN_REQUIREMENT_LINE_CHARS]
    # Drop bare section headers (e.g. "Requirements:", "Nice to have:") — a
    # short line ending in ":" is a heading, not a requirement itself, and
    # would otherwise show up as a misleading false "missing requirement"
    # (a header phrase alone won't semantically match resume content well).
    candidate_lines = [line for line in candidate_lines if not (line.endswith(":") and len(line) < 40)]

    # Fallback: JD was pasted as one dense paragraph with no line breaks —
    # split on sentence boundaries instead.
    if len(candidate_lines) <= 1:
        candidate_lines = [s.strip() for s in re.split(r"(?<=[.!?])\s+", job_description)]
        candidate_lines = [line for line in candidate_lines if len(line) >= MIN_REQUIREMENT_LINE_CHARS]

    return candidate_lines[:MAX_REQUIREMENT_LINES]


async def compute_jd_alignment(resume_text: str, job_description: str) -> Optional[Dict[str, Any]]:
    """
    Deterministic, embedding-based alignment between a resume and an
    optional pasted target job description. Same resume + same JD text
    always produces the same result — the matching decision no longer
    depends on an LLM call at all.

    :return: {"alignment_pct": int, "matched_requirements": [...],
        "missing_requirements": [...]} or None if job_description is empty
        or the embeddings call failed — callers must fall back to the old
        pure-prompt tailoring behavior in that case (i.e. proceed exactly
        as before this function existed), not treat it as a hard error.
    """
    if not job_description or not job_description.strip():
        return None

    requirement_lines = _split_into_requirement_lines(job_description)
    if not requirement_lines:
        logger.warning("JD alignment: could not split the pasted job description into any requirement lines.")
        return None

    vectors = await _get_embeddings([resume_text, job_description] + requirement_lines)
    if not vectors:
        logger.warning("JD alignment: embeddings call failed — tailored chains will fall back to prompt-only reasoning.")
        return None

    resume_vector, jd_vector, requirement_vectors = vectors[0], vectors[1], vectors[2:]

    # Overall alignment: whole-resume vs whole-JD similarity, same
    # calibration curve as Job Matches (see embeddings.py's
    # SIMILARITY_FLOOR/CEILING docstring for why raw cosine similarity needs
    # this scaling step).
    overall_raw = _cosine_similarity(resume_vector, jd_vector)
    alignment_pct = _calibrate_similarity_to_pct(overall_raw)
    logger.info(f"JD alignment: overall raw_similarity={overall_raw:.3f} -> {alignment_pct}%")

    matched, missing = [], []
    for line, line_vector in zip(requirement_lines, requirement_vectors):
        raw = _cosine_similarity(resume_vector, line_vector)
        (matched if raw >= JD_REQUIREMENT_MATCH_THRESHOLD else missing).append(line)
        logger.info(f"JD requirement match: raw_similarity={raw:.3f} (threshold {JD_REQUIREMENT_MATCH_THRESHOLD}) — {'MATCHED' if raw >= JD_REQUIREMENT_MATCH_THRESHOLD else 'missing'} — {line[:80]!r}")

    return {
        "alignment_pct": alignment_pct,
        "matched_requirements": matched,
        "missing_requirements": missing,
    }


def build_augmented_job_description(job_description: str, jd_alignment: Optional[Dict[str, Any]]) -> str:
    """
    Appends the deterministic embedding-based alignment onto the raw pasted
    job description, producing the single string actually passed as
    {job_description} into the chains' prompt inputs (see chains.py's
    run_wave1_chains/run_wave2_chains callers in pipeline.py).

    The "[PRECOMPUTED ALIGNMENT]" marker here must match what
    JD_TAILORING_INSTRUCTION (prompts.py) tells the model to look for — if
    you change the wording of one, check the other.

    If jd_alignment is None (embeddings failed, or no JD was given), returns
    the raw job_description unchanged — the tailored chains simply fall back
    to their original prompt-only reasoning, exactly as before this feature
    existed. This function never raises and never blocks tailoring from
    working when embeddings aren't available.
    """
    if not job_description or not jd_alignment:
        return job_description

    matched = jd_alignment.get("matched_requirements") or []
    missing = jd_alignment.get("missing_requirements") or []
    alignment_pct = jd_alignment.get("alignment_pct")

    lines = [job_description.strip(), "", "[PRECOMPUTED ALIGNMENT]"]
    if isinstance(alignment_pct, int):
        lines.append(f"Overall resume-to-JD semantic alignment: {alignment_pct}%")
    if matched:
        lines.append("Matched requirements (resume shows evidence): " + "; ".join(matched))
    if missing:
        lines.append("Missing requirements (no evidence found in resume): " + "; ".join(missing))
    return "\n".join(lines)