"""
SQLAlchemy engine/session setup for HireMatch's Postgres persistence layer
(Neon). Same pattern as this app's other infra modules (see llm_client.py
for the Groq client equivalent): route/pipeline code should only ever
import `get_db`, never touch `engine` or `SessionLocal` directly.
"""

import os
import ssl
import logging
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

logger = logging.getLogger(__name__)

# Neon gives you two connection strings for the same database: a "pooled"
# one (routed through PgBouncer, host usually has "-pooler" in it) meant
# for exactly this — a web app's normal request/response queries — and a
# "direct"/unpooled one. Use the pooled string here. If you're running
# Alembic migrations against the direct string instead (recommended — see
# alembic/env.py), that's a *separate* env var, not this one.
DATABASE_URL = os.getenv("DATABASE_URL")


def _prepare_pg8000_url(url: str) -> str:
    """
    Rewrites a plain "postgresql://" URL to use pg8000 instead of the
    default psycopg2 driver, and strips query params psycopg2 understands
    but pg8000 does not.

    WHY pg8000 AT ALL: psycopg2's compiled DLL gets blocked by some
    Windows Application Control policies (seen on locked-down/managed
    machines) — pg8000 is a pure-Python Postgres driver with no compiled
    binary, so it's immune to that class of block.

    WHY THE QUERY PARAMS GET STRIPPED: Neon's connection strings include
    `?sslmode=require&channel_binding=require` — both are psycopg2/libpq-
    specific connection parameters. SQLAlchemy passes URL query params
    straight through as keyword arguments to the underlying driver's
    connect() call, and pg8000's connect() doesn't accept either of them
    (`TypeError: connect() got an unexpected keyword argument 'sslmode'`).
    TLS is still required by Neon — see _pg8000_connect_args() below for
    how it's enabled instead, the way pg8000 actually expects.
    """
    if not url or not url.startswith("postgresql://"):
        return url
    url = url.replace("postgresql://", "postgresql+pg8000://", 1)

    parts = urlsplit(url)
    filtered_query = [
        (k, v) for k, v in parse_qsl(parts.query)
        if k not in ("sslmode", "channel_binding")
    ]
    new_query = urlencode(filtered_query)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))


def _pg8000_connect_args(url: str) -> dict:
    """pg8000 enables TLS via an `ssl_context` connect() kwarg, not a
    `sslmode` URL param — Neon requires TLS, so this is how that
    requirement is satisfied for pg8000 specifically."""
    if url and "+pg8000" in url:
        return {"ssl_context": ssl.create_default_context()}
    return {}


DATABASE_URL = _prepare_pg8000_url(DATABASE_URL)

if not DATABASE_URL:
    logger.critical(
        "DATABASE_URL is not set. Set it to your Neon pooled connection string "
        "(postgresql://user:password@ep-xxxx-pooler.region.aws.neon.tech/dbname?sslmode=require) "
        "before any endpoint that touches the database is called."
    )

# Neon is serverless/autosuspending — the compute endpoint can scale to
# zero and a connection can go stale while it's woken back up.
# pool_pre_ping issues a lightweight SELECT 1 before handing out a pooled
# connection, so a stale one gets transparently replaced instead of
# surfacing as an OperationalError on the caller's request. pool_recycle
# proactively retires connections older than 5 minutes for the same reason.
engine = (
    create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args=_pg8000_connect_args(DATABASE_URL),
    )
    if DATABASE_URL
    else None
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """
    FastAPI dependency — yields one session per request, always closed
    afterward (even on an unhandled exception). Usage:

        from fastapi import Depends
        from sqlalchemy.orm import Session
        from app.db.database import get_db

        @app.get("/resumes")
        def list_resumes(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()