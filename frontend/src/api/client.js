/**
 * API client for communicating with the Resume Analyzer backend.
 */

const BACKEND_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

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
 * Uploads a resume file and triggers the parallel LLM analysis.
 * 
 * @param {File} file - The resume PDF or DOCX file to analyze.
 * @param {string} [jobDescription] - Optional target job description. When provided,
 *   ATS/Skills/Rewrite/Cover Letter are tailored to this specific posting.
 * @returns {Promise<Object>} The analysis response containing ats, skills, jobs, rewrite, and cover_letter data.
 * @throws {Error} If no file is provided, or the network request fails.
 */
export async function analyzeResume(file, jobDescription) {
  if (!file) {
    throw new Error("No file provided. Please upload a valid PDF or DOCX resume.");
  }

  const formData = new FormData();
  formData.append("file", file);
  if (jobDescription && jobDescription.trim()) {
    formData.append("job_description", jobDescription.trim());
  }

  const response = await fetch(`${BACKEND_URL}/analyze`, {
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
export async function reanalyzeResume(resumeText, jobDescription) {
  if (!resumeText) {
    throw new Error("No resume text provided.");
  }

  const response = await fetch(`${BACKEND_URL}/reanalyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      resume_text: resumeText,
      job_description: jobDescription && jobDescription.trim() ? jobDescription.trim() : null,
    }),
  });

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Re-analysis"));
  }

  return await response.json();
}

/**
 * Asks a follow-up question about an already-computed ATS score.
 * Stateless on the backend — pass the running conversation history each call
 * so the answer stays coherent across turns.
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

  const response = await fetch(`${BACKEND_URL}/ats/ask`, {
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
 * No AI generation happens here — this renders exactly the content already
 * reviewed on screen (see resume_export.py's docstring on the backend) —
 * so unlike the other client.js functions there's no new AI-content risk
 * to surface as an error state beyond a plain network/render failure.
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

  const response = await fetch(`${BACKEND_URL}/export/resume`, {
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
* Fire-and-forget from the UI's perspective — callers should not block on
 * this or treat a failure as fatal to the surrounding feature.
 *
 * @param {string} feature - Which feature this is about, e.g. 'ats_tip', 'ats_overall', 'interview_question'.
 * @param {'up'|'down'} rating
 * @param {Object} [options]
 * @param {string} [options.itemId] - Identifier for the specific item (e.g. a tip index).
 * @param {string} [options.comment] - Optional short free-text explanation.
 * @param {Object} [options.context] - Optional small snapshot of the item being rated.
 */
export async function submitFeedback(feature, rating, { itemId, comment, context } = {}) {
  const response = await fetch(`${BACKEND_URL}/feedback`, {
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