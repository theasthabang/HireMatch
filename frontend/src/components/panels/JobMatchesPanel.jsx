import React, { useState, useEffect } from "react";

/**
 * CompanyLogo sub-component to fetch and fallback for Clearbit logo.
 */
function CompanyLogo({ companyName }) {
  const [error, setError] = useState(false);

  if (!companyName) {
    return (
      <div className="w-10 h-10 flex-shrink-0 rounded-[8px] bg-[#432818] border border-[#99582a]/30 flex items-center justify-center text-[#bb9457] font-bold text-sm select-none">
        ??
      </div>
    );
  }

  const getCompanyDomain = (name) => {
    let cleaned = name.toLowerCase();
    // Strip common legal/corporate suffixes to get core domain
    cleaned = cleaned.replace(/\b(llc|inc|corp|co|ltd|incorporated|corporation|l\.l\.c\.)\b/gi, "");
    cleaned = cleaned.replace(/[^a-z0-9]/g, "");
    return cleaned ? `${cleaned}.com` : "";
  };

  const domain = getCompanyDomain(companyName);
  const initials = companyName.trim().substring(0, 2).toUpperCase();

  if (error || !domain) {
    return (
      <div className="w-10 h-10 flex-shrink-0 rounded-[8px] bg-[#432818] border border-[#99582a]/30 flex items-center justify-center text-[#bb9457] font-bold text-sm select-none">
        {initials}
      </div>
    );
  }

  return (
    <img
      src={`https://logo.clearbit.com/${domain}`}
      alt={`${companyName} Logo`}
      onError={() => setError(true)}
      loading="lazy"
      className="w-10 h-10 flex-shrink-0 rounded-[8px] object-cover bg-white border border-[#99582a]/20"
    />
  );
}

/**
 * JobMatchesPanel renders recommended roles sorted by compatibility and live job postings.
 * Redesigned with #432818 bg card elements, #6f1d1b progress tracks, and #bb9457 progress fills.
 */
export default function JobMatchesPanel({ data }) {
  const [expandedMatchIdx, setExpandedMatchIdx] = useState(null);
  // Pagination: reveal jobs in batches instead of dumping the whole fetched
  // pool on screen at once. This is purely client-side — the backend already
  // fetched up to ~30 jobs (JSEARCH_RESULTS_PER_QUERY x 3 queries) in one
  // request, so "Load More" costs zero additional API calls, it just reveals
  // more of what's already in memory.
  const JOBS_PAGE_SIZE = 5;
  const [visibleCount, setVisibleCount] = useState(JOBS_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(JOBS_PAGE_SIZE);
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
          <span className="font-bold text-base text-[#ffe6a7]">Job Matches Unavailable</span>
        </div>
        <p className="mt-2 text-[#bb9457]">
          The job matching analysis is currently unavailable.
        </p>
      </div>
    );
  }

  const { experience_level, reasoning, live_jobs = [], live_jobs_status, live_jobs_message } = data;

  // Jobs are tagged source: "live" (real-time JSearch result) or "fallback"
  // (static curated list used when the live API is unavailable). Only show
  // the "Updated Today" live badge when at least one posting is genuinely live.
  const hasLiveData = live_jobs.some((job) => job.source === "live");

  // Jobs are LLM-scored (or, if that failed, keyword-heuristic-scored) against
  // the resume with match_pct/matched_requirements/missing_requirements
  // attached server-side. Sort strongest matches first when that data exists;
  // otherwise preserve the original fetch order.
  const hasMatchData = live_jobs.some((job) => typeof job.match_pct === "number");
  const sortedJobs = hasMatchData
    ? [...live_jobs].sort((a, b) => (b.match_pct ?? -1) - (a.match_pct ?? -1))
    : live_jobs;

  const matchTierStyle = (pct) => {
    if (pct >= 75) return { color: "text-[#1a7a4a]", bg: "bg-[#1a7a4a]/10", border: "border-[#1a7a4a]/30" };
    if (pct >= 50) return { color: "text-[#bb9457]", bg: "bg-[#bb9457]/10", border: "border-[#bb9457]/30" };
    return { color: "text-[#c0392b]", bg: "bg-[#c0392b]/10", border: "border-[#c0392b]/30" };
  };

  // Defensive check before rendering any apply_link as a clickable href —
  // guards against a malformed API response producing a non-http(s) URL
  // (e.g. a stray "javascript:" scheme) ever becoming clickable.
  const isSafeHttpUrl = (url) => {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  // Helper to calculate days since posted date
  const getDaysSincePosted = (postedAt) => {
    if (!postedAt) return 0;
    const postDate = new Date(postedAt);
    const today = new Date();
    // Reset hours to midnight for exact calendar days
    postDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = today - postDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return isNaN(diffDays) ? 0 : Math.max(0, diffDays);
  };

  // Helper to format posted date
  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Helper to render deadline urgency badge
  const renderDeadlineBadge = (daysRemaining) => {
    const badgeBase = "absolute top-4 right-4 rounded-[50px] px-3 py-1 text-xs font-semibold select-none z-10 flex items-center gap-1.5";

    if (daysRemaining <= 0) {
      return (
        <span className={`${badgeBase} bg-[#2c2c2c] text-[#99582a]`}>
          ⚫ May be closed
        </span>
      );
    } else if (daysRemaining <= 3) {
      return (
        <span className={`${badgeBase} bg-[#c0392b] text-white animate-urgent-blink`}>
          🔴 Closes in {daysRemaining} {daysRemaining === 1 ? "day" : "days"}
        </span>
      );
    } else if (daysRemaining <= 7) {
      return (
        <span className={`${badgeBase} bg-[#99582a] text-[#ffe6a7]`}>
          🟠 Closes in {daysRemaining} days
        </span>
      );
    } else if (daysRemaining <= 15) {
      return (
        <span className={`${badgeBase} bg-[#432818] text-[#bb9457] border border-[#bb9457]`}>
          🟡 {daysRemaining} days left
        </span>
      );
    } else {
      return (
        <span className={`${badgeBase} bg-[#432818] text-[#1a7a4a]`}>
          ✅ Plenty of time
        </span>
      );
    }
  };

  return (
    <div className="bg-[#432818] border border-[#99582a] rounded-[16px] p-6 shadow-2xl space-y-8 animate-fadeIn text-[#ffe6a7]">
      {/* Styles Block for Custom Animations */}
      <style>{`
        @keyframes urgentBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .animate-urgent-blink {
          animation: urgentBlink 0.8s infinite ease-in-out;
        }
      `}</style>

      {/* Explicit fallback explanation — tied directly to live_jobs_status from
          the backend, so a missing/invalid RAPIDAPI_KEY (or a rate-limited/
          failed live search) is surfaced honestly instead of silently
          swapping in example data with no explanation. */}
      {!hasLiveData && live_jobs_message && (
        <div className="flex items-start gap-2.5 bg-[#6f1d1b] border border-[#99582a] rounded-xl p-3.5 text-xs">
          <span className="text-[#bb9457] leading-none mt-0.5 flex-shrink-0">ℹ</span>
          <p className="text-[#bb9457] leading-relaxed">
            {live_jobs_message}
            {live_jobs_status === "fallback_no_api_key" && (
              <span className="block text-[#99582a] mt-1">
                (Developer note: set <code className="bg-[#432818] px-1 rounded">RAPIDAPI_KEY</code> in the backend .env to enable live search.)
              </span>
            )}
          </p>
        </div>
      )}

      {experience_level && (
        <div className="bg-[#432818] border border-[#99582a] rounded-[10px] p-[12px_16px] mb-4">
          <div className="text-[#bb9457] font-bold uppercase text-[11px] mb-1">
            Detected Level: {experience_level}
          </div>
          <p className="text-[#99582a] text-[12px] leading-relaxed">
            {reasoning}
          </p>
        </div>
      )}

      {/* 2. Live Job Postings Section */}
      <div className="space-y-6">
        {/* Pulsing Dot Header Row */}
        <div className="flex items-center justify-between gap-4 flex-wrap pb-2">
          <h3 className="text-xl font-bold text-[#ffe6a7]">
            {hasLiveData ? "Live Job Postings" : "Suggested Job Postings"}
          </h3>
          {hasLiveData ? (
            <div className="flex items-center space-x-2 text-[#1a7a4a] bg-[#1a7a4a]/10 px-3 py-1 rounded-full border border-[#1a7a4a]/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#1a7a4a] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#1a7a4a]"></span>
              </span>
              <span className="text-[10px] font-black uppercase tracking-wider">Updated Today</span>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-[#bb9457] bg-[#bb9457]/10 px-3 py-1 rounded-full border border-[#bb9457]/30">
              <span className="text-[10px] font-black uppercase tracking-wider">Curated Picks · Not Real-Time</span>
            </div>
          )}
        </div>

        {sortedJobs.length > 0 ? (
          <>
          <div className="space-y-4">
            {sortedJobs.slice(0, visibleCount).map((job, i) => {
              const hasApplyLink = !!job.apply_link && isSafeHttpUrl(job.apply_link);
              const daysElapsed = job.days_since_posting !== undefined 
                ? job.days_since_posting 
                : getDaysSincePosted(job.posted_at);

              const daysRemaining = Math.max(0, 30 - daysElapsed);
              const isExpired = daysRemaining <= 0;
              const isApplyDisabled = !hasApplyLink || isExpired;

              const handleApply = () => {
                if (!isApplyDisabled) {
                  window.open(job.apply_link, "_blank", "noopener,noreferrer");
                }
              };

              // Truncate description to 220 chars
              const description = job.description || "";
              const shortDesc = description.length > 220 
                ? description.substring(0, 220) + "..." 
                : description;

              const formattedDate = job.posted_at ? formatDate(job.posted_at) : "Today";

              return (
                <div
                  key={i}
                  className="relative bg-[#432818] border border-[#99582a] rounded-[16px] p-6 mb-4 transform hover:-translate-y-[2px] hover:border-[#bb9457] transition-all duration-200 shadow-sm flex flex-col justify-between gap-4"
                >
                  {/* Deadline Urgency Badge absolutely positioned at top right */}
                  {renderDeadlineBadge(daysRemaining)}

                  <div className="space-y-3 pr-36">
                    {/* Header Row: Company name left with Clearbit Logo */}
                    <div className="flex items-center space-x-3">
                      <CompanyLogo companyName={job.company} />
                      <span className="font-bold text-[#ffe6a7] text-base leading-tight">
                        {job.company || "Confidential Company"}
                      </span>
                    </div>

                    {/* Job Title + Match Badge */}
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <h4 className="text-lg font-bold text-[#bb9457]">
                        {job.title}
                      </h4>
                      {typeof job.match_pct === "number" && (
                        (() => {
                          const tier = matchTierStyle(job.match_pct);
                          return (
                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-black border ${tier.color} ${tier.bg} ${tier.border}`}>
                              {job.match_pct}% Match
                            </span>
                          );
                        })()
                      )}
                    </div>

                    {/* Must-Have Skills — always visible, unlike the "Why this match?"
                        detail below. Union of matched_requirements + missing_requirements,
                        i.e. every requirement the LLM extracted from this specific posting,
                        regardless of whether the candidate has it. */}
                    {(() => {
                      const matched = job.matched_requirements || [];
                      const missing = job.missing_requirements || [];
                      const allRequirements = [...matched, ...missing];
                      if (allRequirements.length === 0) return null;
                      const MAX_VISIBLE = 6;
                      const visible = allRequirements.slice(0, MAX_VISIBLE);
                      const extraCount = allRequirements.length - visible.length;
                      return (
                        <div className="space-y-1.5">
                          <span className="text-[#99582a] text-[10px] font-bold uppercase tracking-wider">
                            Must-Have Skills
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {visible.map((req, ri) => {
                              const isMatched = matched.includes(req);
                              return (
                                <span
                                  key={ri}
                                  className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${
                                    isMatched
                                      ? "bg-[#1a7a4a]/15 text-[#1a7a4a] border-[#1a7a4a]/30"
                                      : "bg-[#6f1d1b] text-[#ffe6a7]/70 border-[#99582a]/40"
                                  }`}
                                >
                                  {isMatched ? "✓ " : ""}{req}
                                </span>
                              );
                            })}
                            {extraCount > 0 && (
                              <span className="px-2 py-0.5 rounded-md text-xs font-semibold text-[#99582a]">
                                +{extraCount} more
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Match Reasoning + Requirement Breakdown — expandable */}
                    {(job.match_why || (job.matched_requirements && job.matched_requirements.length > 0) || (job.missing_requirements && job.missing_requirements.length > 0)) && (
                      <div className="text-xs">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedMatchIdx(expandedMatchIdx === i ? null : i);
                          }}
                          className="text-[#bb9457] hover:text-[#ffe6a7] font-bold underline decoration-dotted underline-offset-2 transition"
                        >
                          {expandedMatchIdx === i ? "Hide match details ▲" : "Why this match? ▼"}
                        </button>
                        {expandedMatchIdx === i && (
                          <div className="mt-2 bg-[#6f1d1b] border border-[#99582a] rounded-lg p-3 space-y-2 animate-fadeIn">
                            {job.match_why && (
                              <p className="text-[#ffe6a7]/90 leading-relaxed">{job.match_why}</p>
                            )}
                            {job.matched_requirements && job.matched_requirements.length > 0 && (
                              <div>
                                <span className="text-[#1a7a4a] font-bold uppercase tracking-wider text-[10px]">You match</span>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {job.matched_requirements.map((req, ri) => (
                                    <span key={ri} className="px-2 py-0.5 rounded-md bg-[#1a7a4a]/15 text-[#1a7a4a] border border-[#1a7a4a]/30 font-semibold">
                                      ✓ {req}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {job.missing_requirements && job.missing_requirements.length > 0 && (
                              <div>
                                <span className="text-[#c0392b] font-bold uppercase tracking-wider text-[10px]">Gaps</span>
                                <div className="flex flex-wrap gap-1.5 mt-1">
                                  {job.missing_requirements.map((req, ri) => (
                                    <span key={ri} className="px-2 py-0.5 rounded-md bg-[#c0392b]/10 text-[#c0392b] border border-[#c0392b]/30 font-semibold">
                                      ✕ {req}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Location Row: pin + location • date */}
                    <div className="flex items-center text-xs text-[#99582a] space-x-1.5 font-semibold flex-wrap gap-y-1">
                      <span>📍</span>
                      <span>{job.location || "Remote"}</span>
                      <span>•</span>
                      <span>{formattedDate}</span>
                    </div>

                    {/* Description: 220 chars maximum, italicized, fade-out gradient overlay at bottom */}
                    {description && (
                      <div className="relative text-[#ffe6a7]/80 text-sm italic pr-1 leading-relaxed max-h-[72px] overflow-hidden">
                        <p>{shortDesc}</p>
                        <div className="absolute bottom-0 left-0 w-full h-4 bg-gradient-to-t from-[#432818] to-transparent pointer-events-none" />
                      </div>
                    )}
                  </div>

                  {/* Footer Row: Employment type left, Apply button right */}
                  <div className="flex items-center justify-between gap-4 flex-wrap pt-2">
                    <div>
                      {job.employment_type && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold bg-[#6f1d1b] text-[#bb9457] border border-[#99582a]/30">
                          {job.employment_type}
                        </span>
                      )}
                    </div>

                    {!hasApplyLink ? (
                      <button
                        disabled
                        className="inline-flex items-center justify-center text-center px-6 py-2.5 rounded-[50px] text-xs font-bold bg-[#99582a]/30 text-[#ffe6a7]/40 border border-[#99582a]/20 cursor-not-allowed"
                        style={{ opacity: 0.5 }}
                      >
                        Link Unavailable
                      </button>
                    ) : isExpired ? (
                      <button
                        disabled
                        className="inline-flex items-center justify-center text-center px-6 py-2.5 rounded-[50px] text-xs font-bold bg-[#99582a]/30 text-[#ffe6a7]/40 border border-[#99582a]/20 cursor-not-allowed"
                        style={{ opacity: 0.5 }}
                      >
                        Apply Now →
                      </button>
                    ) : (
                      <a
                        href={job.apply_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center text-center px-6 py-2.5 rounded-[50px] text-xs font-bold bg-[#bb9457] hover:bg-[#ffe6a7] text-[#432818] border border-transparent transition duration-200 cursor-pointer"
                      >
                        Apply Now →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Load More — reveals additional jobs from the already-fetched
              pool client-side, no extra API call. */}
          {visibleCount < sortedJobs.length && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-[#99582a] text-xs font-semibold">
                Showing {Math.min(visibleCount, sortedJobs.length)} of {sortedJobs.length} listings
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + JOBS_PAGE_SIZE)}
                className="px-6 py-2.5 rounded-full text-sm font-bold border border-[#99582a] text-[#bb9457] hover:border-[#bb9457] hover:text-[#ffe6a7] bg-[#432818] transition duration-200 cursor-pointer"
              >
                Load More ({sortedJobs.length - visibleCount} more)
              </button>
            </div>
          )}
          </>
        ) : (
          /* Empty State: Briefcase icon card */
          <div className="flex flex-col items-center justify-center text-center p-8 border border-[#99582a] bg-[#432818] rounded-[16px]">
            <div className="w-12 h-12 rounded-xl bg-[#6f1d1b] border border-[#99582a] flex items-center justify-center text-[#bb9457] mb-4 shadow-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="w-6 h-6"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20.25 14.15v4.25c0 .621-.504 1.125-1.125 1.125H4.875A1.125 1.125 0 013.75 18.4V14.15m16.5 0c0-1.22-.821-2.278-2.002-2.586L15.75 10.5M20.25 14.15l-3.3-3.15m0 0A7.5 7.5 0 005.25 9v1.5m10.5-1.5V9a7.5 7.5 0 00-10.5 0v1.5m10.5-1.5L12 10.5M5.25 10.5l-3.3 3.15m0 0A1.125 1.125 0 003 14.15v4.25M2.25 13.65v-2.625A3.375 3.375 0 015.625 7.5h12.75a3.375 3.375 0 013.375 3.375v2.625"
                />
              </svg>
            </div>
            <h4 className="text-base font-bold text-[#ffe6a7] mb-1 animate-fadeIn">
              No live listings found
            </h4>
            <p className="text-[#99582a] text-xs max-w-xs leading-relaxed">
              Try uploading a resume with more specific skills
            </p>
          </div>
        )}
      </div>
    </div>
  );
}