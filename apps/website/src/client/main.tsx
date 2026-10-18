import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./index.css";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { isStandalone } from "./lib/pwaInstall";
import { registerServiceWorker } from "./lib/pwaUpdate";

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
 * Register the worker for every route, not only when the dashboard mounts:
 * opening `/board` first used to leave a browser with no push wiring.
 *
 * This goes through `lib/pwaUpdate.ts`, which registers the same script and
 * scope exactly once and then watches the registration, so the shell can offer
 * a waiting build instead of a worker taking over mid-answer. `lib/webPush.ts`
 * registers the same script and scope too, so enabling alerts later reuses
 * this registration rather than creating a second one.
 */
registerServiceWorker().catch((error: unknown) => {
  // An unsupported context or a blocked worker must not break the app.
  console.warn("Could not register the SHark service worker", error);
});

/*
 * Older iOS home-screen apps report standalone only through
 * `navigator.standalone`; everything else answers the `display-mode` media
 * query. The class lets `index.css` treat both the same way.
 */
if (isStandalone()) document.documentElement.classList.add("hark-standalone");
