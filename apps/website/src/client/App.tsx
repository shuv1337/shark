import { Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { DocumentMetadata } from "./components/DocumentMetadata";
import { Board } from "./pages/Board";
import { CliAuthorize } from "./pages/CliAuthorize";
import { Dashboard } from "./pages/Dashboard";
import { Docs } from "./pages/Docs";
import { Join } from "./pages/Join";
import { Landing } from "./pages/Landing";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import { OAuthConsent } from "./pages/OAuthConsent";
import { TeamPage } from "./pages/Team";

/**
 * Routes. Everything the operator works in mounts inside `AppShell`, which
 * carries the header, navigation and phone tab bar.
 *
 * Outside the shell: the sign-in page, the policies, and the OAuth consent
 * screen, which has to stay a single focused decision.
 */
export function App() {
  return (
    <>
      <DocumentMetadata />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />

        <Route element={<AppShell />}>
          <Route path="/docs" element={<Docs />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/board" element={<Board />} />
          <Route path="/board/ask/:id" element={<Board />} />
          <Route path="/dashboard/teams/:teamId" element={<TeamPage />} />
          <Route path="/join/:code" element={<Join />} />
          <Route path="/cli/authorize" element={<CliAuthorize />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}
