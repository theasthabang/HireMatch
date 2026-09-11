"""
The shared analysis pipeline: runs all LLM chains, fetches/enriches live
jobs, applies ATS calibration, sanitizes malformed LLM output, and builds
the final validated response.

Used by both /analyze and /reanalyze (see main.py) so the two endpoints
can't drift from each other.
"""

import asyncio
import logging

from fastapi import HTTPException
from pydantic import ValidationError

from app.chains import run_wave1_chains, run_wave2_chains
from app.jd_alignment import compute_jd_alignment, build_augmented_job_description
from app.skills_taxonomy import build_industry_context
from app.jsearch import fetch_live_jobs
from app.job_matching import enrich_jobs_and_matches
from app.response_sanitization import sanitize_analysis_results
from app.extractor import assess_parse_confidence
from app.calibration import apply_calibration
from app.models import AnalysisResponse

logger = logging.getLogger(__name__)


async def run_analysis_pipeline(resume_text: str, filename: str = None, job_description: str = None, industry: str = None) -> AnalysisResponse:
    """Shared pipeline: run all LLM chains, fetch/enrich jobs, apply ATS
    calibration, and build the response.

    Used by both /analyze and /reanalyze so the two endpoints can't drift.

    :param filename: Original uploaded filename, if this call originated from
        /analyze. None for /reanalyze (no file involved), in which case the
        generic-filename calibration note simply won't apply.
    :param job_description: Optional pasted job posting. When non-empty, ATS,
        Skills, Rewrite, and Cover Letter are tailored to this specific
        posting instead of a generically inferred role.
    :param industry: Optional industry/background id from GET /industries
        (e.g. "finance"). When set to a real industry (not "general"/None),
        grounds the ATS and Skills chains with industry-specific reference
        terms — see skills_taxonomy.py's build_industry_context for exactly
        what this does and doesn't affect.
    """
    job_description = (job_description or "").strip()
    industry_context = build_industry_context(industry)

    # Deterministic, embedding-based JD alignment — computed once, up front,
    # before any of the 4 tailored chains run. See compute_jd_alignment's
    # docstring in jd_alignment.py for what this replaces: previously,
    # ATS/Skills/Rewrite/Cover Letter each independently decided (via pure
    # LLM prompt reasoning alone) which JD requirements were met. Now that
    # matching decision is made once, deterministically, and handed to all 4
    # chains as shared grounding — they can no longer disagree with each
    # other about which requirements are matched/missing the way independent
    # LLM judgments could. Falls back to None (and tailoring proceeds exactly
    # as it did before this feature existed) if no JD was given or the
    # embeddings call fails — never blocks or degrades the rest of the pipeline.
    jd_alignment = await compute_jd_alignment(resume_text, job_description) if job_description else None
    augmented_job_description = build_augmented_job_description(job_description, jd_alignment)

    try:
        logger.info(f"Executing wave 1 LLM chains (tailored={bool(job_description)}, jd_alignment_computed={jd_alignment is not None})...")
        wave1_results, wave1_rate_limited = await run_wave1_chains(resume_text, job_description=augmented_job_description, industry_context=industry_context)
    except Exception as chain_err:
        logger.error(f"Critical error during wave 1 LLM analysis: {chain_err}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while communicating with the LLM provider.")

    jobs_data = wave1_results.get('jobs') or {}
    search_queries = jobs_data.get('search_queries') or []

    # Wave 2 (rewrite/interview/roadmap/cover_letter — sequential, can take
    # a minute or more under retries, see run_wave2_chains' docstring) and
    # the JSearch live-job fetch are independent of each other — JSearch only
    # needs wave 1's search_queries above, nothing wave 2 produces. Running
    # them concurrently instead of JSearch waiting behind wave 2 for no
    # reason is a real, meaningful chunk of the total request time back.
    logger.info("Starting wave 2 LLM chains and JSearch live job lookup concurrently...")
    try:
        (wave2_results, wave2_rate_limited), (live_jobs, live_jobs_status, live_jobs_message) = await asyncio.gather(
            run_wave2_chains(resume_text, job_description=augmented_job_description, industry_context=industry_context),
            fetch_live_jobs(search_queries),
        )
    except Exception as chain_err:
        logger.error(f"Critical error during wave 2 LLM analysis or JSearch: {chain_err}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while communicating with the LLM provider.")

    analysis_results = {**wave1_results, **wave2_results}
    was_rate_limited = wave1_rate_limited or wave2_rate_limited

    if all(val is None for val in analysis_results.values()):
        logger.error(f"All LLM analysis chains returned None/failed. Rate limited: {was_rate_limited}")
        if was_rate_limited:
            raise HTTPException(
                status_code=503,
                detail="The AI provider's rate limit was hit while analyzing your resume — this happens under heavy load, not because of a config problem. Please wait a minute and try again."
            )
        raise HTTPException(
            status_code=500,
            detail="All LLM analysis chains failed. Please check your Groq API configuration and try again."
        )

    await enrich_jobs_and_matches(analysis_results, resume_text, live_jobs, live_jobs_status, live_jobs_message)
    analysis_results["resume_text"] = resume_text

    # ATS calibration: assess parse confidence (deterministic, no LLM call),
    # enforce the experience-cap as a safety net, enrich rule_scores with
    # rule_name/points_lost, and attach structured calibration_notes.
    confidence, confidence_reason = assess_parse_confidence(resume_text)
    analysis_results["ats"] = apply_calibration(
        ats_result=analysis_results.get("ats"),
        jobs_result=analysis_results.get("jobs"),
        resume_text=resume_text,
        confidence=confidence,
        confidence_reason=confidence_reason,
        filename=filename,
    )

    # Echo tailoring status back so the frontend can show "Tailored for this job"
    # without re-parsing anything itself — single source of truth is the backend.
    analysis_results["is_tailored"] = bool(job_description)
    if job_description:
        analysis_results["tailored_for"] = job_description[:160] + ("..." if len(job_description) > 160 else "")
    analysis_results["jd_alignment"] = jd_alignment
    analysis_results["is_industry_tailored"] = bool(industry_context)
    if industry_context:
        analysis_results["industry"] = industry

    # A chain can return JSON that parses fine but doesn't satisfy its
    # Pydantic model — e.g. the LLM omits a required field like ATSResult.score
    # after a partial/truncated response that still passed _parse_json_safe.
    # Without this guard, that surfaces as an unhandled ValidationError (a
    # raw 500 with no useful detail) instead of the same kind of clear,
    # actionable error every other failure mode in this file already returns.
    # sanitize_analysis_results() above already resolves the most common
    # cause of that — one malformed item in a list field — by
    # dropping/repairing just that item; this remains as a last-resort guard
    # for anything it doesn't cover.
    try:
        sanitize_analysis_results(analysis_results)
        return AnalysisResponse(**analysis_results)
    except ValidationError as val_err:
        logger.error(f"LLM output failed response schema validation: {val_err}", exc_info=True)
        raise HTTPException(
            status_code=502,
            detail="The AI provider returned an unexpected response format. Please try again."
        )