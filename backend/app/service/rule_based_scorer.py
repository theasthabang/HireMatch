"""
Deterministic, non-LLM ATS scoring.

The whole point of this module: same resume text (and same target_jd /
career_background) in -> the exact same base_score out, every single time.
Nothing in this file calls an LLM or uses any source of randomness — see
test_rule_based_scorer.py for proof (same resume run through this module
twice, byte-identical result).

This base_score is combined with a small, bounded LLM adjustment
elsewhere (see app/services/ats_adjustment.py) — the LLM is only ever
asked for what plain-Python rules genuinely can't judge (writing clarity,
whether achievements are quantified, overall impressiveness), never for
the score itself. See this conversation's explanation of why that split
fixes the run-to-run score drift a pure-LLM scorer has.

Combines three independent checks into one base_score out of 100:
    keyword overlap       — 40%
    section presence      — 30%
    formatting red flags  — 30%
See compute_base_score()'s docstring for the weighting rationale.

NOTE ON PyMuPDF vs pdfplumber: the original request for this module
assumed PyMuPDF was already in use for PDF parsing. It isn't — this app's
actual extractor.py uses pdfplumber. pdfplumber already exposes everything
the formatting checks below need (find_tables(), page.images, per-character
font names via page.chars), so this uses it instead of adding a second,
redundant PDF library to requirements.txt.
"""

import re
import logging
from typing import Optional, Dict, Any, Set

from app.skills_taxonomy import SKILLS_TAXONOMY

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Weights — see compute_base_score()'s docstring for the reasoning.
# ---------------------------------------------------------------------------
KEYWORD_WEIGHT = 0.40
SECTION_WEIGHT = 0.30
FORMATTING_WEIGHT = 0.30

GENERAL_DEFAULT_CATEGORIES = [
    "programming_languages", "frontend", "backend", "databases",
    "cloud_devops", "ai_ml_data", "testing_qa", "tools", "soft_skills",
]


# ---------------------------------------------------------------------------
# a) Keyword overlap check
# ---------------------------------------------------------------------------

def _flatten_all_taxonomy_skills() -> Set[str]:
    """Every skill term across every category (tech + soft + every
    industry) — the full reference vocabulary keyword matching draws from.
    Deliberately not narrowed to one category up front: a 'finance' JD can
    still legitimately mention 'SQL' or 'Excel'-adjacent tools that live in
    programming_languages/tools, not the finance category — narrowing early
    would silently under-count real overlap."""
    all_skills = set()
    for category in SKILLS_TAXONOMY.values():
        if isinstance(category, dict):
            all_skills.update(category.get("skills", []))
    return all_skills


_ALL_TAXONOMY_SKILLS = _flatten_all_taxonomy_skills()


def _industry_reference_skills(career_background: Optional[str]) -> Set[str]:
    """The generic reference keyword set used when no target_jd was
    pasted: the caller's chosen industry's own skill list if they picked
    one, otherwise a general tech-default set (this app's own audience,
    per its README, is CS/tech job-seekers — an empty reference set would
    make the keyword check meaningless for the common case of no JD and
    no industry selected)."""
    if career_background and career_background != "general" and career_background in SKILLS_TAXONOMY:
        return set(SKILLS_TAXONOMY[career_background].get("skills", []))
    skills = set()
    for cat_id in GENERAL_DEFAULT_CATEGORIES:
        cat = SKILLS_TAXONOMY.get(cat_id)
        if cat:
            skills.update(cat.get("skills", []))
    return skills


def _find_taxonomy_terms_in_text(text: str, vocabulary: Set[str]) -> Set[str]:
    """
    Which terms from `vocabulary` appear in `text`, case-insensitive, with
    boundaries that work correctly for terms containing punctuation Python's
    regex \\b doesn't handle well ("C++", "Node.js", ".NET", "C#") — matched
    via explicit not-alphanumeric lookaround on both sides instead of \\b.
    """
    if not text:
        return set()
    found = set()
    for term in vocabulary:
        pattern = r'(?<![A-Za-z0-9])' + re.escape(term) + r'(?![A-Za-z0-9])'
        if re.search(pattern, text, flags=re.IGNORECASE):
            found.add(term)
    return found


# A real job description's own keyword list is a fair, closed target —
# matching 100% of what ONE posting asks for is meaningful. A generic
# industry/tech-default catalog (30-200+ unrelated terms spanning every
# tool in a whole field) is not: no real resume was ever going to contain
# "Assembly + Kubernetes + Ansible + Figma + Cypress" simultaneously, so
# scoring it as percentage-of-the-whole-catalog would make any resume
# look like it has almost no relevant skills, no matter how strong it
# actually is. For the generic-fallback path only, matches are scored on
# a saturating scale instead — matching this many generic-set keywords is
# treated as a full, complete showing, closer to how a recruiter actually
# thinks about it ("does this resume show a solid handful of relevant
# skills," not "does it contain literally everything in the industry").
GENERIC_KEYWORD_SATURATION_COUNT = 10


def keyword_overlap_check(
    resume_text: str,
    target_jd: Optional[str],
    career_background: Optional[str],
) -> Dict[str, Any]:
    """
    Deterministic keyword overlap between the resume and either:
      - the pasted target_jd, if given — keywords are extracted from the
        JD itself, so the check reflects what THIS specific posting asks
        for, not a fixed generic list. Scored as a straight percentage of
        the JD's own keyword count — a fair, closed target.
      - a generic reference set for career_background (or a general
        tech-default set if neither a JD nor an industry was given) when
        no JD was pasted. Scored on a saturating scale instead of a raw
        percentage — see GENERIC_KEYWORD_SATURATION_COUNT above for why.

    "Keyword extraction" here specifically means: which known terms from
    this app's own skills taxonomy (the same reference data already used
    elsewhere for industry grounding) appear in the source text. This is a
    deliberate, documented simplification — see this conversation's
    explanation of how this compares to real ATS keyword matching. It will
    miss any genuinely relevant term that isn't already in the taxonomy
    (a brand-new framework, a company-specific tool name, an uncommon
    certification) — it is not a general-purpose keyword/entity extractor.
    """
    resume_keywords = _find_taxonomy_terms_in_text(resume_text, _ALL_TAXONOMY_SKILLS)

    if target_jd and target_jd.strip():
        source_keywords = _find_taxonomy_terms_in_text(target_jd, _ALL_TAXONOMY_SKILLS)
        source_label = "target_jd"
        matched = sorted(source_keywords & resume_keywords)
        missing = sorted(source_keywords - resume_keywords)
        overlap_pct = (len(matched) / len(source_keywords) * 100) if source_keywords else 0.0
    else:
        source_keywords = _industry_reference_skills(career_background)
        source_label = f"career_background={career_background or 'general (tech-default)'}"
        matched = sorted(source_keywords & resume_keywords)
        missing = sorted(source_keywords - resume_keywords)
        overlap_pct = min(100.0, (len(matched) / GENERIC_KEYWORD_SATURATION_COUNT) * 100)

    return {
        "source": source_label,
        "reference_keyword_count": len(source_keywords),
        "matched_keywords": matched,
        "missing_keywords": missing,
        "overlap_pct": round(overlap_pct, 1),
    }


# ---------------------------------------------------------------------------
# b) Section presence check
# ---------------------------------------------------------------------------

_SECTION_HEADER_PATTERNS = {
    "skills": [r"\bskills\b", r"\btechnical skills\b", r"\bcore competencies\b"],
    "experience": [r"\bexperience\b", r"\bwork experience\b", r"\bemployment history\b", r"\bprofessional experience\b"],
    "education": [r"\beducation\b", r"\bacademic background\b"],
}
_EMAIL_PATTERN = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
_PHONE_PATTERN = re.compile(r'(\+?\d{1,3}[-.\s]?)?\(?\d{3,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}')
_HEADER_LINE_MAX_LEN = 40  # a header is a short label, not a sentence


def section_presence_check(resume_text: str) -> Dict[str, Any]:
    """
    Heuristic section detection via line-level header-keyword matching —
    NOT a real document-structure parser.

    LIMITATION (stated explicitly so this never gets overclaimed anywhere
    downstream, including in the frontend copy): this only recognizes a
    section if one of its lines is SHORT (<=40 chars, i.e. looks like a
    label, not a paragraph) AND contains one of a fixed set of English
    header keywords. It will miss:
      - non-English resumes, or unconventional header wording
        ("What I Bring", "My Journey") instead of a standard label
      - a section whose header got mangled or merged with surrounding text
        during PDF text extraction (see extractor.py's
        assess_parse_confidence for a related, separate extraction-quality
        signal)
      - a resume with the CONTENT of a section (a clear tech stack list)
        but no literal header word introducing it
    Read this as "a header keyword was found on its own line," not as a
    verified judgment of whether the resume actually has that content.
    """
    lines = resume_text.splitlines()
    found = {}
    for section, patterns in _SECTION_HEADER_PATTERNS.items():
        section_found = False
        for line in lines:
            stripped = line.strip()
            if len(stripped) > _HEADER_LINE_MAX_LEN:
                continue
            if any(re.search(p, stripped, re.IGNORECASE) for p in patterns):
                section_found = True
                break
        found[section] = section_found

    found["contact_info"] = bool(_EMAIL_PATTERN.search(resume_text)) or bool(_PHONE_PATTERN.search(resume_text))

    present_count = sum(found.values())
    total = len(found)
    section_score_pct = (present_count / total * 100) if total else 0.0

    return {
        "sections": found,
        "present_count": present_count,
        "total_sections_checked": total,
        "section_score_pct": round(section_score_pct, 1),
    }


# ---------------------------------------------------------------------------
# c) Formatting red-flag check
# ---------------------------------------------------------------------------

_DATE_PATTERN = re.compile(
    r'(\b(19|20)\d{2}\b)|(\bpresent\b)|(\bcurrent\b)|'
    r'(\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*\d{0,4}\b)',
    re.IGNORECASE,
)


def _extract_experience_block(resume_text: str) -> str:
    """Best-effort slice of the text between an 'Experience'-ish header and
    the next recognized header — same header-keyword heuristic (and same
    limitation) as section_presence_check. Returns "" if no experience
    header was found, in which case the date check is skipped entirely
    rather than guessing at the whole document."""
    lines = resume_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if len(stripped) <= _HEADER_LINE_MAX_LEN and re.search(r'\bexperience\b', stripped, re.IGNORECASE):
            start = i + 1
            break
    if start is None:
        return ""
    end = len(lines)
    for i in range(start, len(lines)):
        stripped = lines[i].strip()
        if len(stripped) <= _HEADER_LINE_MAX_LEN and re.search(
            r'\b(education|skills|projects|certifications|awards)\b', stripped, re.IGNORECASE
        ):
            end = i
            break
    return "\n".join(lines[start:end])


def formatting_red_flags_check(file_path: str, content_type: str, resume_text: str) -> Dict[str, Any]:
    """
    Structural formatting checks that correlate with real ATS parsing
    trouble — run against the ORIGINAL file (tables/images require actual
    document structure; extracted plain text alone can't reveal them),
    using pdfplumber (PDF) or python-docx (DOCX) — both already
    dependencies of this app (see extractor.py), so nothing new needs
    adding to requirements.txt for this specific check.

    ON FONTS: font *names* are collected (page.chars' fontname, for PDFs)
    but deliberately NOT scored or flagged as a red flag on their own.
    Font metadata tells you what font is embedded, not whether a real ATS
    can parse the text — that actually depends on whether the text exists
    as real text objects vs. having been flattened to outlines/an image,
    which is a different, weaker-to-detect problem this app already has a
    separate, more direct signal for (extractor.py's
    assess_parse_confidence, via alphabetic-density/fragment-ratio
    heuristics on the extracted text itself). Reporting an "unusual font"
    flag here would imply a reliability this check doesn't actually have,
    so it's surfaced as pure information, worth zero points either way.
    """
    flags = {"has_tables": False, "has_embedded_images": False, "missing_dates_in_experience": None, "font_note": None}

    is_pdf = "pdf" in (content_type or "").lower() or file_path.lower().endswith(".pdf")
    is_docx = (not is_pdf) and (
        "wordprocessingml" in (content_type or "").lower() or file_path.lower().endswith(".docx")
    )

    try:
        if is_pdf:
            import pdfplumber
            with pdfplumber.open(file_path) as pdf:
                font_names = set()
                for page in pdf.pages:
                    if page.find_tables():
                        flags["has_tables"] = True
                    if page.images:
                        flags["has_embedded_images"] = True
                    for char in page.chars:
                        fn = char.get("fontname")
                        if fn:
                            font_names.add(fn)
                flags["font_note"] = (
                    f"{len(font_names)} distinct embedded font name(s) detected — informational only, not scored."
                    if font_names else None
                )
        elif is_docx:
            from docx import Document
            doc = Document(file_path)
            flags["has_tables"] = len(doc.tables) > 0
            flags["has_embedded_images"] = len(doc.inline_shapes) > 0
            flags["font_note"] = "Font detection isn't implemented for DOCX (fonts aren't embedded the same way PDFs embed them) — skipped, not scored."
        else:
            flags["font_note"] = "Unrecognized file type for formatting checks — table/image checks skipped."
    except Exception as e:
        logger.warning(f"Formatting red-flag check failed to fully inspect '{file_path}': {e}")
        flags["font_note"] = "Could not fully inspect file structure for formatting checks."

    experience_block = _extract_experience_block(resume_text)
    if experience_block:
        flags["missing_dates_in_experience"] = not bool(_DATE_PATTERN.search(experience_block))
    # else: stays None — "couldn't find an experience section to check at all",
    # deliberately distinct from False ("checked, dates were there").

    penalties = 0
    reasons = []
    if flags["has_tables"]:
        penalties += 40
        reasons.append("Resume uses tables — many real ATS parsers read table content out of order or skip it entirely.")
    if flags["has_embedded_images"]:
        penalties += 30
        reasons.append("Resume contains embedded images — some ATS parsers ignore image content completely (text inside an image is invisible to them).")
    if flags["missing_dates_in_experience"] is True:
        penalties += 30
        reasons.append("No recognizable dates found in the experience section — both ATS systems and recruiters rely on dates to gauge recency/duration.")

    formatting_score_pct = max(0, 100 - penalties)

    return {**flags, "formatting_score_pct": formatting_score_pct, "reasons": reasons}


# ---------------------------------------------------------------------------
# d) Combine into base_score
# ---------------------------------------------------------------------------

def compute_base_score(
    resume_text: str,
    file_path: str,
    content_type: str,
    target_jd: Optional[str] = None,
    career_background: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Single entry point: runs all three checks and combines them into one
    deterministic base_score out of 100. Nothing in this function (or
    anything it calls) uses an LLM, wall-clock time, randomness, or any
    other non-reproducible input — the exact same four arguments always
    produce the exact same return value.

    WEIGHTING — keyword overlap 40% / section presence 30% / formatting
    30%:
      - Keyword overlap gets the largest single weight because it's the
        closest analogue to what a real ATS's keyword-matching step
        actually does, and it's the most specific, actionable signal
        available (tied to an actual posting or industry, not a generic
        rubric).
      - Section presence and formatting are weighted equally below that:
        both are important-but-secondary hygiene signals — a resume can
        have every right keyword and still get mis-parsed by a real ATS
        due to a table-heavy layout, or vice versa — rather than either
        one being clearly more important than the other.
    These are reasonable starting weights, not empirically validated
    against real ATS outcomes — the same honest caveat this app's
    embeddings.py already applies to its own SIMILARITY_FLOOR/CEILING
    calibration constants.
    """
    keyword = keyword_overlap_check(resume_text, target_jd, career_background)
    sections = section_presence_check(resume_text)
    formatting = formatting_red_flags_check(file_path, content_type, resume_text)

    raw = (
        keyword["overlap_pct"] * KEYWORD_WEIGHT
        + sections["section_score_pct"] * SECTION_WEIGHT
        + formatting["formatting_score_pct"] * FORMATTING_WEIGHT
    )
    base_score = round(max(0.0, min(100.0, raw)))

    return {
        "base_score": base_score,
        "weights": {"keyword_overlap": KEYWORD_WEIGHT, "section_presence": SECTION_WEIGHT, "formatting": FORMATTING_WEIGHT},
        "keyword_overlap": keyword,
        "section_presence": sections,
        "formatting": formatting,
    }