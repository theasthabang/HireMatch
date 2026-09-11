"""
Alembic migration environment.

Two things worth knowing before running `alembic revision --autogenerate`
or `alembic upgrade head` against Neon:

1. sqlalchemy.url in alembic.ini is left blank on purpose (see that file's
   comment) — the connection string is always read from an env var here,
   so it can never silently drift out of sync with database.py's.

2. Neon gives you a pooled connection string (PgBouncer, host has
   "-pooler" in it) and a direct/unpooled one. database.py's DATABASE_URL
   should be the pooled one — right for a web app's normal query traffic.
   Migrations are DDL run inside an explicit transaction, which doesn't
   play well with PgBouncer's transaction-pooling mode (session-level
   state like prepared statements can behave inconsistently). If you're
   using the pooled string for DATABASE_URL, set MIGRATION_DATABASE_URL to
   Neon's direct connection string and this file will prefer it
   automatically. If you only have one (unpooled) connection string to
   begin with, you don't need to set MIGRATION_DATABASE_URL at all.
"""

import os
import ssl
import sys
from logging.config import fileConfig
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode

from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool
from alembic import context

# Alembic is invoked standalone (not through main.py's import chain, which
# is what triggers .env loading elsewhere in this app) — without this,
# every os.getenv() below sees nothing and DATABASE_URL/MIGRATION_DATABASE_URL
# look unset even when .env has them.
load_dotenv()

# Make the `app` package importable when Alembic is invoked from the
# backend/ root (where alembic.ini lives).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import Base
from app.db import models  # noqa: F401 — import registers User/Resume/Analysis on Base.metadata

config = context.config

database_url = os.getenv("MIGRATION_DATABASE_URL") or os.getenv("DATABASE_URL")


def _prepare_pg8000_url(url: str) -> str:
    """
    Same fix as database.py's _prepare_pg8000_url — duplicated here (not
    imported from database.py) because Alembic builds its own engine from
    this file, independently of database.py's.

    psycopg2's compiled DLL gets blocked by some Windows Application
    Control policies — pg8000 is a pure-Python Postgres driver with no
    compiled binary, so it's immune to that class of block. Neon's
    connection strings include `?sslmode=require&channel_binding=require`,
    both psycopg2/libpq-specific params that pg8000's connect() rejects
    with a TypeError — they're stripped here, and TLS is enabled instead
    via an `ssl_context` connect() kwarg (see _pg8000_connect_args below),
    the way pg8000 actually expects.
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
    if url and "+pg8000" in url:
        return {"ssl_context": ssl.create_default_context()}
    return {}


database_url = _prepare_pg8000_url(database_url)

if database_url:
    config.set_main_option("sqlalchemy.url", database_url)
else:
    raise RuntimeError(
        "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set. Alembic needs "
        "a Postgres connection string to run migrations — see this file's "
        "module docstring for which one to use."
    )

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# autogenerate compares against this to produce migration diffs.
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Emit migration SQL without a live DB connection (`alembic upgrade head --sql`)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations against a live connection — the normal path."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
        connect_args=_pg8000_connect_args(database_url),
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()