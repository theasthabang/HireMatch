"""
Lightweight feedback logging.

Appends each feedback event as one JSON line to a local file. This is
deliberately simple — no database, no new infra — so prompt/feature quality
signal starts accumulating immediately. If usage grows, swap
_write_feedback_line for a real datastore without changing the public
log_feedback() signature or the /feedback endpoint contract.
"""

import json
import logging
import os
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

FEEDBACK_LOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "feedback_log.jsonl")


def log_feedback(
    feature: str,
    rating: str,
    item_id: Optional[str] = None,
    comment: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> None:
    """
    Appends one feedback event to FEEDBACK_LOG_PATH as a JSON line.

    Never raises — a logging failure here should not break the request that
    triggered it. Failures are logged instead.
    """
    event = {
        "timestamp": time.time(),
        "feature": feature,
        "item_id": item_id,
        "rating": rating,
        "comment": comment,
        "context": context,
    }
    try:
        with open(FEEDBACK_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.error(f"Failed to write feedback event: {e}", exc_info=True)