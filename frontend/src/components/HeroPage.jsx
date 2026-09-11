import React from "react";
import { SignedIn, SignedOut, UserButton, useClerk } from "@clerk/clerk-react";

/**
 * HeroPage — graded-paper system. Includes a small preview of the
 * signature "circled score" graphic from the ATS panel, so the landing
 * page previews the actual product moment instead of a generic gradient
 * hero. Feature list uses the same mono-numeral pattern (01, 02...) used
 * across the app for visual continuity into the dashboard.
 *
 * AUTH: sign-in is a POPUP — clicking the button below calls
 * useClerk().openSignIn(), which opens Clerk's sign-in box as an overlay
 * on top of this page (not inserted into the page's own layout/flow the
 * way an embedded <SignIn/> component would be). openSignIn() accepts the
 * same `appearance` config an embedded component would, so the popup is
 * still restyled to match this site's Paper (#F8FAFC) / Ink (#0F172A) /
 * Blue (#2563EB) palette and Fraunces/Inter fonts instead of Clerk's
 * default black-and-white look.
 */
export default function HeroPage({ onStart }) {
  const { openSignIn, openSignUp } = useClerk();
  const serif = { fontFamily: "'Fraunces', serif" };
  const mono = { fontFamily: "'IBM Plex Mono', monospace" };

  const clerkAppearance = {
    variables: {
      colorPrimary: "#2563EB",
      colorText: "#0F172A",
      colorTextSecondary: "#64748B",
      colorBackground: "#FFFFFF",
      colorInputBackground: "#F8FAFC",
      colorInputText: "#0F172A",
      borderRadius: "0.125rem",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    },
    elements: {
      formButtonPrimary: "bg-[#0F172A] hover:bg-[#2563EB] text-sm normal-case transition-colors duration-200",
      footerActionLink: "text-[#2563EB] hover:text-[#0F172A]",
      socialButtonsBlockButton: "border-[#E2E8F0] text-[#0F172A] hover:bg-[#F1F5F9]",
      dividerLine: "bg-[#E2E8F0]",
      dividerText: "text-[#64748B]",
      formFieldInput: "border-[#E2E8F0] focus:border-[#0F172A] rounded-sm",
      formFieldLabel: "text-[#0F172A]",
      identityPreviewEditButton: "text-[#2563EB]",
      card: "rounded-sm",
    },
  };

  const handleOpenSignIn = () => {
    openSignIn({ appearance: clerkAppearance, forceRedirectUrl: "/dashboard" });
  };

  const handleOpenSignUp = () => {
    openSignUp({ appearance: clerkAppearance, forceRedirectUrl: "/dashboard" });
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] font-sans">

      <header className="w-full max-w-[1000px] mx-auto px-6 py-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 bg-[#2563EB] flex-shrink-0" />
          <span className="text-lg font-medium" style={serif}>HireMatch</span>
        </div>

        <div className="flex items-center gap-3">
          <SignedOut>
            <button
              onClick={handleOpenSignIn}
              className="text-sm font-medium text-[#64748B] hover:text-[#0F172A] transition-colors duration-200"
            >
              Sign in
            </button>
            <button
              onClick={handleOpenSignUp}
              className="bg-[#0F172A] hover:bg-[#2563EB] text-white text-sm font-medium py-2 px-4 rounded-sm transition-colors duration-200"
            >
              Sign up
            </button>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center text-center px-6 py-16 max-w-[900px] mx-auto w-full">
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

        <SignedOut>
          <button
            onClick={handleOpenSignIn}
            className="bg-[#0F172A] hover:bg-[#2563EB] text-white font-medium text-sm py-3.5 px-10 rounded-sm transition-colors duration-200"
          >
            Sign in to analyze your resume →
          </button>
        </SignedOut>
        <SignedIn>
          <button
            onClick={onStart}
            className="bg-[#0F172A] hover:bg-[#2563EB] text-white font-medium text-sm py-3.5 px-10 rounded-sm transition-colors duration-200"
          >
            Analyze my resume →
          </button>
        </SignedIn>

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