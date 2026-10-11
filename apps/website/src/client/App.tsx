import { Navigate, Route, Routes, useParams } from "react-router";
import { AppShell } from "./components/AppShell";
import { DocumentMetadata } from "./components/DocumentMetadata";
import { Board } from "./pages/Board";
import { CliAuthorize } from "./pages/CliAuthorize";
import { Docs } from "./pages/Docs";
import { Inbox } from "./pages/Inbox";
import { Join } from "./pages/Join";
import { Landing } from "./pages/Landing";
import { Privacy, Terms } from "./pages/Legal";
import { NotFound } from "./pages/NotFound";
import { OAuthConsent } from "./pages/OAuthConsent";
import { Settings } from "./pages/Settings";
import { TeamPage } from "./pages/Team";
import { Teams } from "./pages/Teams";

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
          <Route path="/board" element={<Board />} />
          <Route path="/board/ask/:id" element={<Board />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:id" element={<Inbox />} />
          <Route path="/teams" element={<Teams />} />
          <Route path="/teams/:teamId" element={<TeamPage />} />
          <Route path="/settings" element={<Settings />} />

          {/*
           * `/dashboard` was the one page this app had: push notifications,
           * the iPhone app's registered web app, and sign-in callbacks all
           * still point at it, so it keeps working as a redirect. The server
           * keeps serving its shell for the same reason.
           */}
          <Route path="/dashboard" element={<Navigate replace to="/inbox" />} />
          <Route path="/dashboard/teams/:teamId" element={<LegacyTeamRedirect />} />

          <Route path="/join/:code" element={<Join />} />
          <Route path="/cli/authorize" element={<CliAuthorize />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

function LegacyTeamRedirect() {
  const { teamId = "" } = useParams();
  return <Navigate replace to={`/teams/${teamId}`} />;
}
