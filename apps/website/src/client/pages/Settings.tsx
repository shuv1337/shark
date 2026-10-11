import type { ApiTokenDto, DeviceDto, ServiceDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { SelfHostedBadge } from "../components/AppShell";
import { BrowserNotifications } from "../components/BrowserNotifications";
import { ErrorText, SECTION, SectionHeading, SkeletonList } from "../components/DashboardKit";
import { DevicesSection } from "../components/Devices";
import { McpClientsSection } from "../components/McpClientsSection";
import { ServicesSection } from "../components/ServicesSection";
import { SETTINGS_COLUMN } from "../components/SiteChrome";
import { focusRing, secondaryButton } from "../components/ui";
import { api } from "../lib/api";
import { signOut, useSession } from "../lib/auth";

/**
 * Settings sections, in the order they appear. The rail on `md+` is the
 * page's table of contents, and each entry is a real link so a section can be
 * sent to someone (`/settings#devices`) or bookmarked.
 */
const SECTIONS = [
  { id: "account", label: "Account" },
  { id: "notifications", label: "Browser notifications" },
  { id: "devices", label: "Devices" },
  { id: "services", label: "Services and API tokens" },
  { id: "mcp", label: "Connected MCP clients" },
] as const;

export function Settings() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  const { hash } = useLocation();

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

  // Every section renders its own heading and skeleton immediately, so a
  // `/settings#devices` link can scroll as soon as the hash is known, before
  // any of the data arrives.
  useEffect(() => {
    if (!hash) return;
    const target = document.getElementById(hash.slice(1));
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  if (isPending || !session) {
    return (
      <main className={`${SETTINGS_COLUMN} flex-1 py-10`}>
        <SkeletonList label="Loading your settings" rowClassName="h-20" rows={4} />
      </main>
    );
  }

  const current = hash.slice(1) || SECTIONS[0].id;

  return (
    <main className={`${SETTINGS_COLUMN} flex-1 pt-10 pb-16`}>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 text-sm text-ink-subtle">
        This browser, your devices, and everything allowed to reach them.
      </p>

      <div className="mt-8 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-12">
        <nav aria-label="Settings sections" className="hidden md:block">
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <Link
                  aria-current={current === section.id ? "true" : undefined}
                  className={`block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${focusRing} ${
                    current === section.id
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
          <ErrorText>{error}</ErrorText>

          <AccountSection
            email={session.user.email}
            onSignOut={() => void signOut().then(() => navigate("/"))}
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
           * Install app: Phase 2b fills this in with the Chromium install
           * prompt and the iOS Add to Home Screen steps. It renders nothing
           * until then rather than promising a button that does not exist.
           */}
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
