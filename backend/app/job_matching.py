"""
Combines fetched job listings (jsearch.py) with match scoring — both the
deterministic embeddings-based percentage (embeddings.py, via chains.py's
re-export) and the LLM-based qualitative explanation (chains.py) — into the
final per-job match data the frontend renders.
"""

import logging

from app.jsearch import get_fallback_indian_jobs
from app.embeddings import compute_embedding_match_pcts
from app.chains import score_job_matches

logger = logging.getLogger(__name__)

# Keyword list used ONLY as a fallback when LLM job-match scoring is
# unavailable (chain not configured) or fails. This is the panel's original
# match_pct logic — a flat substring check with no concept of required vs.
# nice-to-have skills — kept as a degraded-but-functional safety net rather
# than showing no match data at all.
_MATCH_FALLBACK_KEYWORDS = [
    "react", "node", "next.js", "nextjs", "express", "mongodb", "socket.io",
    "python", "aws", "gcp", "sql", "javascript", "typescript", "c++"
]


def _keyword_overlap_matches(live_jobs: list, resume_text: str) -> list:
    """Fallback match_pct heuristic (flat keyword substring overlap). See
    score_job_matches in chains.py for the primary LLM-based scoring this
    backs up, and compute_embedding_match_pcts for the primary numeric score."""
    resume_lower = resume_text.lower()
    matches = []
    for job in live_jobs:
        title = job.get("title", "")
        company = job.get("company", "")
        desc = (job.get("description") or "").lower()

        matched_keywords = [kw for kw in _MATCH_FALLBACK_KEYWORDS if kw in desc and kw in resume_lower]
        match_pct = 70 + min(len(matched_keywords) * 5, 25)
        why = f"Matches your skills in {', '.join(matched_keywords) or 'development'}. Your projects showcase experience relevant to {company}'s requirements for {title}."

        matches.append({
            "title": f"{title} at {company}",
            "match_pct": match_pct,
            "why": why,
            "matched_requirements": matched_keywords,
            "missing_requirements": [],
        })
    return matches


async def enrich_jobs_and_matches(
    analysis_results: dict,
    resume_text: str,
    live_jobs: list,
    live_jobs_status: str = "live",
    live_jobs_message: str = "",
):
    """Enriches the analysis results with fallback jobs and job matches to display in UI.

    match_pct and the qualitative explanation (matched/missing requirements,
    "why") are computed independently, by two different mechanisms:

    - match_pct: embedding cosine similarity (compute_embedding_match_pcts in
      embeddings.py) — deterministic, same resume+job always produces the
      same number, unlike an LLM's subjective judgment. Falls back to the
      original keyword-overlap percentage formula if the embeddings call
      fails.
    - matched_requirements / missing_requirements / why: still an LLM call
      (score_job_matches in chains.py) — required-vs-nice-to-have weighting
      and recognizing equivalent skills genuinely needs reasoning an
      embedding similarity score can't produce. Falls back to the same
      keyword heuristic's explanation text if the LLM call fails.

    These two fallbacks are independent: it's entirely possible (and fine)
    for match_pct to come from embeddings while the explanation text comes
    from the keyword fallback, or vice versa, if only one of the two calls
    fails. A match_pct and an explanation are always both present either way.

    :param live_jobs_status: One of "live", "fallback_no_api_key",
        "fallback_no_results", "fallback_api_error" — from jsearch.py's
        fetch_live_jobs(). Echoed onto the response so the frontend can show
        an honest, specific reason instead of a generic "no live jobs" state.
    """
    jobs_data = analysis_results.get('jobs') or {}

    # 1. Use fallback jobs if live_jobs is empty
    if not live_jobs:
        logger.info(f"Using fallback job listings (reason: {live_jobs_status}).")
        live_jobs = get_fallback_indian_jobs(resume_text)

    if "jobs" in analysis_results and analysis_results["jobs"] is not None:
        # 2a. Deterministic match_pct via embeddings, independent of the LLM call below.
        embedding_pcts = await compute_embedding_match_pcts(resume_text, live_jobs)
        if embedding_pcts is None:
            logger.warning("Embedding-based match scoring unavailable/failed — falling back to keyword-overlap percentages.")
            embedding_pcts = [m["match_pct"] for m in _keyword_overlap_matches(live_jobs, resume_text)]

        # 2b. Qualitative explanation via the LLM, independent of the score above.
        llm_matches = await score_job_matches(resume_text, live_jobs)

        matches = []
        if llm_matches:
            # Index LLM results by job index so they can be merged with the
            # embeddings-based percentages below even if the LLM returned
            # them in a different order or (rarely) skipped an index.
            llm_by_index = {
                m.get("index"): m for m in llm_matches
                if isinstance(m.get("index"), int) and 0 <= m.get("index") < len(live_jobs)
            }
        else:
            logger.warning("LLM job match explanation unavailable/failed — falling back to keyword-overlap explanations.")
            llm_by_index = {}

        keyword_fallback = None  # computed lazily, only if actually needed below

        for idx, job in enumerate(live_jobs):
            title = job.get("title", "")
            company = job.get("company", "")
            match_pct = max(0, min(100, int(embedding_pcts[idx] if idx < len(embedding_pcts) else 0)))

            llm_entry = llm_by_index.get(idx)
            if llm_entry:
                matched_reqs = llm_entry.get("matched_requirements") or []
                missing_reqs = llm_entry.get("missing_requirements") or []
                why = llm_entry.get("why", "")
            else:
                if keyword_fallback is None:
                    keyword_fallback = _keyword_overlap_matches(live_jobs, resume_text)
                fallback_entry = keyword_fallback[idx] if idx < len(keyword_fallback) else {}
                matched_reqs = fallback_entry.get("matched_requirements") or []
                missing_reqs = fallback_entry.get("missing_requirements") or []
                why = fallback_entry.get("why", "")

            # Denormalize the match data directly onto the live_job entry
            # too, so the frontend can show match quality right on each
            # job card without cross-referencing a separate matches array.
            job["match_pct"] = match_pct
            job["match_why"] = why
            job["matched_requirements"] = matched_reqs
            job["missing_requirements"] = missing_reqs

            matches.append({
                "title": f"{title} at {company}",
                "match_pct": match_pct,
                "why": why,
                "matched_requirements": matched_reqs,
                "missing_requirements": missing_reqs,
            })

        analysis_results["jobs"]["live_jobs"] = live_jobs
        analysis_results['jobs']['experience_level'] = jobs_data.get('experience_level')
        analysis_results['jobs']['reasoning'] = jobs_data.get('reasoning')
        analysis_results["jobs"]["matches"] = matches
        analysis_results["jobs"]["live_jobs_status"] = live_jobs_status
        analysis_results["jobs"]["live_jobs_message"] = live_jobs_message

    analysis_results["live_jobs"] = live_jobs