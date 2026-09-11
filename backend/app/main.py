"""
FastAPI app: middleware, rate limiting, and route handlers.

All the actual work (LLM chains, JSearch, sanitization, calibration) lives
in the other modules this file imports from — this file's job is just the
HTTP layer: parse the request, call the pipeline, shape the response.
"""

import os
import uuid
import logging
import shutil
import asyncio
from typing import Optional, List

from fastapi import FastAPI, Request, UploadFile, File, HTTPException, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from sqlalchemy.orm import Session

from app.extractor import extract_text
from app.chains import answer_ats_followup
from app.jsearch import get_debug_status
from app.pipeline import run_analysis_pipeline
from app.skills_taxonomy import get_available_industries
from app.models import AnalysisResponse, AtsFollowupRequest, AtsFollowupResponse, FeedbackRequest, FeedbackResponse
from app.feedback import log_feedback
from app.resume_export import build_resume_docx
from app.db.database import get_db
from app.db import models as db_models
from app.db.schemas import ResumeOut, AnalysisCreate, AnalysisOut
from app.auth import get_current_user
from app.storage import upload_resume_to_r2, download_resume_from_r2, get_resume_url, PRESIGNED_URL_EXPIRY_SECONDS

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

# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------
# There's no auth/user concept in this API, so per-IP limiting is the only
# practical guard against something (a misbehaving client, a scraper, or
# someone who got hold of a stale API base URL) burning through the Groq/
# RapidAPI quota. Limits are intentionally generous for normal use but tight
# enough to make abuse expensive. Override via env vars per deployment if
# these defaults don't fit (e.g. a shared demo instance vs. a single-user
# local setup).
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ANALYZE_RATE_LIMIT = os.getenv("ANALYZE_RATE_LIMIT", "5/minute")
FOLLOWUP_RATE_LIMIT = os.getenv("FOLLOWUP_RATE_LIMIT", "20/minute")
FEEDBACK_RATE_LIMIT = os.getenv("FEEDBACK_RATE_LIMIT", "30/minute")

# CORS Configuration
# NOTE: allow_origins=["*"] combined with allow_credentials=True is both invalid
# per the CORS spec (browsers will not honor credentialed requests against a
# wildcard origin) and unsafe as a pattern. Origins are now read from an env
# var so each deployment (local dev, staging, prod) can set its own explicit
# allow-list instead of sharing one wildcard config.
#
# Default here is 3000, not Vite's generic 5173 — this project's own
# vite.config.js pins `server.port: 3000`, so a fresh clone that follows the
# README (`npm run dev` -> opens :3000) with no ALLOWED_ORIGINS override
# would otherwise hit CORS failures out of the box.
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")
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


@app.get("/industries")
def list_industries():
    """
    Returns the list of selectable industries/backgrounds for the frontend's
    dropdown, derived from skills_taxonomy.json's "industry"-typed
    categories (see skills_taxonomy.py). Always includes a "general" option
    first — selecting it (or omitting the field entirely) means zero
    taxonomy involvement, identical to the app's behavior before this
    feature existed.

    No rate limit — this is a static, cheap read with no LLM/external API
    call behind it, unlike every other route in this file.
    """
    return {"industries": get_available_industries()}


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
    return await get_debug_status(live_test=live_test)


class ReanalyzeRequest(BaseModel):
    resume_text: str = Field(..., description="The plain text of the resume.")
    job_description: Optional[str] = Field(
        default=None,
        description="Optional target job description. When provided, ATS/Skills/Rewrite/Cover Letter are tailored to this specific posting."
    )
    industry: Optional[str] = Field(
        default=None,
        description="Optional industry id from GET /industries (e.g. 'finance'). When set to a real industry, grounds ATS/Skills keyword judgment with industry-specific reference terms."
    )


@app.post("/reanalyze", response_model=AnalysisResponse)
@limiter.limit(ANALYZE_RATE_LIMIT)
async def reanalyze_resume(
    request: Request,
    body: ReanalyzeRequest,
    current_user: db_models.User = Depends(get_current_user),
):
    """Reanalyzes updated resume text, running LLM chains and live job search.

    Requires a valid Clerk session (see app/auth.py's get_current_user) —
    current_user isn't otherwise used in this handler's body, it's here
    purely to enforce authentication before the request touches any LLM
    provider quota.

    Note: the endpoint now takes both a starlette `Request` (required by the
    slowapi rate-limit decorator to key off the caller's IP) and the parsed
    Pydantic `body` — FastAPI still validates `body` against ReanalyzeRequest
    exactly as before, this is purely additive.
    """
    resume_text = body.resume_text
    if not resume_text or len(resume_text.strip()) < 100:
        raise HTTPException(
            status_code=422,
            detail="Resume text must be at least 100 characters long."
        )

    logger.info(f"Received reanalyze request for text length: {len(resume_text)}")
    result = await run_analysis_pipeline(resume_text, job_description=body.job_description, industry=body.industry)
    logger.info("Re-analysis completed successfully.")
    return result


@app.post("/analyze", response_model=AnalysisResponse)
@limiter.limit(ANALYZE_RATE_LIMIT)
async def analyze_resume(
    request: Request,
    file: UploadFile = File(...),
    job_description: Optional[str] = Form(None),
    industry: Optional[str] = Form(None),
    current_user: db_models.User = Depends(get_current_user),
):
    """Receives resume file, extracts text, and runs LLM analysis chains in parallel.

    Requires a valid Clerk session — see /reanalyze's docstring above for
    why current_user is a required dependency here even though the body
    doesn't reference it directly.

    :param job_description: Optional target job description pasted alongside the file upload.
    :param industry: Optional industry id from GET /industries (e.g. "finance"), selected before upload.
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

        result = await run_analysis_pipeline(extracted_text, filename=file.filename, job_description=job_description, industry=industry)
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
@limiter.limit(FOLLOWUP_RATE_LIMIT)
async def ask_about_score(
    request: Request,
    body: AtsFollowupRequest,
    current_user: db_models.User = Depends(get_current_user),
):
    """
    'Ask about my score' follow-up chat. Stateless — the client sends the
    ATS result it already has on screen plus a short running history each
    turn, so no session storage is needed on the backend. See
    answer_ats_followup() in chains.py for the actual chain call.

    Requires a valid Clerk session — this is a per-caller LLM call and
    shouldn't be reachable anonymously any more than /analyze is.
    """
    logger.info(f"Received ATS follow-up question (history length: {len(body.history)}).")

    answer = await answer_ats_followup(
        ats_summary=body.ats_summary,
        question=body.question,
        resume_text=body.resume_text,
        history=[turn.model_dump() for turn in body.history],
    )

    if answer is None:
        raise HTTPException(
            status_code=500,
            detail="Could not get an answer right now. Please check your Groq API configuration and try again."
        )

    return AtsFollowupResponse(answer=answer)


@app.post("/feedback", response_model=FeedbackResponse)
@limiter.limit(FEEDBACK_RATE_LIMIT)
async def submit_feedback(request: Request, body: FeedbackRequest):
    """
    Records a thumbs up/down on any specific AI-generated suggestion (an ATS
    tip, an interview question, etc.). Fire-and-forget from the frontend's
    perspective — logging failures don't surface as request failures since
    feedback is inherently best-effort.
    """
    if body.rating not in ("up", "down"):
        raise HTTPException(status_code=422, detail="rating must be 'up' or 'down'.")

    log_feedback(
        feature=body.feature,
        rating=body.rating,
        item_id=body.item_id,
        comment=body.comment,
        context=body.context,
    )
    return FeedbackResponse(status="ok")


class ResumeExportRequest(BaseModel):
    """
    Request body for POST /export/resume. Deliberately takes exactly the
    content the client already has on screen (accepted summary + bullets)
    rather than re-deriving anything server-side — the export is a rendering
    of what the user reviewed and accepted in the Rewrite panel, not a new
    AI generation step, so nothing here should silently diverge from what
    they saw.
    """
    full_name: Optional[str] = Field(
        default=None,
        max_length=200,
        description="Candidate's name for the document header, if known. Purely cosmetic — omit to export without a name line."
    )
    contact_line: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Optional single line of contact info (email / phone / location) shown under the name."
    )
    summary: Optional[str] = Field(
        default=None,
        max_length=4000,
        description="The optimized professional summary text to include."
    )
    bullets: List[str] = Field(
        default_factory=list,
        max_length=100,
        description="Accepted bullet text, in display order — exactly what the user has already accepted/edited client-side."
    )


@app.post("/export/resume")
@limiter.limit(FEEDBACK_RATE_LIMIT)
async def export_resume(
    request: Request,
    body: ResumeExportRequest,
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Renders the user's accepted rewrite content (summary + bullets) as a
    single-column, ATS-safe .docx and streams it back for download.

    No LLM call happens here — this is a pure rendering step over content
    the user already reviewed in the Rewrite panel, so it's fast, free, and
    can't introduce any new fabricated content. See resume_export.py for the
    formatting rules chosen to keep the output ATS-parser-friendly.

    Still requires a valid Clerk session — this renders a document out of
    the caller's own resume content, so it belongs behind auth the same as
    every other resume-related route, even though it doesn't touch the DB.
    """
    if not body.summary and not body.bullets:
        raise HTTPException(
            status_code=422,
            detail="Nothing to export — provide at least a summary or one bullet."
        )

    try:
        buffer = build_resume_docx(
            full_name=body.full_name,
            contact_line=body.contact_line,
            summary=body.summary,
            bullets=body.bullets,
        )
    except Exception as export_err:
        logger.error(f"Resume export failed: {export_err}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate the resume document. Please try again.")

    filename = "resume.docx"
    if body.full_name:
        safe_name = "".join(c for c in body.full_name if c.isalnum() or c in (" ", "_", "-")).strip()
        if safe_name:
            filename = f"{safe_name.replace(' ', '_')}_Resume.docx"

    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Resume persistence (Neon/Postgres)
# ---------------------------------------------------------------------------
# Separate from /analyze and /reanalyze above: those run the LLM pipeline
# and return results directly to the client with nothing saved server-side
# (see pipeline.py — the whole app has been stateless until now). These two
# routes are the first ones that actually touch the database (see
# app/db/database.py's get_db and app/db/models.py's ORM tables) — they
# don't call the AI pipeline at all, just store/retrieve a resume record.


@app.post("/resumes", response_model=ResumeOut, status_code=201)
async def create_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Uploads a resume file, stores it in R2, extracts its text, and creates
    a Resume row owned by the caller — this is now the actual upload path
    (previously took a pre-known file_url + already-parsed JSON; now it
    does the storing and parsing itself, the same way /analyze does).

    Flow, in order:
      1. Read the uploaded bytes.
      2. Upload them to R2 immediately (upload_resume_to_r2) — from this
         point on, R2 is the single source of truth for the raw file.
      3. Download the SAME bytes back FROM R2 into a local temp file, and
         run extract_text() (extractor.py) against that temp file — the
         parsing logic itself is completely untouched; only where its
         input file comes from changed, from the ambient local upload to
         a fresh round-trip through R2.
      4. Delete the temp file — nothing about the raw upload is kept on
         local disk past this request.
      5. Create the Resume row: file_url stores the R2 STORAGE KEY, never
         a URL (see get_resume_download_url below for how access actually
         happens); parsed_json stores the extracted text.
    """
    logger.info(f"Received resume upload for storage: '{file.filename}', type: '{file.content_type}'")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    try:
        storage_key = await asyncio.to_thread(upload_resume_to_r2, file_bytes, current_user.id, file.filename)
    except Exception as upload_err:
        logger.error(f"R2 upload failed: {upload_err}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to store the resume file. Please try again.")

    safe_original_name = os.path.basename(file.filename or "upload")
    temp_filename = f"{uuid.uuid4()}_{safe_original_name}"
    temp_file_path = os.path.join(TEMP_DIR, temp_filename)

    try:
        def _write_from_r2():
            downloaded_bytes = download_resume_from_r2(storage_key)
            with open(temp_file_path, "wb") as buffer:
                buffer.write(downloaded_bytes)

        await asyncio.to_thread(_write_from_r2)

        try:
            extracted_text = await asyncio.to_thread(extract_text, temp_file_path, file.content_type)
        except ValueError as val_err:
            logger.warning(f"Validation failure during text extraction: {val_err}")
            raise HTTPException(status_code=422, detail=str(val_err))
        except Exception as ext_err:
            logger.error(f"Unexpected error during extraction: {ext_err}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to parse resume text. Please try a different file.")
    finally:
        if os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
                logger.info(f"Cleaned up temporary file: {temp_file_path}")
            except Exception as clean_err:
                logger.error(f"Failed to delete temporary file '{temp_file_path}': {clean_err}")

    resume = db_models.Resume(
        user_id=current_user.id,
        file_url=storage_key,  # a storage KEY, never a public URL — see note above
        parsed_json={"resume_text": extracted_text},
        version=1,
    )
    db.add(resume)
    db.commit()
    db.refresh(resume)  # picks up server-generated id/uploaded_at before returning
    return resume


@app.get("/resumes/{resume_id}", response_model=ResumeOut)
def get_resume(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Fetches a single resume record by id — only if it belongs to the
    authenticated caller.

    Returns 404 (not 403) when the resume exists but belongs to someone
    else, same as when it doesn't exist at all — this avoids leaking
    "resume #482 exists, you're just not allowed to see it" to a caller
    probing ids they don't own.
    """
    resume = db.query(db_models.Resume).filter(db_models.Resume.id == resume_id).first()
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"Resume {resume_id} not found.")
    return resume


@app.get("/resumes/{resume_id}/download")
def get_resume_download_url(
    resume_id: int,
    db: Session = Depends(get_db),
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Returns a fresh, short-lived presigned URL for viewing/downloading one
    resume's original file — generated on demand every call, never stored
    anywhere (see this conversation's explanation of why a presigned URL
    beats a permanent public link). Same 404-not-403 ownership check as
    every other resume/analysis route: a resume that exists but belongs to
    someone else looks identical to a resume that doesn't exist at all.
    """
    resume = db.query(db_models.Resume).filter(db_models.Resume.id == resume_id).first()
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"Resume {resume_id} not found.")

    try:
        url = get_resume_url(resume.file_url)
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for resume {resume_id}: {e}", exc_info=True)
        raise HTTPException(status_code=502, detail="Failed to generate a download link. Please try again.")

    return {"url": url, "expires_in": PRESIGNED_URL_EXPIRY_SECONDS}


@app.post("/analyses", response_model=AnalysisOut, status_code=201)
def create_analysis(
    body: AnalysisCreate,
    db: Session = Depends(get_db),
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Saves a completed analysis (an AnalysisResponse the client already has
    from /analyze or /reanalyze) against a resume the caller owns.

    No LLM call happens here — same "render/persist exactly what's already
    on screen" contract as /export/resume, just writing a row instead of a
    .docx. This is what turns a single stateless /analyze call into
    history: the frontend can now call /analyze as before, then POST the
    result here to keep it past this browser session.

    ats_score is deliberately NOT taken from the request body — it's
    pulled out of results_json["ats"]["score"] instead. results_json is
    the ATS chain's own output (by way of calibration.py), which already
    IS the authoritative score; accepting a second, separately-supplied
    ats_score field would let a buggy or stale client persist a number
    that disagrees with the results_json sitting right next to it in the
    same row. ats_score stays None if results_json has no usable
    "ats.score" (e.g. that chain failed for this analysis).

    The resume must belong to the caller — same 404-not-403 reasoning as
    get_resume() above, so an id probe can't distinguish "not yours" from
    "doesn't exist."
    """
    resume = db.query(db_models.Resume).filter(db_models.Resume.id == body.resume_id).first()
    if not resume or resume.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"Resume {body.resume_id} not found.")

    ats_score = None
    ats_block = body.results_json.get("ats") if isinstance(body.results_json, dict) else None
    if isinstance(ats_block, dict) and isinstance(ats_block.get("score"), (int, float)):
        ats_score = float(ats_block["score"])

    analysis = db_models.Analysis(
        resume_id=body.resume_id,
        career_background=body.career_background,
        target_jd=body.target_jd,
        ats_score=ats_score,
        results_json=body.results_json,
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    return analysis


@app.get("/analyses/{analysis_id}", response_model=AnalysisOut)
def get_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: db_models.User = Depends(get_current_user),
):
    """
    Fetches a single saved analysis by id — only if it belongs (via its
    resume) to the authenticated caller. Same 404-not-403 ownership
    pattern as the other three routes here.
    """
    analysis = db.query(db_models.Analysis).filter(db_models.Analysis.id == analysis_id).first()
    if not analysis or analysis.resume.user_id != current_user.id:
        raise HTTPException(status_code=404, detail=f"Analysis {analysis_id} not found.")
    return analysis