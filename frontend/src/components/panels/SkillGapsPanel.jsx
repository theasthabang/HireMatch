import React, { useState } from "react";

/**
 * SkillGapsPanel redesigned for the split-screen dashboard view.
 * Utilizes #432818 bg card containers, #99582a borders, 16px border-radius, and 24px padding.
 */
export default function SkillGapsPanel({ data, roadmap, completedWeeks: completedWeeksProp, onCompletedWeeksChange }) {
  const [activePhaseIdx, setActivePhaseIdx] = useState(0);
  // Falls back to local state only if no persisted-state props are passed
  // (keeps this component usable standalone), but Dashboard always supplies
  // completedWeeksProp/onCompletedWeeksChange so progress is lifted and persisted.
  const [localCompletedWeeks, setLocalCompletedWeeks] = useState([]);
  const completedWeeks = completedWeeksProp !== undefined ? completedWeeksProp : localCompletedWeeks;
  const setCompletedWeeks = onCompletedWeeksChange || setLocalCompletedWeeks;
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
          <span className="font-bold text-base text-[#ffe6a7]">Skills Analysis Unavailable</span>
        </div>
        <p className="mt-2 text-[#bb9457]">
          The skills analysis is currently unavailable.
        </p>
      </div>
    );
  }

  const { strong_skills = [], weak_areas = [], recommended_courses = [] } = data;

  return (
    <div className="bg-[#432818] border border-[#99582a] rounded-[16px] p-6 shadow-2xl space-y-8 animate-fadeIn text-[#ffe6a7]">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        {/* Strong Skills (Gold BG, Dark Brown Text) */}
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
            <h3 className="font-bold text-[#ffe6a7] text-base uppercase tracking-wider">Strong Skills</h3>
          </div>
          <div className="bg-[#6f1d1b]/30 border border-[#99582a] rounded-xl p-5 min-h-[140px]">
            {strong_skills.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {strong_skills.map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold bg-[#bb9457] text-[#432818] border border-[#ffe6a7]/20 shadow-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[#99582a] text-sm italic">No strong skills identified.</p>
            )}
          </div>
        </div>

        {/* Weak Areas (Deep Red BG, Cream Text, Muted Border) */}
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
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <h3 className="font-bold text-[#ffe6a7] text-base uppercase tracking-wider">Skill Gaps</h3>
          </div>
          <div className="bg-[#6f1d1b]/30 border border-[#99582a] rounded-xl p-5 min-h-[140px]">
            {weak_areas.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {weak_areas.map((skill, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-semibold bg-[#6f1d1b] text-[#ffe6a7] border border-[#99582a] shadow-sm"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[#99582a] text-sm italic">No significant skill gaps found.</p>
            )}
          </div>
        </div>
      </div>

      <hr className="border-[#99582a]" />

      {/* Recommended Courses List with Course Cards (#432818 bg, resource link #bb9457) */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-[#bb9457]">Recommended Courses</h3>
        {recommended_courses.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {recommended_courses.map((course, i) => (
              <div
                key={i}
                className="bg-[#432818] border border-[#99582a] rounded-xl p-5 hover:bg-[#6f1d1b]/20 transition flex flex-col justify-between"
              >
                <div className="space-y-1 mb-4">
                  <h4 className="font-extrabold text-[#ffe6a7] text-sm leading-tight">
                    {course.skill}
                  </h4>
                  <p className="text-[#99582a] text-[10px] font-bold uppercase tracking-wider">
                    Targeted learning resource
                  </p>
                </div>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(
                    course.resource || course.skill
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 text-xs font-bold text-[#bb9457] hover:text-[#ffe6a7] transition self-start"
                >
                  <span>{course.resource || "Search course"}</span>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2.5}
                    stroke="currentColor"
                    className="w-3.5 h-3.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                    />
                  </svg>
                </a>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#99582a] text-sm italic text-center py-4 bg-[#6f1d1b]/20 rounded-xl border border-[#99582a]">
            No course recommendations available.
          </p>
        )}
      </div>

      <hr className="border-[#99582a]" />

      {/* Your 90-Day Roadmap */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-[#bb9457]">Your 90-Day Roadmap</h3>
        {!roadmap || !roadmap.phases || roadmap.phases.length === 0 ? (
          <p className="text-[#99582a] text-sm italic text-center py-4 bg-[#6f1d1b]/20 rounded-xl border border-[#99582a]">
            Your personalized roadmap could not be generated — try re-analyzing your resume.
          </p>
        ) : (
          <div className="space-y-6">
            <p className="text-[#bb9457] text-[13px] font-semibold mb-4">
              A personalized plan to close your gaps in: {roadmap.target_skills ? roadmap.target_skills.join(", ") : ""}
            </p>

            {/* Overall Progress Bar */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold text-[#ffe6a7]">
                <span>Overall Progress</span>
                <span>{completedWeeks.length} of 12 weeks completed</span>
              </div>
              <div className="w-full bg-[#432818] rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-[#1a7a4a] h-full transition-all duration-300 rounded-full"
                  style={{ width: `${(completedWeeks.length / 12) * 100}%` }}
                />
              </div>
            </div>

            {/* Phase Tabs */}
            <div className="flex flex-wrap gap-2">
              {roadmap.phases.map((phase, idx) => {
                const isActive = activePhaseIdx === idx;
                return (
                  <button
                    key={idx}
                    onClick={() => setActivePhaseIdx(idx)}
                    className={`px-4 py-2 rounded-full text-xs font-bold transition-all duration-200 ${
                      isActive
                        ? "bg-[#bb9457] text-[#432818]"
                        : "bg-[#6f1d1b] text-[#99582a] border border-[#99582a]/30 hover:border-[#bb9457]/50"
                    }`}
                  >
                    {phase.phase_name} ({phase.days_range})
                  </button>
                );
              })}
            </div>

            {/* Vertical Timeline */}
            <div className="relative pl-1 mt-4 space-y-8">
              {roadmap.phases[activePhaseIdx]?.weeks?.map((week, idx, arr) => {
                const isCompleted = completedWeeks.includes(week.week_number);
                return (
                  <div key={week.week_number} className="flex gap-4 items-stretch relative">
                    {/* Badge and Connecting Line */}
                    <div className="flex flex-col items-center flex-shrink-0 relative">
                      <div className="w-8 h-8 rounded-full bg-[#bb9457] text-[#432818] font-bold flex items-center justify-center text-sm z-10">
                        {week.week_number}
                      </div>
                      {idx < arr.length - 1 && (
                        <div className="w-[2px] bg-[#99582a] absolute top-8 bottom-[-32px] z-0" />
                      )}
                    </div>

                    {/* Card */}
                    <div
                      className={`flex-grow bg-[#6f1d1b] border border-[#99582a] rounded-[10px] p-[14px_18px] transition-all duration-200 relative ${
                        isCompleted
                          ? "border-l-[3px] border-l-[#1a7a4a] opacity-70"
                          : ""
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Checkbox */}
                        <label className="cursor-pointer select-none group flex-shrink-0 mt-0.5">
                          <input
                            type="checkbox"
                            checked={isCompleted}
                            onChange={() => {
                              if (isCompleted) {
                                setCompletedWeeks(completedWeeks.filter((w) => w !== week.week_number));
                              } else {
                                setCompletedWeeks([...completedWeeks, week.week_number]);
                              }
                            }}
                            className="sr-only"
                          />
                          <div
                            className={`w-[18px] h-[18px] flex-shrink-0 rounded border-2 flex items-center justify-center transition-all duration-150 ${
                              isCompleted
                                ? "bg-[#bb9457] border-[#bb9457]"
                                : "border-[#99582a] bg-[#6f1d1b] group-hover:border-[#bb9457]"
                            }`}
                          >
                            {isCompleted && (
                              <span className="text-[#432818] text-xs font-black select-none">✓</span>
                            )}
                          </div>
                        </label>

                        {/* Text Content */}
                        <div className="flex-grow space-y-1 pb-4">
                          <h4
                            className={`text-[#ffe6a7] font-bold text-sm leading-tight transition-all duration-150 ${
                              isCompleted ? "line-through" : ""
                            }`}
                          >
                            {week.title}
                          </h4>
                          <p className="text-[#99582a] text-[13px] leading-relaxed">
                            {week.description}
                          </p>
                        </div>
                      </div>

                      {/* Estimated Hours Pill bottom-right */}
                      <span className="absolute bottom-3 right-4 bg-[#432818] text-[#bb9457] text-[11px] px-2.5 py-0.5 rounded-full font-semibold">
                        {week.estimated_hours} hrs/week
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}