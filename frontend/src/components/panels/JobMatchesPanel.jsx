import React, { useState, useEffect } from "react";

/**
 * CompanyLogo — minimal square, thin hairline border, graphite initials fallback.
 */
function CompanyLogo({ companyName }) {
  const [error, setError] = useState(false);

  if (!companyName) {
    return (
      <div className="w-9 h-9 flex-shrink-0 border border-[#E2E8F0] flex items-center justify-center text-[#64748B] font-semibold text-xs select-none">
        ??
      </div>
    );
  }

  const getCompanyDomain = (name) => {
    let cleaned = name.toLowerCase();
    cleaned = cleaned.replace(/\b(llc|inc|corp|co|ltd|incorporated|corporation|l\.l\.c\.)\b/gi, "");
    cleaned = cleaned.replace(/[^a-z0-9]/g, "");
    return cleaned ? `${cleaned}.com` : "";
  };

  const domain = getCompanyDomain(companyName);
  const initials = companyName.trim().substring(0, 2).toUpperCase();

  if (error || !domain) {
    return (
      <div className="w-9 h-9 flex-shrink-0 border border-[#E2E8F0] flex items-center justify-center text-[#64748B] font-semibold text-xs select-none">
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
      className="w-9 h-9 flex-shrink-0 object-cover bg-white border border-[#E2E8F0]"
    />
  );
}

/**
 * JobMatchesPanel — ranked list, not always-expanded cards.
 *
 * Structural departure: jobs render as a compact numbered ranking (like a
 * results list, tying into the same "graded/ranked" language as the rest
 * of the app) with progressive disclosure — click a row to expand it
 * in-line rather than every job permanently taking up a full card's worth
 * of space. Matched/missing requirements reuse the exact ledger pattern
 * from SkillGapsPanel (teal = matched, blue = missing) so the two-color
 * system reads consistently across panels, not just within one.
 */
export default function JobMatchesPanel({ data }) {
  const [expandedIdx, setExpandedIdx] = useState(null);
  const JOBS_PAGE_SIZE = 6;
  const [visibleCount, setVisibleCount] = useState(JOBS_PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(JOBS_PAGE_SIZE);
    setExpandedIdx(null);
  }, [data]);

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  if (!data) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-[#0F172A] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#64748B] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-semibold text-base text-[#0F172A]" style={serif}>Job Matches Unavailable</span>
        </div>
        <p className="mt-2 text-[#64748B]">The job matching analysis is currently unavailable.</p>
      </div>
    );
  }

  const { experience_level, reasoning, live_jobs = [], live_jobs_status, live_jobs_message } = data;

  const hasLiveData = live_jobs.some((job) => job.source === "live");
  const hasMatchData = live_jobs.some((job) => typeof job.match_pct === "number");
  const sortedJobs = hasMatchData
    ? [...live_jobs].sort((a, b) => (b.match_pct ?? -1) - (a.match_pct ?? -1))
    : live_jobs;

  const matchColor = (pct) => {
    if (pct >= 75) return "#0D9488";
    if (pct >= 50) return "#64748B";
    return "#2563EB";
  };

  const isSafeHttpUrl = (url) => {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const getDaysSincePosted = (postedAt) => {
    if (!postedAt) return 0;
    const postDate = new Date(postedAt);
    const today = new Date();
    postDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = today - postDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return isNaN(diffDays) ? 0 : Math.max(0, diffDays);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const deadlineLabel = (daysRemaining) => {
    if (daysRemaining <= 0) return { text: "May be closed", color: "#64748B" };
    if (daysRemaining <= 3) return { text: `Closes in ${daysRemaining}d`, color: "#2563EB" };
    if (daysRemaining <= 7) return { text: `Closes in ${daysRemaining}d`, color: "#0D9488" };
    return { text: "Open", color: "#64748B" };
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 md:p-12 space-y-8 animate-fadeIn text-[#0F172A]">

      {!hasLiveData && live_jobs_message && (
        <div className="border-l-2 border-[#E2E8F0] pl-5 py-1 text-sm leading-relaxed text-[#64748B]">
          {live_jobs_message}
        </div>
      )}

      {experience_level && (
        <div className="border-l-2 border-[#0F172A] pl-5 py-1">
          <div className="text-[#0F172A] font-semibold text-xs uppercase tracking-wide mb-1">Detected level: {experience_level}</div>
          <p className="text-[#64748B] text-xs leading-relaxed">{reasoning}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap border-b border-[#E2E8F0] pb-4">
        <h3 className="text-lg font-medium text-[#0F172A]" style={serif}>
          {hasLiveData ? "Live job postings" : "Suggested job postings"}
        </h3>
        {hasLiveData ? (
          <div className="flex items-center gap-2 text-[#0F172A]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0F172A] opacity-60"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#0F172A]"></span>
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider" style={mono}>Updated today</span>
          </div>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0D9488]" style={mono}>Curated · not real-time</span>
        )}
      </div>

      {sortedJobs.length > 0 ? (
        <>
          <div className="divide-y divide-[#E2E8F0]">
            {sortedJobs.slice(0, visibleCount).map((job, i) => {
              const hasApplyLink = !!job.apply_link && isSafeHttpUrl(job.apply_link);
              const daysElapsed = job.days_since_posting !== undefined ? job.days_since_posting : getDaysSincePosted(job.posted_at);
              const daysRemaining = Math.max(0, 30 - daysElapsed);
              const isExpired = daysRemaining <= 0;
              const isApplyDisabled = !hasApplyLink || isExpired;
              const formattedDate = job.posted_at ? formatDate(job.posted_at) : "Today";
              const isExpanded = expandedIdx === i;
              const deadline = deadlineLabel(daysRemaining);

              return (
                <div key={i} className="py-4">
                  {/* ============ Ranked row (always visible) ============ */}
                  <button
                    type="button"
                    onClick={() => setExpandedIdx(isExpanded ? null : i)}
                    className="w-full flex items-center gap-4 text-left"
                  >
                    <span className="text-xs font-semibold text-[#64748B] w-6 flex-shrink-0" style={mono}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <CompanyLogo companyName={job.company} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h4 className="font-medium text-[#0F172A] text-sm truncate">{job.title}</h4>
                        <span className="text-[#64748B] text-xs flex-shrink-0">{job.company || "Confidential"}</span>
                      </div>
                      <p className="text-[#64748B] text-[11px] mt-0.5">{job.location || "Remote"} · {formattedDate}</p>
                    </div>
                    {typeof job.match_pct === "number" && (
                      <span className="text-sm font-semibold flex-shrink-0" style={{ ...mono, color: matchColor(job.match_pct) }}>
                        {job.match_pct}%
                      </span>
                    )}
                    <span className="text-[10px] font-semibold flex-shrink-0 w-20 text-right" style={{ ...mono, color: deadline.color }}>
                      {deadline.text}
                    </span>
                    <span className="text-[#64748B] text-xs flex-shrink-0 w-4">{isExpanded ? "−" : "+"}</span>
                  </button>

                  {/* ============ Expanded detail ============ */}
                  {isExpanded && (
                    <div className="mt-4 pl-10 space-y-4 animate-fadeIn">
                      {job.description && (
                        <p className="text-[#64748B] text-[13px] leading-relaxed max-w-2xl">{job.description}</p>
                      )}

                      {job.match_why && (
                        <p className="text-[#0F172A] text-[13px] leading-relaxed max-w-2xl italic">{job.match_why}</p>
                      )}

                      {/* Ledger — same pattern as Skill Gaps: teal matched vs blue missing */}
                      {(job.matched_requirements?.length > 0 || job.missing_requirements?.length > 0) && (
                        <div className="grid grid-cols-2 max-w-xl border-t border-[#E2E8F0] pt-3">
                          <div className="pr-4 border-r border-[#E2E8F0]">
                            <div className="text-[10px] font-semibold text-[#0D9488] uppercase tracking-wide mb-1.5">You match</div>
                            {(job.matched_requirements || []).map((req, ri) => (
                              <div key={ri} className="text-xs text-[#0F172A] py-0.5"><span className="text-[#0D9488] mr-1.5">+</span>{req}</div>
                            ))}
                          </div>
                          <div className="pl-4">
                            <div className="text-[10px] font-semibold text-[#2563EB] uppercase tracking-wide mb-1.5">Gaps</div>
                            {(job.missing_requirements || []).map((req, ri) => (
                              <div key={ri} className="text-xs text-[#64748B] py-0.5"><span className="text-[#2563EB] mr-1.5">−</span>{req}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-4 pt-1">
                        {job.employment_type && (
                          <span className="text-[10px] font-semibold text-[#64748B] uppercase tracking-wide" style={mono}>{job.employment_type}</span>
                        )}
                        {!hasApplyLink ? (
                          <span className="text-xs text-[#64748B]">Link unavailable</span>
                        ) : isExpired ? (
                          <span className="text-xs text-[#64748B]">Listing may be closed</span>
                        ) : (
                          <a
                            href={job.apply_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-semibold text-[#0F172A] hover:text-[#2563EB] transition"
                          >
                            Apply now →
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {visibleCount < sortedJobs.length && (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-[#64748B] text-xs" style={mono}>
                Showing {Math.min(visibleCount, sortedJobs.length)} of {sortedJobs.length}
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount((prev) => prev + JOBS_PAGE_SIZE)}
                className="text-xs font-semibold text-[#0F172A] hover:text-[#2563EB] transition"
              >
                Load more ({sortedJobs.length - visibleCount}) →
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center text-center p-10 border border-[#E2E8F0]">
          <h4 className="text-sm font-medium text-[#0F172A] mb-1">No live listings found</h4>
          <p className="text-[#64748B] text-xs max-w-xs leading-relaxed">Try uploading a resume with more specific skills</p>
        </div>
      )}
    </div>
  );
}