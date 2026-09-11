import { useEffect } from "react";
import { useAuth } from "@clerk/clerk-react";
import { registerTokenGetter } from "../api/client";

/**
 * AuthTokenBridge — renders nothing. Its only job is calling
 * registerTokenGetter() so client.js's apiFetch() has a way to get a
 * fresh Clerk session token before every backend request, without
 * client.js needing to be a React component itself.
 *
 * Mount this once, near the app root, inside <ClerkProvider> (see
 * App.jsx) — not inside ProtectedRoute, since it needs to register
 * getToken (or clear it on sign-out) regardless of which route is active.
 */
export default function AuthTokenBridge() {
  const { getToken, isSignedIn } = useAuth();

  useEffect(() => {
    // Registered whenever `getToken` changes (a new Clerk session) and
    // also cleared to null on sign-out, so a signed-out apiFetch() call
    // doesn't keep attaching a stale/soon-to-be-invalid token.
    registerTokenGetter(isSignedIn ? getToken : null);
  }, [getToken, isSignedIn]);

  return null;
}