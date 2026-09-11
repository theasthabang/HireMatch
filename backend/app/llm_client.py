"""
Generic LLM client plumbing shared by every chain: the ChatGroq client
itself, the generic build_chain() helper, retry-with-backoff invocation,
and rate-limit detection. Split out from chains.py so the actual prompt
content (prompts.py) and chain assembly (chains.py) aren't tangled up with
this lower-level "how do we safely call the LLM" logic.
"""

from dotenv import load_dotenv
import os
import re
import asyncio
import logging
from typing import Dict, Any, Optional

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage
from langchain_core.prompts import HumanMessagePromptTemplate, ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

load_dotenv()

logger = logging.getLogger(__name__)

# Initialize ChatGroq instance
api_key = os.getenv('GROQ_API_KEY')
if not api_key:
    logger.warning("GROQ_API_KEY environment variable is not set. API calls will fail unless configured via environment.")

# Retry/backoff for individual chain calls, mirroring the pattern already
# used for JSearch requests in jsearch.py. Groq's rate limits are the single
# most common cause of a chain silently returning None (see was_rate_limited
# in chains.py's run_all_chains) — a couple of short retries meaningfully
# cuts the whole-chain failure rate without materially slowing down a
# normal request.
#
# NOTE ON ACCOUNT TIER: on the on-demand/free tier, a model like
# openai/gpt-oss-120b can have a tokens-per-minute (TPM) cap as low as 8000.
# Firing several large chain completions in the same instant can burst past
# that in one shot even though the account's *per-request* limits are fine.
# When that happens, Groq's error message includes an exact "try again in
# Xs" wait time — _parse_retry_after_seconds() below prefers that over a
# fixed exponential guess, since a TPM-exhaustion wait can be 20-30s, far
# longer than a plain request-rate 429 would need.
CHAIN_MAX_RETRIES = 3          # per chain call, on rate-limit/5xx-shaped errors only
CHAIN_RETRY_BASE_DELAY = 2.0   # seconds; used when no retry-after hint is parseable
CHAIN_MAX_RETRY_DELAY = 30.0   # cap, so a parsed retry-after can't stall a request indefinitely

LLM_AVAILABLE = True
llm = None

try:
    llm = ChatGroq(
        # llama-3.3-70b-versatile was retired by Groq on 2026-08-16 (see
        # https://console.groq.com/docs/deprecations). openai/gpt-oss-120b is
        # Groq's recommended direct replacement for general-purpose/reasoning
        # workloads. If Groq deprecates this one too in the future, check that
        # page again before swapping the string — a 404 model_not_found error
        # from every chain simultaneously is the signature of this exact issue.
        model_name='openai/gpt-oss-120b',
        groq_api_key=api_key,
        temperature=0.2,
        # Previously unset, meaning a single verbose completion had no ceiling
        # and could eat an unpredictable, large share of the account's 8000
        # tokens-per-minute budget on its own — a real contributor to wave 2's
        # chains (rewrite/interview/roadmap/cover_letter) randomly losing the
        # TPM race against each other. 3000 was chosen by estimating each
        # chain's actual worst-case JSON shape (the interview chain's 10
        # questions x ~150 tokens each is the largest single consumer, with
        # a bullet-heavy rewrite chain a close second) plus headroom — tight
        # enough to make token cost predictable, not so tight that a normal
        # response gets cut mid-JSON and fails to parse, which would trade
        # one failure mode for a worse one.
        max_tokens=3000,
    )
except Exception as e:
    logger.critical(f"Failed to instantiate ChatGroq client: {e}", exc_info=True)
    LLM_AVAILABLE = False


def build_chain(system_prompt: str):
    """
    Helper function to build a standard LLM chain.

    The human message template always includes an (often-empty) Target Job
    Description block AND an (often-empty) Industry Context block, so every
    chain built here supports both without needing separate template
    variants. Chains whose system prompt doesn't reference job_description
    or industry_context (jobs/interview/roadmap/rewrite/cover_letter for the
    latter) simply never mention them — LangChain prompt formatting ignores
    template placeholders the system prompt itself doesn't act on, so this
    is safe for all seven chains uniformly.
    """
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=system_prompt),
        HumanMessagePromptTemplate.from_template(
            "Resume Text:\n{resume_text}\n\n"
            "Industry Context (leave analysis generic if this is empty):\n{industry_context}\n\n"
            "Target Job Description (leave analysis generic if this is empty):\n{job_description}"
        )
    ])
    return prompt | llm | StrOutputParser()


def _is_rate_limit_error(exc) -> bool:
    """Detects whether an exception is a provider rate-limit response, so the
    final error message can say what actually happened instead of the
    generic (and misleading) 'check your configuration'."""
    text = str(exc).lower()
    return "rate_limit" in text or "429" in text or "rate limit" in text


def _parse_retry_after_seconds(exc) -> Optional[float]:
    """
    Groq's TPM (tokens-per-minute) rate-limit errors include an exact wait
    time, e.g. "Please try again in 28.41s". That's far more reliable than a
    fixed exponential backoff guess — a TPM-exhaustion wait can legitimately
    be 20-30s (see the CHAIN_MAX_RETRIES comment above), which a 1.5s/3s
    backoff has no chance of clearing. Falls back to None (caller uses
    exponential backoff instead) if no such hint is present in the message,
    e.g. for a plain request-rate 429 with no token-budget detail.
    """
    match = re.search(r"try again in ([\d.]+)s", str(exc))
    if not match:
        return None
    try:
        return min(float(match.group(1)), CHAIN_MAX_RETRY_DELAY)
    except ValueError:
        return None


async def invoke_chain_safe(chain, inputs: Dict[str, Any], name: str) -> Optional[str]:
    """Helper function to invoke a single chain asynchronously with full exception safety.

    Retries on rate-limit-shaped errors (see _is_rate_limit_error) with
    exponential backoff, the same way jsearch.py's retry logic does for
    JSearch requests — a transient 429 from Groq shouldn't permanently fail
    a whole chain for the request when a short wait would have worked.
    Non-rate-limit errors (bad prompt, auth failure, etc.) are not retried,
    since those won't resolve themselves on a second attempt.

    When Groq's error message includes an exact wait time (TPM-exhaustion
    errors do — see _parse_retry_after_seconds), that's used directly instead
    of the exponential guess, since it can legitimately be much longer than
    a plain request-rate 429 would need.
    """
    if not chain:
        logger.warning(f"Chain {name} is not initialized/available.")
        return None

    last_exc = None
    for attempt in range(CHAIN_MAX_RETRIES + 1):
        try:
            logger.info(f"Triggering {name} chain ainvoke (attempt {attempt + 1}/{CHAIN_MAX_RETRIES + 1})...")
            response = await chain.ainvoke(inputs)
            logger.info(f"Received response from {name} chain.")
            return response
        except Exception as e:
            last_exc = e
            if _is_rate_limit_error(e) and attempt < CHAIN_MAX_RETRIES:
                retry_after = _parse_retry_after_seconds(e)
                delay = retry_after if retry_after is not None else CHAIN_RETRY_BASE_DELAY * (2 ** attempt)
                source = "provider-specified" if retry_after is not None else "exponential-backoff"
                logger.warning(
                    f"{name} chain hit a rate-limit-shaped error. Retrying in {delay:.1f}s ({source}) "
                    f"(attempt {attempt + 1}/{CHAIN_MAX_RETRIES})..."
                )
                await asyncio.sleep(delay)
                continue
            # Non-retryable error, or retries exhausted — give up on this chain.
            break

    logger.error(f"Unhandled error in {name} chain invocation: {last_exc}", exc_info=True)
    return None