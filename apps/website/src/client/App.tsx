import { Route, Routes } from "react-router";
import { DocumentMetadata } from "./components/DocumentMetadata";
import { Board } from "./pages/Board";
import { CliAuthorize } from "./pages/CliAuthorize";
import { Dashboard } from "./pages/Dashboard";
import { Docs } from "./pages/Docs";
import { Landing } from "./pages/Landing";
import { Privacy, Terms } from "./pages/Legal";

export function App() {
  return (
    <>
      <DocumentMetadata />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/board" element={<Board />} />
        <Route path="/board/ask/:id" element={<Board />} />
        <Route path="/cli/authorize" element={<CliAuthorize />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </>
  );
}
