"""
Chain assembly and orchestration.

The actual prompt content lives in prompts.py, the generic LLM-calling
plumbing (retry, rate-limit handling) lives in llm_client.py, JSON-repair
logic lives in json_parsing.py, and deterministic embedding-based scoring
lives in embeddings.py/jd_alignment.py. This file's job is narrower: build
the specific chain objects from those prompts, and orchestrate running them
(the wave1/wave2 staggering, job-match scoring, the follow-up chat).
"""

import json
import logging
import asyncio
from typing import Dict, Any, Optional, List

from langchain_core.messages import SystemMessage
from langchain_core.prompts import HumanMessagePromptTemplate, ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

from app.llm_client import (
    llm, LLM_AVAILABLE, build_chain, invoke_chain_safe as _invoke_chain_safe, _is_rate_limit_error,
)
from app.prompts import (
    ATS_SYSTEM_PROMPT, SKILLS_SYSTEM_PROMPT, JOBS_SYSTEM_PROMPT, REWRITE_SYSTEM_PROMPT,
    INTERVIEW_SYSTEM_PROMPT, ROADMAP_SYSTEM_PROMPT, JOB_MATCH_SYSTEM_PROMPT,
    COVER_LETTER_SYSTEM_PROMPT, ATS_FOLLOWUP_SYSTEM_PROMPT,
)
from app.json_parsing import _parse_json_safe

logger = logging.getLogger(__name__)


def build_job_match_chain():
    """Builds the job-match chain, which takes both resume_text and jobs_block as inputs (not just resume_text)."""
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=JOB_MATCH_SYSTEM_PROMPT),
        HumanMessagePromptTemplate.from_template(
            "Candidate Resume:\n{resume_text}\n\nJob Postings (JSON array, each with an index):\n{jobs_block}"
        )
    ])
    return prompt | llm | StrOutputParser()


def build_followup_chain():
    """Builds the ATS follow-up chat chain: takes ats_context, resume_context, history_block, and question."""
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=ATS_FOLLOWUP_SYSTEM_PROMPT),
        HumanMessagePromptTemplate.from_template(
            "ATS Result Context (JSON):\n{ats_context}\n\n"
            "Resume Text (may be empty if not provided):\n{resume_context}\n\n"
            "Prior conversation so far (may be empty):\n{history_block}\n\n"
            "Candidate's new question:\n{question}"
        )
    ])
    return prompt | llm | StrOutputParser()


# Instantiate the chains
ats_chain = build_chain(ATS_SYSTEM_PROMPT)
skills_chain = build_chain(SKILLS_SYSTEM_PROMPT)
jobs_chain = build_chain(JOBS_SYSTEM_PROMPT)
rewrite_chain = build_chain(REWRITE_SYSTEM_PROMPT)
interview_chain = build_chain(INTERVIEW_SYSTEM_PROMPT)
roadmap_chain = build_chain(ROADMAP_SYSTEM_PROMPT)
cover_letter_chain = build_chain(COVER_LETTER_SYSTEM_PROMPT)
job_match_chain = build_job_match_chain()
followup_chain = build_followup_chain()


async def score_job_matches(resume_text: str, jobs: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """
    Explains job fit via a single LLM call — matched_requirements,
    missing_requirements, and a short "why", for a batch of listings.

    NOTE: this function no longer produces match_pct. That's now computed
    separately and deterministically by compute_embedding_match_pcts()
    (embeddings.py) via embedding similarity — this function's only job is
    the qualitative reasoning an embedding similarity score can't produce on
    its own (required-vs-nice-to-have weighting, recognizing equivalent
    skills, explaining *why* in plain language). Callers (see
    job_matching.py's enrich_jobs_and_matches) merge this function's output
    with the embeddings-based match_pct onto the same job objects.

    :param resume_text: The candidate's resume text.
    :param jobs: List of job dicts (as returned by jsearch.py's fetch_live_jobs/get_fallback_indian_jobs),
        expected to have at least 'title', 'company', 'description' keys.
    :return: List of match dicts (index, matched_requirements, missing_requirements, why),
        or None if the chain is unavailable or the call/parse failed — callers should fall back to
        a simpler heuristic in that case rather than surfacing an error.
    """
    if not job_match_chain or not jobs:
        return None

    # Truncate descriptions to keep token usage bounded regardless of how
    # verbose a given posting's description is.
    compact_jobs = [
        {
            "index": i,
            "title": job.get("title") or "",
            "company": job.get("company") or "",
            "description": (job.get("description") or "")[:600],
        }
        for i, job in enumerate(jobs)
    ]
    jobs_block = json.dumps(compact_jobs)

    try:
        logger.info(f"Triggering job_match chain ainvoke for {len(jobs)} listings...")
        raw = await job_match_chain.ainvoke({"resume_text": resume_text, "jobs_block": jobs_block})
    except Exception as e:
        logger.error(f"job_match chain invocation failed: {e}", exc_info=True)
        return None

    parsed = _parse_json_safe(raw, "job_match")
    if not parsed or not isinstance(parsed.get("matches"), list):
        logger.warning("job_match chain returned no usable 'matches' list.")
        return None

    return parsed["matches"]


def _parse_wave_results(keys: List[str], raw_results: list) -> tuple:
    """Shared parsing step for both wave1 and wave2 — takes the raw
    invoke_chain_safe results (or gather exceptions) and returns
    (parsed_dict, was_rate_limited). Factored out so run_wave1_chains and
    run_wave2_chains don't duplicate this logic."""
    parsed = {}
    was_rate_limited = False
    for key, res in zip(keys, raw_results):
        if isinstance(res, Exception):
            if _is_rate_limit_error(res):
                was_rate_limited = True
            logger.error(f"Gathered exception for {key} chain: {res}", exc_info=True)
            parsed[key] = None
        else:
            parsed[key] = _parse_json_safe(res, key)
    return parsed, was_rate_limited


WAVE1_KEYS = ["ats", "skills", "jobs"]
WAVE2_KEYS = ["rewrite", "interview", "roadmap", "cover_letter"]


async def run_wave1_chains(resume_text: str, job_description: str = "", industry_context: str = "") -> tuple:
    """
    Runs the 3 short/cheap chains (ats/skills/jobs) concurrently. Split out
    from what used to be one opaque run_all_chains() call specifically so
    pipeline.py can start the JSearch live-job fetch (which only needs wave
    1's 'jobs' output — search_queries) at the same time as wave 2 runs,
    instead of waiting for wave 2 to fully finish first. Wave 2 was made
    sequential for TPM-budget reliability (see run_wave2_chains' docstring)
    and can take 1-2+ minutes on its own under a tight rate limit — there's
    no reason JSearch's independent, unrelated network calls should sit idle
    behind that.

    :param industry_context: See skills_taxonomy.py's build_industry_context —
        empty string unless the candidate explicitly selected an industry.
        Only the ats and skills chains' system prompts actually reference
        this (see prompts.py's INDUSTRY_CONTEXT_INSTRUCTION); the jobs
        chain ignores it, same as it already ignores job_description.
    :return: (results_dict, was_rate_limited) for just the 3 wave-1 keys.
    """
    if not LLM_AVAILABLE:
        logger.warning("LLM client is not available. Skipping wave 1 chain invocations.")
        return {key: None for key in WAVE1_KEYS}, False

    inputs = {"resume_text": resume_text, "job_description": job_description or "", "industry_context": industry_context or ""}
    logger.info("Starting wave 1 chains (ats/skills/jobs, concurrent)...")
    raw_results = await asyncio.gather(
        _invoke_chain_safe(ats_chain, inputs, "ats"),
        _invoke_chain_safe(skills_chain, inputs, "skills"),
        _invoke_chain_safe(jobs_chain, inputs, "jobs"),
        return_exceptions=True
    )
    return _parse_wave_results(WAVE1_KEYS, raw_results)


async def run_wave2_chains(resume_text: str, job_description: str = "", industry_context: str = "") -> tuple:
    """
    Runs the 4 longer/pricier chains (rewrite/interview/roadmap/cover_letter)
    fully sequentially — one chain's request completes before the next one
    starts, rather than concurrently. Staggering just the *launch* time (an
    earlier version of this) wasn't enough: with a genuinely tight per-account
    TPM budget, two calls launched a couple seconds apart can still have
    their completions overlap in the same rolling window, which is exactly
    what was still causing an occasional wave-2 chain (seen on both
    'cover_letter' and 'rewrite' in practice) to lose the token race and
    exhaust its retries. True sequential execution trades wall-clock time
    (this can take as long as its 4 calls summed, roughly a minute or more
    under retries) for actual reliability — the honest tradeoff given the
    account's rate limit, not a cosmetic mitigation.

    Callers should fire this concurrently with any independent, unrelated
    work (e.g. pipeline.py's JSearch job fetch) rather than awaiting it in
    isolation, since there's no reason unrelated network calls should sit
    idle behind this specifically.

    :param industry_context: Accepted (and passed through to the shared
        template — see llm_client.py's build_chain()) purely because the
        template requires the key to exist, not because any wave-2 chain's
        system prompt currently acts on it. None of the four chains here
        reference INDUSTRY CONTEXT in their prompts (see prompts.py), so
        this is a no-op for their actual output — same pattern already
        used for job_description on the jobs/interview/roadmap chains.
    :return: (results_dict, was_rate_limited) for just the 4 wave-2 keys.
    """
    if not LLM_AVAILABLE:
        logger.warning("LLM client is not available. Skipping wave 2 chain invocations.")
        return {key: None for key in WAVE2_KEYS}, False

    inputs = {"resume_text": resume_text, "job_description": job_description or "", "industry_context": industry_context or ""}

    # Brief pause before wave 2 to let wave 1's token usage clear the rolling
    # TPM window a bit before this (larger) set of calls begins. Callers that
    # fire this concurrently with wave 1 (there are none currently — wave 1
    # must finish first since it produces the jobs data JSearch needs) would
    # want to account for this delay; as used today (after wave 1 completes),
    # it works exactly as before this function was split out.
    await asyncio.sleep(1.5)

    logger.info("Starting wave 2 chains (rewrite/interview/roadmap/cover_letter, sequential)...")
    raw_results = []
    for chain, key in zip(
        [rewrite_chain, interview_chain, roadmap_chain, cover_letter_chain],
        WAVE2_KEYS,
    ):
        result = await _invoke_chain_safe(chain, inputs, key)
        raw_results.append(result)

    return _parse_wave_results(WAVE2_KEYS, raw_results)


async def run_all_chains(resume_text: str, job_description: str = "", industry_context: str = "") -> tuple:
    """
    Backward-compatible wrapper that runs wave 1 then wave 2 in strict
    sequence, exactly as this function always has. Prefer calling
    run_wave1_chains() and run_wave2_chains() separately (see pipeline.py's
    run_analysis_pipeline) when you have independent work — like the
    JSearch job fetch — that can run concurrently with wave 2 instead of
    waiting behind it for no reason. This wrapper remains for any other
    caller that just wants "run everything, give me one result."

    :return: (results_dict, was_rate_limited) for all 7 chain keys combined.
    """
    if not LLM_AVAILABLE:
        logger.warning("LLM client is not available. Skipping all chain invocations.")
        return {key: None for key in WAVE1_KEYS + WAVE2_KEYS}, False

    wave1_dict, wave1_rate_limited = await run_wave1_chains(resume_text, job_description, industry_context)
    wave2_dict, wave2_rate_limited = await run_wave2_chains(resume_text, job_description, industry_context)

    combined = {**wave1_dict, **wave2_dict}
    logger.info(f"Finished gathering and parsing all analysis chains. Rate limited: {wave1_rate_limited or wave2_rate_limited}")
    return combined, (wave1_rate_limited or wave2_rate_limited)


async def answer_ats_followup(
    ats_summary: Dict[str, Any],
    question: str,
    resume_text: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
) -> Optional[str]:
    """
    Answers a follow-up question about an already-computed ATS score.

    Stateless by design: `history` is whatever the client has accumulated and
    resends each turn (see AtsFollowupRequest) — the backend keeps nothing.
    Only the last few turns are used to bound token usage per call.

    :return: Plain-text answer, or None if the chain is unavailable or the call failed.
    """
    if not followup_chain:
        logger.warning("Follow-up chain is not initialized/available.")
        return None

    MAX_HISTORY_TURNS = 6
    recent_history = (history or [])[-MAX_HISTORY_TURNS:]
    if recent_history:
        history_block = "\n".join(
            f"Q: {turn.get('question', '')}\nA: {turn.get('answer', '')}" for turn in recent_history
        )
    else:
        history_block = "(no prior questions in this conversation)"

    try:
        logger.info("Triggering ats_followup chain ainvoke...")
        answer = await followup_chain.ainvoke({
            "ats_context": json.dumps(ats_summary),
            "resume_context": (resume_text or "")[:4000],  # bound token usage
            "history_block": history_block,
            "question": question,
        })
        return answer.strip() if answer else None
    except Exception as e:
        logger.error(f"ats_followup chain invocation failed: {e}", exc_info=True)
        return None