import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

const tree = (
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// Public routes ship prerendered markup, while private application routes use an
// empty shell. Adopt either shape without maintaining separate client entries.
if (root.firstChild) {
  hydrateRoot(root, tree);
} else {
  createRoot(root).render(tree);
}

/*
 * Register the push worker for every route, not only when the dashboard
 * mounts: opening `/board` first used to leave a browser with no push wiring.
 * `lib/webPush.ts` registers the same script and scope, so enabling alerts
 * later reuses this registration instead of creating a second one. The worker
 * caches nothing in this phase.
 */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
    // An unsupported context or a blocked worker must not break the app.
    console.warn("Could not register the SHark service worker", error);
  });
}
