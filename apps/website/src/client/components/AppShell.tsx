import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { signOut, useSession } from "../lib/auth";
import { type NavCounts, useNavCounts } from "../lib/counts";
import { inEmbeddedWebView } from "../lib/platform";
import { BrandWordmark } from "./BrandWordmark";
import {
  IconBoard,
  IconChevronDown,
  IconDocs,
  IconInbox,
  IconSettings,
  IconSignOut,
  IconTeams,
  IconX,
} from "./icons";
import { DOCS_COLUMN, PAGE_COLUMN, SETTINGS_COLUMN } from "./SiteChrome";
import { focusRing, quietButton } from "./ui";

/**
 * The four primary destinations. Docs lives in the account menu, which is where
 * a reference you read once belongs; it stays a shell route.
 *
 * `count` reads the live badge from the shared nav counts, and `countLabel`
 * says what the number means for a screen reader, which cannot see that the
 * pill sits next to "Board".
 */
const NAV_ITEMS = [
  {
    to: "/board",
    label: "Board",
    icon: IconBoard,
    count: (counts: NavCounts) => counts.boardWaiting,
    countLabel: (count: number) => `${count} waiting on you`,
  },
  {
    to: "/inbox",
    label: "Inbox",
    icon: IconInbox,
    count: (counts: NavCounts) => counts.inboxAttention,
    countLabel: (count: number) => `${count} unread or needing action`,
  },
  { to: "/teams", label: "Teams", icon: IconTeams, count: () => 0, countLabel: () => "" },
  { to: "/settings", label: "Settings", icon: IconSettings, count: () => 0, countLabel: () => "" },
] as const;

/** This deployment is one operator's own server: never a plan, never a quota. */
export function SelfHostedBadge() {
  return (
    <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[13px] leading-5 font-medium text-accent-text">
      Self-hosted
    </span>
  );
}

/**
 * The application frame: one header, one content column, and a bottom tab bar
 * under `md`. Pages keep their own `<main>` so each one owns its column width.
 *
 * Inside the SHark iPhone web view the app is already framed by native chrome,
 * so the shell renders the page alone.
 */
export function AppShell() {
  const { pathname } = useLocation();
  if (inEmbeddedWebView()) return <Outlet />;
  // The docs carry a sidebar and settings a section rail, so their columns are
  // wider; the header matches whichever is underneath it rather than leaving
  // the brand mark floating left of the content.
  const column = pathname.startsWith("/docs")
    ? DOCS_COLUMN
    : pathname.startsWith("/settings")
      ? SETTINGS_COLUMN
      : PAGE_COLUMN;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader column={column} />
      {/*
       * The tab bar is `position: fixed`, so rendering it here costs nothing
       * visually and puts the primary destinations before the page in tab
       * order — the first thing a keyboard or switch user reaches on a phone.
       */}
      <TabBar />
      {/* Room for the tab bar, which floats over the content on phones. */}
      <div className="flex flex-1 flex-col pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-0">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * Header shared by the shell and the docs page, so there is one brand mark and
 * one navigation in the app rather than a variant per page. `column` sets the
 * content width to match the page underneath it.
 */
export function AppHeader({ column = PAGE_COLUMN }: { column?: string }) {
  const { data: session } = useSession();
  const counts = useNavCounts(Boolean(session));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
      <div className={`${column} flex h-14 items-center gap-4 md:h-16`}>
        <Link
          aria-label="SHark home"
          className={`shrink-0 rounded-md text-lg font-semibold ${focusRing}`}
          to={session ? "/board" : "/"}
        >
          <BrandWordmark />
        </Link>

        {session ? (
          <nav aria-label="Primary" className="ml-2 hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const count = item.count(counts);
              return (
                <NavLink
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[15px] transition-colors ${focusRing} ${
                      isActive
                        ? "bg-accent-soft font-medium text-accent-text"
                        : "text-ink-muted hover:bg-surface-hover hover:text-ink"
                    }`
                  }
                  key={item.to}
                  to={item.to}
                >
                  {item.label}
                  {count > 0 ? (
                    <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-on-accent">
                      {count > 99 ? "99+" : count}
                      <span className="sr-only">, {item.countLabel(count)}</span>
                    </span>
                  ) : null}
                </NavLink>
              );
            })}
          </nav>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          {session ? (
            <AccountMenu email={session.user.email} image={session.user.image ?? null} />
          ) : (
            <Link className={quietButton} to="/docs">
              Docs
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * Account menu: who you are signed in as, that this is a self-hosted
 * deployment, docs, and sign out.
 *
 * A real menu, so it owes the keyboard the whole pattern: opening moves focus
 * to the first item, Up/Down cycle, Home/End jump to the ends, and every way
 * out (Escape, choosing an item, the phone close button) hands focus back to
 * the trigger. A click elsewhere closes it without stealing focus.
 */
function AccountMenu({ email, image }: { email: string; image: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const items = useCallback(
    () => [...(menu.current?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])],
    [],
  );

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  // Focus the first item as the menu appears, which is where a keyboard user
  // expects to land after activating the trigger.
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      // Clicking away is a dismissal, not a return: leave focus where it went.
      if (!container.current?.contains(event.target as Node)) close(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  const onMenuKeyDown = (event: React.KeyboardEvent) => {
    const all = items();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      all[(next + all.length) % all.length]?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        return focusAt(index + 1);
      case "ArrowUp":
        return focusAt(index - 1);
      case "Home":
        return focusAt(0);
      case "End":
        return focusAt(all.length - 1);
      case "Escape":
        event.preventDefault();
        return close();
      case "Tab":
        // Tabbing out of a menu dismisses it; let focus go where it was headed.
        return close(false);
      default:
    }
  };

  const itemClass = `flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[15px] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink ${focusRing}`;

  return (
    <div className="relative" ref={container}>
      <button
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${email}`}
        className={`flex min-h-11 items-center gap-2 rounded-full pr-1 pl-1 text-ink-muted transition-colors hover:text-ink md:pr-2 ${focusRing}`}
        onClick={() => setOpen((value) => !value)}
        ref={trigger}
        type="button"
      >
        <Avatar email={email} image={image} />
        <span className="hidden max-w-40 truncate text-[15px] lg:inline">{email}</span>
        <IconChevronDown
          className={`size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div
          aria-label="Account"
          className="absolute right-0 z-40 mt-2 w-[min(17rem,calc(100vw-2rem))] rounded-xl bg-surface p-1.5 shadow-lg"
          id={menuId}
          onKeyDown={onMenuKeyDown}
          ref={menu}
          role="menu"
        >
          <div className="flex items-start justify-between gap-2 px-2.5 pt-1.5 pb-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-medium text-ink">{email}</p>
              <p className="mt-1.5">
                <SelfHostedBadge />
              </p>
            </div>
            <button
              aria-label="Close account menu"
              className={`${quietButton} -mt-1 size-8 shrink-0 justify-center px-0 md:hidden`}
              onClick={() => close()}
              type="button"
            >
              <IconX className="size-4" />
            </button>
          </div>
          <div className="border-t border-line pt-1.5">
            <Link
              className={itemClass}
              onClick={() => close()}
              role="menuitem"
              tabIndex={-1}
              to="/docs"
            >
              <IconDocs className="size-4.5 shrink-0" />
              Docs
            </Link>
            <button
              className={itemClass}
              onClick={() => {
                close();
                void signOut().then(() => navigate("/"));
              }}
              role="menuitem"
              tabIndex={-1}
              type="button"
            >
              <IconSignOut className="size-4.5 shrink-0" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ email, image }: { email: string; image: string | null }) {
  if (image) {
    return (
      <img
        alt=""
        className="size-8 shrink-0 rounded-full object-cover ring-1 ring-line"
        referrerPolicy="no-referrer"
        src={image}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-muted text-sm font-medium text-ink ring-1 ring-line"
    >
      {email.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Phone navigation: the same destinations as the header, thumb-reachable. */
function TabBar() {
  const { data: session } = useSession();
  const counts = useNavCounts(Boolean(session));
  if (!session) return null;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto flex max-w-md items-stretch">
        {NAV_ITEMS.map((item) => {
          const count = item.count(counts);
          return (
            <li className="flex-1" key={item.to}>
              <NavLink
                className={({ isActive }) =>
                  `flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium transition-colors ${focusRing} ${
                    isActive ? "text-accent-text" : "text-ink-faint hover:text-ink-muted"
                  }`
                }
                to={item.to}
              >
                <span className="relative">
                  <item.icon className="size-6" />
                  {count > 0 ? (
                    <span className="absolute -top-1 -right-2 inline-flex min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-[18px] font-semibold text-on-accent">
                      {count > 9 ? "9+" : count}
                      <span className="sr-only">, {item.countLabel(count)}</span>
                    </span>
                  ) : null}
                </span>
                {item.label}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
