import React, { useState, useEffect } from "react";

/**
 * CoverLetterPanel — displays the AI-generated cover letter.
 * Reuses the resume + job description already captured for JD tailoring
 * (see Upload.jsx / Dashboard.jsx), so this costs one more Groq call and no
 * new input plumbing.
 */
export default function CoverLetterPanel({ data }) {
  const [text, setText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data?.letter) {
      setText(data.letter);
      setIsEditing(false);
    }
  }, [data]);

  if (!data) {
    return (
      <div className="bg-[#432818] border border-[#99582a] rounded-2xl p-6 text-[#ffe6a7] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-6 h-6 text-[#bb9457] flex-shrink-0"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <span className="font-bold text-base text-[#ffe6a7]">Cover Letter Unavailable</span>
        </div>
        <p className="mt-2 text-[#bb9457]">
          The cover letter could not be generated.
        </p>
      </div>
    );
  }

  const { tone, tailored } = data;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

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
    <div className="bg-[#432818] border border-[#99582a] rounded-2xl p-8 shadow-2xl space-y-6 animate-fadeIn text-[#ffe6a7]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1.5">
          <h3 className="text-xl font-bold text-[#ffe6a7]">Cover Letter</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {tone && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#6f1d1b] text-[#bb9457] border border-[#99582a]/40 uppercase tracking-wider">
                {tone}
              </span>
            )}
            {tailored ? (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#1a7a4a]/15 text-[#1a7a4a] border border-[#1a7a4a]/30 uppercase tracking-wider">
                ✓ Tailored to your job description
              </span>
            ) : (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#bb9457]/10 text-[#bb9457] border border-[#bb9457]/30 uppercase tracking-wider">
                General purpose — paste a job description for a tailored version
              </span>
            )}
          </div>
        </div>
        <span className="text-[#99582a] text-xs font-semibold flex-shrink-0">{wordCount} words</span>
      </div>

      {/* Letter body — editable */}
      <div className="bg-[#6f1d1b] border border-[#99582a] rounded-xl p-5">
        {isEditing ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            autoFocus
            className="w-full min-h-[320px] bg-transparent text-[#ffe6a7] text-sm leading-relaxed resize-y outline-none whitespace-pre-line"
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className="text-[#ffe6a7] text-sm leading-relaxed whitespace-pre-line cursor-text min-h-[100px]"
          >
            {text || "No letter generated."}
          </div>
        )}
        {!isEditing && (
          <p className="text-[#99582a] text-[10px] font-semibold mt-3 select-none">Click the letter to edit it directly.</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={handleCopy}
          className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-bold bg-[#bb9457] hover:bg-[#ffe6a7] text-[#432818] border border-transparent transition-all duration-200 cursor-pointer"
        >
          {copied ? "Copied!" : "Copy Letter"}
        </button>
        <button
          onClick={handleReset}
          className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-bold border border-[#99582a] text-[#99582a] hover:text-[#ffe6a7] hover:border-[#ffe6a7] bg-transparent transition duration-200 cursor-pointer"
        >
          Reset to AI version
        </button>
      </div>

      {!tailored && (
        <p className="text-[#99582a] text-xs leading-relaxed border-t border-[#99582a]/30 pt-4">
          Tip: paste a job description in the upload panel and re-analyze to get a letter written specifically for
          that role and company instead of this general-purpose version.
        </p>
      )}
    </div>
  );
}