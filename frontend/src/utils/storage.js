/**
 * Safe localStorage wrapper.
 *
 * localStorage can throw (private/incognito mode with storage disabled,
 * storage quota exceeded, etc.) — every call here is wrapped so a storage
 * failure degrades to "nothing persists this session" instead of crashing
 * the app.
 */

export function loadJSON(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`Could not read localStorage key "${key}":`, err);
    return fallback;
  }
}

export function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Could not write localStorage key "${key}":`, err);
    return false;
  }
}

export function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    console.warn(`Could not remove localStorage key "${key}":`, err);
  }
}

// Centralized keys so every consumer references the same string.
export const STORAGE_KEYS = {
  SESSION: "resumeiq:session", // { results, resumeText, jobDescription, completedWeeks, activeTab }
  ATS_EXPLAINER_DISMISSED: "resumeiq:onboarding:ats_explainer_dismissed",
};