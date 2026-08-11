import React, { useState } from "react";
import HeroPage from "./components/HeroPage";
import Dashboard from "./components/Dashboard";

/**
 * Root Application Component mapping between the Landing Hero page and Dashboard panel view.
 */
function App() {
  const [showDashboard, setShowDashboard] = useState(false);

  return (
    <>
      {!showDashboard ? (
        <HeroPage onStart={() => setShowDashboard(true)} />
      ) : (
        <Dashboard onReset={() => setShowDashboard(false)} />
      )}
    </>
  );
}

export default App;
