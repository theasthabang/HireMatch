import React, { useState, useEffect, useRef } from "react";

function CustomCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-start space-x-3 cursor-pointer select-none group text-sm text-[#ffe6a7] py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <div
        className={`w-[18px] h-[18px] flex-shrink-0 rounded border-2 flex items-center justify-center transition-all duration-150 mt-0.5 ${
          checked
            ? "bg-[#bb9457] border-[#bb9457]"
            : "border-[#99582a] bg-[#6f1d1b] group-hover:border-[#bb9457]"
        }`}
      >
        {checked && <span className="text-white text-xs font-black select-none">✓</span>}
      </div>
      <span className="leading-normal">{label}</span>
    </label>
  );
}

/**
 * BulletCard — now pairs the verbatim original with the rewrite, side by
 * side, instead of showing only a flat rewritten string. Two independent
 * controls:
 *   - Accept/Reject: which version (rewritten vs. original) is used when the
 *     user copies the final resume text.
 *   - Edit: still lets the user hand-tweak the rewritten text, same as before.
 *
 * metricNote (from the backend) is shown as an explicit "add this number"
 * flag ONLY when the AI couldn't find a real metric to work with — it is
 * never a warning about a possibly-fabricated number, because the backend
 * prompt now forbids inventing one. If metricNote is absent and the rewrite
 * contains a number, that number is guaranteed to trace back to the
 * candidate's original bullet.
 */
function BulletCard({ bullet, onSave, onEditStart, onToggleAccepted }) {
  const [isEditing, setIsEditing] = useState(bullet.isEditing);
  const [text, setText] = useState(bullet.text);
  const textareaRef = useRef(null);

  useEffect(() => {
    setText(bullet.text);
  }, [bullet.text]);

  useEffect(() => {
    setIsEditing(bullet.isEditing);
  }, [bullet.isEditing]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, [isEditing]);

  const handleBlur = () => {
    onSave(bullet.id, text);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSave(bullet.id, text);
    }
  };

  const handleCardClick = (e) => {
    if (e.target.closest(".no-edit")) return;
    if (!isEditing) {
      onEditStart(bullet.id);
    }
  };

  return (
    <div
      className={`relative bg-[#432818] border rounded-xl p-4 px-5 mb-2.5 transition-all duration-200 group ${
        isEditing ? "border-[#bb9457]" : "border-[#99582a]"
      } ${!bullet.accepted ? "opacity-60" : ""}`}
    >
      {/* Top row: edited badge (left) + Accept/Reject toggle (right) */}
      <div className="flex items-center justify-between mb-2 no-edit">
        <div>
          {bullet.isEdited && (
            <span className="bg-[#1a7a4a] text-[#ffe6a7] text-[10px] font-bold px-2 py-0.5 rounded-[50px] select-none">
              edited
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 no-edit">
          <button
            type="button"
            onClick={() => onToggleAccepted(bullet.id, true)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
              bullet.accepted
                ? "bg-[#1a7a4a] text-[#ffe6a7] border-[#1a7a4a]"
                : "bg-transparent text-[#99582a] border-[#99582a] hover:border-[#1a7a4a] hover:text-[#1a7a4a]"
            }`}
          >
            ✓ Use rewrite
          </button>
          <button
            type="button"
            onClick={() => onToggleAccepted(bullet.id, false)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
              !bullet.accepted
                ? "bg-[#c0392b] text-[#ffe6a7] border-[#c0392b]"
                : "bg-transparent text-[#99582a] border-[#99582a] hover:border-[#c0392b] hover:text-[#c0392b]"
            }`}
          >
            ✕ Keep original
          </button>
        </div>
      </div>

      {/* Original — shown small/dim above the rewrite for direct comparison */}
      <div className="text-[#99582a] text-[12px] leading-relaxed mb-2 pb-2 border-b border-[#99582a]/20">
        <span className="font-bold uppercase tracking-wider text-[10px] mr-1.5">Before:</span>
        <span className={bullet.accepted ? "line-through decoration-[#99582a]/70" : ""}>{bullet.original}</span>
      </div>

      {/* Rewritten — editable, this is what gets used when accepted */}
      <div onClick={handleCardClick} className={`cursor-text ${!bullet.accepted ? "pointer-events-none" : ""}`}>
        {isEditing ? (
          <div className="flex flex-col space-y-1.5 w-full">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="w-full min-h-[80px] bg-[#6f1d1b] border border-[#bb9457] rounded-lg text-[#ffe6a7] text-[15px] leading-[1.6] p-3 resize-y outline-none"
            />
            <span className="text-[#99582a] text-[11px] select-none">
              Press Enter to save · Shift+Enter for new line
            </span>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <div className="text-[#ffe6a7] text-[15px] leading-[1.6] break-words">
              <span className="font-bold uppercase tracking-wider text-[10px] text-[#bb9457] mr-1.5">After:</span>
              {text}
            </div>
            {!isEditing && bullet.accepted && (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  onEditStart(bullet.id);
                }}
                className="no-edit flex-shrink-0 text-[#99582a] text-[14px] opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer select-none"
              >
                ✏
              </span>
            )}
          </div>
        )}
      </div>

      {/* Metric flag — only appears when the AI found no real number to work
          with. This is a "please add your real number here" prompt, never a
          fabrication warning, since the backend is instructed to never
          invent one. */}
      {bullet.metricNote && (
        <div className="no-edit mt-3 flex items-start gap-2 bg-[#bb9457]/10 border border-[#bb9457]/40 rounded-lg px-3 py-2">
          <span className="text-[#bb9457] text-sm leading-none mt-0.5">✦</span>
          <p className="text-[#bb9457] text-[12px] leading-relaxed font-semibold">
            No metric found — {bullet.metricNote}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * ResumeRewritePanel — bullets are now {original, rewritten, metric_note}
 * pairs from the backend instead of flat strings, so the UI can show a real
 * before/after and let the user accept or reject each rewrite individually.
 */
export default function ResumeRewritePanel({ data, rewrite }) {
  const rewriteData = data || rewrite;
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [showImprovements, setShowImprovements] = useState(false);

  const [bullets, setBullets] = useState([]);
  const [checkbox1, setCheckbox1] = useState(false);
  const [checkbox2, setCheckbox2] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [showEditSummary, setShowEditSummary] = useState(false);

  useEffect(() => {
    if (rewriteData?.rewritten_bullets) {
      const initialized = rewriteData.rewritten_bullets.map((b, index) => ({
        id: index,
        original: b.original || "",
        aiRewritten: b.rewritten || "",
        text: b.rewritten || "",
        isEdited: false,
        isEditing: false,
        metricNote: b.metric_note || null,
        accepted: true,
      }));
      setBullets(initialized);
      setCheckbox1(false);
      setCheckbox2(false);
    }
  }, [rewriteData]);

  if (!rewriteData) {
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
          <span className="font-bold text-base text-[#ffe6a7]">Rewrite Recommendations Unavailable</span>
        </div>
        <p className="mt-2 text-[#bb9457]">
          The rewrite recommendations are currently unavailable.
        </p>
      </div>
    );
  }

  const { summary = "", improvements_made = [] } = rewriteData;

  const copySummaryToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const handleSaveBullet = (id, newText) => {
    setBullets((prev) =>
      prev.map((b) => {
        if (b.id === id) {
          return {
            ...b,
            text: newText,
            isEdited: newText !== b.aiRewritten,
            isEditing: false,
          };
        }
        return b;
      })
    );
  };

  const handleEditStart = (id) => {
    setBullets((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, isEditing: true } : { ...b, isEditing: false }
      )
    );
  };

  const handleToggleAccepted = (id, accepted) => {
    setBullets((prev) =>
      prev.map((b) => (b.id === id ? { ...b, accepted, isEditing: false } : b))
    );
  };

  const handleCheckbox1Change = (val) => {
    setCheckbox1(val);
  };

  const handleCopyBullets = () => {
    // Accepted bullets use the (possibly hand-edited) rewrite; rejected
    // bullets fall back to the original wording untouched.
    const textToCopy = bullets.map((b) => (b.accepted ? b.text : b.original)).join("\n");
    navigator.clipboard.writeText(textToCopy);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleResetBullets = () => {
    if (window.confirm("Reset all bullets to the AI-generated version? Your edits and accept/reject choices will be lost.")) {
      setBullets((prev) =>
        prev.map((b) => ({
          ...b,
          text: b.aiRewritten,
          isEdited: false,
          isEditing: false,
          accepted: true,
        }))
      );
      setCheckbox1(false);
      setCheckbox2(false);
    }
  };

  // Only bullets that are (a) currently accepted and (b) still flagged as
  // needing a real metric block the copy action — a rejected bullet reverts
  // to the candidate's own original wording, which needs no verification.
  const flaggedBullets = bullets.filter((b) => b.accepted && b.metricNote);
  const isCopyActive = flaggedBullets.length === 0 || (checkbox1 && checkbox2);
  const editedCount = bullets.filter((b) => b.isEdited).length;
  const rejectedCount = bullets.filter((b) => !b.accepted).length;

  return (
    <div className="bg-[#432818] border border-[#99582a] rounded-2xl p-8 shadow-2xl space-y-8 animate-fadeIn text-[#ffe6a7]">
      {/* 1. Optimized Summary Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-[#ffe6a7]">Optimized Professional Summary</h3>
          <button
            onClick={() => copySummaryToClipboard(summary)}
            className="flex items-center space-x-1.5 text-xs text-[#bb9457] hover:text-[#ffe6a7] font-semibold transition"
          >
            {copiedSummary ? (
              <span>Copied!</span>
            ) : (
              <>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8.25 7.5V6.108c0-1.135.845-2.098 1.976-2.192.373-.03.748-.057 1.123-.08M15.75 18H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08M15.75 18.75v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5A3.375 3.375 0 006.375 7.5H5.25m11.9-3.664A2.251 2.251 0 0015 2.25h-1.5a2.251 2.251 0 00-2.15 1.586m5.8 0c.065.21.1.433.1.664v.75h-6V4.5c0-.231.035-.454.1-.664M6.75 7.5H4.875c-.621 0-1.125.504-1.125 1.125v12c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z"
                  />
                </svg>
                <span>Copy Summary</span>
              </>
            )}
          </button>
        </div>

        <blockquote className="bg-[#6f1d1b] border-l-4 border-[#bb9457] rounded-r-xl p-5 text-[#ffe6a7] text-sm md:text-base leading-relaxed italic my-4">
          "{summary || "No optimized summary generated."}"
        </blockquote>
      </div>

      <hr className="border-[#99582a]" />

      {/* 2. Optimized Experience Bullets — before/after pairs */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-bold text-[#ffe6a7]">Optimized Experience Bullets</h3>
          {bullets.length > 0 && (
            <span className="text-[#99582a] text-xs font-semibold">
              {bullets.length - rejectedCount} of {bullets.length} rewrites in use
            </span>
          )}
        </div>
        <p className="text-[#99582a] text-xs leading-relaxed -mt-2">
          Each bullet shows your original wording above the AI rewrite. Use "Use rewrite" or "Keep original" per
          bullet, or click a rewrite to hand-edit it.
        </p>

        {bullets.length > 0 ? (
          <div className="space-y-1">
            {bullets.map((bullet) => (
              <BulletCard
                key={bullet.id}
                bullet={bullet}
                onSave={handleSaveBullet}
                onEditStart={handleEditStart}
                onToggleAccepted={handleToggleAccepted}
              />
            ))}
          </div>
        ) : (
          <p className="text-[#99582a] text-sm italic">No optimized bullets generated.</p>
        )}

        {/* Confirm Flagged Metrics Checklist — only shown when at least one
            accepted bullet still needs a real number filled in */}
        {flaggedBullets.length > 0 && (
          <div className="space-y-4 bg-[#6f1d1b]/10 border border-[#99582a]/30 p-5 rounded-xl mt-6">
            <div className="text-[#99582a] text-[13px] font-semibold">
              {flaggedBullets.length} of {bullets.length} bullets in use are flagged as needing a real metric
            </div>

            <div className="space-y-3">
              <h4 className="text-[#ffe6a7] font-bold text-sm">Before you copy</h4>
              <CustomCheckbox
                checked={checkbox1}
                onChange={handleCheckbox1Change}
                label="I have added a real number to every flagged bullet, or rejected the ones I can't quantify"
              />
              <CustomCheckbox
                checked={checkbox2}
                onChange={setCheckbox2}
                label="I understand that unverified or fabricated metrics can damage my credibility in interviews"
              />
            </div>
          </div>
        )}

        {/* Copy Resume and Reset Buttons */}
        <div className="flex flex-wrap items-center gap-4 pt-4">
          <button
            onClick={handleCopyBullets}
            disabled={!isCopyActive}
            className={`inline-flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-bold bg-[#bb9457] hover:bg-[#ffe6a7] text-[#432818] border border-transparent transition-all duration-200 ${
              isCopyActive
                ? "cursor-pointer"
                : "opacity-40 cursor-not-allowed pointer-events-none"
            }`}
          >
            Copy Resume
          </button>

          <button
            onClick={handleResetBullets}
            className="inline-flex items-center justify-center px-6 py-2.5 rounded-full text-sm font-bold border border-[#99582a] text-[#99582a] hover:text-[#ffe6a7] hover:border-[#ffe6a7] bg-transparent transition duration-200 cursor-pointer"
          >
            Reset to AI version
          </button>

          {copiedAll && (
            <span className="text-[#1a7a4a] text-sm font-bold animate-fadeIn">
              Copied with your choices ✓
            </span>
          )}
        </div>
      </div>

      <hr className="border-[#99582a]" />

      {/* 3. Collapsible 'What Changed' Section */}
      <div className="border border-[#99582a] rounded-xl overflow-hidden bg-[#6f1d1b]/20">
        <button
          onClick={() => setShowImprovements(!showImprovements)}
          className="w-full flex items-center justify-between p-5 font-bold text-[#ffe6a7] text-sm bg-[#432818] hover:bg-[#6f1d1b]/30 transition border-b border-[#99582a]"
        >
          <span>What Changed / Optimization Rules Applied</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            className={`w-4 h-4 text-[#bb9457] transition-transform duration-200 ${
              showImprovements ? "transform rotate-180" : ""
            }`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>

        {showImprovements && (
          <div className="p-5 bg-[#432818] border-t border-[#99582a] animate-fadeIn">
            {improvements_made.length > 0 ? (
              <ul className="space-y-3">
                {improvements_made.map((imp, idx) => (
                  <li key={idx} className="flex items-start space-x-2 text-sm text-[#ffe6a7]">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-4 h-4 text-[#bb9457] mt-0.5 flex-shrink-0"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{imp}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[#99582a] text-sm italic">No improvements log provided.</p>
            )}
          </div>
        )}
      </div>

      {/* 4. Collapsible Edit Summary Section */}
      <div className="pt-2">
        <button
          onClick={() => setShowEditSummary(!showEditSummary)}
          className="flex items-center space-x-1.5 text-[#99582a] hover:text-[#ffe6a7] text-xs font-semibold transition bg-transparent border-none p-0 cursor-pointer select-none"
        >
          <span>Edit Summary</span>
          <span className="text-[10px]">{showEditSummary ? "▲" : "▼"}</span>
        </button>
        {showEditSummary && (
          <div className="text-[#99582a] text-[13px] mt-2 font-medium bg-[#6f1d1b]/10 border border-[#99582a]/30 p-3 rounded-lg animate-fadeIn">
            {editedCount} of {bullets.length} bullets manually edited · {rejectedCount} kept as original
          </div>
        )}
      </div>
    </div>
  );
}