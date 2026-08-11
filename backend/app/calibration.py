"""
Deterministic post-processing of the ATS chain's output.

This module exists because two things shouldn't be left entirely to the LLM's
discretion, even with a well-written prompt:

1. Hard business rules (like "no experience -> cap at 70") should be
   *enforced*, not just requested. LLMs don't reliably self-apply a numeric
   ceiling 100% of the time. We re-check the condition in Python using the
   already-computed `jobs.experience_level` signal and clamp the score if the
   LLM didn't.
2. Disclosure of *why* a calibration rule applied should be structured data
   computed from actual signals (experience level, resume text, filename,
   parse confidence) — not left to the LLM to remember to mention in prose,
   and not hardcoded as static copy in the frontend that can drift from the
   real logic.

logger.warning() cases here point at points where the LLM disagreed with our
deterministic check.
"""

import logging
import os
import re
from typing import Any, Dict, List, Optional

from app.ats_rules_config import ATS_RULES_BY_ID, CALIBRATION_TEMPLATES

logger = logging.getLogger(__name__)

NO_EXPERIENCE_LEVELS = {"entry-level", "internship"}
EXPERIENCE_CAP_SCORE = 70

# Keyword signals used to detect gamified/badge-style credentials mentioned
# anywhere in the resume text, to decide whether the "gamified badges
# discounted" disclosure is relevant to this specific resume.
GAMIFIED_BADGE_SIGNALS = [
    "cloud quest", "google cloud arcade", "arcade badge", "skill badge",
    "trailhead badge", "coursera completion", "udemy certificate of completion",
]

GENERIC_FILENAME_PATTERNS = [
    r"^resume\.(pdf|docx)$",
    r"^cv\.(pdf|docx)$",
    r"^document\d*\.(pdf|docx)$",
    r"^untitled.*\.(pdf|docx)$",
    r"^new\s?resume.*\.(pdf|docx)$",
]


def _make_note(rule_id: str, filename: Optional[str] = None) -> Dict[str, str]:
    template = CALIBRATION_TEMPLATES[rule_id]
    message = template["message"]
    if filename is not None:
        message = message.format(filename=filename)
    return {"rule": rule_id, "severity": template["severity"], "message": message}


def enforce_experience_cap(ats_result: Dict[str, Any], jobs_result: Optional[Dict[str, Any]]) -> bool:
    """
    Deterministically enforces the no-experience score cap as a safety net,
    in case the LLM didn't apply it despite the prompt instruction.

    Mutates ats_result["score"] in place if a correction is needed.
    :return: True if a correction was applied.
    """
    if not ats_result or not jobs_result:
        return False

    experience_level = (jobs_result.get("experience_level") or "").lower()
    score = ats_result.get("score")

    if experience_level in NO_EXPERIENCE_LEVELS and isinstance(score, (int, float)) and score > EXPERIENCE_CAP_SCORE:
        logger.warning(
            f"ATS chain returned score={score} for experience_level='{experience_level}', "
            f"which violates the no-experience cap of {EXPERIENCE_CAP_SCORE}. Clamping score server-side."
        )
        ats_result["score"] = EXPERIENCE_CAP_SCORE
        return True

    return False


def build_calibration_notes(
    ats_result: Dict[str, Any],
    jobs_result: Optional[Dict[str, Any]],
    resume_text: str,
    confidence: Optional[str],
    confidence_reason: Optional[str],
    filename: Optional[str] = None,
) -> List[Dict[str, str]]:
    """
    Builds the list of user-facing calibration_notes for this specific
    resume. Only includes a note when the underlying condition actually
    applies — this is never a static "here are all our rules" list.
    """
    notes: List[Dict[str, str]] = []
    resume_lower = (resume_text or "").lower()
    jobs_result = jobs_result or {}

    # 1. No-experience cap
    experience_level = (jobs_result.get("experience_level") or "").lower()
    if experience_level in NO_EXPERIENCE_LEVELS:
        notes.append(_make_note("no_experience_cap"))

    # 2. Gamified badges discounted — only if the resume actually mentions any
    if any(signal in resume_lower for signal in GAMIFIED_BADGE_SIGNALS):
        notes.append(_make_note("gamified_badges_discounted"))

    # 3. Low parse confidence — only warn when it's actually low/medium
    if confidence == "low":
        notes.append(_make_note("low_confidence_parse"))

    # 4. Generic filename
    if filename:
        base = os.path.basename(filename).lower().strip()
        if any(re.match(pattern, base) for pattern in GENERIC_FILENAME_PATTERNS):
            notes.append(_make_note("generic_filename", filename=filename))

    return notes


def enrich_rule_scores(rule_scores: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """
    Adds `rule_name` (from the versioned config, not the LLM) and
    `points_lost` to each rule entry returned by the ATS chain.

    These are additive fields only — existing keys (points_awarded,
    max_points, reason) are left untouched, so this is backward compatible
    with any consumer reading the original three fields.
    """
    if not rule_scores:
        return rule_scores

    for rule_id, entry in rule_scores.items():
        if not isinstance(entry, dict):
            continue
        config_rule = ATS_RULES_BY_ID.get(rule_id)
        if config_rule:
            entry["rule_name"] = config_rule["name"]
        awarded = entry.get("points_awarded")
        max_points = entry.get("max_points")
        if isinstance(awarded, (int, float)) and isinstance(max_points, (int, float)):
            entry["points_lost"] = max(0, max_points - awarded)

    return rule_scores


def apply_calibration(
    ats_result: Optional[Dict[str, Any]],
    jobs_result: Optional[Dict[str, Any]],
    resume_text: str,
    confidence: Optional[str],
    confidence_reason: Optional[str],
    filename: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """
    Single entry point called from main.py's pipeline: enforces the
    deterministic cap, enriches rule_scores, and attaches calibration_notes
    plus confidence fields onto the ATS result dict in place.
    """
    if ats_result is None:
        return None

    enforce_experience_cap(ats_result, jobs_result)
    ats_result["rule_scores"] = enrich_rule_scores(ats_result.get("rule_scores"))
    ats_result["calibration_notes"] = build_calibration_notes(
        ats_result, jobs_result, resume_text, confidence, confidence_reason, filename
    )
    ats_result["confidence"] = confidence
    ats_result["confidence_reason"] = confidence_reason

    return ats_result