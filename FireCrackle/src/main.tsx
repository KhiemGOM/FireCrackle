import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary, ErrorNotifications } from "./components/ErrorNotifications";
import { installGlobalErrorHandlers } from "./lib/appErrors";

const removeErrorHandlers = installGlobalErrorHandlers(window);
import.meta.hot?.dispose(removeErrorHandlers);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
    <ErrorNotifications />
  </React.StrictMode>,
);
