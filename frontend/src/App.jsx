import React from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { SignIn, SignUp } from "@clerk/clerk-react";
import HeroPage from "./components/HeroPage";
import Dashboard from "./components/Dashboard";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthTokenBridge from "./components/AuthTokenBridge";

/**
 * Root Application Component.
 *
 * Was a local-state toggle between HeroPage and Dashboard (`showDashboard`).
 * Now route-based instead: HeroPage/Dashboard are unchanged internally —
 * they still just take onStart/onReset callbacks — but those callbacks now
 * navigate("/dashboard") / navigate("/") instead of flipping local state.
 * This is what makes /sign-in and /sign-up real, linkable, refreshable URLs
 * (required for Clerk's <SignIn/>/<SignUp/> and for ProtectedRoute's
 * redirect-back-to-/sign-in behavior) instead of something only reachable
 * by clicking through the app from "/".
 */
function App() {
  const navigate = useNavigate();

  return (
    <>
      {/* Renders nothing — just keeps client.js supplied with a fresh
          Clerk session token. Outside <Routes> so it stays mounted no
          matter which route is active, including signed-out ones. */}
      <AuthTokenBridge />

      <Routes>
        <Route path="/" element={<HeroPage onStart={() => navigate("/dashboard")} />} />

        {/* routing="path" + the "/*" wildcard: Clerk's <SignIn/>/<SignUp/>
            manage their own sub-steps internally (password entry, email
            verification code, OAuth callback, "forgot password", etc.) by
            pushing additional path segments under this route — e.g.
            /sign-in/factor-one. The wildcard lets react-router hand all of
            those sub-paths to the same element instead of 404ing on them. */}
        <Route
          path="/sign-in/*"
          element={<SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" afterSignInUrl="/dashboard" />}
        />
        <Route
          path="/sign-up/*"
          element={<SignUp routing="path" path="/sign-up" signInUrl="/sign-in" afterSignUpUrl="/dashboard" />}
        />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard onReset={() => navigate("/")} />
            </ProtectedRoute>
          }
        />
      </Routes>
    </>
  );
}

export default App;