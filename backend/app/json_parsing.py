"""
Safely parses (and repairs, where possible) JSON that an LLM chain returned
as raw text. Split out from chains.py since this logic is self-contained —
pure string manipulation, no network calls, no LangChain — and is exactly
the kind of hand-rolled parser logic that benefits from living somewhere
easy to unit-test in isolation.
"""

import json
import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


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