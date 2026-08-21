import React, { useState } from "react";
import FeedbackButtons from "../FeedbackButtons";

/**
 * InterviewPrepPanel — practice mode, not expand-to-read.
 *
 * Structural departure: expanding a question no longer immediately shows
 * the model answer. Instead it opens a practice space — an optional
 * textarea to attempt your own answer first, and a "Reveal model answer"
 * action. This mirrors how interview prep actually works (attempt, then
 * check yourself) rather than just presenting a list of things to read.
 */
export default function InterviewPrepPanel({ data }) {
  const [activeFilter, setActiveFilter] = useState("All");
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [revealedIdx, setRevealedIdx] = useState({});
  const [attempts, setAttempts] = useState({});

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  if (!data || !data.questions || data.questions.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-center animate-fadeIn text-[#0F172A]">
        <h4 className="text-base font-semibold text-[#0F172A] mb-1" style={serif}>Interview Prep Unavailable</h4>
        <p className="text-[#64748B] text-xs max-w-xs mx-auto leading-relaxed">
          Interview questions could not be generated — try re-analyzing your resume.
        </p>
      </div>
    );
  }

  const filters = ["All", "Technical", "Project", "Behavioral", "Situational", "Curveball"];

  const filteredQuestions = data.questions.filter((q) => {
    if (activeFilter === "All") return true;
    return q.type?.toLowerCase() === activeFilter.toLowerCase();
  });

  const handleCopy = (e, index, text) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedIdx(index);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const toggleExpand = (index) => {
    setExpandedIdx(expandedIdx === index ? null : index);
  };

  const reveal = (index) => {
    setRevealedIdx((prev) => ({ ...prev, [index]: true }));
  };

  const difficultyColor = (level) => {
    const l = level?.toLowerCase();
    if (l === "easy") return "#0D9488";
    if (l === "hard") return "#2563EB";
    return "#64748B";
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 md:p-12 space-y-8 animate-fadeIn text-[#0F172A]">

      <div>
        <h3 className="text-lg font-medium text-[#0F172A]" style={serif}>Interview prep</h3>
        <p className="text-[#64748B] text-sm mt-1">
          Tailored questions based on your background and projects — try answering before revealing the model answer.
        </p>
      </div>

      <div className="flex items-center gap-6 border-b border-[#E2E8F0] flex-wrap">
        {filters.map((f) => {
          const isSelected = activeFilter === f;
          return (
            <button
              key={f}
              onClick={() => { setActiveFilter(f); setExpandedIdx(null); }}
              className={`pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
                isSelected ? "text-[#0F172A] border-[#2563EB]" : "text-[#64748B] border-transparent hover:text-[#0F172A]"
              }`}
            >
              {f}
            </button>
          );
        })}
      </div>

      <div className="divide-y divide-[#E2E8F0]">
        {filteredQuestions.length > 0 ? (
          filteredQuestions.map((q, idx) => {
            const isExpanded = expandedIdx === idx;
            const isRevealed = !!revealedIdx[idx];

            return (
              <div key={idx} className="py-4">
                <button onClick={() => toggleExpand(idx)} className="w-full flex items-start justify-between gap-4 text-left">
                  <div className="flex items-start gap-4 flex-1 min-w-0">
                    <span className="text-xs font-semibold text-[#64748B] w-6 flex-shrink-0 pt-0.5" style={mono}>
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide" style={mono}>
                        <span className="text-[#64748B]">{q.type}</span>
                        <span style={{ color: difficultyColor(q.difficulty) }}>{q.difficulty}</span>
                      </div>
                      <h4 className="text-[15px] font-medium text-[#0F172A] leading-relaxed">{q.question}</h4>
                    </div>
                  </div>
                  <span className="text-[#64748B] text-sm select-none pt-1 flex-shrink-0">{isExpanded ? "−" : "+"}</span>
                </button>

                {isExpanded && (
                  <div className="mt-5 pl-10 space-y-5 animate-fadeIn" onClick={(e) => e.stopPropagation()}>

                    {!isRevealed ? (
                      <div className="space-y-3">
                        <h5 className="text-[11px] font-semibold text-[#0F172A] uppercase tracking-wide">Your attempt (optional)</h5>
                        <textarea
                          value={attempts[idx] || ""}
                          onChange={(e) => setAttempts((prev) => ({ ...prev, [idx]: e.target.value }))}
                          placeholder="Type your answer here before checking the model answer — this is where the practice actually happens."
                          className="w-full min-h-[100px] bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-sm leading-relaxed p-3 resize-y outline-none placeholder:text-[#64748B]/60"
                        />
                        <button onClick={() => reveal(idx)} className="text-sm font-semibold text-[#0F172A] hover:text-[#2563EB] transition">
                          Reveal model answer →
                        </button>
                      </div>
                    ) : (
                      <>
                        {attempts[idx] && (
                          <div className="space-y-2">
                            <h5 className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wide">Your attempt</h5>
                            <p className="text-[#64748B] text-sm leading-relaxed italic whitespace-pre-line border-l-2 border-[#E2E8F0] pl-4">
                              {attempts[idx]}
                            </p>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h5 className="text-[11px] font-semibold text-[#0F172A] uppercase tracking-wide">Model answer</h5>
                            <button onClick={(e) => handleCopy(e, idx, q.model_answer)} className="text-xs text-[#64748B] hover:text-[#0F172A] font-medium transition">
                              {copiedIdx === idx ? "Copied ✓" : "Copy"}
                            </button>
                          </div>
                          <p className="text-[#0F172A] text-sm leading-relaxed italic whitespace-pre-line border-l-2 border-[#0D9488] pl-4">
                            "{q.model_answer}"
                          </p>
                        </div>

                        {q.key_points && q.key_points.length > 0 && (
                          <div className="space-y-2">
                            <h5 className="text-[11px] font-semibold text-[#0F172A] uppercase tracking-wide">What the interviewer is evaluating</h5>
                            <ul className="space-y-1.5">
                              {q.key_points.map((pt, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-[#64748B]">
                                  <span className="text-[#64748B] mt-0.5 flex-shrink-0">·</span>
                                  <span>{pt}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-[#64748B] text-[11px] font-medium">Was this relevant?</span>
                          <FeedbackButtons feature="interview_question" itemId={`question_${idx}`} context={{ question: q.question, type: q.type }} />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="text-center py-8 text-[#64748B] text-sm italic">No questions found for the selected category.</div>
        )}
      </div>
    </div>
  );
}