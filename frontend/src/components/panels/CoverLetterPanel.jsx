import React, { useState, useEffect } from "react";

/**
 * CoverLetterPanel — structural departure: the letter renders as an actual
 * formatted letter (serif body, a letterhead date line, a bordered "sheet
 * of paper" with a soft shadow lifting it off the page) instead of a plain
 * textarea sitting in a generic card. Same functionality as before:
 * click-to-edit, copy, reset.
 */
export default function CoverLetterPanel({ data }) {
  const [text, setText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  useEffect(() => {
    if (data?.letter) {
      setText(data.letter);
      setIsEditing(false);
    }
  }, [data]);

  if (!data) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-[#0F172A] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#64748B] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-semibold text-base text-[#0F172A]" style={serif}>Cover Letter Unavailable</span>
        </div>
        <p className="mt-2 text-[#64748B]">The cover letter could not be generated.</p>
      </div>
    );
  }

  const { tone, tailored } = data;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setText(data.letter || "");
    setIsEditing(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn text-[#0F172A]">

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {tone && <span className="text-[11px] text-[#64748B] uppercase tracking-wide" style={mono}>{tone}</span>}
          {tailored ? (
            <span className="text-[10px] font-semibold text-[#0D9488] uppercase tracking-wide">✓ Tailored to your job description</span>
          ) : (
            <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wide">General purpose</span>
          )}
        </div>
        <span className="text-[#64748B] text-xs" style={mono}>{wordCount} words</span>
      </div>

      {/* The letter itself — formatted like an actual document, lifted off the page with a soft shadow */}
      <div className="bg-white border border-[#E2E8F0] rounded-sm shadow-[0_2px_16px_rgba(15,23,42,0.06)] p-10 md:p-14">
        <p className="text-[#64748B] text-xs mb-8" style={mono}>{today}</p>

        {isEditing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            autoFocus
            style={serif}
            className="w-full min-h-[420px] bg-transparent text-[#0F172A] text-[17px] leading-[1.8] resize-y outline-none whitespace-pre-line"
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            style={serif}
            className="text-[#0F172A] text-[17px] leading-[1.8] whitespace-pre-line cursor-text min-h-[200px]"
          >
            {text || "No letter generated."}
          </div>
        )}
      </div>

      {!isEditing && (
        <p className="text-[#64748B] text-[11px] select-none -mt-3">Click the letter to edit it directly.</p>
      )}

      <div className="flex flex-wrap items-center gap-5">
        <button onClick={handleCopy} className="text-sm font-semibold text-[#0F172A] hover:text-[#2563EB] transition">
          {copied ? "Copied!" : "Copy letter →"}
        </button>
        <button onClick={handleReset} className="text-sm font-medium text-[#64748B] hover:text-[#0F172A] transition">
          Reset to AI version
        </button>
      </div>

      {!tailored && (
        <p className="text-[#64748B] text-xs leading-relaxed border-t border-[#E2E8F0] pt-4">
          Tip: paste a job description in the upload panel and re-analyze to get a letter written specifically for
          that role and company instead of this general-purpose version.
        </p>
      )}
    </div>
  );
}