"""
SQLAlchemy ORM models — the database tables.

Deliberately kept separate from app/models.py, which holds the Pydantic
request/response schemas for the API layer (AnalysisResponse, etc.). That
file describes the HTTP wire format; this one describes the tables. They
serve different layers and were never meant to be the same object — a
Resume row and the AnalysisResponse the API returns for it can (and
probably will) diverge in shape over time.
"""

import uuid

from sqlalchemy import Column, Integer, String, Text, DateTime, Float, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    # UUID generated client-side (uuid.uuid4) rather than via a Postgres
    # server_default like gen_random_uuid() — avoids needing the pgcrypto
    # extension enabled on the Neon database at all.
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    # Clerk's own user id (e.g. "user_2abc...") — the source of truth for
    # identity; this table is just how HireMatch links its own data to it.
    clerk_user_id = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    resumes = relationship("Resume", back_populates="user", cascade="all, delete-orphan")


class Resume(Base):
    __tablename__ = "resumes"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    # Wherever the uploaded file actually lives (S3/Supabase Storage/etc.) —
    # this table stores the pointer, not the file bytes.
    file_url = Column(String, nullable=False)
    # The extracted/cleaned resume text plus any structured parse output —
    # same shape as what extractor.py already produces, stored so a re-open
    # of this resume doesn't require re-parsing the file.
    parsed_json = Column(JSONB, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # Bumped each time the same logical resume gets replaced/re-uploaded,
    # so history isn't silently overwritten.
    version = Column(Integer, nullable=False, default=1)

    user = relationship("User", back_populates="resumes")
    analyses = relationship("Analysis", back_populates="resume", cascade="all, delete-orphan")


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    resume_id = Column(Integer, ForeignKey("resumes.id", ondelete="CASCADE"), nullable=False, index=True)
    # Mirrors the optional `industry` param already accepted by /analyze
    # and /reanalyze in main.py (see skills_taxonomy.py).
    career_background = Column(String, nullable=True)
    # The pasted job description, if any — mirrors the optional
    # `job_description` param already accepted by /analyze and /reanalyze.
    target_jd = Column(Text, nullable=True)
    ats_score = Column(Float, nullable=True)
    # The full AnalysisResponse payload (ats/skills/jobs/rewrite/etc.) as
    # returned to the frontend — stored whole so a saved analysis can be
    # reloaded without re-running any LLM chains.
    results_json = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    resume = relationship("Resume", back_populates="analyses")