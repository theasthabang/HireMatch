/**
 * API client for communicating with the Resume Analyzer backend.
 *
 * Every request now goes through apiFetch() instead of calling fetch()
 * directly — it attaches `Authorization: Bearer <clerk token>` and handles
 * an expired/invalid session the same way everywhere, instead of each
 * function reimplementing that.
 */

const BACKEND_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// ---------------------------------------------------------------------------
// Token wiring.
// ---------------------------------------------------------------------------
// client.js is a plain module, not a React component — it can't call
// useAuth() itself. Instead, <AuthTokenBridge/> (a component rendered once
// near the app root, inside ClerkProvider) calls useAuth().getToken() and
// hands the function itself in here via registerTokenGetter(). Every
// exported function below then calls that stored function right before
// each request, so the token is always freshly fetched (Clerk's getToken()
// returns a cached token and transparently refreshes it only when it's
// actually close to expiring — callers never need to think about that).
let _getToken = null;

export function registerTokenGetter(getTokenFn) {
  _getToken = getTokenFn;
}

async function authHeaders() {
  if (!_getToken) return {};
  try {
    const token = await _getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch (err) {
    // getToken() itself throwing (e.g. session genuinely gone) shouldn't
    // crash the caller — proceed with no auth header, which the backend
    // will correctly turn into a 401, handled uniformly below.
    console.warn("Could not retrieve Clerk session token:", err);
    return {};
  }
}

/**
 * Shared fetch wrapper: attaches the auth header, and on a 401 redirects
 * to /sign-in instead of letting the caller's .then()/JSON-parsing code
 * blow up on an auth error it has no way to handle sensibly. Every
 * exported function in this file should call this instead of fetch()
 * directly.
 */
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), ...(await authHeaders()) };
  const response = await fetch(`${BACKEND_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    // Missing/expired/invalid session — there's no graceful in-page
    // recovery from this (the backend has already rejected the request),
    // so send the user to sign back in rather than surfacing a raw
    // "Analysis failed" error for what's actually an auth problem.
    window.location.href = "/sign-in";
    // Throw so the caller's own error handling doesn't ALSO run and show
    // a second, confusing error message during the redirect.
    throw new Error("Session expired. Redirecting to sign-in…");
  }

  return response;
}

/**
 * Extracts a user-friendly error message from a failed fetch Response.
 * Shared across all client functions so error-parsing logic lives in one place.
 */
async function extractErrorMessage(response, fallbackPrefix) {
  let errorMessage = `${fallbackPrefix} failed with status code ${response.status}.`;
  try {
    const errorData = await response.json();
    if (errorData && errorData.detail) {
      errorMessage = typeof errorData.detail === "string"
        ? errorData.detail
        : JSON.stringify(errorData.detail);
    } else if (errorData && errorData.error) {
      errorMessage = errorData.error;
    }
  } catch (parseError) {
    // Fallback if the error response is not valid JSON
  }
  return errorMessage;
}

/**
 * Fetches the list of selectable industries/backgrounds for the dropdown
 * shown before upload. "general" is always first — selecting it (or never
 * calling this at all) means zero taxonomy involvement, identical to the
 * app's behavior before this feature existed.
 *
 * Not auth-gated on the backend (GET /industries is a public route), but
 * still goes through apiFetch for consistency — the auth header is simply
 * ignored server-side if present.
 *
 * @returns {Promise<Array<{id: string, label: string}>>}
 */
export async function fetchIndustries() {
  const response = await apiFetch("/industries");
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Fetching industries"));
  }
  const data = await response.json();
  return data.industries || [];
}

export async function analyzeResume(file, jobDescription, industry) {
  if (!file) {
    throw new Error("No file provided. Please upload a valid PDF or DOCX resume.");
  }

  const formData = new FormData();
  formData.append("file", file);
  if (jobDescription && jobDescription.trim()) {
    formData.append("job_description", jobDescription.trim());
  }
  if (industry && industry !== "general") {
    formData.append("industry", industry);
  }

  const response = await apiFetch("/analyze", {
    method: "POST",
    body: formData,
    // Note: Do not set Content-Type header manually.
    // The browser must automatically set it along with the correct boundary parameter.
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Analysis"));
  }

  return await response.json();
}

/**
 * Sends updated resume text directly to the /reanalyze endpoint.
 *
 * @param {string} resumeText - The plain text of the resume to re-analyze.
 * @param {string} [jobDescription] - Optional target job description, same tailoring behavior as analyzeResume.
 * @returns {Promise<Object>} The updated analysis response.
 */
export async function reanalyzeResume(resumeText, jobDescription, industry) {
  if (!resumeText) {
    throw new Error("No resume text provided.");
  }

  const response = await apiFetch("/reanalyze", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resume_text: resumeText,
      job_description: jobDescription && jobDescription.trim() ? jobDescription.trim() : null,
      industry: industry && industry !== "general" ? industry : null,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Re-analysis"));
  }

  return await response.json();
}

/**
 * Asks a follow-up question about an already-computed ATS score.
 * Stateless on the backend — pass the running conversation history each
 * call so the answer stays coherent across turns.
 *
 * @param {Object} atsSummary - The ats object from the analysis response (score, rule_scores, verdict, calibration_notes, etc.)
 * @param {string} question - The user's follow-up question.
 * @param {string} [resumeText] - Optional resume text for grounding.
 * @param {Array<{question: string, answer: string}>} [history] - Prior turns in this conversation, oldest first.
 * @returns {Promise<string>} The plain-text answer.
 */
export async function askAboutScore(atsSummary, question, resumeText, history) {
  if (!question || !question.trim()) {
    throw new Error("Please enter a question.");
  }

  const response = await apiFetch("/ats/ask", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ats_summary: atsSummary || {},
      question: question.trim(),
      resume_text: resumeText || null,
      history: history || [],
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Follow-up question"));
  }

  const data = await response.json();
  return data.answer;
}

/**
 * Requests a downloadable .docx built from the summary/bullets the user has
 * already accepted in the Rewrite panel, and triggers a browser download.
 *
 * @param {Object} params
 * @param {string} [params.fullName] - Candidate's name for the doc header, if known.
 * @param {string} [params.contactLine] - Optional single line of contact info.
 * @param {string} params.summary - The optimized summary text.
 * @param {string[]} params.bullets - Accepted bullet text, in order.
 */
export async function exportResumeDocx({ fullName, contactLine, summary, bullets }) {
  if (!summary && (!bullets || bullets.length === 0)) {
    throw new Error("Nothing to export yet — accept a summary or at least one bullet first.");
  }

  const response = await apiFetch("/export/resume", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      full_name: fullName || null,
      contact_line: contactLine || null,
      summary: summary || null,
      bullets: bullets || [],
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Resume export"));
  }

  // Extract the server-suggested filename from Content-Disposition rather
  // than hardcoding "resume.docx" — main.py names it after the candidate
  // when a name was provided.
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : "resume.docx";

  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * Records a thumbs up/down on a specific AI-generated suggestion.
 * Fire-and-forget from the UI's perspective — callers should not block on
 * this or treat a failure as fatal to the surrounding feature.
 *
 * Not auth-gated on the backend (feedback stays anonymous by design), but
 * still routed through apiFetch for consistency.
 *
 * @param {string} feature - Which feature this is about, e.g. 'ats_tip', 'ats_overall', 'interview_question'.
 * @param {'up'|'down'} rating
 * @param {Object} [options]
 * @param {string} [options.itemId] - Identifier for the specific item (e.g. a tip index).
 * @param {string} [options.comment] - Optional short free-text explanation.
 * @param {Object} [options.context] - Optional small snapshot of the item being rated.
 */
export async function submitFeedback(feature, rating, { itemId, comment, context } = {}) {
  const response = await apiFetch("/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      feature,
      rating,
      item_id: itemId || null,
      comment: comment || null,
      context: context || null,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Feedback submission"));
  }

  return await response.json();
}