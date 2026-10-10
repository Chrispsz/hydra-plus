import React from "react";
import ReactDOM from "react-dom/client";
import { DebugConsoleApp } from "./debug-app";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DebugConsoleApp />
  </React.StrictMode>
);
