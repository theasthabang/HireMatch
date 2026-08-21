import React, { useState, useEffect, useRef } from "react";
import { exportResumeDocx } from "../../api/client";

function CustomCheckbox({ checked, onChange, label }) {
  return (
    <label className="flex items-start space-x-3 cursor-pointer select-none group text-sm text-[#0F172A] py-1">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <div className={`w-4 h-4 flex-shrink-0 border flex items-center justify-center transition-all duration-150 mt-0.5 ${
        checked ? "bg-[#0D9488] border-[#0D9488]" : "border-[#64748B] group-hover:border-[#0F172A]"
      }`}>
        {checked && <span className="text-white text-[10px] font-bold select-none">✓</span>}
      </div>
      <span className="leading-normal">{label}</span>
    </label>
  );
}

/**
 * BulletCard — redline/tracked-changes structure, not stacked before/after
 * labels. The original renders struck-through inline, flowing directly into
 * the rewrite on the same line — like an editor's markup on a real
 * document, rather than two separately-labeled blocks. Accept/reject is a
 * small text toggle, not a full pill button, matching the restrained
 * language used everywhere else in the app.
 */
function BulletCard({ bullet, onSave, onEditStart, onToggleAccepted }) {
  const [isEditing, setIsEditing] = useState(bullet.isEditing);
  const [text, setText] = useState(bullet.text);
  const textareaRef = useRef(null);

  useEffect(() => setText(bullet.text), [bullet.text]);
  useEffect(() => setIsEditing(bullet.isEditing), [bullet.isEditing]);
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, [isEditing]);

  const handleBlur = () => onSave(bullet.id, text);
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSave(bullet.id, text);
    }
  };

  return (
    <div className={`py-4 ${!bullet.accepted ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {bullet.isEdited && <span className="text-[10px] font-semibold text-[#0D9488] uppercase tracking-wide">Edited</span>}
        </div>
        <div className="flex items-center gap-3 text-[11px] font-medium">
          <button
            type="button"
            onClick={() => onToggleAccepted(bullet.id, true)}
            className={bullet.accepted ? "text-[#0D9488]" : "text-[#64748B] hover:text-[#0D9488]"}
          >
            Use rewrite
          </button>
          <button
            type="button"
            onClick={() => onToggleAccepted(bullet.id, false)}
            className={!bullet.accepted ? "text-[#2563EB]" : "text-[#64748B] hover:text-[#2563EB]"}
          >
            Keep original
          </button>
        </div>
      </div>

      <p className="text-[15px] leading-relaxed">
        <span className="text-[#64748B] line-through decoration-[#64748B]/60">{bullet.original}</span>
        <span className="text-[#64748B] mx-2">→</span>
        {isEditing ? (
          <span className="block mt-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              className="w-full min-h-[60px] bg-[#F8FAFC] border border-[#0F172A] text-[#0F172A] text-[15px] leading-relaxed p-2.5 resize-y outline-none"
            />
            <span className="text-[#64748B] text-[11px] select-none block mt-1">Press Enter to save · Shift+Enter for new line</span>
          </span>
        ) : (
          <span
            onClick={() => bullet.accepted && onEditStart(bullet.id)}
            className={`text-[#0F172A] font-medium ${bullet.accepted ? "cursor-text hover:bg-[#F1F5F9]" : ""}`}
          >
            {text}
          </span>
        )}
      </p>

      {bullet.metricNote && (
        <p className="text-[#0D9488] text-xs leading-relaxed mt-2 border-l-2 border-[#0D9488] pl-3">
          No metric found — {bullet.metricNote}
        </p>
      )}
    </div>
  );
}

export default function ResumeRewritePanel({ data, rewrite }) {
  const rewriteData = data || rewrite;
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [showImprovements, setShowImprovements] = useState(false);
  const [bullets, setBullets] = useState([]);
  const [checkbox1, setCheckbox1] = useState(false);
  const [checkbox2, setCheckbox2] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [showEditSummary, setShowEditSummary] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [exportFullName, setExportFullName] = useState("");
  const [exportContactLine, setExportContactLine] = useState("");
  const [showExportFields, setShowExportFields] = useState(false);

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

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
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-[#0F172A] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#64748B] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-semibold text-base text-[#0F172A]" style={serif}>Rewrite Recommendations Unavailable</span>
        </div>
        <p className="mt-2 text-[#64748B]">The rewrite recommendations are currently unavailable.</p>
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
    setBullets((prev) => prev.map((b) => (b.id === id ? { ...b, text: newText, isEdited: newText !== b.aiRewritten, isEditing: false } : b)));
  };

  const handleEditStart = (id) => {
    setBullets((prev) => prev.map((b) => (b.id === id ? { ...b, isEditing: true } : { ...b, isEditing: false })));
  };

  const handleToggleAccepted = (id, accepted) => {
    setBullets((prev) => prev.map((b) => (b.id === id ? { ...b, accepted, isEditing: false } : b)));
  };

  const handleCopyBullets = () => {
    const textToCopy = bullets.map((b) => (b.accepted ? b.text : b.original)).join("\n");
    navigator.clipboard.writeText(textToCopy);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleExportDocx = async () => {
    setExportError(null);
    setExportingDocx(true);
    try {
      // Exactly the same accepted-vs-original selection logic as
      // handleCopyBullets above, so "Copy resume" and "Download .docx"
      // always produce identical content — no separate export-only path
      // that could silently diverge from what the user reviewed.
      const bulletsToExport = bullets.map((b) => (b.accepted ? b.text : b.original));
      await exportResumeDocx({
        fullName: exportFullName.trim() || undefined,
        contactLine: exportContactLine.trim() || undefined,
        summary,
        bullets: bulletsToExport,
      });
    } catch (err) {
      setExportError(err.message || "Couldn't generate the resume document. Please try again.");
    } finally {
      setExportingDocx(false);
    }
  };

  const handleResetBullets = () => {
    if (window.confirm("Reset all bullets to the AI-generated version? Your edits and accept/reject choices will be lost.")) {
      setBullets((prev) => prev.map((b) => ({ ...b, text: b.aiRewritten, isEdited: false, isEditing: false, accepted: true })));
      setCheckbox1(false);
      setCheckbox2(false);
    }
  };

  const flaggedBullets = bullets.filter((b) => b.accepted && b.metricNote);
  const isCopyActive = flaggedBullets.length === 0 || (checkbox1 && checkbox2);
  const editedCount = bullets.filter((b) => b.isEdited).length;
  const rejectedCount = bullets.filter((b) => !b.accepted).length;

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 md:p-12 space-y-10 animate-fadeIn text-[#0F172A]">

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
          <h3 className="text-lg font-medium text-[#0F172A]" style={serif}>Optimized summary</h3>
          <button onClick={() => copySummaryToClipboard(summary)} className="text-xs font-semibold text-[#0F172A] hover:text-[#2563EB] transition">
            {copiedSummary ? "Copied!" : "Copy"}
          </button>
        </div>
        <blockquote className="border-l-2 border-[#0F172A] pl-5 text-[#0F172A] text-sm md:text-base leading-relaxed italic">
          "{summary || "No optimized summary generated."}"
        </blockquote>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2 border-b border-[#E2E8F0] pb-3">
          <h3 className="text-lg font-medium text-[#0F172A]" style={serif}>Optimized experience bullets</h3>
          {bullets.length > 0 && (
            <span className="text-[#64748B] text-xs" style={mono}>{bullets.length - rejectedCount} of {bullets.length} in use</span>
          )}
        </div>
        <p className="text-[#64748B] text-xs leading-relaxed pt-1">
          Struck-through text is your original — the rewrite follows the arrow. Click a rewrite to hand-edit it.
        </p>

        {bullets.length > 0 ? (
          <div className="divide-y divide-[#E2E8F0]">
            {bullets.map((bullet) => (
              <BulletCard key={bullet.id} bullet={bullet} onSave={handleSaveBullet} onEditStart={handleEditStart} onToggleAccepted={handleToggleAccepted} />
            ))}
          </div>
        ) : (
          <p className="text-[#64748B] text-sm italic py-4">No optimized bullets generated.</p>
        )}

        {flaggedBullets.length > 0 && (
          <div className="space-y-3 border-l-2 border-[#0D9488] pl-5 py-2 mt-6">
            <div className="text-[#0F172A] text-[13px] font-medium">
              {flaggedBullets.length} of {bullets.length} bullets in use are flagged as needing a real metric
            </div>
            <div className="space-y-2">
              <CustomCheckbox checked={checkbox1} onChange={setCheckbox1} label="I have added a real number to every flagged bullet, or rejected the ones I can't quantify" />
              <CustomCheckbox checked={checkbox2} onChange={setCheckbox2} label="I understand that unverified or fabricated metrics can damage my credibility in interviews" />
            </div>
          </div>
        )}

        <div className="border-t border-[#E2E8F0] pt-5">
          <button
            type="button"
            onClick={() => setShowExportFields((prev) => !prev)}
            className="text-[11px] font-medium text-[#64748B] hover:text-[#0F172A] transition"
          >
            {showExportFields ? "Hide" : exportFullName || exportContactLine ? "Edit" : "Add"} name & contact info for the downloaded document
          </button>
          {showExportFields && (
            <div className="mt-3 space-y-2.5 max-w-md animate-fadeIn">
              <p className="text-[#64748B] text-[11px] leading-relaxed">
                Optional — shown at the top of the exported .docx only. Nothing here is used anywhere else in the app.
              </p>
              <input
                type="text"
                value={exportFullName}
                onChange={(e) => setExportFullName(e.target.value)}
                placeholder="Full name (e.g. Astha Sharma)"
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-[13px] px-3 py-2 outline-none placeholder:text-[#64748B]/60"
              />
              <input
                type="text"
                value={exportContactLine}
                onChange={(e) => setExportContactLine(e.target.value)}
                placeholder="Email · Phone · Location (e.g. astha@email.com · +91-9876543210 · Bengaluru)"
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-[13px] px-3 py-2 outline-none placeholder:text-[#64748B]/60"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-5 pt-5">
          <button
            onClick={handleCopyBullets}
            disabled={!isCopyActive}
            className={`text-sm font-semibold transition ${isCopyActive ? "text-[#0F172A] hover:text-[#2563EB] cursor-pointer" : "text-[#64748B]/40 cursor-not-allowed"}`}
          >
            Copy resume →
          </button>
          <button
            onClick={handleExportDocx}
            disabled={!isCopyActive || exportingDocx}
            className={`text-sm font-semibold transition ${isCopyActive && !exportingDocx ? "text-[#0F172A] hover:text-[#2563EB] cursor-pointer" : "text-[#64748B]/40 cursor-not-allowed"}`}
          >
            {exportingDocx ? "Preparing document…" : "Download as .docx →"}
          </button>
          <button onClick={handleResetBullets} className="text-sm font-medium text-[#64748B] hover:text-[#0F172A] transition">
            Reset to AI version
          </button>
          {copiedAll && <span className="text-[#0D9488] text-sm font-medium animate-fadeIn">Copied with your choices ✓</span>}
        </div>
        {exportError && (
          <p className="text-[#2563EB] text-xs font-medium pt-1">{exportError}</p>
        )}
      </div>

      <div className="border-t border-[#E2E8F0] pt-6">
        <button onClick={() => setShowImprovements(!showImprovements)} className="w-full flex items-center justify-between text-left">
          <span className="text-sm font-semibold text-[#0F172A]">What changed / optimization rules applied</span>
          <span className="text-[#64748B] text-xs">{showImprovements ? "Hide" : "Show"}</span>
        </button>

        {showImprovements && (
          <div className="pt-4 animate-fadeIn">
            {improvements_made.length > 0 ? (
              <ul className="space-y-2.5">
                {improvements_made.map((imp, idx) => (
                  <li key={idx} className="flex items-start gap-2.5 text-sm text-[#0F172A]">
                    <span className="text-[#0D9488] mt-0.5 flex-shrink-0">+</span>
                    <span>{imp}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[#64748B] text-sm italic">No improvements log provided.</p>
            )}
          </div>
        )}
      </div>

      <div className="pt-1">
        <button onClick={() => setShowEditSummary(!showEditSummary)} className="flex items-center gap-1.5 text-[#64748B] hover:text-[#0F172A] text-xs font-medium transition">
          <span>Edit summary</span>
          <span className="text-[10px]">{showEditSummary ? "▲" : "▼"}</span>
        </button>
        {showEditSummary && (
          <p className="text-[#64748B] text-[13px] mt-2 animate-fadeIn" style={mono}>
            {editedCount} of {bullets.length} bullets manually edited · {rejectedCount} kept as original
          </p>
        )}
      </div>
    </div>
  );
}