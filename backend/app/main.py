import os
import uuid
import logging
import shutil
import asyncio
import time
import httpx
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.extractor import extract_text, assess_parse_confidence
from app.chains import run_all_chains, score_job_matches, answer_ats_followup
from app.models import AnalysisResponse, AtsFollowupRequest, AtsFollowupResponse, FeedbackRequest, FeedbackResponse
from app.calibration import apply_calibration
from app.feedback import log_feedback

# Setup logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)

# Initialize FastAPI App
app = FastAPI(
    title="Resume Analyzer API",
    version="1.0.0",
    description="API for parsing resumes (PDF/DOCX) and running parallel LLM analysis chains (ATS, Skills, Jobs, Rewrite)."
)

# CORS Configuration
# NOTE: allow_origins=["*"] combined with allow_credentials=True is both invalid
# per the CORS spec (browsers will not honor credentialed requests against a
# wildcard origin) and unsafe as a pattern. Origins are now read from an env
# var so each deployment (local dev, staging, prod) can set its own explicit
# allow-list instead of sharing one wildcard config.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
ALLOWED_ORIGINS = [origin.strip() for origin in _raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Local temp directory within the workspace to save files during extraction
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp_uploads")
os.makedirs(TEMP_DIR, exist_ok=True)


@app.on_event("startup")
def startup_event():
    if not os.getenv("GROQ_API_KEY"):
        logger.critical(
            "GROQ_API_KEY is not set. The /analyze and /reanalyze endpoints will fail. "
            "Set this environment variable before accepting traffic."
        )
    if not ALLOWED_ORIGINS or ALLOWED_ORIGINS == ["*"]:
        logger.warning(
            "ALLOWED_ORIGINS is not set to a restricted list. Set the ALLOWED_ORIGINS "
            "env var (comma-separated) before accepting production traffic."
        )


@app.get("/health", status_code=200)
def health_check():
    """Simple endpoint to verify api is active. Render uses this for health checking."""
    return {"status": "ok"}


@app.get("/debug/jsearch")
async def debug_jsearch_status(live_test: bool = False):
    """
    Verifies whether live job search (JSearch/RapidAPI) is actually working,
    without needing to run a full resume analysis to find out.

    GET /debug/jsearch
        Cheap check — just reports whether RAPIDAPI_KEY is configured.
        Uses zero API quota.

    GET /debug/jsearch?live_test=true
        Makes one real, minimal JSearch call using the exact same
        fetch_live_jobs() function the app uses for real analyses (same
        retry/backoff, same week-then-month fallback tier) and reports
        whether it actually succeeded. Uses 1 unit of your API quota.
    """
    api_key = os.getenv("RAPIDAPI_KEY")
    if not api_key:
        return {
            "configured": False,
            "detail": "RAPIDAPI_KEY is not set in the environment. Add it to backend/.env and restart uvicorn.",
        }

    masked_key = f"{api_key[:4]}...{api_key[-4:]}" if len(api_key) > 8 else "****"

    if not live_test:
        return {
            "configured": True,
            "key_preview": masked_key,
            "cache_entries": len(_jsearch_cache),
            "cache_ttl_seconds": JSEARCH_CACHE_TTL_SECONDS,
            "detail": "RAPIDAPI_KEY is set. Call GET /debug/jsearch?live_test=true to make one real test request and confirm it's actually valid (uses 1 API quota unit, unless already cached).",
        }

    logger.info("Running /debug/jsearch live_test=true — making a real JSearch test call.")

    # Raw call first: bypasses all retry/fallback logic to show EXACTLY what
    # RapidAPI said. This is what actually distinguishes "not subscribed to
    # this API on RapidAPI" (a 403 with a specific message) from "the key
    # works fine, this particular search just came back empty" (a 200 with
    # an empty data array) — the app's normal fetch_live_jobs() collapses
    # both of those into the same "fallback_no_results" status, which isn't
    # enough to diagnose a subscription problem from the outside.
    raw_status_code = None
    raw_body_snippet = None
    try:
        async with httpx.AsyncClient() as client:
            raw_resp = await client.get(
                JSEARCH_URL,
                params={"query": "Software Developer in India", "num_pages": 1, "date_posted": "month"},
                headers={"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
                timeout=10.0,
            )
            raw_status_code = raw_resp.status_code
            raw_body_snippet = raw_resp.text[:500]
    except Exception as e:
        raw_body_snippet = f"Raw diagnostic call itself failed: {e}"

    jobs, status, message = await fetch_live_jobs(["Software Developer"])

    return {
        "configured": True,
        "key_preview": masked_key,
        "raw_http_status": raw_status_code,   # 200 = OK; 403 = usually "not subscribed to this API"; 401 = invalid key
        "raw_body_preview": raw_body_snippet,  # look here for RapidAPI's own error message if status isn't 200
        # Note: raw_http_status/raw_body_preview above ALWAYS make a fresh call
        # (that's the point — showing the unfiltered truth). live_test_status
        # below goes through fetch_live_jobs(), which DOES use the cache.
        "live_test_status": status,     # "live" = key works and returned real results
        "live_test_message": message,
        "jobs_found": len(jobs),
        "sample_job": jobs[0] if jobs else None,
        "cache_entries": len(_jsearch_cache),
    }


# ---------------------------------------------------------------------------
# Fallback job listings
# ---------------------------------------------------------------------------
# This is a small static/curated list used ONLY when the live JSearch API call
# fails, returns nothing, or no RAPIDAPI_KEY is configured. It is NOT live
# data. Every job returned from here is tagged source="fallback" (see
# get_fallback_indian_jobs) so the frontend can visually distinguish it from
# real-time postings instead of presenting it as "Updated Today".
_FALLBACK_JOB_LISTINGS = [
    {
        "title": "Full Stack Developer (Fresher)",
        "company": "Capminds",
        "location": "Chennai, Tamil Nadu (Remote)",
        "posted_at": "2026-06-23T05:30:00Z",
        "apply_link": "https://www.capminds.com/careers/",
        "description": "Exciting opportunity for a Fresher Full Stack Developer skilled in MongoDB, Express.js, React.js, and Node.js (MERN stack). You will work on designing, building, and deploying scalable web applications and collaborating with cross-functional teams.",
        "employment_type": "Full-time",
        "keywords": ["mern", "full stack", "mongodb", "react", "node", "express", "javascript"]
    },
    {
        "title": "React / Next.js Frontend Developer",
        "company": "PicEra Private Limited",
        "location": "Delhi, India",
        "posted_at": "2026-06-23T06:00:00Z",
        "apply_link": "https://www.picera.com/careers/",
        "description": "Looking for a Frontend Developer with experience in React.js and Next.js. You will be building responsive user interfaces, implementing complex UI/UX designs, and integrating with RESTful APIs. Experience with Tailwind CSS and Framer Motion is a plus.",
        "employment_type": "Full-time",
        "keywords": ["react", "next.js", "nextjs", "frontend", "javascript", "typescript", "tailwind", "framer motion"]
    },
    {
        "title": "Node.js Developer Intern",
        "company": "Unikwork Systems",
        "location": "Surat, Gujarat (Hybrid)",
        "posted_at": "2026-06-23T07:15:00Z",
        "apply_link": "https://www.unikwork.com/careers/",
        "description": "Work closely with our backend engineering team to develop APIs, write clean server-side backend code, and manage MongoDB/MySQL databases. Knowledge of Socket.io and REST APIs is highly appreciated.",
        "employment_type": "Internship",
        "keywords": ["node", "express", "backend", "socket.io", "socket", "api", "mongodb", "mysql", "sql"]
    },
    {
        "title": "Junior ReactJS Developer",
        "company": "Altos Technologies",
        "location": "Kochi, Kerala (Remote)",
        "posted_at": "2026-06-23T04:45:00Z",
        "apply_link": "https://www.altostechnologies.com/careers/",
        "description": "Altos Technologies is seeking a Junior React Developer. Join our frontend team to build high-performance React.js applications. Strong understanding of JavaScript, React hooks, state management, and Git is required.",
        "employment_type": "Full-time",
        "keywords": ["react", "javascript", "frontend", "hooks", "git"]
    },
    {
        "title": "MERN Stack Developer Trainee",
        "company": "Softnotions Tech",
        "location": "Trivandrum, Kerala",
        "posted_at": "2026-06-23T02:00:00Z",
        "apply_link": "https://www.softnotions.com/careers/",
        "description": "Join our intensive MERN stack training program. Ideal for CS/IT freshers who have built hands-on projects with React, Node.js, and MongoDB. Learn agile development workflows and cloud deployment.",
        "employment_type": "Internship",
        "keywords": ["mern", "mongodb", "react", "node", "express", "web development"]
    },
    {
        "title": "Python & AI Developer Intern",
        "company": "NeetSupport",
        "location": "Noida, Uttar Pradesh (Remote)",
        "posted_at": "2026-06-23T06:30:00Z",
        "apply_link": "https://www.neetsupport.com/careers/",
        "description": "NeetSupport is seeking a Python developer intern. You will work with LLM APIs (like Gemini/OpenAI), write backend scripts in Python, and build data parsing pipelines.",
        "employment_type": "Internship",
        "keywords": ["python", "ai", "gemini", "openai", "llm", "data science"]
    },
    {
        "title": "Junior Data Scientist",
        "company": "Speqto Technologies",
        "location": "Noida, Uttar Pradesh",
        "posted_at": "2026-06-23T04:15:00Z",
        "apply_link": "https://www.speqto.com/careers/",
        "description": "Entry level position for candidates with strong Python skills, SQL knowledge, and understanding of Machine Learning/AI concepts. Help build recommendation systems and clean datasets.",
        "employment_type": "Full-time",
        "keywords": ["python", "sql", "machine learning", "data science", "ai"]
    },
    {
        "title": "Cloud Associate (AWS/GCP)",
        "company": "TechMahindra",
        "location": "Pune, Maharashtra (Hybrid)",
        "posted_at": "2026-06-23T03:30:00Z",
        "apply_link": "https://www.techmahindra.com/careers/",
        "description": "Looking for entry level cloud enthusiasts with AWS/GCP certifications. Help configure cloud environments, monitor application performance, and manage basic IAM permissions.",
        "employment_type": "Full-time",
        "keywords": ["aws", "gcp", "cloud", "docker", "kubernetes", "devops"]
    }
]


def get_fallback_indian_jobs(resume_text: str) -> list:
    """Returns the top 4 curated fallback listings, keyword-ranked against the resume.

    Every entry is tagged source="fallback" so callers/consumers never confuse
    this static list with a real-time JSearch result.
    """
    resume_lower = resume_text.lower()

    scored_jobs = []
    for job in _FALLBACK_JOB_LISTINGS:
        score = 0
        for keyword in job["keywords"]:
            if keyword in resume_lower:
                score += 1

        # Also give partial score boost for title keyword matches
        title_lower = job["title"].lower()
        if "react" in title_lower and "react" in resume_lower:
            score += 1
        if "node" in title_lower and "node" in resume_lower:
            score += 1
        if "python" in title_lower and "python" in resume_lower:
            score += 1
        if "cloud" in title_lower and ("aws" in resume_lower or "cloud" in resume_lower):
            score += 1

        scored_jobs.append((score, job))

    # Sort by score descending
    scored_jobs.sort(key=lambda x: x[0], reverse=True)

    # Format and return the top 4 matched jobs
    matched_jobs = []
    for score, job in scored_jobs[:4]:
        job_copy = job.copy()
        job_copy.pop("keywords", None)
        job_copy["source"] = "fallback"
        matched_jobs.append(job_copy)

    return matched_jobs


# ---------------------------------------------------------------------------
# Live job search (JSearch API) — single shared implementation.
# Previously this ~80-line block was duplicated verbatim in both /analyze and
# /reanalyze. It now lives in one place so a fix or API change only has to
# happen once.
# ---------------------------------------------------------------------------
JSEARCH_URL = "https://jsearch.p.rapidapi.com/search"
JSEARCH_RESULTS_PER_QUERY = 10  # was 5 — bigger pool so "Load More" has real inventory to reveal
JSEARCH_MAX_RETRIES = 2        # per individual request, on 429/5xx only
JSEARCH_RETRY_BASE_DELAY = 1.0  # seconds; doubles each retry (1s, 2s)
JSEARCH_CACHE_TTL_SECONDS = int(os.getenv("JSEARCH_CACHE_TTL_SECONDS", 4 * 60 * 60))  # 4 hours by default

# Simple in-memory TTL cache for raw JSearch responses, keyed by (query, date_posted).
# Deliberately NOT a new service/dependency — just a process-local dict, which is enough
# to cut duplicate API calls within a session or across close-together analyses of similar
# profiles (a very common case: someone re-analyzing the same resume, or two students with
# similar target roles hitting the backend within the same few hours). Resets on restart,
# which is fine — this is a cost optimization, not a correctness requirement.
_jsearch_cache: dict = {}  # key -> (cached_at_epoch_seconds, response_json)


def _jsearch_cache_get(cache_key: str) -> Optional[dict]:
    entry = _jsearch_cache.get(cache_key)
    if not entry:
        return None
    cached_at, response_json = entry
    age = time.time() - cached_at
    if age > JSEARCH_CACHE_TTL_SECONDS:
        del _jsearch_cache[cache_key]
        return None
    logger.info(f"JSearch cache HIT for '{cache_key}' (age: {int(age)}s, saved 1 API call).")
    return response_json


def _jsearch_cache_set(cache_key: str, response_json: dict) -> None:
    _jsearch_cache[cache_key] = (time.time(), response_json)


def _compute_days_since_posting(posted_at_iso: Optional[str]) -> Optional[int]:
    """Computes days-since-posted from JSearch's job_posted_at_datetime_utc field
    server-side, so the frontend's freshness badge is grounded in the API's real
    posting timestamp rather than left to re-derive it (and possibly get local
    timezone parsing wrong) on the client."""
    if not posted_at_iso:
        return None
    try:
        posted_dt = datetime.fromisoformat(posted_at_iso.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta_days = (now - posted_dt).days
        return max(0, delta_days)
    except (ValueError, TypeError):
        return None


async def _jsearch_request_with_retry(client: httpx.AsyncClient, params: dict, headers: dict) -> Optional[dict]:
    """
    Makes one JSearch request with retry/backoff on 429 (rate limit) and 5xx
    (transient server error) — these are exactly the failure modes worth
    retrying, as opposed to 4xx auth/validation errors which won't fix
    themselves on retry. Returns the parsed JSON body, or None if all
    attempts failed (never raises — callers treat None as "this query yielded
    nothing", not as a hard failure of the whole fetch).

    Checks a TTL cache first (see _jsearch_cache_get/_set above) — an
    identical query+date_posted combo within JSEARCH_CACHE_TTL_SECONDS
    returns the cached response with zero API calls made.
    """
    cache_key = f"{params.get('query')}|{params.get('date_posted')}"
    cached = _jsearch_cache_get(cache_key)
    if cached is not None:
        return cached

    last_status = None
    for attempt in range(JSEARCH_MAX_RETRIES + 1):
        try:
            resp = await client.get(JSEARCH_URL, params=params, headers=headers, timeout=10.0)
            if resp.status_code == 200:
                response_json = resp.json()
                _jsearch_cache_set(cache_key, response_json)
                return response_json
            last_status = resp.status_code
            if resp.status_code == 429 or resp.status_code >= 500:
                if attempt < JSEARCH_MAX_RETRIES:
                    delay = JSEARCH_RETRY_BASE_DELAY * (2 ** attempt)
                    logger.warning(
                        f"JSearch request got status {resp.status_code} (query='{params.get('query')}'). "
                        f"Retrying in {delay}s (attempt {attempt + 1}/{JSEARCH_MAX_RETRIES})..."
                    )
                    await asyncio.sleep(delay)
                    continue
            else:
                # Non-retryable client error (401 bad key, 400 bad params, etc.)
                logger.error(f"JSearch request failed with non-retryable status {resp.status_code}: {resp.text[:300]}")
                return None
        except Exception as e:
            last_status = "exception"
            if attempt < JSEARCH_MAX_RETRIES:
                delay = JSEARCH_RETRY_BASE_DELAY * (2 ** attempt)
                logger.warning(f"JSearch request raised {e}. Retrying in {delay}s...")
                await asyncio.sleep(delay)
                continue
            logger.error(f"JSearch request failed after {JSEARCH_MAX_RETRIES} retries: {e}", exc_info=True)
            return None

    logger.error(f"JSearch request exhausted all retries (last status: {last_status}).")
    return None


async def _jsearch_search_pass(client: httpx.AsyncClient, titles: list, headers: dict, date_posted: str) -> list:
    """One pass of querying all titles concurrently for a given date_posted window."""
    tasks = [
        _jsearch_request_with_retry(
            client,
            params={"query": f"{title} in India", "num_pages": 1, "date_posted": date_posted},
            headers=headers,
        )
        for title in titles
    ]
    responses = await asyncio.gather(*tasks)

    jobs = []
    for resp_json in responses:
        if not resp_json:
            continue
        data = resp_json.get("data", [])
        for job in data[:JSEARCH_RESULTS_PER_QUERY]:
            job_city = job.get("job_city")
            job_country = job.get("job_country")
            loc_parts = [p for p in (job_city, job_country) if p]
            location = ", ".join(loc_parts) if loc_parts else "Remote"
            posted_at = job.get("job_posted_at_datetime_utc")

            jobs.append({
                "title": job.get("job_title"),
                "company": job.get("employer_name"),
                "location": location,
                "posted_at": posted_at,
                "days_since_posting": _compute_days_since_posting(posted_at),
                "apply_link": job.get("job_apply_link"),
                "description": job.get("job_description"),
                "employment_type": job.get("job_employment_type"),
                "source": "live",
            })
    return jobs


async def fetch_live_jobs(search_queries: list) -> tuple:
    """Fetches live job postings from the JSearch API for up to 3 search queries.

    Two-tier freshness fallback: tries the last week first; if that yields
    nothing (a common outcome for niche/entry-level queries), retries with
    the last month before giving up. Each individual request also retries on
    429/5xx with exponential backoff before being treated as failed.

    :return: (jobs: list, status: str, message: str) — never raises. status is
        one of: "live", "fallback_no_api_key", "fallback_no_results",
        "fallback_api_error". Callers use this to decide whether to fall back
        to get_fallback_indian_jobs() AND to explain why to the user, instead
        of silently swapping in example data.
    """
    titles = (search_queries or [])[:3]
    if not titles:
        return [], "fallback_no_results", "No search terms were generated for this resume."

    api_key = os.getenv("RAPIDAPI_KEY")
    if not api_key:
        logger.info("RAPIDAPI_KEY not configured. Skipping live JSearch lookup.")
        return [], "fallback_no_api_key", "Live job search unavailable — no RapidAPI key configured. Showing example listings."

    headers = {
        "X-RapidAPI-Key": api_key,
        "X-RapidAPI-Host": "jsearch.p.rapidapi.com"
    }

    try:
        async with httpx.AsyncClient() as client:
            logger.info(f"JSearch: attempting 'past week' search for {len(titles)} queries...")
            jobs = await _jsearch_search_pass(client, titles, headers, date_posted="week")

            if not jobs:
                logger.info("JSearch: 'past week' returned 0 results. Retrying with 'past month'...")
                jobs = await _jsearch_search_pass(client, titles, headers, date_posted="month")

            if jobs:
                logger.info(f"JSearch: succeeded with {len(jobs)} live listings.")
                return jobs, "live", f"{len(jobs)} live listings found."
            else:
                logger.warning("JSearch: both 'week' and 'month' searches returned 0 results.")
                return [], "fallback_no_results", "No live postings found for your profile in the last month. Showing example listings."

    except Exception as jsearch_err:
        logger.error(f"JSearch API integration failed: {jsearch_err}", exc_info=True)
        return [], "fallback_api_error", "Live job search failed unexpectedly. Showing example listings."


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
    """Fallback match_pct heuristic (flat keyword substring overlap). See score_job_matches
    in chains.py for the primary LLM-based scoring this backs up."""
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

    Job matching is now LLM-scored in a single batched call (score_job_matches)
    instead of a flat keyword-substring check, so it can weigh required vs.
    nice-to-have requirements and recognize conceptually-equivalent skills
    (e.g. Next.js counting toward a React requirement). Falls back to the
    original keyword heuristic if the LLM call is unavailable or fails, so a
    match_pct is always present.

    :param live_jobs_status: One of "live", "fallback_no_api_key",
        "fallback_no_results", "fallback_api_error" — from fetch_live_jobs().
        Echoed onto the response so the frontend can show an honest,
        specific reason instead of a generic "no live jobs" state.
    """
    jobs_data = analysis_results.get('jobs') or {}

    # 1. Use fallback jobs if live_jobs is empty
    if not live_jobs:
        logger.info(f"Using fallback job listings (reason: {live_jobs_status}).")
        live_jobs = get_fallback_indian_jobs(resume_text)

    if "jobs" in analysis_results and analysis_results["jobs"] is not None:
        # 2. Score all listings against the resume in one batched LLM call
        llm_matches = await score_job_matches(resume_text, live_jobs)

        matches = []
        if llm_matches:
            for m in llm_matches:
                idx = m.get("index")
                if not isinstance(idx, int) or idx < 0 or idx >= len(live_jobs):
                    continue
                job = live_jobs[idx]
                title = job.get("title", "")
                company = job.get("company", "")
                match_pct = max(0, min(100, int(m.get("match_pct", 0) or 0)))
                matched_reqs = m.get("matched_requirements") or []
                missing_reqs = m.get("missing_requirements") or []
                why = m.get("why", "")

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

        if not matches:
            logger.warning("LLM job match scoring unavailable/failed — falling back to keyword-overlap heuristic.")
            matches = _keyword_overlap_matches(live_jobs, resume_text)
            # Also denormalize the fallback match data onto live_jobs for consistency.
            for job, m in zip(live_jobs, matches):
                job["match_pct"] = m["match_pct"]
                job["match_why"] = m["why"]
                job["matched_requirements"] = m["matched_requirements"]
                job["missing_requirements"] = m["missing_requirements"]

        analysis_results["jobs"]["live_jobs"] = live_jobs
        analysis_results['jobs']['experience_level'] = jobs_data.get('experience_level')
        analysis_results['jobs']['reasoning'] = jobs_data.get('reasoning')
        analysis_results["jobs"]["matches"] = matches
        analysis_results["jobs"]["live_jobs_status"] = live_jobs_status
        analysis_results["jobs"]["live_jobs_message"] = live_jobs_message

    analysis_results["live_jobs"] = live_jobs


async def run_analysis_pipeline(resume_text: str, filename: str = None, job_description: str = None) -> AnalysisResponse:
    """Shared pipeline: run all LLM chains, fetch/enrich jobs, apply ATS
    calibration, and build the response.

    Used by both /analyze and /reanalyze so the two endpoints can't drift.

    :param filename: Original uploaded filename, if this call originated from
        /analyze. None for /reanalyze (no file involved), in which case the
        generic-filename calibration note simply won't apply.
    :param job_description: Optional pasted job posting. When non-empty, ATS,
        Skills, Rewrite, and Cover Letter are tailored to this specific
        posting instead of a generically inferred role.
    """
    job_description = (job_description or "").strip()

    try:
        logger.info(f"Executing LLM analysis chains (tailored={bool(job_description)})...")
        analysis_results = await run_all_chains(resume_text, job_description=job_description)
    except Exception as chain_err:
        logger.error(f"Critical error during LLM analysis: {chain_err}", exc_info=True)
        raise HTTPException(status_code=500, detail="An error occurred while communicating with the LLM provider.")

    if all(val is None for val in analysis_results.values()):
        logger.error("All LLM analysis chains returned None/failed.")
        raise HTTPException(
            status_code=500,
            detail="All LLM analysis chains failed. Please check your Groq API configuration and try again."
        )

    jobs_data = analysis_results.get('jobs') or {}
    search_queries = jobs_data.get('search_queries') or []

    logger.info("Starting JSearch live job lookup...")
    live_jobs, live_jobs_status, live_jobs_message = await fetch_live_jobs(search_queries)

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

    return AnalysisResponse(**analysis_results)


class ReanalyzeRequest(BaseModel):
    resume_text: str = Field(..., description="The plain text of the resume.")
    job_description: Optional[str] = Field(
        default=None,
        description="Optional target job description. When provided, ATS/Skills/Rewrite/Cover Letter are tailored to this specific posting."
    )


@app.post("/reanalyze", response_model=AnalysisResponse)
async def reanalyze_resume(request: ReanalyzeRequest):
    """Reanalyzes updated resume text, running LLM chains and live job search."""
    resume_text = request.resume_text
    if not resume_text or len(resume_text.strip()) < 100:
        raise HTTPException(
            status_code=422,
            detail="Resume text must be at least 100 characters long."
        )

    logger.info(f"Received reanalyze request for text length: {len(resume_text)}")
    result = await run_analysis_pipeline(resume_text, job_description=request.job_description)
    logger.info("Re-analysis completed successfully.")
    return result


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_resume(file: UploadFile = File(...), job_description: Optional[str] = Form(None)):
    """Receives resume file, extracts text, and runs LLM analysis chains in parallel.

    :param job_description: Optional target job description pasted alongside the file upload.
    """
    logger.info(f"Received analyze request for file: '{file.filename}', type: '{file.content_type}'")

    # Sanitize the original filename before it becomes part of a filesystem
    # path — strip directory components so a name like "../../evil.pdf"
    # can't escape TEMP_DIR.
    safe_original_name = os.path.basename(file.filename or "upload")
    temp_filename = f"{uuid.uuid4()}_{safe_original_name}"
    temp_file_path = os.path.join(TEMP_DIR, temp_filename)

    try:
        # Save uploaded file contents off the event loop — file I/O is
        # blocking and would otherwise stall every concurrent request.
        logger.info(f"Saving uploaded file to temporary path: {temp_file_path}")

        def _save_upload():
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

        await asyncio.to_thread(_save_upload)

        # Text extraction (pdfplumber/docx) is also blocking — run in a thread.
        try:
            logger.info("Initiating text extraction...")
            extracted_text = await asyncio.to_thread(extract_text, temp_file_path, file.content_type)
        except ValueError as val_err:
            logger.warning(f"Validation failure during text extraction: {val_err}")
            raise HTTPException(status_code=422, detail=str(val_err))
        except Exception as ext_err:
            logger.error(f"Unexpected error during extraction: {ext_err}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to parse resume text. Please try a different file.")

        result = await run_analysis_pipeline(extracted_text, filename=file.filename, job_description=job_description)
        logger.info("Analysis completed successfully.")
        return result

    finally:
        # Clean up temporary file
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as clean_err:
                logger.error(f"Failed to delete temporary file '{temp_file_path}': {clean_err}")


@app.post("/ats/ask", response_model=AtsFollowupResponse)
async def ask_about_score(request: AtsFollowupRequest):
    """
    'Ask about my score' follow-up chat. Stateless — the client sends the
    ATS result it already has on screen plus a short running history each
    turn, so no session storage is needed on the backend. See
    answer_ats_followup() in chains.py for the actual chain call.
    """
    logger.info(f"Received ATS follow-up question (history length: {len(request.history)}).")

    answer = await answer_ats_followup(
        ats_summary=request.ats_summary,
        question=request.question,
        resume_text=request.resume_text,
        history=[turn.model_dump() for turn in request.history],
    )

    if answer is None:
        raise HTTPException(
            status_code=500,
            detail="Could not get an answer right now. Please check your Groq API configuration and try again."
        )

    return AtsFollowupResponse(answer=answer)


@app.post("/feedback", response_model=FeedbackResponse)
async def submit_feedback(request: FeedbackRequest):
    """
    Records a thumbs up/down on any specific AI-generated suggestion (an ATS
    tip, an interview question, etc.). Fire-and-forget from the frontend's
    perspective — logging failures don't surface as request failures since
    feedback is inherently best-effort.
    """
    if request.rating not in ("up", "down"):
        raise HTTPException(status_code=422, detail="rating must be 'up' or 'down'.")

    log_feedback(
        feature=request.feature,
        rating=request.rating,
        item_id=request.item_id,
        comment=request.comment,
        context=request.context,
    )
    return FeedbackResponse(status="ok")