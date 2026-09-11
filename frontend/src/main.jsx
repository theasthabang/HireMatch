// Entrypoint rendering the React App.
//
// Two providers now wrap everything:
// - BrowserRouter (react-router-dom): needed for /sign-in, /sign-up, and
//   ProtectedRoute's redirect-to-/sign-in behavior — none of that works
//   without a router in the tree.
// - ClerkProvider (@clerk/clerk-react): makes Clerk's hooks (useAuth,
//   useUser) and components (<SignIn/>, <SignUp/>) work anywhere in the
//   app below it. ClerkProvider is nested INSIDE BrowserRouter on purpose
//   — Clerk's components use react-router's navigation internally when a
//   router is present, so the router has to exist above it, not the other
//   way around.
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App.jsx';
import './index.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!CLERK_PUBLISHABLE_KEY) {
  // Fail loudly and immediately rather than letting ClerkProvider fail
  // more cryptically later — this is almost always a missing/misnamed
  // .env entry, and the Vite-specific "must be prefixed with VITE_" rule
  // is an easy thing to trip on.
  throw new Error(
    "Missing VITE_CLERK_PUBLISHABLE_KEY. Add it to your .env file (see .env.example) " +
    "— get the value from your Clerk dashboard's API Keys page."
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    </BrowserRouter>
  </React.StrictMode>
);