"""
Resume export — builds a downloadable, ATS-friendly .docx from the
optimized summary and bullets the user has accepted in the Rewrite panel.

This exists to close a real gap against most competing ATS-checker tools
(Jobscan, Resume Worded, SkillSyncer, etc.): they diagnose and suggest, but
this app's rewrite panel previously only offered "copy resume" as plain
text with no formatting. A resume-builder-adjacent tool like VisualCV,
Kickresume, or Rezi lets you leave with an actual polished, ATS-safe
document — this module gives HireMatch the same "diagnose AND produce a
file" loop instead of stopping at diagnosis.

Deliberately minimal formatting choices, all chosen for ATS-parsing safety
per the same rules this app already scores against (see ats_rules_config.py
rule3/rule4/rule8/rule9): single column, standard heading names, no tables,
no icons/graphics, consistent date-adjacent formatting left to the user's
own bullet text. This is not a full resume *builder* (no template gallery,
no section reordering) — it's a straight, safe rendering of exactly what
the user has already reviewed and accepted in the UI, nothing invented here.
"""

import io
import logging
from typing import List, Optional

from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH

logger = logging.getLogger(__name__)


def build_resume_docx(
    full_name: Optional[str],
    contact_line: Optional[str],
    summary: Optional[str],
    bullets: List[str],
    section_heading: str = "Experience & Projects",
) -> io.BytesIO:
    """
    Builds a single-column, ATS-safe .docx in memory and returns it as a
    BytesIO buffer ready to stream back in an HTTP response.

    :param full_name: Candidate's name for the document header, if known.
        Optional because the backend has no reliable structured "name" field
        anywhere in the pipeline (resume_text is unstructured) — the export
        works fine without it, just without a name line at the top.
    :param contact_line: Optional single line of contact info (email / phone
        / location) — kept as one line intentionally, matching rule10's
        guidance against burying contact info in a header/footer block that
        many real ATS parsers strip.
    :param summary: The optimized professional summary text.
    :param bullets: The exact accepted bullet text, in order — this is
        whatever the user has already reviewed and accepted client-side
        (accepted rewrite, edited rewrite, or original if they rejected the
        rewrite for that bullet). Nothing is altered here.
    :param section_heading: Standard ATS-recognized heading name for the
        bullets section. Defaults to "Experience & Projects" rather than a
        plain "Experience" because the accepted bullets passed in here come
        from wherever REWRITE_SYSTEM_PROMPT pulled them from — explicitly
        "the resume's Experience/Projects sections" combined (see
        chains.py) — with no per-bullet tag telling this function which
        bullet came from which. Labeling the merged list as plain
        "Experience" would be actively misleading on a document meant to be
        submitted to a real ATS: this app's own rule3 in
        ats_rules_config.py specifically rewards having *separate*
        Experience and Projects headings and penalizes non-standard/merged
        ones. Exporting a document that violates the app's own scoring
        rubric would be a real, avoidable bug, not just a labeling nitpick.
    """
    doc = Document()

    # Base font: a plain, universally-available serif/sans face. Avoids any
    # icon/symbol font or unusual typeface that risks parsing oddly or
    # rendering as tofu on a machine that lacks the font.
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)

    section = doc.sections[0]
    section.left_margin = Inches(0.75)
    section.right_margin = Inches(0.75)
    section.top_margin = Inches(0.6)
    section.bottom_margin = Inches(0.6)

    if full_name:
        name_para = doc.add_paragraph()
        name_run = name_para.add_run(full_name)
        name_run.bold = True
        name_run.font.size = Pt(18)
        name_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    if contact_line:
        contact_para = doc.add_paragraph()
        contact_run = contact_para.add_run(contact_line)
        contact_run.font.size = Pt(10)
        contact_para.alignment = WD_ALIGN_PARAGRAPH.CENTER

    if summary and summary.strip():
        doc.add_heading("Summary", level=1)
        doc.add_paragraph(summary.strip())

    if bullets:
        doc.add_heading(section_heading, level=1)
        for bullet_text in bullets:
            text = (bullet_text or "").strip()
            if not text:
                continue
            # Word's built-in "List Bullet" style, not a manually-typed
            # bullet glyph — keeps the list structurally a list in the
            # document XML rather than a plain paragraph starting with "•",
            # which is what rule8 (No Graphics or Icons) actually cares
            # about avoiding: icon-rendered content, not real list markup.
            doc.add_paragraph(text, style="List Bullet")

    buffer = io.BytesIO()
    doc.save(buffer)
    buffer.seek(0)
    return buffer