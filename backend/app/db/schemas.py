"""
Pydantic schemas for the persistence-layer endpoints (POST /resumes,
GET /resumes/{id}, etc.) — the wire format for app/db/models.py's ORM
tables, the same relationship app/models.py already has to the analysis
pipeline's output. Kept in their own file rather than added to
app/models.py so the two don't blur: app/models.py describes what the AI
pipeline produces, this describes what the database stores.
"""

from datetime import datetime
from typing import Optional, Dict, Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ResumeOut(BaseModel):
    """Response shape for POST /resumes, GET /resumes/{id}, and GET /resumes/{id}/download."""
    model_config = ConfigDict(from_attributes=True)  # lets FastAPI build this straight from the ORM object

    id: int
    user_id: UUID
    file_url: str
    parsed_json: Optional[Dict[str, Any]] = None
    uploaded_at: datetime
    version: int


class AnalysisCreate(BaseModel):
    """
    Body for POST /analyses.

    Deliberately takes the full AnalysisResponse payload (results_json) as
    one blob rather than the frontend re-sending each of its seven
    sections as separate fields — it's already the exact object /analyze
    and /reanalyze returned to the client (see main.py/pipeline.py), so
    this is "save what you already have on screen," the same shape as
    /export/resume's contract, not a second AI generation step.

    ats_score is NOT accepted here on purpose — see create_analysis()'s
    docstring in main.py for why it's derived server-side from
    results_json["ats"]["score"] instead of trusted as separate client
    input, which would let the two silently disagree.
    """
    resume_id: int = Field(..., description="The resume this analysis was run against (must already exist).")
    results_json: Dict[str, Any] = Field(..., description="The full AnalysisResponse payload as returned by /analyze or /reanalyze.")
    career_background: Optional[str] = Field(
        default=None,
        description="The industry id passed to /analyze, if any (e.g. 'finance') — same value the caller already has in its own request state.",
    )
    target_jd: Optional[str] = Field(
        default=None,
        description="The full pasted job description, if any — same value the caller already has (results_json only carries a truncated 'tailored_for' preview, not the full text).",
    )


class AnalysisOut(BaseModel):
    """Response shape for POST /analyses."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    resume_id: int
    career_background: Optional[str] = None
    target_jd: Optional[str] = None
    ats_score: Optional[float] = None
    results_json: Optional[Dict[str, Any]] = None
    created_at: datetime