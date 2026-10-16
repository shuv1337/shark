import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { SkeletonList } from "../components/DashboardKit";
import { InboxDetailView, InboxPanel } from "../components/InboxPanel";
import { LiveActivitiesSection } from "../components/LiveActivities";
import { PAGE_COLUMN } from "../components/SiteChrome";
import { useSession } from "../lib/auth";

/**
 * `/inbox` and `/inbox/:id`. One component for both, so returning from an item
 * keeps the filter and the loaded list instead of refetching the first page.
 *
 * The item fills the column rather than opening beside the list: the body, the
 * timeline and the response guidance are the whole task once you are there, and
 * a phone has no room for two panes anyway.
 */
export function Inbox() {
  const { id } = useParams();
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    // navigate() can return a promise; the router owns navigation errors.
    if (!isPending && !session) void navigate("/", { replace: true });
  }, [session, isPending, navigate]);

  if (isPending || !session) {
    return (
      <main className={`${PAGE_COLUMN} flex-1 py-10`}>
        <SkeletonList label="Loading your inbox" rowClassName="h-20" rows={4} />
      </main>
    );
  }

  if (id) {
    return (
      <main className={`${PAGE_COLUMN} flex-1 pt-6 pb-16`}>
        <InboxDetailView id={id} />
      </main>
    );
  }

  return (
    <main className={`${PAGE_COLUMN} flex-1 pt-10 pb-16`}>
      <InboxPanel />
      <LiveActivitiesSection />
    </main>
  );
}
