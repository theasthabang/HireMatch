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
 * Dashboard — graded-paper design system, split-screen structure kept
 * (sidebar + tabs, per explicit direction), rebuilt with the new tokens:
 * Paper #F8FAFC, Ink #0F172A, Graphite #64748B, Primary Blue #2563EB (one
 * accent only), Hairline #E2E8F0. Fraunces for headings, Inter for body,
 * IBM Plex Mono for data/labels. All state/logic identical to before —
 * this is a visual + component-craft rebuild, not a functional change.
 */
export default function Dashboard({ onReset }) {
  const [results, setResults] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.results ?? null);
  const [activeTab, setActiveTab] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.activeTab ?? "ats");
  const [loading, setLoading] = useState(false);
  const [resumeText, setResumeText] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.resumeText ?? "");
  const [showToast, setShowToast] = useState(false);
  const [jobDescription, setJobDescription] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.jobDescription ?? "");
  const [industry, setIndustry] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.industry ?? "general");
  const [completedWeeks, setCompletedWeeks] = useState(() => loadJSON(STORAGE_KEYS.SESSION, {})?.completedWeeks ?? []);
  const [previousAtsScore, setPreviousAtsScore] = useState(null);
  const [scoreDelta, setScoreDelta] = useState(null);

  // True only when the currently-shown `results` came from localStorage on
  // initial page load, not from a live analysis run in this session. Without
  // this, opening the app fresh silently shows last session's saved score
  // with zero visual difference from a real, just-completed analysis —
  // genuinely confusing since nothing was actually uploaded/analyzed this
  // time. Flips to false the moment a real analyze/re-analyze completes.
  const [isRestoredSession, setIsRestoredSession] = useState(
    () => !!(loadJSON(STORAGE_KEYS.SESSION, {})?.results)
  );

  useEffect(() => {
    saveJSON(STORAGE_KEYS.SESSION, { results, resumeText, jobDescription, industry, completedWeeks, activeTab });
  }, [results, resumeText, jobDescription, industry, completedWeeks, activeTab]);

  const handleResult = (data, filename) => {
    setResults(data);
    setResumeText(data?.resume_text || "");
    setCompletedWeeks([]);
    setPreviousAtsScore(null);
    setScoreDelta(null);
    setIsRestoredSession(false); // this is a real, fresh analysis — no longer "restored"
  };

  const handleResumeUpdate = (updatedText) => setResumeText(updatedText);

  const handleReAnalyze = async (updatedText) => {
    setShowToast(true);
    const scoreBefore = results?.ats?.score;
    try {
      const response = await reanalyzeResume(updatedText, jobDescription, industry);
      setResults(response);
      setResumeText(response?.resume_text || updatedText);
      setIsRestoredSession(false); // fresh re-analysis — no longer "restored"
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
      setIsRestoredSession(false);
    }
  };

  const tabs = [
    { id: "ats", name: "ATS Score" },
    { id: "skills", name: "Skill Gaps" },
    { id: "jobs", name: "Job Matches" },
    { id: "rewrite", name: "Rewrite" },
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
            jdAlignment={results?.jd_alignment}
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

  const atsScore = results?.ats?.score !== undefined ? results.ats.score : null;
  const skillsCount = results?.skills?.strong_skills?.length !== undefined ? results.skills.strong_skills.length : null;
  const jobsCount = results?.jobs?.matches?.length !== undefined ? results.jobs.matches.length : null;

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col md:grid md:grid-cols-[260px_1fr] text-[#0F172A] font-sans">

      <aside
        className="w-full md:w-[260px] border-b md:border-b-0 md:border-r border-[#E2E8F0] px-7 py-8 flex flex-col justify-between flex-shrink-0 md:min-h-screen"
        style={{ background: "linear-gradient(180deg, #EFF6FF 0%, #F8FAFC 220px)" }}
      >
        <div className="space-y-8">

          <div className="space-y-4">
            <button onClick={onReset} className="flex items-center gap-1.5 text-xs font-medium text-[#64748B] hover:text-[#2563EB] transition">
              <span>← New analysis</span>
            </button>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-[#2563EB] flex-shrink-0" />
              <div className="text-lg font-medium text-[#0F172A]" style={serif}>HireMatch</div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A]">Upload resume</h3>
              <p className="text-[#64748B] text-xs mt-0.5">PDF or DOCX, up to 5MB</p>
            </div>
            <Upload onResult={handleResult} onLoadingChange={setLoading} jobDescription={jobDescription} onJobDescriptionChange={setJobDescription} industry={industry} onIndustryChange={setIndustry} />
          </div>

          <div className="space-y-2.5 border-t border-[#E2E8F0] pt-5">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full ${loading ? "bg-[#2563EB] animate-pulse" : results ? "bg-[#0D9488]" : "bg-[#E2E8F0]"}`} />
              <span className="text-xs font-medium text-[#0F172A]">
                {loading ? "Processing" : results ? "Model online" : "Awaiting upload"}
              </span>
            </div>
            {results?.is_tailored && (
              <p className="text-[#64748B] text-[11px] leading-snug pl-3.5 border-l border-[#E2E8F0]">
                Tailored to: {results.tailored_for || "your pasted job description"}
              </p>
            )}
            {results && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-[#64748B] text-[11px]">Saved in this browser</span>
                <button onClick={handleClearSavedAnalysis} className="text-[#64748B] hover:text-[#2563EB] text-[11px] font-medium underline decoration-dotted underline-offset-2 transition">
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 border-t border-[#E2E8F0] pt-5 mt-8">
          <div className="text-center border-r border-[#E2E8F0] relative">
            <span className="absolute -top-[21px] left-1/2 -translate-x-1/2 w-6 h-[2px] bg-[#2563EB]" />
            <p className="text-xl font-medium text-[#0F172A]" style={serif}>
              {atsScore !== null ? atsScore : "—"}
              {typeof scoreDelta === "number" && scoreDelta !== 0 && (
                <span className={`text-[10px] font-semibold ml-0.5 align-top ${scoreDelta > 0 ? "text-[#0D9488]" : "text-[#2563EB]"}`} style={mono}>
                  {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}
                </span>
              )}
            </p>
            <p className="text-[#64748B] text-[9px] uppercase tracking-wide mt-0.5">Score</p>
          </div>
          <div className="text-center border-r border-[#E2E8F0] relative">
            <span className="absolute -top-[21px] left-1/2 -translate-x-1/2 w-6 h-[2px] bg-[#0D9488]" />
            <p className="text-xl font-medium text-[#0F172A]" style={serif}>{skillsCount !== null ? skillsCount : "—"}</p>
            <p className="text-[#64748B] text-[9px] uppercase tracking-wide mt-0.5">Skills</p>
          </div>
          <div className="text-center relative">
            <span className="absolute -top-[21px] left-1/2 -translate-x-1/2 w-6 h-[2px] bg-[#0F172A]" />
            <p className="text-xl font-medium text-[#0F172A]" style={serif}>{jobsCount !== null ? jobsCount : "—"}</p>
            <p className="text-[#64748B] text-[9px] uppercase tracking-wide mt-0.5">Matches</p>
          </div>
        </div>
      </aside>

      <section className="flex-grow px-8 py-10 md:px-14 md:py-12 overflow-y-auto max-h-screen flex flex-col">
        {!results ? (
          <div className="flex-grow flex flex-col items-center justify-center text-center animate-fadeIn">
            <h4 className="text-2xl font-medium text-[#0F172A] mb-2" style={serif}>Ready to analyze</h4>
            <p className="text-[#64748B] text-sm max-w-xs leading-relaxed mb-10">Upload your resume on the left to get started</p>

            <div className="max-w-md text-left space-y-3">
              <h5 className="text-[#0F172A] font-semibold text-sm border-b border-[#E2E8F0] pb-2 mb-1">What you'll get</h5>
              <div className="bg-[#2563EB]/[0.04] border-l-2 border-[#2563EB] pl-4 pr-4 py-3 flex gap-3">
                <span className="text-[#2563EB] flex-shrink-0 font-semibold" style={mono}>01</span>
                <span className="text-[#64748B] text-[13px] leading-relaxed">
                  An <span className="text-[#0F172A] font-medium">ATS score out of 100</span>, scored strictly against 11 explicit rules — not a black box, every rule's reasoning is shown. This is a resume-hygiene practice score modeled on a fast recruiter scan, not a simulation of any specific company's actual ATS software — most real ATS platforms don't compute a match score at all.
                </span>
              </div>
              <div className="bg-[#0D9488]/[0.05] border-l-2 border-[#0D9488] pl-4 pr-4 py-3 flex gap-3">
                <span className="text-[#0D9488] flex-shrink-0 font-semibold" style={mono}>02</span>
                <span className="text-[#64748B] text-[13px] leading-relaxed">Skill gaps, job matches, an optimized rewrite, a cover letter, and interview prep — all tailored to a specific job description if you paste one.</span>
              </div>
              <div className="bg-[#0F172A]/[0.03] border-l-2 border-[#0F172A] pl-4 pr-4 py-3 flex gap-3">
                <span className="text-[#0F172A] flex-shrink-0 font-semibold" style={mono}>03</span>
                <span className="text-[#64748B] text-[13px] leading-relaxed">Your analysis is saved in this browser, so refreshing the page won't lose your results or roadmap progress.</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 flex flex-col flex-grow">
            {isRestoredSession && (
              <div className="flex items-center justify-between gap-4 flex-wrap bg-[#2563EB]/[0.05] border border-[#2563EB]/30 rounded-sm px-5 py-3 animate-fadeIn">
                <p className="text-[#0F172A] text-[13px] leading-relaxed">
                  <span className="font-semibold">Showing your last analysis</span>, saved in this browser — not a new
                  result. Upload a resume above to run a fresh analysis.
                </p>
                <div className="flex items-center gap-4 flex-shrink-0">
                  <button
                    onClick={handleClearSavedAnalysis}
                    className="text-[#2563EB] hover:text-[#0F172A] text-xs font-semibold transition"
                  >
                    Start fresh →
                  </button>
                  <button
                    onClick={() => setIsRestoredSession(false)}
                    className="text-[#64748B] hover:text-[#0F172A] text-xs font-medium transition"
                    aria-label="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between w-full gap-4 border-b border-[#E2E8F0] flex-wrap">
              {tabs.map((tab) => {
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`pb-3 text-sm font-medium transition-colors border-b-2 -mb-px ${isSelected ? "text-[#0F172A] border-[#2563EB]" : "text-[#64748B] border-transparent hover:text-[#0F172A]"}`}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </div>

            <div key={activeTab} className="animate-fadeIn flex-grow">
              {renderActivePanel()}
            </div>
          </div>
        )}
      </section>

      {showToast && (
        <div className="fixed bottom-6 right-6 bg-[#0F172A] text-white px-5 py-3 rounded-sm shadow-sm z-[1000] text-sm animate-fadeIn">
          Re-analyzing your resume…
        </div>
      )}
    </div>
  );
}