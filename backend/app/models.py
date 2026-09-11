from typing import List, Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator

class BaseAnalysisModel(BaseModel):
    """Base model setting standard configurations for LLM-parsed models."""
    model_config = ConfigDict(strict=False)

class CalibrationNote(BaseAnalysisModel):
    """
    A disclosed, structured explanation of an 'invisible' scoring rule that
    affected this specific resume's score (e.g. the no-experience cap, or
    gamified-badge discounting). Only rules that actually applied to THIS
    resume are included — this is not a static list of all possible rules.

    Generated server-side (see app/calibration.py) so the reasoning always
    stays in sync with the scoring logic that actually ran, rather than being
    hardcoded as separate copy in the frontend.
    """
    rule: str = Field(..., description="Machine-readable identifier for the calibration rule, e.g. 'no_experience_cap'.")
    severity: str = Field(..., description="'info' or 'warning' — used by the UI to choose banner styling.")
    message: str = Field(..., description="User-facing explanation of why/how this rule affected the score.")

class ATSResult(BaseAnalysisModel):
    """Results of the ATS optimization and keyword match analysis."""
    score: int = Field(
        ..., 
        description="ATS score from 0 to 100 assessing overall keyword alignment."
    )
    matched_keywords: List[str] = Field(
        default_factory=list, 
        description="Keywords found in both the resume and target job description."
    )
    missing_keywords: List[str] = Field(
        default_factory=list, 
        description="Keywords present in the job description but missing from the resume."
    )
    verdict: str = Field(
        ..., 
        description="Brief qualitative assessment of the resume compatibility."
    )
    rule_scores: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Breakdown of points awarded per ATS rule, keyed by rule id (e.g. 'rule1'). "
            "Each value is enriched server-side with rule_name and points_lost in addition "
            "to the LLM-provided points_awarded/max_points/reason. NOTE: rule_name and "
            "points_lost are additive fields — existing consumers that only read "
            "points_awarded/max_points/reason are unaffected."
        )
    )
    improvement_tips: Optional[List[str]] = Field(
        default_factory=list,
        description="Specific actionable tips to improve the ATS score."
    )
    calibration_notes: List[CalibrationNote] = Field(
        default_factory=list,
        description="Structured, per-resume disclosures of any 'invisible' calibration rules that affected this score."
    )
    confidence: Optional[str] = Field(
        default=None,
        description="'high' | 'medium' | 'low' — how reliable this score is likely to be, based on how cleanly the resume text was extracted."
    )
    confidence_reason: Optional[str] = Field(
        default=None,
        description="Short explanation for the confidence rating."
    )

    @field_validator("score", mode="after")
    @classmethod
    def clamp_score(cls, v: int) -> int:
        """Clamp score between 0 and 100."""
        return max(0, min(100, v))

class CourseRecommendation(BaseAnalysisModel):
    """Recommendation for a learning resource to fill a specific skill gap."""
    skill: str = Field(..., description="The name of the skill to be acquired.")
    resource: str = Field(..., description="Link or reference to a learning resource.")

class SkillsResult(BaseAnalysisModel):
    """Analysis of resume skills, listing strengths, gaps, and learning resources."""
    strong_skills: List[str] = Field(
        default_factory=list, 
        description="List of solid skills demonstrated in the resume."
    )
    weak_areas: List[str] = Field(
        default_factory=list, 
        description="List of skill gaps or weaknesses identified in the resume."
    )
    recommended_courses: List[CourseRecommendation] = Field(
        default_factory=list, 
        description="Suggested courses or resources to cover the identified weak areas."
    )

class JobMatch(BaseAnalysisModel):
    """Evaluation of how well the candidate matches a specific job role."""
    title: str = Field(..., description="The job title or role evaluated.")
    match_pct: int = Field(
        ..., 
        description="Deterministic embedding-similarity match percentage from 0 to 100 between resume and job description (see compute_embedding_match_pcts in chains.py) — not an LLM's subjective estimate."
    )
    why: str = Field(
        ..., 
        description="LLM-generated explanation citing specific resume evidence for why requirements are matched/missing — the qualitative reasoning behind (not the source of) the match_pct above."
    )
    matched_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements from the job posting the candidate demonstrably satisfies (including conceptually-equivalent skills, e.g. Next.js counting toward a React requirement)."
    )
    missing_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements from the job posting with no supporting evidence in the resume."
    )

    @field_validator("match_pct", mode="after")
    @classmethod
    def clamp_match_pct(cls, v: int) -> int:
        """Clamp match percentage between 0 and 100."""
        return max(0, min(100, v))

class LiveJob(BaseAnalysisModel):
    """Details of a live job listing fetched from external APIs."""
    title: Optional[str] = Field(None, description="Job title.")
    company: Optional[str] = Field(None, description="Company or employer name.")
    location: Optional[str] = Field(None, description="Job location (city/country).")
    posted_at: Optional[str] = Field(None, description="UTC timestamp of when the job was posted.")
    apply_link: Optional[str] = Field(None, description="URL to apply for the job.")
    description: Optional[str] = Field(None, description="Short snippet of the job description.")
    employment_type: Optional[str] = Field(None, description="Employment type (e.g. Full-time).")
    days_since_posting: Optional[int] = Field(None, description="Days since job was posted.")
    source: str = Field(
        default="live",
        description="'live' if fetched from the JSearch API in real time, 'fallback' if drawn from the static curated list."
    )
    match_pct: Optional[int] = Field(
        default=None,
        description="Deterministic embedding-similarity match percentage for this listing against the candidate's resume (see compute_embedding_match_pcts in chains.py) — not an LLM's subjective estimate. None if scoring wasn't available for this listing."
    )
    match_why: Optional[str] = Field(
        default=None,
        description="Short explanation of the match score for this listing."
    )
    matched_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements from this listing the candidate satisfies."
    )
    missing_requirements: List[str] = Field(
        default_factory=list,
        description="Requirements from this listing with no supporting evidence in the resume."
    )

class JobsResult(BaseAnalysisModel):
    """Wrapper containing multiple job compatibility matches."""
    matches: List[JobMatch] = Field(
        default_factory=list, 
        description="List of jobs matched with the candidate profile."
    )
    live_jobs: Optional[List[LiveJob]] = Field(
        default_factory=list,
        description="List of live job postings fetched from external APIs."
    )
    experience_level: Optional[str] = Field(default=None, description='Detected candidate experience level.')
    search_queries: Optional[List[str]] = Field(default_factory=list, description='Job search queries used to find live postings.')
    reasoning: Optional[str] = Field(default=None, description='Explanation of why these search queries were chosen.')
    live_jobs_status: Optional[str] = Field(
        default=None,
        description="'live', 'fallback_no_api_key', 'fallback_no_results', or 'fallback_api_error' — why live_jobs is what it is."
    )
    live_jobs_message: Optional[str] = Field(
        default=None,
        description="Human-readable explanation matching live_jobs_status, e.g. 'Live job search unavailable — no RapidAPI key configured.'"
    )

class RewrittenBullet(BaseAnalysisModel):
    """
    A single experience bullet pairing the verbatim original with its rewrite.

    metric_note is populated ONLY when the original bullet had no real,
    verifiable metric and the rewrite therefore could not include one — in
    that case the AI must not invent a number, and instead flags exactly
    what kind of number the candidate should fill in themselves (e.g. team
    size, % improvement, user count). When metric_note is None, any number
    present in `rewritten` is guaranteed to originate from `original`, not
    be AI-invented.
    """
    original: str = Field(..., description="The original bullet point exactly as it appeared in the resume.")
    rewritten: str = Field(..., description="The improved rewrite of this bullet.")
    metric_note: Optional[str] = Field(
        default=None,
        description="If set, the rewrite has no real metric and this describes what number the candidate should add themselves. Never a fabricated metric."
    )

class RewriteResult(BaseAnalysisModel):
    """Suggestions for polishing resume summary and bullet points."""
    summary: str = Field(
        ..., 
        description="An improved or optimized version of the professional summary."
    )
    rewritten_bullets: List[RewrittenBullet] = Field(
        default_factory=list, 
        description="Suggested rewrites for existing experience bullet points, each paired with its original for side-by-side comparison."
    )
    improvements_made: List[str] = Field(
        default_factory=list, 
        description="Explanations of the changes and why they optimize the resume."
    )

class InterviewQuestion(BaseAnalysisModel):
    question: str = Field(..., description="The interview question text.")
    type: str = Field(..., description="Technical, Project, Behavioral, Situational, or Curveball.")
    difficulty: str = Field(..., description="Easy, Medium, or Hard.")
    model_answer: str = Field(..., description="Model answer in first person.")
    key_points: List[str] = Field(default_factory=list)

class InterviewResult(BaseAnalysisModel):
    questions: List[InterviewQuestion] = Field(default_factory=list)

class RoadmapWeek(BaseAnalysisModel):
    week_number: int = Field(..., description='Week number from 1 to 12.')
    title: str = Field(..., description='Short action-oriented title for the week.')
    description: str = Field(..., description='Specific tailored description of what to do this week.')
    estimated_hours: int = Field(..., description='Estimated hours needed this week.')

class RoadmapPhase(BaseAnalysisModel):
    phase_name: str = Field(..., description='Foundation, Application, or Mastery and Portfolio.')
    days_range: str = Field(..., description='e.g. Days 1-30')
    weeks: List[RoadmapWeek] = Field(default_factory=list)

class RoadmapResult(BaseAnalysisModel):
    target_skills: List[str] = Field(default_factory=list)
    phases: List[RoadmapPhase] = Field(default_factory=list)

class CoverLetterResult(BaseAnalysisModel):
    """AI-generated cover letter, tailored to a specific job description when one was provided."""
    letter: str = Field(..., description="The full cover letter text, ready to copy/export.")
    tone: Optional[str] = Field(
        default=None,
        description="Short descriptor of the tone used, e.g. 'Professional and confident'."
    )
    tailored: bool = Field(
        default=False,
        description="True if this letter was written against a specific pasted job description rather than generically from the resume alone."
    )

class JDAlignmentResult(BaseAnalysisModel):
    """
    Deterministic, embedding-based alignment between the resume and an
    optional pasted target job description — computed via cosine similarity
    (see compute_jd_alignment in chains.py), NOT an LLM's subjective
    judgment. Same resume + same JD always produces the same result.

    Only populated when a job description was provided AND the embeddings
    call succeeded; None otherwise (the tailored chains still work via their
    own prompt-level reasoning in that case — this is an additive signal,
    not a hard dependency).
    """
    alignment_pct: int = Field(..., description="0-100 deterministic semantic similarity between resume and job description as a whole.")
    matched_requirements: List[str] = Field(default_factory=list, description="JD requirement lines with embedding-similarity evidence found in the resume.")
    missing_requirements: List[str] = Field(default_factory=list, description="JD requirement lines with no embedding-similarity evidence found in the resume.")
    method: str = Field(default="embedding_similarity", description="How this was computed — always 'embedding_similarity', included so the frontend/API consumers never have to guess.")


class AnalysisResponse(BaseAnalysisModel):
    """Top-level unified analysis response wrapping all sub-component analysis models.
    
    Fields are Optional to prevent a failure in any single chain from failing the entire response.
    """
    ats: Optional[ATSResult] = Field(
        default=None, 
        description="ATS score and keyword analysis."
    )
    skills: Optional[SkillsResult] = Field(
        default=None, 
        description="Skill strengths and course recommendations."
    )
    jobs: Optional[JobsResult] = Field(
        default=None, 
        description="Job matches and compatibility reasons."
    )
    rewrite: Optional[RewriteResult] = Field(
        default=None, 
        description="Resume rewrite suggestions and bullet optimization."
    )
    interview: Optional[InterviewResult] = Field(
        default=None, 
        description="Predicted interview questions."
    )
    roadmap: Optional[RoadmapResult] = Field(
        default=None, 
        description='Personalized 30/60/90-day skill roadmap.'
    )
    cover_letter: Optional[CoverLetterResult] = Field(
        default=None,
        description="AI-generated cover letter, tailored to the pasted job description if one was provided."
    )
    live_jobs: Optional[List[LiveJob]] = Field(
        default_factory=list,
        description="List of live job postings."
    )
    resume_text: Optional[str] = Field(
        default=None,
        description="The plain text of the resume."
    )
    is_tailored: bool = Field(
        default=False,
        description="True if this analysis (ATS, skills, rewrite, cover letter) was computed against a specific pasted job description rather than a generically inferred role."
    )
    tailored_for: Optional[str] = Field(
        default=None,
        description="Short echo of the job description used for tailoring (truncated), shown in the UI so the user can confirm what they tailored against."
    )
    jd_alignment: Optional[JDAlignmentResult] = Field(
        default=None,
        description="Deterministic embedding-based resume-to-JD alignment score and requirement breakdown. None if no job description was provided or the embeddings call failed."
    )
    is_industry_tailored: bool = Field(
        default=False,
        description="True if the ATS and Skills chains were grounded with industry-specific reference terms from an explicitly selected industry/background (see GET /industries)."
    )
    industry: Optional[str] = Field(
        default=None,
        description="The industry id (e.g. 'finance') used for grounding, if is_industry_tailored is True. None otherwise."
    )

class AtsFollowupTurn(BaseAnalysisModel):
    """A single prior question/answer pair, sent back by the client to give the follow-up chat continuity across turns without server-side session storage."""
    question: str
    answer: str

class AtsFollowupRequest(BaseModel):
    """Request body for POST /ats/ask — the 'Ask about my score' follow-up chat."""
    ats_summary: Dict[str, Any] = Field(
        ...,
        description="The ATS result the user already has on screen (score, verdict, rule_scores, calibration_notes, etc.) — sent by the client since the backend keeps no session state."
    )
    question: str = Field(..., min_length=1, max_length=500, description="The user's follow-up question about their score.")
    resume_text: Optional[str] = Field(default=None, description="Optional resume text for grounding, if the client has it.")
    history: List[AtsFollowupTurn] = Field(
        default_factory=list,
        description="Prior turns in this conversation, oldest first. Only the most recent few are used server-side to bound token usage."
    )

class AtsFollowupResponse(BaseModel):
    """Response body for POST /ats/ask."""
    answer: str = Field(..., description="Plain-text answer to the user's question, grounded in ats_summary.")

class FeedbackRequest(BaseModel):
    """
    Request body for POST /feedback — a lightweight thumbs up/down signal on
    any specific AI-generated suggestion, so prompt quality can be iterated
    on using real signal instead of guesswork.
    """
    feature: str = Field(..., description="Which feature this feedback is about, e.g. 'ats_tip', 'ats_overall', 'interview_question'.", max_length=64)
    item_id: Optional[str] = Field(default=None, description="Identifier for the specific item within the feature, e.g. a tip index or question index.", max_length=128)
    rating: str = Field(..., description="'up' or 'down'.")
    comment: Optional[str] = Field(default=None, description="Optional short free-text explanation, mainly expected on 'down' ratings.", max_length=1000)
    context: Optional[Dict[str, Any]] = Field(default=None, description="Optional small snapshot of the item being rated (e.g. the tip text itself), for later review without needing to correlate against logs elsewhere.")

class FeedbackResponse(BaseModel):
    """Response body for POST /feedback."""
    status: str = Field(default="ok")

class ErrorResponse(BaseAnalysisModel):
    """Standard error response format for API validation and processing errors."""
    error: str = Field(..., description="Error type or category.")
    detail: str = Field(..., description="User-friendly details about the error.")