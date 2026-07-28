import { Link } from "react-router";
import { BrandWordmark } from "../components/BrandWordmark";

const updated = "July 27, 2026";

function LegalLayout({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header>
        <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/" className="text-lg font-semibold">
            <BrandWordmark />
          </Link>
          <nav className="flex items-center gap-4 text-sm text-ink-subtle" aria-label="Primary">
            <Link className="transition hover:text-ink" to="/docs">
              Docs
            </Link>
            <Link className="transition hover:text-ink" to="/">
              Home
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-accent-text mb-3 text-xs font-medium uppercase">{eyebrow}</p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-3 text-sm text-ink-faint">Last updated {updated}</p>
        <div className="legal-copy mt-10 max-w-2xl space-y-8 text-sm leading-relaxed text-ink-muted">
          {children}
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function Privacy() {
  return (
    <LegalLayout eyebrow="Operator policy" title="Privacy">
      <Section title="Private deployment">
        <p>
          SHark is a personal, noncommercial, single-operator deployment. Access is limited to exact
          Apple email addresses selected by the operator. SHark does not sell personal information,
          advertise, offer public signup, or operate a paid plan.
        </p>
      </Section>

      <Section title="Information processed">
        <p>
          SHark processes the verified Apple identity and provider subject, encrypted Apple
          revocation credentials, service and device settings, webhook and interaction content,
          delivery results, scoped agent-token metadata, and encrypted push and Live Activity
          credentials needed to provide the service. Plaintext agent tokens are returned only at
          creation. Secret webhook URLs and push credentials must be treated as passwords.
        </p>
      </Section>

      <Section title="Purpose and access">
        <p>
          Information is used only to authenticate the operator, deliver notifications and Live
          Activities, return authorized interaction responses, prevent abuse and duplicates, display
          private history, support deletion, and recover the service. Removing an address from the
          allowlist immediately blocks its sessions and credential paths; offboarding revokes access
          but preserves account data until a separate deletion request.
        </p>
      </Section>

      <Section title="Providers">
        <p>
          Apple provides authentication, push delivery, and internal TestFlight distribution. Expo
          carries ordinary push notifications. exe.dev hosts the service, Cloudflare provides DNS,
          Bitwarden stores scoped secrets, rsync.net stores encrypted Restic backups, and GitHub
          publishes reviewed deployment images. Each provider applies its own terms.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          Production keeps capped, redacted local logs for seven days. Encrypted database backups
          follow a 7 daily, 4 weekly, and 6 monthly schedule. Account data remains until the
          operator performs explicit deletion. Deletion revokes Apple grants and removes sessions,
          services, devices, credentials, interactions, and activity from the active database;
          encrypted backup copies expire under the backup schedule.
        </p>
      </Section>

      <Section title="Security">
        <p>
          SHark uses encrypted transport, scoped credentials, exact-email admission, restricted
          deployment access, redacted logs, and encrypted off-host backups. No online system can
          guarantee absolute security. Exposed webhook or agent credentials should be revoked or
          rotated immediately.
        </p>
      </Section>
    </LegalLayout>
  );
}

export function Terms() {
  return (
    <LegalLayout eyebrow="Operator policy" title="Terms">
      <Section title="Personal use">
        <p>
          SHark is a personal, noncommercial system for the operator's own devices and workflows. It
          is not offered as a public service, subscription, or commercial product.
        </p>
      </Section>

      <Section title="Service behavior">
        <p>
          SHark converts authorized webhook and agent requests into notifications, interactions, and
          Live Activities. Push delivery can be delayed, duplicated, rejected, or disabled by device
          settings and third-party services. Callers must use idempotency keys and handle canceled,
          expired, denied, missing, or retried responses safely.
        </p>
      </Section>

      <Section title="Credentials and content">
        <p>
          The operator is responsible for protecting Apple access, webhook URLs, agent tokens,
          deployment credentials, and submitted content. Content and destination URLs must be lawful
          and appropriately licensed. External notification and reply content must be treated as
          untrusted data.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          SHark is provided “as is” and “as available.” Apple, Expo, exe.dev, Cloudflare, Bitwarden,
          rsync.net, and GitHub availability or policy changes may affect operation. The operator
          may suspend, restore, change, or discontinue the deployment at any time.
        </p>
      </Section>

      <Section title="License">
        <p>
          SHark remains subject to the repository's PolyForm Noncommercial License 1.0.0 and
          preserved upstream attribution. Commercial use requires a separate license from the
          upstream licensor.
        </p>
      </Section>
    </LegalLayout>
  );
}
