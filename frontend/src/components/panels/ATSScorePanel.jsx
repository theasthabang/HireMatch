import React, { useState, useEffect } from "react";
import { askAboutScore } from "../../api/client";
import FeedbackButtons from "../FeedbackButtons";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../../utils/storage";

// Static Benchmark Data Percentiles
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

// Pure function to classify candidate's role category
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

// Interpolates score based on percentile brackets
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
 * ATSScorePanel redesigned with card backgrounds set to #432818,
 * borders to #99582a, padding 24px, and customized SVG score ring.
 * Now features animated counter, glow, and vanilla confetti above score 80.
 * Includes a premium "Resume vs Peers" benchmark comparisons component.
 */
export default function ATSScorePanel({ data, resumeText, previousScore, scoreDelta }) {
  const [displayScore, setDisplayScore] = useState(0);
  const [markerPosition, setMarkerPosition] = useState(0);
  const [breakdownExpanded, setBreakdownExpanded] = useState(true);

  // "Ask about my score" follow-up chat — stateless on the backend, so the
  // running history lives here and gets resent with each new question.
  const [chatMessages, setChatMessages] = useState([]); // [{question, answer}]
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState(null);

  // First-time onboarding explainer — dismissed once, remembered across
  // sessions via localStorage so it doesn't nag returning users.
  const [explainerDismissed, setExplainerDismissed] = useState(() =>
    loadJSON(STORAGE_KEYS.ATS_EXPLAINER_DISMISSED, false)
  );
  const dismissExplainer = () => {
    setExplainerDismissed(true);
    saveJSON(STORAGE_KEYS.ATS_EXPLAINER_DISMISSED, true);
  };

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
          <span className="font-bold text-base text-[#ffe6a7]">ATS Analysis Unavailable</span>
        </div>
        <p className="mt-2 text-[#bb9457]">
          The ATS compatibility analysis is currently unavailable.
        </p>
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

  // rule_scores comes back as an object keyed by rule id (rule1..ruleN), each
  // enriched server-side with rule_name and points_lost. Convert to a sorted
  // array once: biggest point loss first, so the highest-impact fixes are
  // the first thing the user sees.
  const ruleBreakdown = rule_scores
    ? Object.entries(rule_scores)
        .map(([ruleId, r]) => ({
          id: ruleId,
          name: r.rule_name || ruleId,
          awarded: typeof r.points_awarded === "number" ? r.points_awarded : 0,
          max: typeof r.max_points === "number" ? r.max_points : 0,
          reason: r.reason || "",
          lost:
            typeof r.points_lost === "number"
              ? r.points_lost
              : Math.max(0, (r.max_points || 0) - (r.points_awarded || 0)),
        }))
        .sort((a, b) => b.lost - a.lost)
    : [];

  const confidenceStyles = {
    high: { label: "High Confidence", color: "text-[#1a7a4a]", bg: "bg-[#1a7a4a]/10", border: "border-[#1a7a4a]/30" },
    medium: { label: "Medium Confidence", color: "text-[#bb9457]", bg: "bg-[#bb9457]/10", border: "border-[#bb9457]/30" },
    low: { label: "Low Confidence", color: "text-[#c0392b]", bg: "bg-[#c0392b]/10", border: "border-[#c0392b]/30" },
  };
  const confidenceStyle = confidence ? confidenceStyles[confidence] : null;

  // SVG Circular Ring Configuration
  const radius = 70;
  const stroke = 8;
  const normalizedRadius = radius - stroke * 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (displayScore / 100) * circumference;

  const hasGlow = score > 80;

  // Vanilla JS Confetti Animation Trigger
  const triggerConfetti = () => {
    const styleId = "confetti-keyframes-style";
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement("style");
      styleEl.id = styleId;
      styleEl.innerHTML = `
        @keyframes fall {
          0% {
            transform: translateY(0) translateX(0) rotate(0deg);
            opacity: 1;
          }
          80% {
            opacity: 1;
          }
          100% {
            transform: translateY(105vh) translateX(var(--drift)) rotate(var(--rotate));
            opacity: 0;
          }
        }
      `;
      document.head.appendChild(styleEl);
    }

    const colors = ["#bb9457", "#ffe6a7", "#99582a", "#6f1d1b", "#ffffff"];

    for (let i = 0; i < 60; i++) {
      const conf = document.createElement("div");
      conf.style.width = "8px";
      conf.style.height = "8px";
      conf.style.borderRadius = "50%";
      conf.style.position = "fixed";
      conf.style.pointerEvents = "none";
      conf.style.zIndex = "9999";

      const color = colors[Math.floor(Math.random() * colors.length)];
      conf.style.backgroundColor = color;

      const xStart = Math.random() * 100; // vw
      conf.style.left = `${xStart}vw`;
      conf.style.top = "-10px";

      const duration = 2 + Math.random() * 2; // 2-4 seconds
      const drift = (Math.random() - 0.5) * 200; // ±100px drift

      conf.style.setProperty("--drift", `${drift}px`);
      conf.style.setProperty("--rotate", `${Math.random() * 360}deg`);
      conf.style.animation = `fall ${duration}s linear forwards`;

      document.body.appendChild(conf);

      setTimeout(() => {
        if (conf && conf.parentNode) {
          conf.parentNode.removeChild(conf);
        }
      }, duration * 1000 + 100);
    }
  };

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

      if (score > 80) {
        triggerConfetti();
      }

      return () => clearInterval(timer);
    } else {
      setDisplayScore(0);
    }
  }, [score]);

  // Marker sliding animation effect
  useEffect(() => {
    const timer = setTimeout(() => {
      setMarkerPosition(score);
    }, 100);
    return () => clearTimeout(timer);
  }, [score]);

  // Compute Benchmark Details
  const roleCategory = detectRoleCategory(matched_keywords, verdict);
  const benchmarks = ROLE_BENCHMARKS[roleCategory];
  const percentile = calculatePercentile(score, benchmarks);

  // Compute Advice Text and styling based on Score Brackets
  let adviceText = "";
  let adviceColor = "";
  if (score < benchmarks.p50) {
    adviceText = "Focus on adding more role-specific keywords and quantified achievements.";
    adviceColor = "text-[#c0392b]";
  } else if (score < benchmarks.p75) {
    adviceText = "You are competitive. Fix section headings and add missing technical skills to break into the top 25%.";
    adviceColor = "text-[#bb9457]";
  } else if (score < benchmarks.p90) {
    adviceText = "Strong resume. A tailored summary per JD will push you to top 10%.";
    adviceColor = "text-[#1a7a4a]";
  } else {
    adviceText = "Excellent. Focus on interview prep — your resume will get you the call.";
    adviceColor = "text-[#ffe6a7]";
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
      setChatInput(question); // give the question back so the user doesn't retype it
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

  return (
    <div className="bg-[#432818] border border-[#99582a] rounded-[16px] p-6 shadow-2xl space-y-6 animate-fadeIn text-[#ffe6a7]">
      <div className="flex flex-col md:flex-row items-center md:items-start gap-6">

        {/* Large Circular SVG Progress Ring */}
        <div className="relative flex-shrink-0 flex items-center justify-center w-36 h-36">
          <svg
            height={radius * 2}
            width={radius * 2}
            className="transform -rotate-90"
            style={hasGlow ? { filter: "drop-shadow(0 0 8px #bb9457)" } : undefined}
          >
            <circle
              stroke="#6f1d1b"
              fill="transparent"
              strokeWidth={stroke}
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
            <circle
              stroke="#bb9457"
              fill="transparent"
              strokeWidth={stroke}
              strokeDasharray={circumference + " " + circumference}
              style={{
                strokeDashoffset,
                transition: "stroke-dashoffset 1.5s ease-out",
                willChange: "transform",
              }}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-[#ffe6a7]">{displayScore}%</span>
            <span className="text-[10px] font-bold text-[#bb9457] uppercase tracking-wider">
              ATS Fit
            </span>
          </div>
        </div>

        {/* Header content */}
        <div className="flex-grow text-center md:text-left space-y-2">
          <div className="flex flex-col sm:flex-row items-center justify-center md:justify-start gap-3">
            <h3 className="text-xl font-bold text-[#ffe6a7]">ATS Score & Keyword Breakdown</h3>
            <span className="px-3 py-0.5 text-xs font-bold rounded-full border border-[#99582a] bg-[#6f1d1b] text-[#ffe6a7]">
              Audit Result
            </span>
            {confidenceStyle && (
              <span
                title={confidence_reason || ""}
                className={`px-3 py-0.5 text-xs font-bold rounded-full border ${confidenceStyle.border} ${confidenceStyle.bg} ${confidenceStyle.color} cursor-help`}
              >
                {confidenceStyle.label}
              </span>
            )}
            {typeof scoreDelta === "number" && typeof previousScore === "number" && (
              <span
                className={`px-3 py-0.5 text-xs font-bold rounded-full border ${
                  scoreDelta > 0
                    ? "border-[#1a7a4a]/40 bg-[#1a7a4a]/10 text-[#1a7a4a]"
                    : scoreDelta < 0
                    ? "border-[#c0392b]/40 bg-[#c0392b]/10 text-[#c0392b]"
                    : "border-[#99582a] bg-[#6f1d1b] text-[#99582a]"
                }`}
              >
                {scoreDelta > 0 ? "▲" : scoreDelta < 0 ? "▼" : "="} {previousScore} → {score}
                {scoreDelta !== 0 && ` (${scoreDelta > 0 ? "+" : ""}${scoreDelta})`}
              </span>
            )}
          </div>
          <p className="text-[#bb9457] text-sm font-medium">
            Calculated key matching metrics and index compatibility.
          </p>
          {confidenceStyle && confidence_reason && (
            <p
              className={`text-xs font-semibold leading-relaxed max-w-md ${
                confidence === "low" ? "text-[#c0392b]" : "text-[#bb9457]"
              }`}
            >
              {confidence === "low" ? "⚠ " : ""}
              {confidence === "low"
                ? `Low confidence — this score may be less accurate: ${confidence_reason}`
                : confidence === "medium"
                ? `Medium confidence: ${confidence_reason}`
                : `High confidence: ${confidence_reason}`}
            </p>
          )}
        </div>
      </div>

      {/* First-time onboarding explainer — dismissible, remembered via
          localStorage. Addresses the "user drops a resume in cold with zero
          explanation" gap directly at the point where it matters most. */}
      {!explainerDismissed && (
        <div className="bg-[#6f1d1b] border border-[#99582a] rounded-xl p-4 flex items-start gap-3 animate-fadeIn">
          <span className="text-[#bb9457] text-base leading-none mt-0.5 flex-shrink-0">💡</span>
          <div className="flex-1 space-y-1.5">
            <p className="text-[#ffe6a7] text-sm font-bold">How this score is calculated</p>
            <p className="text-[#bb9457] text-xs leading-relaxed">
              Your resume is scored against 11 explicit rules (keyword match, section headings, quantified
              achievements, and more) — expand "Why This Score?" below to see the exact points awarded per rule.
              Scoring is intentionally strict and calibrated like real ATS/recruiter screening, so scores above 90
              are rare. If a specific calibration rule applied to your resume (like a cap for no verified work
              experience), it's called out explicitly above.
            </p>
          </div>
          <button
            onClick={dismissExplainer}
            className="text-[#99582a] hover:text-[#ffe6a7] text-xs font-bold flex-shrink-0 transition"
          >
            Got it ✕
          </button>
        </div>
      )}

      {/* Overall score feedback — was the score itself useful/accurate? */}
      <div className="flex items-center gap-2 -mt-2">
        <span className="text-[#99582a] text-xs font-semibold">Was this score helpful?</span>
        <FeedbackButtons feature="ats_overall" itemId="overall" context={{ score, verdict }} />
      </div>

      {/* Calibration Disclosures — structured notes from the backend explaining
          any "invisible" scoring rules that affected THIS resume (e.g. the
          no-experience cap, gamified badge discounting). Shown by default,
          not hidden behind a click, since "why" is the core value prop. */}
      {calibration_notes && calibration_notes.length > 0 && (
        <div className="space-y-3">
          {calibration_notes.map((note, i) => {
            const isWarning = note.severity === "warning";
            return (
              <div
                key={i}
                className={`rounded-xl border p-4 text-sm leading-relaxed flex items-start gap-3 ${
                  isWarning
                    ? "bg-[#c0392b]/10 border-[#c0392b]/40 text-[#ffe6a7]"
                    : "bg-[#6f1d1b] border-[#99582a] text-[#ffe6a7]"
                }`}
              >
                <span className={`text-base leading-none mt-0.5 ${isWarning ? "text-[#c0392b]" : "text-[#bb9457]"}`}>
                  {isWarning ? "⚠" : "ℹ"}
                </span>
                <p className="flex-1">{note.message}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Rule-by-Rule Score Breakdown — "Why this score?"
          Default expanded (not gated behind an extra click) since this is
          the core transparency value prop. Sorted biggest point loss first
          so the highest-impact fixes are visible immediately. Backward
          compatible: if an older cached response has no rule_scores at all,
          ruleBreakdown is [] and this section simply doesn't render. */}
      {ruleBreakdown.length > 0 && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setBreakdownExpanded((prev) => !prev)}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-[#ffe6a7] text-base uppercase tracking-wider">Why This Score?</h4>
              <span className="text-[#99582a] text-xs font-semibold">
                {ruleBreakdown.length} rules · sorted by biggest point loss first
              </span>
            </div>
            <span className="text-[#bb9457] text-sm font-bold select-none flex-shrink-0">
              {breakdownExpanded ? "Hide ▲" : "Show ▼"}
            </span>
          </button>

          {breakdownExpanded && (
            <div className="space-y-3">
              {ruleBreakdown.map((rule) => {
                const pct = rule.max > 0 ? Math.round((rule.awarded / rule.max) * 100) : 0;
                let barColor = "#1a7a4a"; // full points — green
                let dotColor = "bg-[#1a7a4a]";
                if (rule.awarded <= 0) {
                  barColor = "#c0392b"; // zero points — red
                  dotColor = "bg-[#c0392b]";
                } else if (rule.awarded < rule.max) {
                  barColor = "#bb9457"; // partial — yellow/gold
                  dotColor = "bg-[#bb9457]";
                }
                return (
                  <div key={rule.id} className="bg-[#6f1d1b] border border-[#99582a] rounded-xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                        <span className="font-bold text-[#ffe6a7] text-sm">{rule.name}</span>
                      </div>
                      <span className="text-xs font-black text-[#ffe6a7] flex-shrink-0">
                        {rule.awarded}/{rule.max} pts
                        {rule.lost > 0 && (
                          <span className="text-[#c0392b] font-bold ml-1.5">(-{rule.lost})</span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-[#432818] rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                    {rule.reason && (
                      <p className="text-[#bb9457] text-xs leading-relaxed">{rule.reason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <hr className="border-[#99582a]" />

      {/* Resume vs Peers Benchmark Card */}
      <div className="bg-[#432818] border border-[#99582a] rounded-[14px] p-[14px_20px] mb-6 flex flex-col">
        {/* Row 1 — Header */}
        <div className="flex justify-between items-center text-xs font-bold">
          <span className="text-[#bb9457] uppercase tracking-wider">Resume vs Peers</span>
          <span className="text-[#99582a]">{roleCategory} Applicants</span>
        </div>

        {/* Row 2 — Percentile statement */}
        <h4 className="text-[#ffe6a7] text-[15px] font-semibold mt-2 mb-[14px] leading-tight">
          Your resume scores better than {percentile}% of {roleCategory} applicants
        </h4>

        {/* Row 3 — Benchmark bar (with animation & dynamic ticks) */}
        <div className="relative w-full h-12 mt-4 mb-6">
          {/* Ticks and Labels */}
          <div style={{ left: `${benchmarks.p50}%` }} className="absolute top-0 transform -translate-x-1/2 flex flex-col items-center">
            <div className="w-[2px] h-[8px] bg-[#99582a]" />
            <span className="text-[10px] text-[#99582a] mt-[16px] whitespace-nowrap select-none">Average ({benchmarks.p50})</span>
          </div>

          <div style={{ left: `${benchmarks.p75}%` }} className="absolute top-0 transform -translate-x-1/2 flex flex-col items-center">
            <div className="w-[2px] h-[8px] bg-[#99582a]" />
            <span className="text-[10px] text-[#99582a] mt-[16px] whitespace-nowrap select-none">Strong ({benchmarks.p75})</span>
          </div>

          <div style={{ left: `${benchmarks.p90}%` }} className="absolute top-0 transform -translate-x-1/2 flex flex-col items-center">
            <div className="w-[2px] h-[8px] bg-[#99582a]" />
            <span className="text-[10px] text-[#99582a] mt-[16px] whitespace-nowrap select-none">Top 10% ({benchmarks.p90})</span>
          </div>

          {/* Color-proportioned Benchmark Bar */}
          <div className="absolute top-[8px] left-0 w-full h-[8px] rounded-full overflow-hidden flex">
            <div style={{ width: `${benchmarks.p50}%`, backgroundColor: "#c0392b" }} className="h-full flex-shrink-0" />
            <div style={{ width: `${benchmarks.p75 - benchmarks.p50}%`, backgroundColor: "#bb9457" }} className="h-full flex-shrink-0" />
            <div style={{ width: `${100 - benchmarks.p75}%`, backgroundColor: "#1a7a4a" }} className="h-full flex-shrink-0" />
          </div>

          {/* Sliding User Marker */}
          <div
            style={{
              left: `${markerPosition}%`,
              transition: "left 1.2s cubic-bezier(0.25, 0.8, 0.25, 1)"
            }}
            className="absolute top-[-10px] transform -translate-x-1/2 flex flex-col items-center pointer-events-none"
          >
            <span className="text-[10px] font-bold text-[#ffe6a7] mb-1">You</span>
            <div className="w-[14px] h-[14px] rounded-full bg-[#ffe6a7] border-2 border-[#432818] shadow-md" />
          </div>
        </div>

        {/* Row 4 — Advice Line */}
        <p className={`text-xs italic mt-[10px] font-medium leading-relaxed ${adviceColor}`}>
          {adviceText}
        </p>
      </div>

      <hr className="border-[#99582a]" />

      {/* Keywords Column Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Matched Keywords */}
        <div className="space-y-4">
          <div className="flex items-center space-x-2 text-[#bb9457]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            <h4 className="font-bold text-[#ffe6a7]">Matched Keywords ({matched_keywords.length})</h4>
          </div>
          {matched_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {matched_keywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-[#bb9457] text-[#432818] border border-[#ffe6a7]/20"
                >
                  {kw}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[#99582a] text-xs italic">No matched keywords found.</p>
          )}
        </div>

        {/* Missing Keywords */}
        <div className="space-y-4">
          <div className="flex items-center space-x-2 text-[#bb9457]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                clipRule="evenodd"
              />
            </svg>
            <h4 className="font-bold text-[#ffe6a7]">Missing Keywords ({missing_keywords.length})</h4>
          </div>
          {missing_keywords.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {missing_keywords.map((kw, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-[#6f1d1b] text-[#ffe6a7] border border-[#99582a]"
                >
                  {kw}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[#99582a] text-xs italic">No critical missing keywords.</p>
          )}
        </div>
      </div>

      {/* Improvement Tips Section */}
      {improvement_tips && improvement_tips.length > 0 && (
        <div className="space-y-4">
          <hr className="border-[#99582a]" />
          <h4 className="font-bold text-[#ffe6a7] text-base uppercase tracking-wider">Your Action Plan</h4>
          <div className="grid grid-cols-1 gap-3">
            {improvement_tips.map((tip, idx) => (
              <div
                key={idx}
                className="flex items-start bg-[#432818] border border-[#99582a]/30 border-l-4 border-l-[#bb9457] rounded-lg p-4 space-x-4 shadow-md hover:border-[#99582a] transition-all"
              >
                <span className="text-2xl font-black text-[#bb9457] leading-none select-none">
                  {idx + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <p className="text-[#ffe6a7] text-sm leading-relaxed pt-0.5">
                    {tip}
                  </p>
                  <FeedbackButtons feature="ats_tip" itemId={`tip_${idx}`} context={{ tip_text: tip }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ask About My Score — stateless follow-up chat. The running
          conversation lives in local component state and gets resent to the
          backend each turn since it keeps no session of its own. */}
      <div className="space-y-4">
        <hr className="border-[#99582a]" />
        <h4 className="font-bold text-[#ffe6a7] text-base uppercase tracking-wider">Ask About My Score</h4>
        <p className="text-[#99582a] text-xs leading-relaxed -mt-2">
          Have a question about a specific rule or why your score is what it is? Ask directly.
        </p>

        {chatMessages.length > 0 && (
          <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
            {chatMessages.map((msg, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex justify-end">
                  <div className="bg-[#bb9457] text-[#432818] text-sm font-semibold rounded-2xl rounded-tr-sm px-4 py-2 max-w-[85%]">
                    {msg.question}
                  </div>
                </div>
                <div className="flex justify-start">
                  <div className="bg-[#6f1d1b] border border-[#99582a] text-[#ffe6a7] text-sm leading-relaxed rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
                    {msg.answer}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {chatLoading && (
          <div className="flex justify-start">
            <div className="bg-[#6f1d1b] border border-[#99582a] text-[#99582a] text-sm rounded-2xl rounded-tl-sm px-4 py-2.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#99582a] animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#99582a] animate-pulse" style={{ animationDelay: "0.15s" }} />
              <span className="w-1.5 h-1.5 rounded-full bg-[#99582a] animate-pulse" style={{ animationDelay: "0.3s" }} />
            </div>
          </div>
        )}

        {chatError && (
          <p className="text-[#c0392b] text-xs font-semibold">{chatError}</p>
        )}

        <div className="flex items-end gap-2">
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            disabled={chatLoading}
            placeholder="e.g. Why didn't my AWS badge count as a certification?"
            rows={1}
            className="flex-1 bg-[#6f1d1b] border border-[#99582a] focus:border-[#bb9457] rounded-xl text-[#ffe6a7] text-sm p-3 resize-none outline-none placeholder:text-[#99582a]/70"
          />
          <button
            onClick={handleAskQuestion}
            disabled={chatLoading || !chatInput.trim()}
            className={`px-5 py-3 rounded-xl text-sm font-bold transition ${
              chatLoading || !chatInput.trim()
                ? "bg-[#99582a]/30 text-[#432818]/60 cursor-not-allowed"
                : "bg-[#bb9457] hover:bg-[#ffe6a7] text-[#432818] cursor-pointer"
            }`}
          >
            Ask
          </button>
        </div>
      </div>
    </div>
  );
}