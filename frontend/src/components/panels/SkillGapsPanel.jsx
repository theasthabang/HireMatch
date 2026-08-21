import React, { useState } from "react";

/**
 * SkillGapsPanel — ledger architecture, not reskinned cards.
 *
 * Two structural departures from the old tab-based panel:
 * 1. Strengths vs Gaps render as a balance-sheet ledger (center divider
 *    rule, opposing columns) instead of two side-by-side pill-tag boxes.
 * 2. The roadmap shows all 12 weeks at once, grouped under phase headers,
 *    instead of hiding 2/3 of the plan behind clickable phase tabs — you
 *    can see and scan the whole journey, not just the phase you clicked.
 *
 * Color: Primary Blue (#2563EB) stays reserved for gaps/critical. Teal
 * (#0D9488) marks positive/complete states — strengths, matched items,
 * finished roadmap weeks — the "highlighter" to blue's "pen," both grounded
 * in the same graded-document metaphor as the rest of the app.
 */
export default function SkillGapsPanel({ data, roadmap, completedWeeks: completedWeeksProp, onCompletedWeeksChange }) {
  const [localCompletedWeeks, setLocalCompletedWeeks] = useState([]);
  const completedWeeks = completedWeeksProp !== undefined ? completedWeeksProp : localCompletedWeeks;
  const setCompletedWeeks = onCompletedWeeksChange || setLocalCompletedWeeks;

  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  if (!data) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 text-[#0F172A] text-sm animate-fadeIn">
        <div className="flex items-center space-x-3">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-[#64748B] flex-shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span className="font-semibold text-base text-[#0F172A]" style={serif}>Skills Analysis Unavailable</span>
        </div>
        <p className="mt-2 text-[#64748B]">The skills analysis is currently unavailable.</p>
      </div>
    );
  }

  const { strong_skills = [], weak_areas = [], recommended_courses = [] } = data;
  const maxRows = Math.max(strong_skills.length, weak_areas.length, 1);

  const totalWeeks = roadmap?.phases?.reduce((sum, p) => sum + (p.weeks?.length || 0), 0) || 12;

  const toggleWeek = (weekNumber) => {
    if (completedWeeks.includes(weekNumber)) {
      setCompletedWeeks(completedWeeks.filter((w) => w !== weekNumber));
    } else {
      setCompletedWeeks([...completedWeeks, weekNumber]);
    }
  };

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-sm p-8 md:p-12 space-y-14 animate-fadeIn text-[#0F172A]">

      {/* ============ Ledger: Strengths vs Gaps ============ */}
      <div>
        <div className="flex items-baseline justify-between border-b border-[#0F172A] pb-2 mb-1">
          <h3 className="text-lg font-medium" style={serif}>Skills ledger</h3>
          <span className="text-[11px] text-[#64748B]" style={mono}>
            {strong_skills.length} strengths · {weak_areas.length} gaps
          </span>
        </div>

        <div className="grid grid-cols-2">
          <div className="pr-6 border-r border-[#E2E8F0] bg-[#0D9488]/[0.03] pl-4 -ml-4">
            <div className="text-[11px] font-semibold text-[#0D9488] uppercase tracking-wide py-3">Strengths</div>
            {Array.from({ length: maxRows }).map((_, i) => (
              <div key={i} className="py-2 border-t border-[#F1F5F9] min-h-[36px] flex items-center">
                {strong_skills[i] ? (
                  <span className="text-sm text-[#0F172A]">
                    <span className="text-[#0D9488] mr-2">+</span>{strong_skills[i]}
                  </span>
                ) : (
                  <span className="text-transparent select-none">—</span>
                )}
              </div>
            ))}
          </div>
          <div className="pl-6 bg-[#2563EB]/[0.025] pr-4 -mr-4">
            <div className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wide py-3">Gaps</div>
            {Array.from({ length: maxRows }).map((_, i) => (
              <div key={i} className="py-2 border-t border-[#F1F5F9] min-h-[36px] flex items-center">
                {weak_areas[i] ? (
                  <span className="text-sm text-[#64748B]">
                    <span className="text-[#2563EB] mr-2">−</span>{weak_areas[i]}
                  </span>
                ) : (
                  <span className="text-transparent select-none">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ============ Recommended courses ============ */}
      <div className="space-y-5">
        <h3 className="text-lg font-medium text-[#0F172A] border-b border-[#E2E8F0] pb-3" style={serif}>Recommended courses</h3>
        {recommended_courses.length > 0 ? (
          <div className="divide-y divide-[#E2E8F0]">
            {recommended_courses.map((course, i) => (
              <div key={i} className="py-4 flex items-center justify-between gap-4">
                <div>
                  <h4 className="font-medium text-[#0F172A] text-sm">{course.skill}</h4>
                  <p className="text-[#64748B] text-[11px] mt-0.5">Targeted learning resource</p>
                </div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(course.resource || course.skill)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-[#0D9488] hover:text-[#2563EB] transition flex-shrink-0 whitespace-nowrap"
                >
                  {course.resource || "Search course"} →
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#64748B] text-sm italic text-center py-4">No course recommendations available.</p>
        )}
      </div>

      {/* ============ Roadmap: all weeks visible, no tab-hiding ============ */}
      <div className="space-y-6">
        <div className="flex items-baseline justify-between border-b border-[#E2E8F0] pb-3">
          <h3 className="text-lg font-medium text-[#0F172A]" style={serif}>Your 90-day roadmap</h3>
          <span className="text-[11px] text-[#64748B]" style={mono}>{completedWeeks.length} / {totalWeeks} weeks done</span>
        </div>

        {!roadmap || !roadmap.phases || roadmap.phases.length === 0 ? (
          <p className="text-[#64748B] text-sm italic text-center py-4">
            Your personalized roadmap could not be generated — try re-analyzing your resume.
          </p>
        ) : (
          <>
            <p className="text-[#64748B] text-[13px] -mt-2">
              Closing gaps in: {roadmap.target_skills ? roadmap.target_skills.join(", ") : ""}
            </p>

            <div className="w-full bg-[#F1F5F9] h-[3px] overflow-hidden">
              <div className="bg-[#0D9488] h-full transition-all duration-300" style={{ width: `${(completedWeeks.length / totalWeeks) * 100}%` }} />
            </div>

            {/* All phases stacked and always visible — nothing hidden behind a click */}
            <div className="space-y-8 pt-2">
              {roadmap.phases.map((phase, phaseIdx) => (
                <div key={phaseIdx}>
                  <div className="flex items-baseline gap-3 mb-3">
                    <h4 className="text-sm font-semibold text-[#0F172A]">{phase.phase_name}</h4>
                    <span className="text-[10px] text-[#64748B]" style={mono}>{phase.days_range}</span>
                  </div>

                  <div className="divide-y divide-[#F1F5F9]">
                    {phase.weeks?.map((week) => {
                      const isCompleted = completedWeeks.includes(week.week_number);
                      return (
                        <div key={week.week_number} className="py-3.5 flex items-start gap-4">
                          <span className="text-[11px] font-semibold text-[#64748B] flex-shrink-0 pt-0.5 w-8" style={mono}>
                            W{String(week.week_number).padStart(2, "0")}
                          </span>

                          <label className="cursor-pointer select-none group flex-shrink-0 mt-0.5">
                            <input
                              type="checkbox"
                              checked={isCompleted}
                              onChange={() => toggleWeek(week.week_number)}
                              className="sr-only"
                            />
                            <div className={`w-3.5 h-3.5 flex-shrink-0 border flex items-center justify-center transition-all duration-150 ${
                              isCompleted ? "bg-[#0D9488] border-[#0D9488]" : "border-[#64748B] group-hover:border-[#0F172A]"
                            }`}>
                              {isCompleted && <span className="text-white text-[9px] font-bold select-none">✓</span>}
                            </div>
                          </label>

                          <div className="flex-grow space-y-0.5 min-w-0">
                            <div className="flex items-start justify-between gap-3">
                              <h5 className={`text-[#0F172A] font-medium text-[13px] leading-tight ${isCompleted ? "line-through text-[#64748B]" : ""}`}>
                                {week.title}
                              </h5>
                              <span className="text-[10px] text-[#64748B] flex-shrink-0" style={mono}>{week.estimated_hours}h</span>
                            </div>
                            <p className="text-[#64748B] text-xs leading-relaxed">{week.description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}