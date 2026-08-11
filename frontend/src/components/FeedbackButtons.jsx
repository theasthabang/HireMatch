import React, { useState } from "react";
import { submitFeedback } from "../api/client";

/**
 * FeedbackButtons — a small, reusable thumbs up/down control for any
 * specific AI-generated suggestion (an ATS tip, an interview question,
 * etc.). Intentionally lightweight: no accounts, no threading — just a
 * rating plus an optional short comment, logged server-side for later review.
 *
 * @param {string} feature - Feature identifier, e.g. 'ats_tip', 'ats_overall', 'interview_question'.
 * @param {string} [itemId] - Identifier for the specific item within the feature.
 * @param {Object} [context] - Optional small snapshot of the item (e.g. its text) sent along for review.
 * @param {string} [className]
 */
export default function FeedbackButtons({ feature, itemId, context, className = "" }) {
  const [rating, setRating] = useState(null); // null | 'up' | 'down'
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const handleRate = async (newRating) => {
    if (submitted) return;
    setRating(newRating);
    setError(null);

    if (newRating === "down") {
      // Give the user a chance to say what was wrong before sending.
      setShowCommentBox(true);
      return;
    }

    try {
      await submitFeedback(feature, newRating, { itemId, context });
      setSubmitted(true);
    } catch (err) {
      setError("Couldn't send feedback.");
    }
  };

  const handleSubmitDown = async () => {
    try {
      await submitFeedback(feature, "down", { itemId, context, comment: comment.trim() || undefined });
      setSubmitted(true);
      setShowCommentBox(false);
    } catch (err) {
      setError("Couldn't send feedback.");
    }
  };

  if (submitted) {
    return (
      <span className={`text-[#99582a] text-[11px] font-semibold select-none ${className}`}>
        Thanks for the feedback
      </span>
    );
  }

  return (
    <div className={`inline-flex flex-col gap-1.5 ${className}`}>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => handleRate("up")}
          title="Helpful"
          className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition ${
            rating === "up"
              ? "bg-[#1a7a4a]/20 text-[#1a7a4a]"
              : "text-[#99582a] hover:text-[#1a7a4a] hover:bg-[#1a7a4a]/10"
          }`}
        >
          👍
        </button>
        <button
          type="button"
          onClick={() => handleRate("down")}
          title="Not helpful"
          className={`w-6 h-6 rounded-md flex items-center justify-center text-xs transition ${
            rating === "down"
              ? "bg-[#c0392b]/20 text-[#c0392b]"
              : "text-[#99582a] hover:text-[#c0392b] hover:bg-[#c0392b]/10"
          }`}
        >
          👎
        </button>
        {error && <span className="text-[#c0392b] text-[10px] font-semibold">{error}</span>}
      </div>

      {showCommentBox && (
        <div className="flex items-center gap-1.5 animate-fadeIn">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmitDown()}
            placeholder="What was wrong? (optional)"
            className="text-[11px] bg-[#6f1d1b] border border-[#99582a] focus:border-[#bb9457] rounded-md px-2 py-1 text-[#ffe6a7] outline-none w-40 placeholder:text-[#99582a]/70"
          />
          <button
            type="button"
            onClick={handleSubmitDown}
            className="text-[10px] font-bold text-[#bb9457] hover:text-[#ffe6a7] transition"
          >
            Send
          </button>
        </div>
      )}
    </div>
  );
}