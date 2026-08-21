from dotenv import load_dotenv
import os
load_dotenv()

import json
import logging
import asyncio
import re
from typing import Dict, Any, Optional, List
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage
from langchain_core.prompts import HumanMessagePromptTemplate, ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser

# Configure logging
logger = logging.getLogger(__name__)

# Initialize ChatGroq instance
api_key = os.getenv('GROQ_API_KEY')
if not api_key:
    logger.warning("GROQ_API_KEY environment variable is not set. API calls will fail unless configured via environment.")

# Retry/backoff for individual chain calls, mirroring the pattern already
# used for JSearch requests in main.py. Groq's rate limits are the single
# most common cause of a chain silently returning None (see was_rate_limited
# in run_all_chains) — a couple of short retries meaningfully cuts the
# whole-chain failure rate without materially slowing down a normal request.
#
# NOTE ON ACCOUNT TIER: on the on-demand/free tier, a model like
# openai/gpt-oss-120b can have a tokens-per-minute (TPM) cap as low as 8000.
# Firing several large chain completions in the same instant (see the wave2
# staggering in run_all_chains below) can burst past that in one shot even
# though the account's *per-request* limits are fine. When that happens,
# Groq's error message includes an exact "try again in Xs" wait time —
# _parse_retry_after_seconds() below prefers that over a fixed exponential
# guess, since a TPM-exhaustion wait can be 20-30s, far longer than a plain
# request-rate 429 would need.
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


# 1. ATS Chain Prompt
# Built dynamically from ats_rules_config.ATS_RULES instead of being hardcoded
# here, so the rule set has exactly one source of truth: changing strictness,
# adding a rule, or re-pointing point values only requires editing
# ats_rules_config.py, and the change is guaranteed to show up both in the
# prompt sent to the LLM and in the rule names surfaced to the frontend.
from app.ats_rules_config import ATS_RULES, ATS_RULESET_VERSION


# Shared instruction appended to ATS/Skills/Rewrite prompts so all three
# become "JD-aware": if the caller pasted a specific job description, treat
# it as ground truth for keyword/requirement matching instead of an inferred
# generic role. If job_description is empty, behavior is unchanged from
# before this feature existed.
JD_TAILORING_INSTRUCTION = (
    "\n\nTAILORING INSTRUCTION: You will also be given a 'Target Job Description' field. "
    "If it is non-empty, you MUST tailor your entire analysis to that specific posting — its stated "
    "requirements, responsibilities, and preferred qualifications become your primary source of truth for "
    "keyword matching, skill gaps, and rewrite emphasis, taking priority over any role you would otherwise "
    "infer generically from the resume alone. If the Target Job Description is empty, ignore this instruction "
    "entirely and proceed exactly as you would with no job description provided."
)


def _build_ats_prompt() -> str:
    rule_lines = []
    for idx, rule in enumerate(ATS_RULES, start=1):
        rule_lines.append(f"Rule {idx} — {rule['name']} ({rule['max_points']} points): {rule['criteria']}")
    rules_block = "\n".join(rule_lines)
    rule_key_hint = ", ".join(rule["id"] for rule in ATS_RULES)

    return (
        f"You are a strict ATS scoring engine used by Fortune 500 recruiters (rule set version {ATS_RULESET_VERSION}). "
        "Evaluate the resume against these exact rules and calculate a precise score. Each rule has a maximum point "
        "value. Be harsh and realistic — deduct points for every violation found.\n"
        "SCORING RULES:\n"
        f"{rules_block}\n"
        "TOTAL: Add up all rule scores. Cap the final total at 100.\n"
        "Return a JSON object with these exact fields:\n"
        "score: the final integer total capped at 100,\n"
        "matched_keywords: list of actual keywords found in the resume,\n"
        "missing_keywords: list of important keywords missing for the detected target role (or missing from the Target Job Description, if one was provided),\n"
        "verdict: a detailed paragraph explaining the exact score with specific rule-by-rule breakdown mentioning which rules lost points and why,\n"
        f"rule_scores: an object with keys {rule_key_hint} each containing points_awarded (integer), max_points (integer), and reason (short string explaining the award),\n"
        "improvement_tips: a list of 3–5 specific actionable strings the candidate should do right now to increase their score\n"
        "CRITICAL CALIBRATION RULE: If the resume shows no formal work experience — only academic projects, coursework, and certifications — apply an automatic ceiling. Such resumes cannot score above 70, regardless of how many keywords are matched, because real recruiters weight production work experience heavily and ATS systems specifically look for an Experience or Work History section with employer names and dates, which is structurally absent here. A resume with zero work experience, zero quantified business outcomes, and only completion-badge certificates should score in the 50-65 range even if technically well-formatted. Only resumes with verifiable internships, jobs, or freelance client work with named employers can score above 75.\n"
        "Be strict. A fresh graduate resume with no numbers and weak skills section should score 45–60. A strong experienced resume with all elements should score 75–88. Perfect scores above 90 are extremely rare.\n\n"
        "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, "
        "or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation."
        + JD_TAILORING_INSTRUCTION
    )


ATS_SYSTEM_PROMPT = _build_ats_prompt()

# NOTE: the no-experience-cap and gamified-badge-discounting rules above are
# also enforced deterministically as a safety net in calibration.py after the
# LLM responds (LLMs don't reliably self-enforce hard ceilings 100% of the
# time), and disclosed to the user via `calibration_notes` — see main.py's
# run_analysis_pipeline() and calibration.py for that logic.


# 2. Skills Chain Prompts
SKILLS_SYSTEM_PROMPT = (
    "You are a professional career advisor and skill gap analyst. Analyze the provided resume text to identify the candidate's "
    "strengths, major skill gaps, and suggest learning resources or courses to bridge those gaps.\n"
    "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, "
    "or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation.\n\n"
    "Required fields in the returned JSON object:\n"
    "1. strong_skills: a list of strings of the candidate's strong skills.\n"
    "2. weak_areas: a list of strings of identified skill gaps or weak areas.\n"
    "3. recommended_courses: a list of objects representing recommendations. Each recommendation object must contain two fields: "
    "'skill' (the name of the skill/gap to address as a string) and 'resource' (the name of the recommended course, platform, or resource as a string)."
    + JD_TAILORING_INSTRUCTION
)

# 3. Jobs Chain Prompts
JOBS_SYSTEM_PROMPT = (
    'You are a talent acquisition strategist. Analyze this resume and determine two things: the candidate experience level, and the best 3 job search query strings to find real, currently open postings this candidate could realistically apply to today.\n'
    'EXPERIENCE LEVEL DETECTION: Check for an Experience or Work History section with named employers and dates. If none exists and the resume only shows academic projects, coursework, and certifications, classify as "entry-level" or "internship". If there is 1-2 years of named work experience, classify as "junior". If there is 3+ years, classify as "mid-level". Be strict — projects and personal apps are NOT work experience.\n'
    'QUERY GENERATION RULES: Based on the detected experience level, generate search query strings that include the experience qualifier directly in the query so the job search returns appropriate results. For entry-level candidates, queries must include words like "fresher", "entry level", "intern", or "graduate trainee" alongside the role, for example "Full Stack Developer fresher" or "Software Engineer Intern". For junior candidates use queries like "Junior Full Stack Developer". For mid-level use the plain title. Never generate a query for a senior or specialist title (like "AI Engineer" or "Cloud Architect") unless the resume shows multiple years of hands-on production work directly in that domain — completion badges, gamified learning programs, or one-off API usage inside a student project do NOT qualify.\n'
    'Return a JSON object with these exact fields: experience_level (string: "entry-level", "internship", "junior", or "mid-level"), search_queries (a list of exactly 3 strings, each a realistic job search query calibrated to the detected experience level), reasoning (a short string explaining why these specific queries were chosen based on what is and is not present in the resume).\n\n'
    'You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation.'
)

# 4. Rewrite Chain Prompts
REWRITE_SYSTEM_PROMPT = (
    "You are an expert resume writer. Rewrite the candidate's professional summary and experience bullet points to be "
    "action-oriented and professional.\n\n"
    "For the experience bullets, find the actual bullet points in the resume's Experience/Projects sections and "
    "produce a rewrite for EACH one. For every bullet, return an object with three fields: 'original' (the bullet "
    "exactly as it appears in the resume, verbatim, no paraphrasing), 'rewritten' (your improved version — stronger "
    "action verb, tighter phrasing, clearer impact), and 'metric_note'.\n\n"
    "CRITICAL RULE ABOUT METRICS — READ CAREFULLY: You must NEVER invent a number, percentage, dollar amount, team "
    "size, or any other metric that is not already present in the original bullet. Fabricating a metric that the "
    "candidate did not actually achieve is a serious integrity problem — they could be asked about it in an "
    "interview and have no real answer. Follow this exact logic for every bullet:\n"
    "  - If the ORIGINAL bullet already contains a real number/metric: your rewrite may keep, rephrase, or "
    "    highlight that same number more clearly. Set metric_note to null.\n"
    "  - If the ORIGINAL bullet has NO number/metric: your rewrite must strengthen the verb and clarity WITHOUT "
    "    adding any number. Instead, set metric_note to a short, specific instruction telling the candidate exactly "
    "    what kind of number would strengthen this bullet and where it goes — for example 'Add the number of users "
    "    or requests this system handled' or 'Add the percentage improvement in load time you measured' or 'Add "
    "    the size of the team you led'. Be specific to THIS bullet's content, not generic.\n"
    "  - Never set metric_note AND include a new invented number in the same rewrite — those two things are mutually exclusive.\n\n"
    "Required fields in the returned JSON object:\n"
    "1. summary: the optimized professional summary as a string (this one field may read naturally without a strict "
    "metric-only rule, but still do not invent specific achievement numbers that aren't grounded in the resume).\n"
    "2. rewritten_bullets: a list of objects, each with 'original', 'rewritten', and 'metric_note' (string or null) as described above.\n"
    "3. improvements_made: a list of strings describing general, resume-wide improvements made (tone, structure, clarity) — not per-bullet detail, since that now lives in metric_note/rewritten pairs.\n\n"
    "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, "
    "or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation."
    + JD_TAILORING_INSTRUCTION
    + " When tailoring to a Target Job Description, prioritize strengthening bullets and summary language that speak "
    "directly to that posting's stated requirements."
)

# 5. Interview Prep Chain Prompts
INTERVIEW_SYSTEM_PROMPT = (
    "You are a senior technical interviewer at a top tech company. Based on this resume, generate exactly 10 interview questions this candidate will most likely face. Mix these types: 3 technical questions based on their specific tech stack, 2 project-deep-dive questions referencing their actual projects by name, 2 behavioral questions using STAR format, 2 situational questions based on their target role, 1 curveball or trick question common for their level. For each question provide: the question text, question type (Technical, Project, Behavioral, Situational, Curveball), difficulty level (Easy, Medium, Hard), a model answer tailored to this specific candidate's experience written in first person as if the candidate is answering, and 2-3 key points the interviewer is actually looking for.\n"
    "Return JSON with field: questions — list of objects each with: question, type, difficulty, model_answer, key_points list.\n\n"
    "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, "
    "or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation."
)

# 6. Roadmap Chain Prompts
ROADMAP_SYSTEM_PROMPT = (
    "You are a senior technical mentor creating a personalized learning roadmap. Based on this resume, identify the 2-3 most critical skill gaps for the candidate target role. Build a 90-day roadmap broken into 12 weekly milestones. Each week must be specific and actionable, not generic — reference the candidate actual project names, tech stack, or experience wherever possible so the plan feels tailored, not templated. For example, instead of \"Learn Docker basics\" write \"Week 1: Learn Docker fundamentals — containerize a simple Python script\" and if the candidate has a named project, a later week should say something like \"Week 3: Write a Dockerfile for your [actual project name from resume] project and run it locally.\" Mix learning weeks with applied/build weeks — do not make every week pure theory. Group weeks into three phases: Days 1-30 (Foundation), Days 31-60 (Application), Days 61-90 (Mastery and Portfolio). For each week provide: week number, phase name, title (short, action-oriented), description (1-2 sentences, specific and tied to their resume context where possible), and an estimated_hours integer representing realistic hours needed that week for someone working or studying part-time.\n"
    "Return a JSON object with fields: target_skills (list of 2-3 strings naming the skills this roadmap addresses), phases (list of exactly 3 objects each with: phase_name string, days_range string like \"Days 1-30\", weeks list of objects each with week_number integer, title string, description string, estimated_hours integer).\n\n"
    "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation."
)

# 7. Job Match Chain Prompt
# Scores live job postings against the resume in ONE batched call (not one
# call per job) to keep LLM call volume bounded regardless of how many
# listings were fetched. Replaces the old flat keyword-substring match_pct
# calculation in main.py, which couldn't distinguish a required skill from a
# nice-to-have, and had no concept of related-but-differently-worded skills.
JOB_MATCH_SYSTEM_PROMPT = (
    "You are a senior technical recruiter. You are given one candidate resume and a numbered list of job postings. "
    "For EACH job, evaluate how well the candidate matches it.\n"
    "Rules for scoring:\n"
    "- Read the job description and mentally separate REQUIRED skills/experience from NICE-TO-HAVE or bonus ones. "
    "A candidate missing a required skill should score meaningfully lower than one missing only a nice-to-have.\n"
    "- Recognize conceptually equivalent skills even when worded differently — e.g. Next.js experience is strong "
    "evidence toward a 'React' requirement, FastAPI experience is strong evidence toward a general 'Python backend' "
    "requirement. Do not require an exact string match.\n"
    "- match_pct (0-100) should reflect the weighted result of the above, not a simple count of shared words.\n"
    "- matched_requirements: short list of specific requirements from THIS posting the candidate satisfies.\n"
    "- missing_requirements: short list of specific requirements from THIS posting with no supporting evidence in the resume.\n"
    "- why: one or two sentences citing specific resume evidence (project names, tech stack, experience) for the score.\n\n"
    "Return ONLY a JSON object of the form: "
    "{\"matches\": [{\"index\": 0, \"match_pct\": 82, \"matched_requirements\": [...], \"missing_requirements\": [...], \"why\": \"...\"}, ...]}\n"
    "The 'index' field must exactly match the index given for each job in the input. Include one entry per job provided, in any order. "
    "Do NOT wrap your output in markdown formatting or code blocks. Do not include comments or trailing commas."
)


def build_job_match_chain():
    """Builds the job-match chain, which takes both resume_text and jobs_block as inputs (not just resume_text)."""
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=JOB_MATCH_SYSTEM_PROMPT),
        HumanMessagePromptTemplate.from_template(
            "Candidate Resume:\n{resume_text}\n\nJob Postings (JSON array, each with an index):\n{jobs_block}"
        )
    ])
    return prompt | llm | StrOutputParser()


# 8. Cover Letter Chain Prompt
# Reuses the exact same resume + job_description input already captured for
# JD tailoring above — no new input plumbing needed, just one more chain in
# the same parallel batch.
COVER_LETTER_SYSTEM_PROMPT = (
    "You are a professional cover letter writer. Write a concise, genuine-sounding cover letter for this candidate "
    "based on their resume. Avoid generic filler phrases ('I am writing to express my interest...') — open with "
    "something specific to the candidate's actual background. Reference real projects, skills, or experience from "
    "the resume; do not invent achievements, employers, or metrics not present in the resume. Keep it to 3-4 "
    "paragraphs, professional but not stiff."
    + JD_TAILORING_INSTRUCTION
    + " When a Target Job Description is provided, write the letter specifically for that role and company if the "
    "company name is identifiable from the posting, and explicitly connect the candidate's background to that "
    "posting's stated requirements. When no Target Job Description is provided, write a strong general-purpose "
    "letter highlighting the candidate's strongest, most differentiating qualifications instead.\n\n"
    "Return a JSON object with these exact fields:\n"
    "1. letter: the full cover letter text as a single string (use \\n\\n between paragraphs).\n"
    "2. tone: a short string describing the tone used, e.g. 'Professional and confident' or 'Enthusiastic and early-career'.\n"
    "3. tailored: boolean — true if a non-empty Target Job Description was provided and used, false otherwise.\n\n"
    "You must respond ONLY with a valid JSON object. Do NOT wrap your output in markdown formatting, markdown code blocks, "
    "or write any text outside of the raw JSON object. Do not include comments or trailing commas. Do not use any curly braces in your explanation."
)


# 9. "Ask About My Score" Follow-Up Chat Prompt
# Deliberately returns PLAIN TEXT, not JSON — this is a conversational
# answer, not structured data, so there's no JSON-parsing failure mode to
# worry about for this feature. Stateless: the client resends a short
# running history each turn instead of the backend keeping a session.
ATS_FOLLOWUP_SYSTEM_PROMPT = (
    "You are a helpful assistant answering a candidate's follow-up question about the ATS resume score they just "
    "received. You are given the ATS result context (score, rule-by-rule breakdown, verdict, and any calibration "
    "notes that applied) and, if available, their resume text. Answer the candidate's question conversationally and "
    "specifically, referencing the actual numbers/reasons from the context provided — do not invent scores, rules, "
    "or resume content that isn't in the context. Keep the answer under about 150 words. If the question can't be "
    "answered from the given context (e.g. it's unrelated to their score), say so honestly in one sentence and "
    "briefly redirect to what you can help with. Respond in plain conversational text — no JSON, no markdown headers."
)


def build_followup_chain():
    """Builds the ATS follow-up chat chain: takes ats_context, resume_context, history_block, and question."""
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=ATS_FOLLOWUP_SYSTEM_PROMPT),
        HumanMessagePromptTemplate.from_template(
            "ATS Result Context (JSON):\n{ats_context}\n\n"
            "Resume Text (may be empty if not provided):\n{resume_context}\n\n"
            "Prior conversation so far (may be empty):\n{history_block}\n\n"
            "Candidate's new question:\n{question}"
        )
    ])
    return prompt | llm | StrOutputParser()


def build_chain(system_prompt: str):
    """
    Helper function to build a standard LLM chain.

    The human message template now always includes an (often-empty) Target
    Job Description block, so every chain built here is JD-tailorable without
    needing a separate template variant. Chains whose system prompt doesn't
    reference job_description (jobs/interview/roadmap) simply never mention
    it — LangChain prompt formatting ignores template placeholders the system
    prompt itself doesn't act on, so this is safe for all six chains uniformly.
    """
    if not LLM_AVAILABLE or llm is None:
        return None
    prompt = ChatPromptTemplate.from_messages([
        SystemMessage(content=system_prompt),
        HumanMessagePromptTemplate.from_template(
            "Resume Text:\n{resume_text}\n\nTarget Job Description (leave analysis generic if this is empty):\n{job_description}"
        )
    ])
    return prompt | llm | StrOutputParser()

# Instantiate the chains
ats_chain = build_chain(ATS_SYSTEM_PROMPT)
skills_chain = build_chain(SKILLS_SYSTEM_PROMPT)
jobs_chain = build_chain(JOBS_SYSTEM_PROMPT)
rewrite_chain = build_chain(REWRITE_SYSTEM_PROMPT)
interview_chain = build_chain(INTERVIEW_SYSTEM_PROMPT)
roadmap_chain = build_chain(ROADMAP_SYSTEM_PROMPT)
cover_letter_chain = build_chain(COVER_LETTER_SYSTEM_PROMPT)
job_match_chain = build_job_match_chain()
followup_chain = build_followup_chain()

async def _invoke_chain_safe(chain, inputs: Dict[str, Any], name: str) -> Optional[str]:
    """Helper function to invoke a single chain asynchronously with full exception safety.

    Retries on rate-limit-shaped errors (see _is_rate_limit_error) with
    exponential backoff, the same way _jsearch_request_with_retry does for
    JSearch in main.py — a transient 429 from Groq shouldn't permanently
    fail a whole chain for the request when a short wait would have worked.
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


def _escape_control_chars_in_strings(s: str) -> str:
    """
    Escapes raw control characters (literal newlines, tabs, carriage returns)
    that appear INSIDE JSON string values.

    LLMs are instructed to use \\n for line breaks in multi-paragraph fields
    (e.g. the cover letter's 'letter' field), but sometimes emit a literal
    newline character instead — which is invalid inside a JSON string and
    breaks json.loads with an 'Invalid control character' error, even though
    the content itself is otherwise fine.

    Only characters INSIDE a string are touched (tracked the same way
    _repair_json_string tracks bracket matching) — whitespace used for JSON
    formatting between tokens is left untouched.
    """
    out = []
    in_string = False
    escape = False

    for char in s:
        if escape:
            out.append(char)
            escape = False
            continue
        if char == '\\':
            out.append(char)
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            out.append(char)
            continue
        if in_string and char == '\n':
            out.append('\\n')
        elif in_string and char == '\r':
            out.append('\\r')
        elif in_string and char == '\t':
            out.append('\\t')
        else:
            out.append(char)

    return "".join(out)


def _repair_json_string(s: str) -> str:
    """Repair truncated JSON or missing closing braces/brackets/quotes."""
    s = s.strip()
    
    # Remove trailing commas before closing braces/brackets
    s = re.sub(r',\s*([}\]])', r'\1', s)
    
    # Track opening braces/brackets and quotes
    stack = []
    in_string = False
    escape = False
    
    for char in s:
        if escape:
            escape = False
            continue
        if char == '\\':
            escape = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if not in_string:
            if char in '{[':
                stack.append(char)
            elif char in '}]':
                if stack:
                    top = stack[-1]
                    if (char == '}' and top == '{') or (char == ']' and top == '['):
                        stack.pop()
                        
    if in_string:
        s += '"'
        
    while stack:
        top = stack.pop()
        if top == '{':
            s += '}'
        elif top == '[':
            s += ']'
            
    return s


def _parse_json_safe(raw_string: Optional[str], name: str) -> Optional[Dict[str, Any]]:
    """Cleans up markdown wrappers if present and parses raw response to JSON."""
    if not raw_string:
        logger.warning(f"No response content to parse for {name} chain.")
        return None

    cleaned = raw_string.strip()
    
    # Strip markdown code blocks like ```json ... ``` or ``` ... ```
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
        
    try:
        return json.loads(cleaned)
    except Exception as e:
        logger.warning(f"Initial JSON parse failed for {name} chain. Attempting repair... Error: {e}")
        try:
            sanitized = _escape_control_chars_in_strings(cleaned)
            repaired = _repair_json_string(sanitized)
            parsed = json.loads(repaired)
            logger.info(f"Successfully repaired JSON for {name} chain.")
            return parsed
        except Exception as repair_err:
            logger.error(
                f"JSON parsing failed after repair for {name} chain. Error: {repair_err}. Raw content: '{raw_string}'"
            )
            return None


async def score_job_matches(resume_text: str, jobs: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
    """
    Scores a batch of job listings against the resume in a single LLM call.

    :param resume_text: The candidate's resume text.
    :param jobs: List of job dicts (as returned by fetch_live_jobs/get_fallback_indian_jobs),
        expected to have at least 'title', 'company', 'description' keys.
    :return: List of match dicts (index, match_pct, matched_requirements, missing_requirements, why),
        or None if the chain is unavailable or the call/parse failed — callers should fall back to
        a simpler heuristic in that case rather than surfacing an error.
    """
    if not job_match_chain or not jobs:
        return None

    # Truncate descriptions to keep token usage bounded regardless of how
    # verbose a given posting's description is.
    compact_jobs = [
        {
            "index": i,
            "title": job.get("title") or "",
            "company": job.get("company") or "",
            "description": (job.get("description") or "")[:600],
        }
        for i, job in enumerate(jobs)
    ]
    jobs_block = json.dumps(compact_jobs)

    try:
        logger.info(f"Triggering job_match chain ainvoke for {len(jobs)} listings...")
        raw = await job_match_chain.ainvoke({"resume_text": resume_text, "jobs_block": jobs_block})
    except Exception as e:
        logger.error(f"job_match chain invocation failed: {e}", exc_info=True)
        return None

    parsed = _parse_json_safe(raw, "job_match")
    if not parsed or not isinstance(parsed.get("matches"), list):
        logger.warning("job_match chain returned no usable 'matches' list.")
        return None

    return parsed["matches"]


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


async def run_all_chains(resume_text: str, job_description: str = "") -> tuple:
    """Runs all analysis chains and parses the JSON responses safely.

    Chains are staggered into two waves rather than all 7 fired at once —
    with 8 total LLM calls per analysis (7 chains + the job-match scoring
    call that follows), firing everything simultaneously can burst past the
    provider's tokens-per-minute limit even when each individual call would
    fit comfortably alone. Wave 1 (ats/skills/jobs — shorter completions)
    still fires concurrently since that hasn't been observed to trip the
    limit; wave 2 (rewrite/interview/roadmap/cover_letter — longer, pricier
    completions) now runs fully sequentially — one chain's request completes
    before the next one starts — rather than concurrently. Staggering just
    the *launch* time (a prior version of this function) wasn't enough: with
    a genuinely tight per-account TPM budget, two calls launched 2s apart
    can still have their completions overlap in the same rolling window,
    which is exactly what was still causing an occasional wave-2 chain (seen
    on both 'cover_letter' and 'rewrite' in practice) to lose the token race
    and exhaust its retries. True sequential execution trades wall-clock
    time (wave 2 now takes roughly as long as its 4 calls summed, rather
    than the fastest of the 4) for actual reliability — the honest tradeoff
    given the account's rate limit, not a cosmetic mitigation.

    :param resume_text: Extracted text from the candidate's resume.
    :param job_description: Optional pasted job description. When non-empty, the ATS,
        Skills, Rewrite, and Cover Letter chains tailor their analysis to this specific
        posting instead of a generically inferred role (see JD_TAILORING_INSTRUCTION).
        Jobs/Interview/Roadmap chains ignore it — their prompts don't reference it.
    :return: (results_dict, was_rate_limited) — results_dict contains parsed outputs for
        'ats', 'skills', 'jobs', 'rewrite', 'interview', 'roadmap', 'cover_letter'.
        was_rate_limited is True if any chain failure looked like a provider rate limit,
        so callers can surface an accurate error message instead of a generic one.
    """
    wave1_keys = ["ats", "skills", "jobs"]
    wave2_keys = ["rewrite", "interview", "roadmap", "cover_letter"]
    all_keys = wave1_keys + wave2_keys

    if not LLM_AVAILABLE:
        logger.warning("LLM client is not available. Skipping all chain invocations.")
        return {key: None for key in all_keys}, False

    logger.info("Starting execution of analysis chains (wave 1 concurrent, wave 2 sequential)...")
    inputs = {"resume_text": resume_text, "job_description": job_description or ""}

    wave1_results = await asyncio.gather(
        _invoke_chain_safe(ats_chain, inputs, "ats"),
        _invoke_chain_safe(skills_chain, inputs, "skills"),
        _invoke_chain_safe(jobs_chain, inputs, "jobs"),
        return_exceptions=True
    )

    # Brief pause before wave 2 to let wave 1's token usage clear the rolling
    # TPM window a bit before the next (larger) set of calls begins.
    await asyncio.sleep(1.5)

    # Wave 2 is now fully sequential — see the reasoning in this function's
    # docstring above. Each _invoke_chain_safe call still has its own
    # retry-with-backoff for any 429 that occurs anyway (a tight account
    # budget plus other concurrent traffic on the same key can still produce
    # one), but sequential execution means that's now the exception path
    # rather than the routine one.
    wave2_results = []
    for chain, key in zip(
        [rewrite_chain, interview_chain, roadmap_chain, cover_letter_chain],
        wave2_keys,
    ):
        result = await _invoke_chain_safe(chain, inputs, key)
        wave2_results.append(result)

    all_results = list(wave1_results) + list(wave2_results)

    final_dict = {}
    was_rate_limited = False

    for key, res in zip(all_keys, all_results):
        if isinstance(res, Exception):
            if _is_rate_limit_error(res):
                was_rate_limited = True
            logger.error(f"Gathered exception for {key} chain: {res}", exc_info=True)
            final_dict[key] = None
        else:
            final_dict[key] = _parse_json_safe(res, key)

    logger.info(f"Finished gathering and parsing all analysis chains. Rate limited: {was_rate_limited}")
    return final_dict, was_rate_limited


async def answer_ats_followup(
    ats_summary: Dict[str, Any],
    question: str,
    resume_text: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
) -> Optional[str]:
    """
    Answers a follow-up question about an already-computed ATS score.

    Stateless by design: `history` is whatever the client has accumulated and
    resends each turn (see AtsFollowupRequest) — the backend keeps nothing.
    Only the last few turns are used to bound token usage per call.

    :return: Plain-text answer, or None if the chain is unavailable or the call failed.
    """
    if not followup_chain:
        logger.warning("Follow-up chain is not initialized/available.")
        return None

    MAX_HISTORY_TURNS = 6
    recent_history = (history or [])[-MAX_HISTORY_TURNS:]
    if recent_history:
        history_block = "\n".join(
            f"Q: {turn.get('question', '')}\nA: {turn.get('answer', '')}" for turn in recent_history
        )
    else:
        history_block = "(no prior questions in this conversation)"

    try:
        logger.info("Triggering ats_followup chain ainvoke...")
        answer = await followup_chain.ainvoke({
            "ats_context": json.dumps(ats_summary),
            "resume_context": (resume_text or "")[:4000],  # bound token usage
            "history_block": history_block,
            "question": question,
        })
        return answer.strip() if answer else None
    except Exception as e:
        logger.error(f"ats_followup chain invocation failed: {e}", exc_info=True)
        return None