import React, { useState, useEffect } from "react";
import { askAboutScore } from "../../api/client";
import FeedbackButtons from "../FeedbackButtons";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../../utils/storage";

// NOTE: These are hand-authored, illustrative reference points — not derived
// from real applicant score data. They exist to give the score a visual
// sense of scale (avg/strong/top-10%), not to make a factual claim about
// where this candidate actually ranks among real applicants. The UI copy
// that reads this (see the "Resume vs Peers" section below) is written to
// disclose that explicitly — if you change this data, keep that disclosure
// intact rather than presenting it as a measured statistic.
const ROLE_BENCHMARKS = {
  "Frontend": { p25: 48, p50: 64, p75: 76, p90: 85 },
  "Backend": { p25: 50, p50: 66, p75: 78, p90: 87 },
  "Full Stack": { p25: 52, p50: 68, p75: 79, p90: 87 },
  "AI/ML": { p25: 45, p50: 62, p75: 76, p90: 86 },
  "Data": { p25: 47, p50: 63, p75: 75, p90: 84 },
  "DevOps": { p25: 49, p50: 65, p75: 77, p90: 86 },
  "Cybersecurity": { p25: 44, p50: 60, p75: 74, p90: 83 },
  "Product": { p25: 46, p50: 63, p75: 76, p90: 85 },
  "Other": { p25: 45, p50: 62, p75: 75, p90: 84 }
};

const detectRoleCategory = (matchedKeywords = [], verdict = "") => {
  const keywordsStr = (matchedKeywords || []).join(" ").toLowerCase();
  const verdictStr = (verdict || "").toLowerCase();
  const searchStr = `${keywordsStr} ${verdictStr}`;

  const frontendSignals = ["react", "vue", "angular", "css", "html", "tailwind", "figma", "webpack", "nextjs"];
  const backendSignals = ["fastapi", "django", "node", "express", "spring", "postgresql", "mysql", "redis", "api"];
  const aimlSignals = ["tensorflow", "pytorch", "langchain", "llm", "machine learning", "neural", "model training", "huggingface"];
  const dataSignals = ["sql", "pandas", "spark", "tableau", "powerbi", "bigquery", "etl", "data pipeline", "jupyter"];
  const devopsSignals = ["docker", "kubernetes", "ci/cd", "terraform", "aws", "gcp", "azure", "jenkins", "ansible"];
  const cyberSignals = ["penetration", "firewall", "siem", "vulnerability", "owasp", "encryption", "security audit"];
  const productSignals = ["roadmap", "stakeholder", "agile", "scrum", "product manager", "jira", "okr", "user research"];

  const hasFrontend = frontendSignals.some(sig => searchStr.includes(sig));
  const hasBackend = backendSignals.some(sig => searchStr.includes(sig));
  const hasAIML = aimlSignals.some(sig => searchStr.includes(sig));
  const hasData = dataSignals.some(sig => searchStr.includes(sig));
  const hasDevOps = devopsSignals.some(sig => searchStr.includes(sig));
  const hasCyber = cyberSignals.some(sig => searchStr.includes(sig));
  const hasProduct = productSignals.some(sig => searchStr.includes(sig));

  if (hasFrontend && hasBackend) return "Full Stack";
  if (hasFrontend) return "Frontend";
  if (hasBackend) return "Backend";
  if (hasAIML) return "AI/ML";
  if (hasData) return "Data";
  if (hasDevOps) return "DevOps";
  if (hasCyber) return "Cybersecurity";
  if (hasProduct) return "Product";
  return "Other";
};

const calculatePercentile = (score, benchmarks) => {
  const { p25, p50, p75, p90 } = benchmarks;
  let pct = 0;
  if (score < p25) {
    pct = (score / p25) * 25;
  } else if (score < p50) {
    pct = 25 + ((score - p25) / (p50 - p25)) * 25;
  } else if (score < p75) {
    pct = 50 + ((score - p50) / (p75 - p50)) * 25;
  } else if (score < p90) {
    pct = 75 + ((score - p75) / (p90 - p75)) * 15;
  } else {
    pct = 90 + ((score - p90) / (100 - p90)) * 9;
  }
  return Math.min(99, Math.max(0, Math.round(pct)));
};

/**
 * ATSScorePanel — "graded exam paper" design system.
 * Tokens: Paper #F8FAFC, Ink #0F172A, Graphite #64748B, Primary Blue #2563EB
 * (the ONE accent), Hairline #E2E8F0. Display: Fraunces. Body: Inter.
 * Data/rule IDs: IBM Plex Mono.
 *
 * Signature moment: the score renders as an oversized serif numeral with a
 * hand-drawn red circle drawn around it on load — a grade circled in red
 * pen, since that's literally what this feature does. No progress-ring
 * gauge, no confetti — the circle-draw is the restrained celebratory beat.
 */
export default function ATSScorePanel({ data, resumeText, onResumeUpdate, onReAnalyze, previousScore, scoreDelta, jdAlignment }) {
  const [displayScore, setDisplayScore] = useState(0);
  const [markerPosition, setMarkerPosition] = useState(0);
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);

  const [showEditResume, setShowEditResume] = useState(false);
  const [editedResumeText, setEditedResumeText] = useState(resumeText || "");
  const [reAnalyzing, setReAnalyzing] = useState(false);

  // Keep the edit box in sync if resumeText changes from outside this panel
  // (a fresh upload, or a re-analysis completing and updating Dashboard's
  // resumeText state) — without this, editing here after either of those
  // events would silently operate on stale text.
  useEffect(() => {
    setEditedResumeText(resumeText || "");
  }, [resumeText]);

  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);

  const [explainerDismissed, setExplainerDismissed] = useState(() =>
    loadJSON(STORAGE_KEYS.ATS_EXPLAINER_DISMISSED, false)
  );
  const dismissExplainer = () => {
    setExplainerDismissed(true);
    saveJSON(STORAGE_KEYS.ATS_EXPLAINER_DISMISSED, true);
  };

  const MIN_RESUME_LENGTH = 100; // matches the backend's own /reanalyze validation, checked client-side for instant feedback instead of a round-trip 422

  const handleEditedTextChange = (val) => {
    setEditedResumeText(val);
    if (onResumeUpdate) onResumeUpdate(val); // live-sync into Dashboard's resumeText state as the user types
  };

  const handleReAnalyzeClick = async () => {
    if (!onReAnalyze) return; // defensive — this panel can be rendered without these callbacks in other contexts
    setReAnalyzing(true);
    try {
      await onReAnalyze(editedResumeText);
      // Dashboard's handleReAnalyze already manages its own toast/error
      // alert — this local state is only for disabling the button/showing
      // a spinner right here while the request is in flight.
    } finally {
      setReAnalyzing(false);
    }
  };

  const canReAnalyze =
    !!onReAnalyze &&
    !reAnalyzing &&
    editedResumeText.trim().length >= MIN_RESUME_LENGTH &&
    editedResumeText.trim() !== (resumeText || "").trim();

  if (!data) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-[#0F172A] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#64748B] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-semibold text-base text-[#0F172A]" style={{ fontFamily: "'Fraunces', serif" }}>
            ATS Analysis Unavailable
          </span>
        </div>
        <p className="mt-2 text-[#64748B]">The ATS compatibility analysis is currently unavailable.</p>
      </div>
    );
  }

  const {
    score = 0,
    matched_keywords = [],
    missing_keywords = [],
    verdict = "",
    improvement_tips = [],
    rule_scores = null,
    calibration_notes = [],
    confidence = null,
    confidence_reason = null,
  } = data;

  const ruleBreakdown = rule_scores
    ? Object.entries(rule_scores)
        .map(([ruleId, r]) => ({
          id: ruleId,
          name: r.rule_name || ruleId,
          awarded: typeof r.points_awarded === "number" ? r.points_awarded : 0,
          max: typeof r.max_points === "number" ? r.max_points : 0,
          reason: r.reason || "",
          lost: typeof r.points_lost === "number" ? r.points_lost : Math.max(0, (r.max_points || 0) - (r.points_awarded || 0)),
        }))
        .sort((a, b) => b.lost - a.lost)
    : [];

  const confidenceStyles = {
    high: { label: "High Confidence", color: "text-[#0D9488]", bg: "bg-[#0D9488]/5", border: "border-[#0D9488]/40" },
    medium: { label: "Medium Confidence", color: "text-[#64748B]", bg: "bg-transparent", border: "border-[#64748B]/40" },
    low: { label: "Low Confidence", color: "text-[#2563EB]", bg: "bg-[#2563EB]/5", border: "border-[#2563EB]/40" },
  };
  const confidenceStyle = confidence ? confidenceStyles[confidence] : null;

  useEffect(() => {
    let current = 0;
    const intervalTime = 20;
    const increment = 2;
    if (score > 0) {
      const timer = setInterval(() => {
        current += increment;
        if (current >= score) {
          setDisplayScore(score);
          clearInterval(timer);
        } else {
          setDisplayScore(current);
        }
      }, intervalTime);
      return () => clearInterval(timer);
    } else {
      setDisplayScore(0);
    }
  }, [score]);

  useEffect(() => {
    const timer = setTimeout(() => setMarkerPosition(score), 100);
    return () => clearTimeout(timer);
  }, [score]);

  const roleCategory = detectRoleCategory(matched_keywords, verdict);
  const benchmarks = ROLE_BENCHMARKS[roleCategory];
  const percentile = calculatePercentile(score, benchmarks);

  let adviceText = "";
  if (score < benchmarks.p50) {
    adviceText = "Focus on adding more role-specific keywords and quantified achievements.";
  } else if (score < benchmarks.p75) {
    adviceText = "You are competitive. Fix section headings and add missing technical skills to break into the top 25%.";
  } else if (score < benchmarks.p90) {
    adviceText = "Strong resume. A tailored summary per JD will push you to top 10%.";
  } else {
    adviceText = "Excellent. Focus on interview prep — your resume will get you the call.";
  }

  const handleAskQuestion = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;
    setChatLoading(true);
    setChatError(null);
    setChatInput("");
    try {
      const answer = await askAboutScore(data, question, resumeText, chatMessages);
      setChatMessages((prev) => [...prev, { question, answer }]);
    } catch (err) {
      setChatError(err.message || "Couldn't get an answer right now. Please try again.");
      setChatInput(question);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAskQuestion();
    }
  };

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 md:p-12 space-y-12 animate-fadeIn text-[#0F172A]">

      <div className="flex flex-col md:flex-row items-start gap-10 md:gap-16">
        <div className="relative flex-shrink-0 w-[180px] h-[180px] mx-auto md:mx-0">
          <div
            className="absolute inset-0 rounded-full blur-2xl opacity-[0.15]"
            style={{ background: score >= 70 ? "#0D9488" : "#2563EB" }}
          />
          <svg viewBox="0 0 180 180" className="absolute inset-0 w-full h-full overflow-visible">
            <ellipse cx="90" cy="90" rx="82" ry="72" fill="none" stroke="#2563EB" strokeWidth="4" strokeLinecap="round" transform="rotate(-4 90 90)" strokeDasharray="1000" className="animate-drawCircle" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[64px] leading-none font-medium text-[#0F172A]" style={serif}>{displayScore}</span>
            <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-[0.15em] mt-1">out of 100</span>
          </div>
        </div>

        <div className="flex-grow space-y-4 w-full">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-2xl font-medium text-[#0F172A]" style={serif}>Your ATS Score</h3>
            {confidenceStyle && (
              <span title={confidence_reason || ""} className={`px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide rounded-sm border ${confidenceStyle.border} ${confidenceStyle.bg} ${confidenceStyle.color} cursor-help`}>
                {confidenceStyle.label}
              </span>
            )}
            {typeof scoreDelta === "number" && typeof previousScore === "number" && (
              <span className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-sm border ${scoreDelta > 0 ? "border-[#0D9488]/40 text-[#0D9488]" : scoreDelta < 0 ? "border-[#2563EB]/40 text-[#2563EB]" : "border-[#E2E8F0] text-[#64748B]"}`} style={mono}>
                {scoreDelta > 0 ? "↑" : scoreDelta < 0 ? "↓" : "="} {previousScore} → {score}
                {scoreDelta !== 0 && ` (${scoreDelta > 0 ? "+" : ""}${scoreDelta})`}
              </span>
            )}
          </div>
          <p className="text-[#64748B] text-sm leading-relaxed max-w-lg">
            Scored against 11 explicit rules — keyword match, section headings, quantified achievements, and more.
          </p>
          <p className="text-[#64748B] text-xs leading-relaxed max-w-lg">
            Worth knowing: most real ATS platforms (Workday, Greenhouse, iCIMS, etc.) don't compute or show a
            pass/fail match score at all — they're primarily searchable databases, and only a small share of
            recruiters have any automatic content-based rejection configured. Treat this score as practice
            feedback on resume-parsing hygiene and the kind of fast scan a real recruiter does, not a guarantee
            about how any specific company's system will treat your resume.
          </p>
          {confidenceStyle && confidence_reason && (
            <p className={`text-xs leading-relaxed max-w-lg ${confidence === "low" ? "text-[#2563EB]" : "text-[#64748B]"}`}>
              {confidence === "low" ? "⚠ " : ""}{confidence_reason}
            </p>
          )}
          <div className="pt-1">
            <FeedbackButtons feature="ats_overall" itemId="overall" context={{ score, verdict }} />
          </div>
        </div>
      </div>

      {onReAnalyze && (
        <div className="border-t border-[#E2E8F0] pt-5">
          <button
            type="button"
            onClick={() => setShowEditResume((prev) => !prev)}
            className="text-[13px] font-medium text-[#0F172A] hover:text-[#2563EB] transition"
          >
            {showEditResume ? "Hide" : "Edit resume text & re-score"} {showEditResume ? "▲" : "▼"}
          </button>
          {showEditResume && (
            <div className="mt-3 space-y-3 animate-fadeIn">
              <p className="text-[#64748B] text-xs leading-relaxed">
                Made a change based on the feedback above? Edit the extracted text directly and re-run the full
                analysis — this calls the same scoring pipeline again on the updated text.
              </p>
              <textarea
                value={editedResumeText}
                onChange={(e) => handleEditedTextChange(e.target.value)}
                disabled={reAnalyzing}
                rows={10}
                className="w-full bg-[#F8FAFC] border border-[#E2E8F0] focus:border-[#0F172A] rounded-sm text-[#0F172A] text-[13px] leading-relaxed p-3 resize-y outline-none font-mono"
              />
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={handleReAnalyzeClick}
                  disabled={!canReAnalyze}
                  className={`text-sm font-semibold transition ${canReAnalyze ? "text-[#0F172A] hover:text-[#2563EB] cursor-pointer" : "text-[#64748B]/40 cursor-not-allowed"}`}
                >
                  {reAnalyzing ? "Re-scoring…" : "Re-score with these changes →"}
                </button>
                {editedResumeText.trim().length > 0 && editedResumeText.trim().length < MIN_RESUME_LENGTH && (
                  <span className="text-[#2563EB] text-xs">Needs at least {MIN_RESUME_LENGTH} characters ({editedResumeText.trim().length} now)</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {!explainerDismissed && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-sm p-6 animate-fadeIn">
          <div className="flex justify-between items-baseline text-xs mb-2">
            <span className="text-[#64748B] font-semibold uppercase tracking-wide">Resume vs Peers</span>
            <div className="flex items-center gap-3">
              <span className="text-[#64748B]" style={mono}>{roleCategory} applicants · estimate</span>
              <button onClick={dismissExplainer} className="text-[#64748B] hover:text-[#0F172A] text-xs font-semibold flex-shrink-0 transition">Got it ✕</button>
            </div>
          </div>
          <h4 className="text-[#0F172A] text-base font-medium mb-1" style={serif}>
            Estimated to be better than {percentile}% of {roleCategory} applicants
          </h4>
          <p className="text-[#64748B] text-[11px] leading-relaxed mb-6">
            An illustrative estimate based on your score and typical {roleCategory} score ranges — not measured against
            real applicant data, so treat it as a rough guide rather than a statistic.
          </p>

          <div className="relative w-full h-10 mb-2">
            <div style={{ left: `${benchmarks.p50}%` }} className="absolute top-0 -translate-x-1/2 flex flex-col items-center">
              <div className="w-px h-2 bg-[#64748B]" />
              <span className="text-[10px] text-[#64748B] mt-2 whitespace-nowrap select-none" style={mono}>Avg {benchmarks.p50}</span>
            </div>
            <div style={{ left: `${benchmarks.p75}%` }} className="absolute top-0 -translate-x-1/2 flex flex-col items-center">
              <div className="w-px h-2 bg-[#64748B]" />
              <span className="text-[10px] text-[#64748B] mt-2 whitespace-nowrap select-none" style={mono}>Strong {benchmarks.p75}</span>
            </div>
            <div style={{ left: `${benchmarks.p90}%` }} className="absolute top-0 -translate-x-1/2 flex flex-col items-center">
              <div className="w-px h-2 bg-[#64748B]" />
              <span className="text-[10px] text-[#64748B] mt-2 whitespace-nowrap select-none" style={mono}>Top 10% {benchmarks.p90}</span>
            </div>

            <div className="absolute top-[2px] left-0 w-full h-[3px] bg-[#F1F5F9]" />

            <div style={{ left: `${markerPosition}%`, transition: "left 1.2s cubic-bezier(0.25, 0.8, 0.25, 1)" }} className="absolute top-[-14px] -translate-x-1/2 flex flex-col items-center pointer-events-none">
              <span className="text-[10px] font-semibold text-[#2563EB] mb-1">You</span>
              <div className="w-2 h-2 rounded-full bg-[#2563EB]" />
            </div>
          </div>

          <p className="text-xs text-[#64748B] leading-relaxed mt-3">{adviceText}</p>
        </div>
      )}

      {jdAlignment && (
        <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-sm p-6 animate-fadeIn">
          <div className="flex justify-between items-baseline text-xs mb-2">
            <span className="text-[#64748B] font-semibold uppercase tracking-wide">Target Job Alignment</span>
            <span className="text-[#64748B]" style={mono}>deterministic · embedding similarity</span>
          </div>
          <h4 className="text-[#0F172A] text-base font-medium mb-1" style={serif}>
            {jdAlignment.alignment_pct}% semantic alignment with your pasted job description
          </h4>
          <p className="text-[#64748B] text-[11px] leading-relaxed mb-4">
            Computed via embedding similarity between your resume and the job description — deterministic, not an
            LLM's subjective read. Not a score any real employer's ATS would show you; treat it as a self-check.
          </p>

          {(jdAlignment.matched_requirements?.length > 0 || jdAlignment.missing_requirements?.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-[#E2E8F0] pt-4">
              <div>
                <div className="text-[10px] font-semibold text-[#0D9488] uppercase tracking-wide mb-2">
                  Matched ({jdAlignment.matched_requirements?.length || 0})
                </div>
                {(jdAlignment.matched_requirements || []).map((req, i) => (
                  <div key={i} className="text-xs text-[#0F172A] py-1"><span className="text-[#0D9488] mr-1.5">+</span>{req}</div>
                ))}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#2563EB] uppercase tracking-wide mb-2">
                  Missing ({jdAlignment.missing_requirements?.length || 0})
                </div>
                {(jdAlignment.missing_requirements || []).map((req, i) => (
                  <div key={i} className="text-xs text-[#64748B] py-1"><span className="text-[#2563EB] mr-1.5">−</span>{req}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {calibration_notes && calibration_notes.length > 0 && (
        <div className="space-y-3">
          {calibration_notes.map((note, i) => {
            const isWarning = note.severity === "warning";
            return (
              <div key={i} className={`border-l-2 pl-5 pr-5 py-4 text-sm leading-relaxed ${isWarning ? "bg-[#2563EB]/[0.04] border-[#2563EB] text-[#0F172A]" : "bg-[#0F172A]/[0.02] border-[#E2E8F0] text-[#64748B]"}`}>
                <span className={`font-semibold mr-1 ${isWarning ? "text-[#2563EB]" : "text-[#64748B]"}`}>{isWarning ? "Note —" : "Info —"}</span>
                {note.message}
              </div>
            );
          })}
        </div>
      )}

      {ruleBreakdown.length > 0 && (
        <div className="space-y-5">
          <button type="button" onClick={() => setBreakdownExpanded((prev) => !prev)} className="w-full flex items-center justify-between gap-3 text-left border-b border-[#E2E8F0] pb-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <h4 className="text-lg font-medium text-[#0F172A]" style={serif}>Why This Score?</h4>
              <span className="text-[#64748B] text-xs" style={mono}>{ruleBreakdown.length} rules, sorted by biggest loss</span>
            </div>
            <span className="text-[#0F172A] text-sm font-semibold select-none flex-shrink-0">{breakdownExpanded ? "Hide" : "Show"}</span>
          </button>

          {breakdownExpanded && (
            <div className="divide-y divide-[#E2E8F0]">
              {ruleBreakdown.map((rule) => {
                const pct = rule.max > 0 ? Math.round((rule.awarded / rule.max) * 100) : 0;
                let markColor = "#0F172A";
                if (rule.awarded <= 0) markColor = "#2563EB";
                else if (rule.awarded < rule.max) markColor = "#64748B";
                return (
                  <div key={rule.id} className="py-4 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 items-baseline">
                    <span className="font-medium text-[#0F172A] text-sm">{rule.name}</span>
                    <span className="text-sm font-semibold flex-shrink-0" style={{ ...mono, color: markColor }}>
                      {rule.awarded}/{rule.max}
                      {rule.lost > 0 && <span className="text-[#2563EB] ml-1.5">−{rule.lost}</span>}
                    </span>
                    <div className="col-span-2 w-full bg-[#F1F5F9] h-[3px] overflow-hidden">
                      <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: markColor }} />
                    </div>
                    {rule.reason && <p className="col-span-2 text-[#64748B] text-xs leading-relaxed max-w-2xl">{rule.reason}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
        <div className="space-y-3">
          <h4 className="font-semibold text-[#0D9488] text-sm uppercase tracking-wide">Matched ({matched_keywords.length})</h4>
          {matched_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {matched_keywords.map((kw, i) => (
                <span key={i} className="text-sm text-[#0D9488]" style={mono}>{kw}{i < matched_keywords.length - 1 ? "," : ""}</span>
              ))}
            </div>
          ) : (
            <p className="text-[#64748B] text-xs italic">No matched keywords found.</p>
          )}
        </div>

        <div className="space-y-3">
          <h4 className="font-semibold text-[#2563EB] text-sm uppercase tracking-wide">Missing ({missing_keywords.length})</h4>
          {missing_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {missing_keywords.map((kw, i) => (
                <span key={i} className="text-sm text-[#64748B]" style={mono}>{kw}{i < missing_keywords.length - 1 ? "," : ""}</span>
              ))}
            </div>
          ) : (
            <p className="text-[#64748B] text-xs italic">No critical missing keywords.</p>
          )}
        </div>
      </div>

      {improvement_tips && improvement_tips.length > 0 && (
        <div className="space-y-5">
          <h4 className="text-lg font-medium text-[#0F172A] border-b border-[#E2E8F0] pb-3" style={serif}>Your Action Plan</h4>
          <div className="space-y-5">
            {improvement_tips.map((tip, idx) => (
              <div key={idx} className="flex items-start gap-4">
                <span className="text-sm font-semibold text-[#2563EB] flex-shrink-0 pt-0.5" style={mono}>{String(idx + 1).padStart(2, "0")}</span>
                <div className="flex-1 space-y-2">
                  <p className="text-[#0F172A] text-sm leading-relaxed">{tip}</p>
                  <FeedbackButtons feature="ats_tip" itemId={`tip_${idx}`} context={{ tip_text: tip }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-5">
        <h4 className="text-lg font-medium text-[#0F172A] border-b border-[#E2E8F0] pb-3" style={serif}>Ask About My Score</h4>
        <p className="text-[#64748B] text-sm -mt-2">Have a question about a specific rule or why your score is what it is? Ask directly.</p>

        {chatMessages.length > 0 && (
          <div className="space-y-4 max-h-[360px] overflow-y-auto pr-1">
            {chatMessages.map((msg, i) => (
              <div key={i} className="space-y-2">
                <div className="flex justify-end">
                  <div className="bg-[#0F172A] text-white text-sm px-4 py-2 max-w-[85%] rounded-sm">{msg.question}</div>
                </div>
                <div className="flex justify-start">
                  <div className="border border-[#E2E8F0] text-[#0F172A] text-sm leading-relaxed px-4 py-2.5 max-w-[85%] rounded-sm">{msg.answer}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {chatLoading && (
          <div className="flex justify-start">
            <div className="border border-[#E2E8F0] text-[#64748B] text-sm px-4 py-2.5 flex items-center gap-1.5 rounded-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[#64748B] animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#64748B] animate-pulse" style={{ animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#64748B] animate-pulse" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        )}

        {chatError && <p className="text-[#2563EB] text-xs font-semibold">{chatError}</p>}

        <div className="flex items-end gap-3 border-t border-[#E2E8F0] pt-4">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            disabled={chatLoading}
            placeholder="e.g. Why didn't my AWS badge count as a certification?"
            rows={1}
            className="flex-1 bg-transparent border-0 border-b border-[#E2E8F0] focus:border-[#0F172A] text-[#0F172A] text-sm py-2 resize-none outline-none placeholder:text-[#64748B]/60 transition-colors"
          />
          <button
            onClick={handleAskQuestion}
            disabled={chatLoading || !chatInput.trim()}
            className={`text-sm font-semibold pb-2 transition ${chatLoading || !chatInput.trim() ? "text-[#64748B]/40 cursor-not-allowed" : "text-[#0F172A] hover:text-[#2563EB] cursor-pointer"}`}
          >
            Ask →
          </button>
        </div>
      </div>
    </div>
  );
}