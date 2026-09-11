import React from "react";

/**
 * HeroPage — graded-paper system. Includes a small preview of the
 * signature "circled score" graphic from the ATS panel, so the landing
 * page previews the actual product moment instead of a generic gradient
 * hero. Feature list uses the same mono-numeral pattern (01, 02...) used
 * across the app for visual continuity into the dashboard.
 */
export default function HeroPage({ onStart }) {
  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] font-sans">

      <header className="w-full max-w-[1000px] mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#2563EB] flex-shrink-0" />
          <span className="text-lg font-medium" style={serif}>HireMatch</span>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center text-center px-6 py-8 max-w-[900px] mx-auto w-full">
        <div className="text-[11px] font-semibold text-[#64748B] uppercase tracking-[0.15em] mb-8" style={mono}>
          AI resume analysis, scored explicitly
        </div>

        <h2 className="text-4xl sm:text-6xl font-medium tracking-tight leading-[1.15] mb-6 max-w-3xl" style={serif}>
          Your resume, <span className="text-[#2563EB]">graded honestly.</span>
        </h2>

        <p className="text-[#64748B] text-base sm:text-lg max-w-[560px] leading-relaxed mb-12">
          Not a black-box score. Upload your resume and see exactly why you scored what you did, rule by rule —
          plus skill gaps, live job matches, and an AI-optimized rewrite.
        </p>

        <button
          onClick={onStart}
          className="bg-[#0F172A] hover:bg-[#2563EB] text-white font-medium text-sm py-3.5 px-10 rounded-sm transition-colors duration-200"
        >
          Analyze my resume →
        </button>

        <p className="text-[#64748B]/70 text-[11px] mt-4 max-w-[460px]">
          Practice feedback on resume hygiene and recruiter-scan readiness — not a simulation of any specific
          company's actual ATS software.
        </p>
      </main>

      <div className="w-full pb-16">
        <div className="max-w-[900px] mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-[#E2E8F0] pt-8">
            {[
              { n: "01", label: "ATS scoring", desc: "11 explicit rules, shown" },
              { n: "02", label: "Skill gaps", desc: "with a 90-day roadmap" },
              { n: "03", label: "Live job matches", desc: "scored against your resume" },
              { n: "04", label: "AI rewrite", desc: "never fabricates metrics" },
            ].map((f) => (
              <div key={f.n} className="text-left">
                <span className="text-xs font-semibold text-[#2563EB]" style={mono}>{f.n}</span>
                <p className="text-sm font-medium text-[#0F172A] mt-1">{f.label}</p>
                <p className="text-xs text-[#64748B] mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <footer className="text-center mt-10">
          <p className="text-[#64748B] text-xs">Built with FastAPI + React</p>
        </footer>
      </div>
    </div>
  );
}