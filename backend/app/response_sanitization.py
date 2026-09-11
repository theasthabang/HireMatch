"""
Repairs or drops malformed items inside LLM-generated list fields before
they ever reach Pydantic validation.

Exists because of a real production bug: a single rewritten_bullets entry
missing its 'rewritten' field turned a mostly-successful analysis into a
full 502, discarding 6 other correctly-generated sections along with it.
Pydantic's validation is all-or-nothing for the whole AnalysisResponse — one
malformed leaf anywhere fails the entire object. This module salvages what
it safely can before that validation ever runs.
"""

import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _sanitize_list_field(container: Optional[dict], list_key: str, required_fields: list, safe_fallbacks: Optional[dict] = None, item_label: str = "item") -> None:
    """
    Mutates container[list_key] in place, dropping any list entry missing a
    required field it can't be safely repaired — so one malformed item
    inside a 5-15 item LLM-generated list can't take down the entire
    AnalysisResponse the way an unguarded Pydantic ValidationError would.

    :param safe_fallbacks: optional {missing_field: source_field} map for
        repairs that don't fabricate anything — e.g. rewritten_bullets can
        safely fall back to copying `original` into a missing `rewritten`,
        since that's verbatim resume text, not invented content. Fields
        with no safe fallback (e.g. an interview question's `model_answer`)
        just cause that one item to be dropped instead.
    """
    if not container or not isinstance(container.get(list_key), list):
        return

    safe_fallbacks = safe_fallbacks or {}
    original_items = container[list_key]
    kept_items = []

    for idx, item in enumerate(original_items):
        if not isinstance(item, dict):
            logger.warning(f"Dropping non-dict {item_label} at index {idx} in '{list_key}'.")
            continue

        for field in required_fields:
            if item.get(field) not in (None, ""):
                continue
            fallback_source = safe_fallbacks.get(field)
            if fallback_source and item.get(fallback_source) not in (None, ""):
                logger.warning(f"{item_label} at index {idx} in '{list_key}' missing '{field}' — repaired from '{fallback_source}'.")
                item[field] = item[fallback_source]
            else:
                logger.warning(f"Dropping {item_label} at index {idx} in '{list_key}' — missing required field '{field}' with no safe repair.")
                item = None
                break
        if item is not None:
            kept_items.append(item)

    if len(kept_items) != len(original_items):
        logger.warning(f"'{list_key}' sanitized: {len(original_items)} -> {len(kept_items)} items after dropping malformed entries.")
    container[list_key] = kept_items


def sanitize_analysis_results(analysis_results: dict) -> None:
    """
    Applies _sanitize_list_field to every known list-of-LLM-generated-dicts
    field in the response, right before Pydantic validation. See that
    function's docstring for why this exists — this is specifically about
    salvaging the 6 other correctly-generated sections when exactly one
    item in exactly one list is malformed, rather than discarding
    everything via an all-or-nothing ValidationError.
    """
    _sanitize_list_field(
        analysis_results.get("rewrite"), "rewritten_bullets",
        required_fields=["original", "rewritten"],
        safe_fallbacks={"rewritten": "original"},  # never fabricates — falls back to verbatim resume text
        item_label="rewritten bullet",
    )
    _sanitize_list_field(
        analysis_results.get("interview"), "questions",
        required_fields=["question", "type", "difficulty", "model_answer"],
        item_label="interview question",
    )
    if analysis_results.get("roadmap") and isinstance(analysis_results["roadmap"].get("phases"), list):
        for phase in analysis_results["roadmap"]["phases"]:
            if isinstance(phase, dict):
                _sanitize_list_field(
                    phase, "weeks",
                    required_fields=["week_number", "title", "description", "estimated_hours"],
                    item_label="roadmap week",
                )