import React from "react";

/**
 * HeroPage component featuring an animated gradient background and a modern layout.
 * 
 * @param {Object} props
 * @param {Function} props.onStart - Callback to switch to the dashboard view.
 */
export default function HeroPage({ onStart }) {
  return (
    <div className="min-h-screen flex flex-col justify-between bg-gradient-to-br from-[#6f1d1b] via-[#432818] to-[#99582a] animate-gradientShift text-[#ffe6a7] relative overflow-hidden font-sans">
      
      {/* Top Navbar */}
      <header className="w-full max-w-[1100px] mx-auto px-6 py-6 flex items-center justify-between z-10">
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <span className="bg-[#bb9457] text-[#432818] w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black">IQ</span>
          <span>ResumeIQ</span>
        </h1>
      </header>

      {/* Center Hero Content */}
      <main className="flex-grow flex flex-col items-center justify-center text-center px-6 py-12 z-10 max-w-[1100px] mx-auto w-full">
        {/* Top Badge */}
        <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-[#432818] border border-[#bb9457] text-[#bb9457] text-xs font-semibold uppercase tracking-wider mb-6 shadow-sm">
          ✦ AI-Powered Resume Intelligence
        </div>

        {/* Giant Headline */}
        <h2 className="text-5xl sm:text-7xl font-black tracking-tight leading-[1.05] mb-6 max-w-4xl text-[#ffe6a7] select-none">
          Your Resume.<br />
          <span className="text-[#bb9457]">Reimagined by AI.</span>
        </h2>

        {/* Subtext */}
        <p className="text-[#bb9457] text-base sm:text-lg max-w-[600px] leading-relaxed mb-10">
          Stop guessing. Upload your resume and get ATS score, skill gaps, job matches, and an AI-optimized rewrite — in seconds.
        </p>

        {/* CTA Button */}
        <button
          onClick={onStart}
          className="group bg-[#bb9457] text-[#432818] font-bold text-base py-4 px-12 rounded-full transition-all duration-300 transform hover:scale-[1.03] shadow-[0_10px_25px_-5px_rgba(187,148,87,0.3)] hover:shadow-[0_15px_30px_-5px_rgba(187,148,87,0.5)] focus:outline-none"
        >
          Analyze My Resume →
        </button>
      </main>

      {/* Bottom Feature Strip & Footer */}
      <div className="w-full z-10 space-y-8 pb-8">
        {/* Features Row */}
        <div className="max-w-[1100px] mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <span className="bg-[#432818] border border-[#99582a]/30 text-[#bb9457] text-sm font-semibold py-3 px-4 rounded-full shadow-sm flex items-center justify-center gap-1.5">
              <span>⚡</span> ATS Scoring
            </span>
            <span className="bg-[#432818] border border-[#99582a]/30 text-[#bb9457] text-sm font-semibold py-3 px-4 rounded-full shadow-sm flex items-center justify-center gap-1.5">
              <span>🎯</span> Skill Gap Analysis
            </span>
            <span className="bg-[#432818] border border-[#99582a]/30 text-[#bb9457] text-sm font-semibold py-3 px-4 rounded-full shadow-sm flex items-center justify-center gap-1.5">
              <span>💼</span> Live Job Matches
            </span>
            <span className="bg-[#432818] border border-[#99582a]/30 text-[#bb9457] text-sm font-semibold py-3 px-4 rounded-full shadow-sm flex items-center justify-center gap-1.5">
              <span>✍️</span> AI Resume Rewrite
            </span>
          </div>
        </div>

        {/* Technical Footer */}
        <footer className="text-center">
          <p className="text-[#99582a] text-xs font-semibold tracking-wider uppercase">
            Powered by LLaMA-3 70B · Built with FastAPI + React
          </p>
        </footer>
      </div>
    </div>
  );
}
