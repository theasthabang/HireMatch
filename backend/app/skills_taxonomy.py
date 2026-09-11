"""
Industry/background skill taxonomy — grounds the ATS and Skills chains with
industry-specific reference terms instead of only tech-generic ones.

DESIGN DECISION: this taxonomy does NOT replace the existing LLM-driven
keyword judgment (rule1 in ats_rules_config.py, and the Skills chain) with a
separate algorithmic matcher. It grounds those same LLM chains with extra
context, the same pattern already used for JD alignment
(jd_alignment.py -> "[PRECOMPUTED ALIGNMENT]" block). This was a deliberate
choice over building a parallel deterministic scorer — seeing "we already
have an LLM doing keyword judgment, and a proven grounding pattern" made
adding a second, separately-maintained scoring path hard to justify.

TOKEN BUDGET NOTE: only the SELECTED industry's skill list is injected
(typically 9-13 terms) — not the full tech taxonomy (200+ terms across 11
categories), even though "tech" skills are also present in the taxonomy
file. The LLM already handles generic tech keyword detection well on its
own (that's what rule1 already does with zero taxonomy involvement) — the
taxonomy's real value-add is industry-specific terms the LLM might
under-weight, not re-teaching it tech skills it already knows. Given this
app runs under a tight per-account tokens-per-minute budget (see
llm_client.py's CHAIN_MAX_RETRIES comment), injecting 200+ extra terms into
every relevant chain's prompt on every request would be a real, avoidable
cost — bounding this to ~13 terms keeps it negligible.
"""

import os
import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

TAXONOMY_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "skills_taxonomy.json")

DEFAULT_INDUSTRY_ID = "general"  # what the frontend's default dropdown option sends


def _load_taxonomy() -> Dict[str, Any]:
    try:
        with open(TAXONOMY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        # Never let a missing/malformed taxonomy file break the app — the
        # industry-grounding feature just becomes a no-op (identical to the
        # "no industry selected" path) rather than crashing every analysis.
        logger.error(f"Failed to load skills taxonomy from {TAXONOMY_PATH}: {e}. Industry grounding will be unavailable.")
        return {}


SKILLS_TAXONOMY = _load_taxonomy()


def _label_for(category_key: str) -> str:
    return category_key.replace("_", " ").title()


def get_available_industries() -> List[Dict[str, str]]:
    """
    Returns [{"id": "general", "label": "General / Tech"}, {"id": "finance", "label": "Finance"}, ...]
    for the GET /industries endpoint. "general" is always first and always
    present, even if the taxonomy file failed to load.
    """
    industries = [{"id": DEFAULT_INDUSTRY_ID, "label": "General / Tech"}]
    for key, category in SKILLS_TAXONOMY.items():
        if isinstance(category, dict) and category.get("category_type") == "industry":
            industries.append({"id": key, "label": _label_for(key)})
    return industries


def build_industry_context(industry_id: Optional[str]) -> str:
    """
    Builds the text block injected into the ATS/Skills chains' prompts (see
    prompts.py's INDUSTRY_CONTEXT_INSTRUCTION for how it's used once there).

    Returns an empty string — meaning zero taxonomy involvement, identical
    to today's behavior — when industry_id is None, empty, or "general".
    This is deliberate: requirement was "if no industry is passed, scoring
    behaves exactly as it does now," and today's behavior never consults
    this taxonomy at all. Injecting even the tech+soft categories
    unconditionally would be a subtle behavior change for users who never
    touch this feature, so nothing is added unless a *specific* industry
    was explicitly selected.
    """
    if not industry_id or industry_id == DEFAULT_INDUSTRY_ID:
        return ""

    industry_category = SKILLS_TAXONOMY.get(industry_id)
    if not industry_category or industry_category.get("category_type") != "industry":
        logger.warning(f"Unknown or invalid industry id requested: {industry_id!r}. Ignoring — no context injected.")
        return ""

    industry_skills = industry_category.get("skills", [])
    if not industry_skills:
        return ""

    label = _label_for(industry_id)
    return (
        f"The candidate has indicated their target industry/background is '{label}'. In addition to "
        f"normal technical and soft-skill evaluation, also recognize and credit these industry-specific "
        f"terms as relevant keywords if they appear in the resume, and consider them when identifying "
        f"skill gaps: {', '.join(industry_skills)}. This is an additive reference list, not a required "
        f"checklist — do not penalize the candidate for lacking skills outside this list, and do not "
        f"stop crediting standard technical/soft skills just because an industry was selected."
    )