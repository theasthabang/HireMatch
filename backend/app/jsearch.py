"""
Live job search via the JSearch (RapidAPI) API, plus the curated
fallback listings used when live search is unavailable or configured
without an API key.

Split out from main.py because this is a self-contained integration with
its own retry/cache/fallback logic, independent of the LLM chains or the
FastAPI route layer — worth being able to read and test on its own.
"""

import os
import re
import time
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

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
JSEARCH_URL = "https://jsearch.p.rapidapi.com/search-v2"  # was /search — RapidAPI renamed this endpoint
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


# Experience qualifiers the `jobs` chain is instructed to add for
# entry-level/junior candidates (see JOBS_SYSTEM_PROMPT's QUERY GENERATION
# RULES in prompts.py) — e.g. "Full Stack Developer fresher". These make the
# query more *precise* about what the candidate can realistically apply to,
# but they also make it a stricter AND-match against a real job board's
# search index. "fresher" in particular is an Indian-hiring-market term that
# isn't as universally indexed as "intern"/"entry level" — a title qualified
# this way can legitimately return 0 live results in a given week/month
# window even though broader postings for the same underlying role exist.
_EXPERIENCE_QUALIFIER_PATTERN = re.compile(
    r"\b(fresher|freshers|entry[\s-]?level|graduate trainee|intern(?:ship)?|junior)\b",
    re.IGNORECASE,
)


def _broaden_query(title: str) -> str:
    """
    Strips experience qualifiers from a search title, collapsing extra
    whitespace and any separator punctuation left dangling behind (e.g.
    "Graduate Trainee - Data Analyst" -> "Data Analyst", not "- Data
    Analyst"). Used as a last-resort broader search tier — see
    fetch_live_jobs()'s three-tier fallback below. Returns the original
    title unchanged if no qualifier was found (so the caller can skip a
    redundant identical retry).
    """
    broadened = _EXPERIENCE_QUALIFIER_PATTERN.sub("", title)
    # Collapse now-dangling separators (a leftover "-", "–", "," etc. from a
    # qualifier that was joined onto the rest of the title with one) at the
    # start/end of the string, then any resulting extra whitespace.
    broadened = re.sub(r"^[\s\-–,]+|[\s\-–,]+$", "", broadened)
    broadened = re.sub(r"\s{2,}", " ", broadened).strip()
    return broadened or title


async def _jsearch_search_pass(client: httpx.AsyncClient, titles: list, headers: dict, date_posted: str) -> list:
    """One pass of querying all titles concurrently for a given date_posted window."""
    tasks = [
        _jsearch_request_with_retry(
            client,
            params={"query": f"{title} in India", "num_pages": 1, "country": "in", "date_posted": date_posted},
            headers=headers,
        )
        for title in titles
    ]
    responses = await asyncio.gather(*tasks)

    jobs = []
    for resp_json in responses:
        if not resp_json:
            continue

        raw_data = resp_json.get("data", [])
        # search-v2 nests results one level deeper than the older /search
        # endpoint did: {"data": {"jobs": [...], "cursor": "..."}} instead of
        # {"data": [...]}. This was the actual root cause of every "0 live
        # jobs" result up to now — real jobs were being fetched successfully
        # every time (see /debug/jsearch's raw_http_status: 200), then
        # silently discarded here because the old code expected `data`
        # itself to be the list. Handle both shapes so a future endpoint
        # change (or a fallback to /search) degrades gracefully instead of
        # breaking the same way again.
        if isinstance(raw_data, dict):
            job_list = raw_data.get("jobs", [])
        elif isinstance(raw_data, list):
            job_list = raw_data
        else:
            job_list = None

        if not isinstance(job_list, list):
            logger.warning(
                f"JSearch response had an unrecognized 'data' shape (got {type(raw_data).__name__}: "
                f"{str(raw_data)[:200]!r}) — skipping this response. If this keeps happening, check "
                f"GET /debug/jsearch?live_test=true for the current raw response shape."
            )
            continue

        for job in job_list[:JSEARCH_RESULTS_PER_QUERY]:
            if not isinstance(job, dict):
                continue

            # Safety net for the *inner* job object's field names, not just
            # the outer envelope: if the fields this code expects (job_title
            # etc.) are ever renamed too, log it clearly instead of silently
            # appending a job with every field blank — that failure mode is
            # exactly what happened with the outer envelope and took a
            # manual debug session to catch.
            if "job_title" not in job and "job_id" in job:
                logger.warning(
                    f"JSearch job object (id={job.get('job_id')}) is missing expected field 'job_title'. "
                    f"Available keys: {list(job.keys())[:15]}. The job schema may have changed again — "
                    f"check GET /debug/jsearch?live_test=true."
                )

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

    Three-tier freshness/breadth fallback: tries the last week first; if that
    yields nothing (a common outcome for niche/entry-level queries), retries
    with the last month; if that still yields nothing, retries once more with
    experience qualifiers ("fresher", "intern", "junior", etc.) stripped from
    the titles — see _broaden_query()'s docstring for why that's a legitimate
    last resort rather than a lower-quality result. Each individual request
    also retries on 429/5xx with exponential backoff before being treated as
    failed.

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

            if not jobs:
                # Third and final tier: strip experience qualifiers ("fresher",
                # "intern", "junior", etc — see _broaden_query's docstring) and
                # retry once more against the widest window. This exists
                # specifically for entry-level/fresher profiles, where the
                # qualifier-included query is precise but can be too strict an
                # AND-match for a real job board's search index to return
                # anything, even when broader postings for the same role exist.
                broadened_titles = list({_broaden_query(t) for t in titles})
                if broadened_titles != titles:
                    logger.info(
                        f"JSearch: 'past month' returned 0 results with qualified titles. "
                        f"Retrying with broadened titles: {broadened_titles}..."
                    )
                    jobs = await _jsearch_search_pass(client, broadened_titles, headers, date_posted="month")
                    if jobs:
                        logger.info(f"JSearch: broadened-title retry succeeded with {len(jobs)} listings.")

            if jobs:
                logger.info(f"JSearch: succeeded with {len(jobs)} live listings.")
                return jobs, "live", f"{len(jobs)} live listings found."
            else:
                logger.warning("JSearch: 'week', 'month', and broadened-title searches all returned 0 results.")
                return [], "fallback_no_results", "No live postings found for your profile in the last month. Showing example listings."

    except Exception as jsearch_err:
        logger.error(f"JSearch API integration failed: {jsearch_err}", exc_info=True)
        return [], "fallback_api_error", "Live job search failed unexpectedly. Showing example listings."


async def get_debug_status(live_test: bool = False) -> dict:
    """
    Verifies whether live job search (JSearch/RapidAPI) is actually working,
    without needing to run a full resume analysis to find out. Backs the
    GET /debug/jsearch route in main.py — kept here rather than in main.py
    so this module's internals (the cache dict, JSEARCH_URL) stay
    encapsulated instead of being reached into from the route layer.

    live_test=False: cheap check — just reports whether RAPIDAPI_KEY is
        configured. Uses zero API quota.
    live_test=True: makes one real, minimal JSearch call using the exact
        same fetch_live_jobs() function the app uses for real analyses
        (same retry/backoff, same week-then-month fallback tier) and
        reports whether it actually succeeded. Uses 1 unit of API quota.
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
                params={"query": "Software Developer in India", "num_pages": 1, "country": "in", "date_posted": "month"},
                headers={"X-RapidAPI-Key": api_key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com"},
                timeout=10.0,
            )
            raw_status_code = raw_resp.status_code
            # 500 chars was cutting off before even one full job object,
            # which is exactly the data that mattered when diagnosing the
            # search-v2 nesting bug — bumped so future schema drift is
            # actually visible here instead of requiring a second manual
            # curl/Postman call to see past the truncation point.
            raw_body_snippet = raw_resp.text[:3000]
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