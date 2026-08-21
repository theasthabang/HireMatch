import React, { useState } from "react";
import { submitFeedback } from "../api/client";

/**
 * FeedbackButtons — graded-paper system. Same behavior as before, rebuilt
 * as quiet text-only marks (+ / ✕) instead of colored pill buttons, matching
 * the restrained, single-accent visual language used everywhere else.
 */
export default function FeedbackButtons({ feature, itemId, context, className = "" }) {
  const [rating, setRating] = useState(null);
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null);

  const handleRate = async (newRating) => {
    if (submitted) return;
    setRating(newRating);
    setError(null);

    if (newRating === "down") {
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
      <span className={`text-[#64748B] text-[11px] select-none ${className}`}>
        Thanks for the feedback
      </span>
    );
  }

  return (
    <div className={`inline-flex flex-col gap-1.5 ${className}`}>
      <div className="inline-flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleRate("up")}
          title="Helpful"
          className={`text-[11px] font-medium transition ${
            rating === "up" ? "text-[#0D9488]" : "text-[#64748B] hover:text-[#0D9488]"
          }`}
        >
          Helpful
        </button>
        <button
          type="button"
          onClick={() => handleRate("down")}
          title="Not helpful"
          className={`text-[11px] font-medium transition ${
            rating === "down" ? "text-[#2563EB]" : "text-[#64748B] hover:text-[#2563EB]"
          }`}
        >
          Not helpful
        </button>
        {error && <span className="text-[#2563EB] text-[10px] font-medium">{error}</span>}
      </div>

      {showCommentBox && (
        <div className="flex items-center gap-2 animate-fadeIn">
          <input
            type="text"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmitDown()}
            placeholder="What was wrong? (optional)"
            className="text-[11px] bg-transparent border-b border-[#E2E8F0] focus:border-[#0F172A] px-0.5 py-1 text-[#0F172A] outline-none w-44 placeholder:text-[#64748B]/60"
          />
          <button type="button" onClick={handleSubmitDown} className="text-[10px] font-semibold text-[#0F172A] hover:text-[#2563EB] transition">
            Send
          </button>
        </div>
      )}
    </div>
  );
}