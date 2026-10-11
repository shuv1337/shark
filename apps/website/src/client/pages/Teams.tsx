import type { TeamDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { EmptyState, SkeletonList } from "../components/DashboardKit";
import { PAGE_COLUMN } from "../components/SiteChrome";
import { TeamsSection } from "../components/TeamsSection";
import { api, isMissingRoute } from "../lib/api";
import { useSession } from "../lib/auth";

/** `/teams`: every team you belong to, and the way to start one. */
export function Teams() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  /** `"unsupported"` when the server predates teams; the page says so. */
  const [teams, setTeams] = useState<TeamDto[] | "unsupported" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTeams((await api.listTeams()).teams);
      setError(null);
    } catch (err) {
      if (isMissingRoute(err)) setTeams("unsupported");
      else setError("Could not load your teams.");
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) void load();
  }, [session, isPending, navigate, load]);

  if (isPending || !session) {
    return (
      <main className={`${PAGE_COLUMN} flex-1 py-10`}>
        <SkeletonList label="Loading your teams" rowClassName="h-20" rows={3} />
      </main>
    );
  }

  return (
    <main className={`${PAGE_COLUMN} flex-1 pt-10 pb-16`}>
      {teams === "unsupported" ? (
        <>
          <h1 className="text-2xl font-semibold">Teams</h1>
          <div className="mt-6">
            <EmptyState title="Teams are not available on this server">
              This deployment predates teams. Update the SHark server to create one.
            </EmptyState>
          </div>
        </>
      ) : (
        <TeamsSection
          error={error}
          onCreated={(team) =>
            setTeams((current) => [...(Array.isArray(current) ? current : []), team])
          }
          teams={teams}
        />
      )}
    </main>
  );
}
