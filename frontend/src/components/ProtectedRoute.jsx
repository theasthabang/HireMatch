import React from "react";
import { useAuth } from "@clerk/clerk-react";
import { Navigate, useLocation } from "react-router-dom";

/**
 * ProtectedRoute — gates any page that requires a signed-in user.
 *
 * Three states, not two:
 * 1. isLoaded === false: Clerk hasn't finished checking whether a session
 *    exists yet (this happens on every hard page load/refresh — Clerk
 *    reads the session from a cookie/storage asynchronously). Render a
 *    loading state here, NOT a redirect — redirecting before Clerk has
 *    answered would bounce an actually-signed-in user to /sign-in for a
 *    visible flash on every refresh, which is exactly the "graceful, not
 *    crash-y" handling this needs.
 * 2. isLoaded === true, isSignedIn === false: genuinely not signed in —
 *    redirect to /sign-in, carrying the page they were trying to reach in
 *    router state so sign-in can send them back afterward if you wire
 *    that up later.
 * 3. isLoaded === true, isSignedIn === true: render the page.
 */
export default function ProtectedRoute({ children }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] text-[#64748B] text-sm">
        Loading…
      </div>
    );
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace state={{ from: location }} />;
  }

  return children;
}