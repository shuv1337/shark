import { Link, useLocation } from "react-router";
import { PAGE_COLUMN } from "../components/SiteChrome";
import { primaryButton, secondaryButton } from "../components/ui";

/** Anything the router does not recognise, including stale push deep links. */
export function NotFound() {
  const { pathname } = useLocation();
  return (
    <main className={`${PAGE_COLUMN} flex flex-1 items-center py-16`}>
      <div className="w-full max-w-xl">
        <p className="font-mono text-[13px] text-ink-faint">404</p>
        <h1 className="mt-3 text-[28px] leading-[1.15] font-medium tracking-[-0.015em] text-ink">
          There is nothing at this address
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
          The link may be from an older version of SHark, or the item it pointed at was answered and
          cleared. The board shows everything your agents are waiting on right now.
        </p>
        <p className="mt-4 overflow-hidden font-mono text-[13px] text-ellipsis whitespace-nowrap text-ink-faint">
          {pathname}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link className={primaryButton} to="/board">
            Go to the board
          </Link>
          <Link className={`${secondaryButton} h-11`} to="/dashboard">
            Open your inbox
          </Link>
        </div>
      </div>
    </main>
  );
}
