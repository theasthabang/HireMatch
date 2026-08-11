import React, { useState, useEffect } from "react";
import Upload from "./Upload";
import ATSScorePanel from "./panels/ATSScorePanel";
import SkillGapsPanel from "./panels/SkillGapsPanel";
import JobMatchesPanel from "./panels/JobMatchesPanel";
import ResumeRewritePanel from "./panels/ResumeRewritePanel";
import InterviewPrepPanel from "./panels/InterviewPrepPanel";
import CoverLetterPanel from "./panels/CoverLetterPanel";
import { reanalyzeResume } from "../api/client";
import { loadJSON, saveJSON, removeKey, STORAGE_KEYS } from "../utils/storage";

/**
 * Dashboard component displaying the split-screen view.
 *
 * Session persistence: results, resumeText, jobDescription, roadmap
 * checklist progress, and the active tab are all persisted to localStorage
 * under STORAGE_KEYS.SESSION so a page refresh doesn't lose them — this
 * previously lived only in useState and vanished on every reload, which
 * quietly defeated the point of the 90-day roadmap checklist.
 *
 * @param {Object} props
 * @param {Function} props.onReset - Callback to return to the HeroPage.
 */
export default function Dashboard({ onReset }) {
  // Lazy initializers: read persisted session once on first mount, not on
  // every render.
  const [results, setResults] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.results ?? null);
  const [activeTab, setActiveTab] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.activeTab ?? "ats");
  const [loading, setLoading] = useState(false);
  const [resumeText, setResumeText] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.resumeText ?? "");
  const [showToast, setShowToast] = useState(false);
  // Lifted here (not local to Upload) so the same JD can be reused on
  // /reanalyze calls without the user retyping it.
  const [jobDescription, setJobDescription] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.jobDescription ?? "");
  // Lifted out of SkillGapsPanel so it persists with everything else instead
  // of resetting to [] on every refresh.
  const [completedWeeks, setCompletedWeeks] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.completedWeeks ?? []);
  // Snapshot of the ATS score right before a re-analyze, so the delta can be
  // shown once the new result comes back ("62 -> 78"). Intentionally not
  // persisted across reloads — it's only meaningful right after an in-session
  // re-analyze action.
  const [previousAtsScore, setPreviousAtsScore] = useState(null);
  const [scoreDelta, setScoreDelta] = useState(null);

  // Persist the session on every relevant change. Debounce-free is fine here
  // since these are all low-frequency state changes (uploads, reanalyzes,
  // checklist toggles), not per-keystroke.
  useEffect(() => {
    saveJSON(STORAGE_KEYS.SESSION, {
      results,
      resumeText,
      jobDescription,
      completedWeeks,
      activeTab,
    });
  }, [results, resumeText, jobDescription, completedWeeks, activeTab]);

  const handleResult = (data, filename) => {
    setResults(data);
    setResumeText(data?.resume_text || "");
    // A genuinely new resume upload means a new roadmap — carrying over
    // checkmarks from a previous, unrelated resume would be misleading.
    setCompletedWeeks([]);
    setPreviousAtsScore(null);
    setScoreDelta(null);
  };

  const handleResumeUpdate = (updatedText) => {
    setResumeText(updatedText);
  };

  const handleReAnalyze = async (updatedText) => {
    setShowToast(true);
    // Snapshot the current score before the new result overwrites it, so we
    // can compute a delta once the response arrives.
    const scoreBefore = results?.ats?.score;
    try {
      const response = await reanalyzeResume(updatedText, jobDescription);
      setResults(response);
      setResumeText(response?.resume_text || updatedText);

      const scoreAfter = response?.ats?.score;
      if (typeof scoreBefore === "number" && typeof scoreAfter === "number") {
        setPreviousAtsScore(scoreBefore);
        setScoreDelta(scoreAfter - scoreBefore);
      } else {
        setPreviousAtsScore(null);
        setScoreDelta(null);
      }
      setShowToast(false);
    } catch (err) {
      console.error("Re-analysis failed:", err);
      setShowToast(false);
      alert(err.message || "Failed to re-analyze resume.");
    }
  };

  const handleClearSavedAnalysis = () => {
    if (window.confirm("Clear your saved analysis from this browser? This can't be undone.")) {
      removeKey(STORAGE_KEYS.SESSION);
      setResults(null);
      setResumeText("");
      setJobDescription("");
      setCompletedWeeks([]);
      setPreviousAtsScore(null);
      setScoreDelta(null);
      setActiveTab("ats");
    }
  };

  const tabs = [
    { id: "ats", name: "ATS Score" },
    { id: "skills", name: "Skill Gaps" },
    { id: "jobs", name: "Job Matches" },
    { id: "rewrite", name: "Optimized Rewrite" },
    { id: "cover_letter", name: "Cover Letter" },
    { id: "interview", name: "Interview Prep" },
  ];

  const renderActivePanel = () => {
    switch (activeTab) {
      case "ats":
        return (
          <ATSScorePanel
            data={results?.ats}
            resumeText={resumeText}
            onResumeUpdate={handleResumeUpdate}
            onReAnalyze={handleReAnalyze}
            previousScore={previousAtsScore}
            scoreDelta={scoreDelta}
          />
        );
      case "skills":
        return (
          <SkillGapsPanel
            data={results?.skills}
            roadmap={results?.roadmap}
            completedWeeks={completedWeeks}
            onCompletedWeeksChange={setCompletedWeeks}
          />
        );
      case "jobs":
        return <JobMatchesPanel data={results?.jobs} />;
      case "rewrite":
        return <ResumeRewritePanel data={results?.rewrite} />;
      case "cover_letter":
        return <CoverLetterPanel data={results?.cover_letter} />;
      case "interview":
        return <InterviewPrepPanel data={results?.interview} />;
      default:
        return null;
    }
  };

  // Stat computations
  const atsScore = results?.ats?.score !== undefined ? `${results.ats.score}%` : "—";
  const skillsCount = results?.skills?.strong_skills?.length !== undefined ? results.skills.strong_skills.length : "—";
  const jobsCount = results?.jobs?.matches?.length !== undefined ? results.jobs.matches.length : "—";

  return (
    <div className="min-h-screen bg-[#6f1d1b] flex flex-col md:grid md:grid-cols-[420px_1fr] text-[#ffe6a7] font-sans">
      
      {/* Left Panel - Fixed width 420px, background #432818, border right #99582a */}
      <aside className="w-full md:w-[420px] bg-[#432818] border-b md:border-b-0 md:border-r border-[#99582a] p-6 flex flex-col justify-between flex-shrink-0 md:min-h-screen">
        <div className="space-y-4">
          
          {/* Group 1 — Header */}
          <div className="space-y-1.5">
            {/* Back button */}
            <button
              onClick={onReset}
              className="flex items-center space-x-2 text-xs font-bold text-[#bb9457] hover:text-[#ffe6a7] transition focus:outline-none"
            >
              <span>← New Analysis</span>
            </button>

            {/* Logo */}
            <div className="flex items-center space-x-2">
              <span className="bg-[#bb9457] text-[#432818] w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shadow-sm">IQ</span>
              <span className="text-lg font-bold text-[#ffe6a7] tracking-tight">ResumeIQ</span>
            </div>
          </div>

          {/* Group 2 — Upload section */}
          <div className="space-y-2.5">
            <div>
              <h3 className="text-lg font-extrabold text-[#ffe6a7]">Upload Resume</h3>
              <p className="text-[#99582a] text-[11px] font-semibold mt-0.5">
                Select or drop your file to get started
              </p>
            </div>

            {/* Upload Component */}
            <Upload
              onResult={handleResult}
              onLoadingChange={setLoading}
              jobDescription={jobDescription}
              onJobDescriptionChange={setJobDescription}
            />
          </div>

          {/* Group 3 — System Status Card */}
          <div className="bg-[#6f1d1b] border border-[#99582a] rounded-xl shadow-inner p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#ffe6a7] uppercase tracking-wider">System Status</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold bg-[#432818] text-[#bb9457] border border-[#bb9457]/50">
                LLaMA-3 70B
              </span>
            </div>
            <div className="flex items-center space-x-2">
              <span className={`w-2 h-2 rounded-full ${loading ? "bg-[#bb9457] animate-pulse" : results ? "bg-[#bb9457]" : "bg-[#99582a]"}`} />
              <span className="text-xs font-extrabold text-[#ffe6a7]">
                {loading ? "Processing..." : results ? "Model Online" : "Awaiting Upload"}
              </span>
            </div>
            {results?.is_tailored && (
              <div className="flex items-start gap-1.5 pt-1 border-t border-[#99582a]/20 mt-1">
                <span className="text-[#1a7a4a] text-xs leading-none mt-0.5">✓</span>
                <p className="text-[#1a7a4a] text-[10px] font-semibold leading-snug">
                  Tailored to: {results.tailored_for || "your pasted job description"}
                </p>
              </div>
            )}
            {results && (
              <div className="pt-1 border-t border-[#99582a]/20 mt-1 flex items-center justify-between">
                <span className="text-[#99582a] text-[10px] font-semibold">Saved in this browser</span>
                <button
                  onClick={handleClearSavedAnalysis}
                  className="text-[#99582a] hover:text-[#c0392b] text-[10px] font-bold underline decoration-dotted underline-offset-2 transition"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Group 4 — Bottom stats row */}
        <div className="grid grid-cols-3 gap-2.5 mt-5">
          <div className="bg-[#6f1d1b] border border-[#99582a]/30 rounded-xl p-2 text-center shadow-inner">
            <p className="text-[#bb9457] text-lg font-black">
              {atsScore}
              {typeof scoreDelta === "number" && scoreDelta !== 0 && (
                <span className={`ml-1 text-xs font-black align-top ${scoreDelta > 0 ? "text-[#1a7a4a]" : "text-[#c0392b]"}`}>
                  {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}
                </span>
              )}
            </p>
            <p className="text-[#99582a] text-[9px] font-bold uppercase tracking-wider mt-0.5">ATS Score</p>
          </div>
          <div className="bg-[#6f1d1b] border border-[#99582a]/30 rounded-xl p-2 text-center shadow-inner">
            <p className="text-[#bb9457] text-lg font-black">{skillsCount}</p>
            <p className="text-[#99582a] text-[9px] font-bold uppercase tracking-wider mt-0.5">Skills</p>
          </div>
          <div className="bg-[#6f1d1b] border border-[#99582a]/30 rounded-xl p-2 text-center shadow-inner">
            <p className="text-[#bb9457] text-lg font-black">{jobsCount}</p>
            <p className="text-[#99582a] text-[9px] font-bold uppercase tracking-wider mt-0.5">Matches</p>
          </div>
        </div>
      </aside>

      {/* Right Panel - Fills remaining space, background #6f1d1b, padding 32px */}
      <section className="flex-grow p-8 overflow-y-auto max-h-screen flex flex-col">
        {!results ? (
          // Center Empty State — includes a brief onboarding explainer so a
          // cold-start user knows what they're about to get before uploading.
          <div className="flex-grow flex flex-col items-center justify-center text-center p-8 animate-fadeIn">
            <div className="w-16 h-16 rounded-2xl bg-[#432818] border border-[#99582a] flex items-center justify-center text-[#bb9457] mb-6 shadow-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-8 h-8"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.813 15.904L9 21l8.904-4.43 3.002-12.01a1.875 1.875 0 10-3.536-1.258l-7.558 7.558z"
                />
              </svg>
            </div>
            <h4 className="text-xl font-bold text-[#ffe6a7] mb-2">Ready to analyze</h4>
            <p className="text-[#99582a] text-sm max-w-xs leading-relaxed mb-6">
              Upload your resume on the left to get started
            </p>

            <div className="max-w-md text-left bg-[#432818] border border-[#99582a] rounded-2xl p-5 space-y-3">
              <h5 className="text-[#ffe6a7] font-bold text-sm">What you'll get</h5>
              <ul className="space-y-2 text-[#bb9457] text-xs leading-relaxed">
                <li className="flex gap-2">
                  <span className="text-[#1a7a4a] flex-shrink-0">✓</span>
                  <span>
                    An <span className="text-[#ffe6a7] font-semibold">ATS score out of 100</span>, scored strictly
                    against 11 explicit rules — not a black box. Every rule's reasoning is shown, and the score is
                    intentionally hard to max out, similar to real recruiter screening.
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#1a7a4a] flex-shrink-0">✓</span>
                  <span>Skill gaps, job matches, an optimized rewrite, a cover letter, and interview prep — all tailored to a specific job description if you paste one.</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-[#1a7a4a] flex-shrink-0">✓</span>
                  <span>Your analysis is saved in this browser, so refreshing the page won't lose your results or roadmap progress.</span>
                </li>
              </ul>
            </div>
          </div>
        ) : (
          // Tabbed Content Dashboard View
          <div className="space-y-6 flex flex-col flex-grow">


            {/* Pill-Style Tabs Navigation Bar */}
            <div className="flex items-center bg-[#432818] border border-[#99582a] p-1.5 rounded-[50px] self-start gap-2 shadow-md flex-wrap">
              {tabs.map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-5 py-2.5 rounded-[50px] text-xs sm:text-sm font-bold transition-all duration-300 ${
                      isSelected
                        ? "bg-[#bb9457] text-[#432818] shadow-sm"
                        : "text-[#99582a] hover:text-[#bb9457] bg-transparent"
                    }`}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </div>

            {/* Active Panel Content */}
            <div key={activeTab} className="animate-fadeIn flex-grow">
              {renderActivePanel()}
            </div>
          </div>
        )}
      </section>
      {showToast && (
        <div className="fixed bottom-6 right-6 bg-[#432818] text-[#bb9457] border border-[#bb9457] px-5 py-3 rounded-full shadow-2xl z-[1000] font-bold text-sm animate-fadeIn">
          Re-analyzing your resume...
        </div>
      )}
    </div>
  );
}