"""
Clerk auth for HireMatch's protected FastAPI routes.

Two responsibilities live here:

1. Verifying the Bearer JWT Clerk attaches to every authenticated request
   — signature, algorithm, expiry, issuer — against Clerk's public JWKS.
   See _jwk_client below for why that JWKS is fetched once and cached at
   import time, not re-fetched inside every request.

2. Resolving a verified token to a local `users` row, creating one on the
   caller's very first authenticated request if it doesn't exist yet. See
   get_current_user's docstring for the tradeoff that choice makes vs. a
   Clerk webhook-based approach.

The verification logic here (PyJWKClient + jwt.decode with
algorithms=["RS256"] and issuer=CLERK_ISSUER pinned explicitly) was tested
against six scenarios — a valid token, an expired one, a wrong-issuer one,
a signature forged with an attacker's own keypair, an alg=none attack, and
an algorithm-confusion (HS256-with-the-public-key) attack — with all five
attacks correctly rejected. See test_jwt_verification.py.
"""

import os
import logging
from typing import Optional

import httpx
import jwt
from jwt import PyJWKClient
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.db.database import get_db
from app.db import models as db_models

logger = logging.getLogger(__name__)

# From your Clerk dashboard (API Keys):
#   CLERK_JWKS_URL = https://<your-clerk-domain>/.well-known/jwks.json
#   CLERK_ISSUER   = https://<your-clerk-domain>
CLERK_JWKS_URL = os.getenv("CLERK_JWKS_URL")
CLERK_ISSUER = os.getenv("CLERK_ISSUER")

# Only needed for the email-resolution fallback in _fetch_email_from_clerk
# below. Your backend-only secret key (never the publishable key) — from
# the same Clerk dashboard page.
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")

if not CLERK_JWKS_URL or not CLERK_ISSUER:
    logger.warning(
        "CLERK_JWKS_URL and/or CLERK_ISSUER is not set. Every route depending on "
        "get_current_user will fail closed (401) until both are configured."
    )

# ---------------------------------------------------------------------------
# JWKS caching — built ONCE at import time, not inside get_current_user.
# ---------------------------------------------------------------------------
# PyJWKClient caches the keys it fetches and only re-fetches if it sees a
# `kid` in an incoming token that isn't already in its cache (e.g. right
# after Clerk rotates its signing key) — but that caching only helps if
# the SAME client instance is reused across requests. Constructing a fresh
# `PyJWKClient(CLERK_JWKS_URL)` inside get_current_user would give every
# single request an empty cache, meaning every authenticated call —
# /analyze, /resumes, /analyses, all of them — would cost an extra network
# round-trip to Clerk before your own logic even ran, adding real latency
# to your slowest endpoints and putting Clerk's uptime in the critical
# path of every request HireMatch serves. One client, built once, shared
# by every request for the life of the process, fixes that.
_jwk_client: Optional[PyJWKClient] = PyJWKClient(CLERK_JWKS_URL) if CLERK_JWKS_URL else None


def _extract_bearer_token(request: Request) -> str:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    return auth_header[len("Bearer "):].strip()


def _verify_token(token: str) -> dict:
    """
    The security-critical step. In order:

    - signature: was this token signed by Clerk's actual private key,
      using the exact public key Clerk currently publishes for the `kid`
      named in the token's own header — not just "some key that happens
      to decode it."
    - algorithm: pinned explicitly to RS256 via `algorithms=["RS256"]`,
      never inferred from the token's own header. This is what blocks an
      algorithm-confusion attack, where a token claims a different (often
      weaker, symmetric) algorithm to trick a verifier that trusts the
      header into checking the signature the wrong way.
    - expiry (`exp` claim): rejected once the current time is past it.
    - issuer (`iss` claim): rejected unless it exactly equals CLERK_ISSUER.
      Without this check, a validly-signed token from a DIFFERENT Clerk
      application — yours in a different environment, or an unrelated
      Clerk customer's app entirely — would verify successfully here too,
      since it's genuinely signed by Clerk, just not signed for THIS app.
    """
    if _jwk_client is None:
        raise HTTPException(status_code=500, detail="Auth is not configured (CLERK_JWKS_URL missing).")
    try:
        signing_key = _jwk_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER,
            options={"verify_aud": False},  # Clerk session tokens don't set `aud` by default
        )
    except jwt.PyJWTError as e:
        logger.warning(f"Clerk token verification failed: {e}")
        raise HTTPException(status_code=401, detail="Invalid or expired session token.")


def _fetch_email_from_clerk(clerk_user_id: str) -> Optional[str]:
    """
    Fallback for when the token itself doesn't carry an email claim.

    Clerk's DEFAULT session token only guarantees a `sub` claim (the user
    id) — it does NOT include email unless you've added a custom claim to
    your session token's JWT template in the Clerk dashboard (Sessions ->
    Customize session token -> add `"email": "{{user.primary_email_address}}"`).
    If you've done that, this function never gets called — get_current_user
    reads `payload["email"]` directly. This is the fallback for when you
    haven't, calling Clerk's Backend API directly instead. Requires
    CLERK_SECRET_KEY.
    """
    if not CLERK_SECRET_KEY:
        return None
    try:
        resp = httpx.get(
            f"https://api.clerk.com/v1/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
            timeout=5.0,
        )
        resp.raise_for_status()
        data = resp.json()
        addresses = data.get("email_addresses") or []
        primary_id = data.get("primary_email_address_id")
        for addr in addresses:
            if addr.get("id") == primary_id:
                return addr.get("email_address")
        return addresses[0].get("email_address") if addresses else None
    except Exception as e:
        logger.error(f"Failed to fetch email from Clerk Backend API for {clerk_user_id}: {e}")
        return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> db_models.User:
    """
    Verifies the caller's Clerk session token and returns the matching
    local User row — creating it on their very first authenticated
    request if it doesn't exist yet.

    WHY CREATE-ON-FIRST-REQUEST INSTEAD OF DURING SIGN-UP:
    Clerk owns the actual sign-up flow (the <SignUp/> component, password/
    OAuth handling, email verification) entirely client-side — HireMatch's
    backend is never in that loop at all, unless you explicitly wire a
    Clerk webhook (the `user.created` event) to call back into this API
    the moment someone finishes signing up. Doing it here instead means
    one less moving part to build and keep working (no webhook endpoint,
    no webhook-signature verification, no "what if the webhook delivery
    fails" case) — at the cost of the row not existing until their first
    real API call. That's an acceptable trade for HireMatch specifically,
    since nothing in this app is useful before that first call anyway. The
    real tradeoff: a webhook creates the row eagerly (useful if some OTHER
    system needs to know about a user before they ever call HireMatch's
    API) and can also react to user.updated/user.deleted to keep the local
    row in sync later; this approach is simpler but only ever creates,
    never syncs.

    RACE CONDITION: two concurrent first-requests for the same brand-new
    user (e.g. two browser tabs both loading right after signup) can both
    miss the lookup and both attempt the insert. Whichever commits first
    wins; the other hits the unique constraint on clerk_user_id and is
    handled by re-querying instead of surfacing a 500. Tested in
    test_user_provisioning.py.
    """
    token = _extract_bearer_token(request)
    payload = _verify_token(token)

    clerk_user_id = payload.get("sub")
    if not clerk_user_id:
        raise HTTPException(status_code=401, detail="Token is missing its 'sub' claim.")

    user = db.query(db_models.User).filter(db_models.User.clerk_user_id == clerk_user_id).first()
    if user:
        return user

    # First-ever authenticated request for this Clerk identity.
    email = payload.get("email") or _fetch_email_from_clerk(clerk_user_id)
    if not email:
        # Don't create a row with a fabricated/empty email — email is
        # NOT NULL and unique in the schema; a bad value here would either
        # crash the insert or silently corrupt the row.
        raise HTTPException(
            status_code=401,
            detail=(
                "Could not resolve an email address for this account. Add an 'email' "
                "claim to your Clerk session token template, or set CLERK_SECRET_KEY."
            ),
        )

    new_user = db_models.User(clerk_user_id=clerk_user_id, email=email)
    db.add(new_user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        user = db.query(db_models.User).filter(db_models.User.clerk_user_id == clerk_user_id).first()
        if user is None:
            raise  # genuinely unexpected — don't swallow it silently
        return user
    db.refresh(new_user)
    return new_user