"""
Structured, versioned configuration for ATS scoring.

Previously the 11 scoring rules lived only as prose inside one long prompt
string in chains.py. That made it impossible to change strictness, add a
rule, or answer "what does rule 6 actually check?" without reading and
editing a wall of text embedded in Python.

This file is now the single source of truth:
  - `ATS_RULES` is used to *generate* the LLM prompt (see chains.py's
    _build_ats_prompt()), so the prompt and the documented rule set can
    never drift apart.
  - The same `ATS_RULES` list is used server-side to enrich the LLM's
    `rule_scores` response with a human-readable `rule_name` and a
    precomputed `points_lost`, so the frontend doesn't need to hardcode a
    rule-id -> rule-name mapping either.
  - `CALIBRATION_TEMPLATES` documents every "invisible" scoring behavior
    (the no-experience cap, gamified-badge discounting, etc.) as structured,
    reusable message templates instead of prose buried in the prompt with
    no user-facing equivalent.

Bump ATS_RULESET_VERSION whenever criteria or point values change, so a
given score can be traced back to the exact rule set that produced it.
"""

ATS_RULESET_VERSION = "2026.08.1"

# Each rule's `criteria` text is intentionally written in the strict/tightened
# form — see inline comments for what changed vs. the original leniency.
ATS_RULES = [
    {
        "id": "rule1",
        "name": "Keyword Match",
        "max_points": 20,
        "criteria": (
            "Identify the candidate's target role from resume context. Check for hard skills "
            "(languages, tools, frameworks) and soft skills (leadership, communication, teamwork). "
            "Award 20 points if 15+ relevant keywords found, 15 for 10-14, 10 for 6-9, 5 for 3-5, 0 for less than 3. "
            "STRICT: only count a keyword if it appears in a meaningful context — inside a skills list, "
            "a project description, or an experience bullet. Do not award credit for keywords that only "
            "appear in an unconnected buzzword dump with no supporting evidence anywhere else in the resume."
        ),
    },
    {
        "id": "rule2",
        "name": "Job Title Alignment",
        "max_points": 10,
        "criteria": (
            "Check if resume contains a clear target job title or role matching industry norms. "
            "Award 10 if a clear professional title is found matching industry norms, 5 if vague or "
            "student-only title, 0 if no title found."
        ),
    },
    {
        "id": "rule3",
        "name": "Section Headings",
        "max_points": 10,
        "criteria": (
            "Check for standard ATS section headings: Experience/Work Experience, Education, Skills, "
            "Projects. Award 10 if all 4 found, 7 if 3, 4 if 2, 0 if 1 or none. Deduct 5 if creative "
            "non-standard headings are used instead. STRICT: a heading only counts if it appears on its "
            "own line as a clear section marker — not embedded mid-paragraph."
        ),
    },
    {
        "id": "rule4",
        "name": "File Format & Layout Integrity",
        "max_points": 5,
        "criteria": (
            "Check the extracted text for signs of bad formatting or a parsing-hostile layout. Award 5 if "
            "text reads cleanly, 2 for minor issues, 0 if heavily garbled. STRICT: specifically look for "
            "signatures of a multi-column or table-based layout — interleaved unrelated phrases, a date "
            "sitting next to unrelated bullet text, or a header/footer block repeating mid-document. These "
            "are a common real-world cause of ATS parsing failure even when the text looks superficially "
            "readable, so weight them heavily and mention them explicitly in the reason if found."
        ),
    },
    {
        "id": "rule5",
        "name": "Skill Section Completeness",
        "max_points": 15,
        "criteria": (
            "Check for a dedicated Skills section explicitly listing technical tools, languages, and "
            "frameworks. Award 15 if 10+ items in a rich section, 10 for 6-9, 5 for 3-5, 0 if skills are "
            "only implied in descriptions. STRICT: full marks require the list to be organized by category "
            "(e.g. Languages / Frameworks / Tools) — an unorganized flat list of 10+ items caps at 12/15."
        ),
    },
    {
        "id": "rule6",
        "name": "Quantified Achievements",
        "max_points": 15,
        "criteria": (
            "Count bullets/sentences with specific numbers, percentages, or measurable outcomes. Award 15 "
            "for 5+, 10 for 3-4, 5 for 1-2, 0 for none. STRICT: a bullet only counts as a full 'quantified "
            "achievement' if it pairs a number with a strong action verb (e.g. increased, reduced, built, "
            "led, automated, shipped). A number paired only with a generic/passive verb (e.g. 'worked on', "
            "'helped with', 'responsible for') counts as half a quantified achievement, not a full one."
        ),
    },
    {
        "id": "rule7",
        "name": "Education & Certifications",
        "max_points": 10,
        "criteria": (
            "Check for full degree name, institution, graduation year, GPA if present. Award 10 if all "
            "complete, 7 if most present, 4 if minimal, 0 if missing. Bonus 2 points if GPA is 8.0+/10 or "
            "3.5+/4.0, capped at 10 total. STRICT: distinguish gamified learning badges (AWS Cloud Quest, "
            "Google Cloud Arcade, generic Coursera completion certificates) from real, paid, proctored "
            "certifications (AWS Certified Solutions Architect, etc.) — badges should not move the score "
            "the way a real certification would, and this distinction must be mentioned in the reason "
            "whenever gamified badges are present so the candidate understands why they weren't weighted "
            "as heavily as a formal credential."
        ),
    },
    {
        "id": "rule8",
        "name": "No Graphics or Icons",
        "max_points": 5,
        "criteria": (
            "Check extracted text for signs of icon-based content — progress bars described as percentage "
            "blocks, star ratings, skill-level graphics. Deduct all 5 if detected, award 5 if clean text only."
        ),
    },
    {
        "id": "rule9",
        "name": "Date Formatting Consistency",
        "max_points": 5,
        "criteria": (
            "Check all dates in the resume. Award 5 if all dates follow a consistent Month Year or MM/YYYY "
            "format, 2 if mixed formats are detected, 0 if dates are missing or heavily inconsistent."
        ),
    },
    {
        "id": "rule10",
        "name": "Contact Info Completeness & Placement",
        "max_points": 5,
        "criteria": (
            "Check for: email, phone number, LinkedIn URL or profile mention, city/location. Award 5 if all "
            "4 present, 3 if 3, 1 if 2, 0 if only 1 or none. STRICT: if contact info appears to live only "
            "inside what looks like a page header/footer block, apply the full 2-point deduction regardless "
            "of how complete the info is — many ATS parsers strip headers/footers entirely before scoring, "
            "so info that only lives there is effectively invisible to a real ATS."
        ),
    },
    {
        "id": "rule11",
        "name": "Length and Density",
        "max_points": 5,
        "criteria": (
            "Estimate resume length from text length. Under 300 words is too sparse (0 points). 300-600 "
            "words for freshers is ideal (5 points). 600-900 is acceptable (4 points). Over 1200 is too "
            "long (2 points). Check for excessive whitespace signals."
        ),
    },
]

ATS_RULES_BY_ID = {rule["id"]: rule for rule in ATS_RULES}
ATS_TOTAL_MAX_POINTS = sum(rule["max_points"] for rule in ATS_RULES)  # 105; bonus points can push a
                                                                        # single rule over its own cap,
                                                                        # final score is clamped to 100.

# ---------------------------------------------------------------------------
# Calibration disclosure templates
# ---------------------------------------------------------------------------
# These document every "invisible" calibration rule that currently lives only
# inside prompt prose with no user-facing equivalent. Each is rendered into a
# `calibration_notes` entry by calibration.py ONLY when it actually applies to
# a given resume — never unconditionally.
#
# Rules considered and the disclosure decision made for each:
#   - no_experience_cap            -> DISCLOSE (explicitly requested; large,
#                                      confusing effect on the score if silent)
#   - gamified_badges_discounted   -> DISCLOSE (explicitly requested; affects
#                                      rule 7 credibly and isn't obvious)
#   - low_confidence_parse         -> DISCLOSE (new: tells the user the score
#                                      itself may be unreliable on messy input)
#   - generic_filename             -> DISCLOSE (new: minor but easy, actionable)
#   - "scores rarely exceed 90"    -> NOT disclosed as a dynamic note. This is
#                                      general grading philosophy, not a
#                                      per-resume calibration decision, so it's
#                                      shown as static UI copy near the score
#                                      instead of a backend-generated note.
CALIBRATION_TEMPLATES = {
    "no_experience_cap": {
        "severity": "warning",
        "message": (
            "Your score is capped at 70/100 because no verified work experience was detected. "
            "This reflects how most ATS systems and recruiters weight experience — add internships, "
            "projects with impact metrics, or freelance work with a named client to raise this ceiling."
        ),
    },
    "gamified_badges_discounted": {
        "severity": "info",
        "message": (
            "Some of your certifications (e.g. AWS Cloud Quest, Google Cloud Arcade, or similar gamified "
            "learning badges) were scored lower than paid, proctored certifications like AWS Certified "
            "Solutions Architect. This reflects how ATS systems and recruiters typically weight credential rigor."
        ),
    },
    "low_confidence_parse": {
        "severity": "warning",
        "message": (
            "This resume's text was difficult to extract cleanly — possible signs of tables, multi-column "
            "layout, or scanned/image-based formatting. Your score's accuracy may be lower than usual on "
            "this upload; consider re-uploading a single-column, text-based PDF or DOCX for a more reliable result."
        ),
    },
    "generic_filename": {
        "severity": "info",
        "message": (
            "Your file is named '{filename}', which is generic. Many recruiters and some ATS systems prefer "
            "descriptive filenames like 'FirstName_LastName_Resume.pdf'."
        ),
    },
}