import type { ApiTokenDto, DeviceDto, ServiceDto } from "@hark/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { SelfHostedBadge } from "../components/AppShell";
import { BrowserNotifications } from "../components/BrowserNotifications";
import { ErrorText, SECTION, SectionHeading, SkeletonList } from "../components/DashboardKit";
import { DevicesSection } from "../components/Devices";
import { AppBuildLine, InstallAppSection, useInstallTarget } from "../components/InstallApp";
import { McpClientsSection } from "../components/McpClientsSection";
import { ServicesSection } from "../components/ServicesSection";
import { SETTINGS_COLUMN } from "../components/SiteChrome";
import { focusRing, secondaryButton } from "../components/ui";
import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";
import { useOffline } from "../lib/connection";
import { clearNavCounts } from "../lib/counts";
import { activeSection, visibleSections } from "../lib/sectionSpy";

/**
 * Settings sections, in the order they appear. The rail on `md+` is the
 * page's table of contents, and each entry is a real link so a section can be
 * sent to someone (`/settings#devices`) or bookmarked.
 *
 * Install is conditional: it only exists in a browser that has somewhere to
 * install to, so the rail is built per visit rather than fixed here.
 */
const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "notifications", label: "Browser notifications" },
  { id: "devices", label: "Devices" },
  { id: "services", label: "Services and API tokens" },
  { id: "mcp", label: "Connected MCP clients" },
] as const;

const INSTALL_SECTION = { id: "install", label: "Install app" } as const;

/**
 * The band that counts as "here": the strip just under the sticky header. A
 * section is current from the moment its heading reaches that strip until the
 * next one does.
 */
const SPY_BAND = "-20% 0px -70% 0px";

export function Settings() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const installTarget = useInstallTarget();
  const offline = useOffline();
  const sections = useMemo(
    () => (installTarget ? [...SECTIONS, INSTALL_SECTION] : [...SECTIONS]),
    [installTarget],
  );

  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [apiTokens, setApiTokens] = useState<ApiTokenDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [svc, dev, tokenState] = await Promise.all([
        api.listServices(),
        api.listDevices(),
        api.listApiTokens(),
      ]);
      setServices(svc.services);
      setDevices(dev.devices);
      setApiTokens(tokenState.tokens);
      setError(null);
    } catch {
      setError("Could not load your settings. Please refresh and try again.");
    }
  }, []);

  useEffect(() => {
    if (!isPending && !session) {
      navigate("/", { replace: true });
      return;
    }
    if (session) void refresh();
  }, [session, isPending, navigate, refresh]);

  const [visible, setVisible] = useState<string[]>([]);
  // The hashes this page wrote itself, which must not be read back as a
  // request to jump somewhere.
  const authored = useRef<string | null>(null);

  /*
   * A link from outside — `/settings#devices` in a message, a bookmark, the
   * rail — jumps straight there. Not smoothly: the reader asked for that
   * section, and animating past four others on arrival is a show, not an
   * orientation. Every section renders its heading and skeleton immediately,
   * so the target exists before any data lands.
   */
  useEffect(() => {
    const id = hash.slice(1);
    if (!id || id === authored.current) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [hash]);

  // Which section is actually on screen, rather than which one was last
  // clicked: scrolling past a section marks it in the rail.
  useEffect(() => {
    // The sections only exist once the session has resolved and the page has
    // rendered them, so this waits for it rather than observing nothing.
    if (!session || typeof IntersectionObserver === "undefined") return;
    const ids = sections.map((section) => section.id);
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => setVisible((current) => visibleSections(current, entries, ids)),
      { rootMargin: SPY_BAND },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [session, sections]);

  const active = activeSection(visible, hash.slice(1) || SECTIONS[0].id);

  /*
   * Keep the address on the section being read, so copying the URL copies
   * where you are — replacing the entry rather than adding one, because
   * scrolling is not navigation and Back must still leave Settings. Nothing
   * is written until the observer has actually reported a section, so simply
   * landing on `/settings` does not rewrite the address.
   */
  useEffect(() => {
    if (visible.length === 0) return;
    const next = `#${active}`;
    if (hash === next) return;
    authored.current = active;
    navigate(`/settings${next}`, { replace: true });
  }, [active, hash, navigate, visible]);

  if (isPending || !session) {
    return (
      <main className={`${SETTINGS_COLUMN} flex-1 py-10`}>
        <SkeletonList label="Loading your settings" rowClassName="h-20" rows={4} />
      </main>
    );
  }

  return (
    <main className={`${SETTINGS_COLUMN} flex-1 pt-10 pb-16`}>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        This browser, your devices, and everything allowed to reach them.
      </p>

      <div className="mt-8 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
        <nav aria-label="Settings sections" className="hidden md:block">
          <ul className="sticky top-24 space-y-0.5">
            {sections.map((section) => (
              <li key={section.id}>
                <Link
                  aria-current={active === section.id ? "true" : undefined}
                  className={`block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${focusRing} ${
                    active === section.id
                      ? "bg-accent-soft font-medium text-accent-text"
                      : "text-ink-muted hover:bg-surface-hover hover:text-ink"
                  }`}
                  to={`/settings#${section.id}`}
                >
                  {section.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0">
          {/* Offline is the shell's banner, not a failure of this page. */}
          <ErrorText>{offline ? null : error}</ErrorText>

          <AccountSection
            email={session.user.email}
            onSignOut={() => {
              clearNavCounts();
              void signOut().then(() => navigate("/"));
            }}
          />

          <BrowserNotifications onChanged={() => void refresh()} />

          <DevicesSection devices={devices} onRemoved={() => void refresh()} />

          <ServicesSection
            devices={devices}
            onChanged={() => void refresh()}
            onTokenRevoked={(id) =>
              setApiTokens((tokens) => tokens?.filter((token) => token.id !== id) ?? tokens)
            }
            services={services}
            tokens={apiTokens}
          />

          <McpClientsSection />

          {/*
           * The install section carries the build line. Where there is nothing
           * to install — Firefox on the desktop — the section is gone but the
           * build is still worth being able to read back, so it stands alone.
           */}
          {installTarget ? (
            <InstallAppSection />
          ) : (
            <AppBuildLine className="mt-10 border-t border-line pt-8" />
          )}
        </div>
      </div>
    </main>
  );
}

function AccountSection({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <section
      aria-labelledby="account-heading"
      className={`${SECTION} mt-0 scroll-mt-24 border-t-0 pt-0`}
      id="account"
    >
      <SectionHeading
        id="account-heading"
        title="Account"
        description="One Apple account, allowlisted on this server."
      />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{email}</p>
          <p className="mt-1.5">
            <SelfHostedBadge />
          </p>
        </div>
        <button className={secondaryButton} onClick={onSignOut} type="button">
          Sign out
        </button>
      </div>
    </section>
  );
}
