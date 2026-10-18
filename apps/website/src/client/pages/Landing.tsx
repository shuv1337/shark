import { Link } from "react-router";
import { AppleButton } from "../components/AppleButton";
import { BrandWordmark } from "../components/BrandWordmark";
import { CodeBlock } from "../components/CodeBlock";
import { InlineCode } from "../components/DashboardKit";
import {
  focusRing,
  primaryButton,
  primaryButtonSmall,
  quietButton,
  textLink,
} from "../components/ui";
import { signInWithApple, useSession } from "../lib/auth";

const requestExample = `curl -X POST https://shark.shuv.dev/hooks/whk_your_token \\
  -H 'Content-Type: application/json' \\
  -d '{
    "body": "Production deployed successfully.",
    "title": "GitHub",
    "imageUrl": "https://github.com/github.png"
  }'`;

const responseExample = `{
  "ok": true,
  "eventId": "evt_Cxns2IdbF4H0TJYq",
  "delivered": 1
}`;

export function Landing() {
  const { data: session, isPending } = useSession();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-20 w-full max-w-3xl items-center justify-between px-6">
        <Link className={`rounded-md text-lg font-semibold ${focusRing}`} to="/">
          <BrandWordmark />
        </Link>
        <nav className="flex items-center gap-3" aria-label="Primary">
          <Link className={quietButton} to="/docs">
            Docs
          </Link>
          {session ? (
            <Link className={primaryButtonSmall} to="/board">
              Open SHark
            </Link>
          ) : null}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-24 text-left">
        <section>
          <h1 className="max-w-2xl text-4xl font-semibold text-balance sm:text-5xl">
            POST a webhook. Get a beautiful iOS notification.
          </h1>
          <p className="text-ink-subtle mt-5 max-w-xl text-base leading-relaxed text-pretty">
            Create a service, copy its secret webhook URL, and every POST becomes a source-branded
            communication notification on your iPhone — with your service's name and avatar.
          </p>
          <div className="mt-8">
            {session ? (
              <Link className={primaryButton} to="/board">
                Go to your board
              </Link>
            ) : (
              <AppleButton onClick={() => void signInWithApple()} disabled={isPending} />
            )}
          </div>
        </section>

        <hr className="border-line mt-20 border-t" />

        <section className="pt-14" aria-labelledby="how-it-works">
          <h2 id="how-it-works" className="text-2xl font-semibold">
            How it works
          </h2>
          <p className="text-ink-subtle mt-3 max-w-xl text-base leading-relaxed">
            POST JSON to a service's webhook URL. Only <InlineCode>body</InlineCode> is required.
          </p>

          <h3 className="mt-10 mb-3 text-sm font-semibold">Request</h3>
          <CodeBlock language="bash" code={requestExample} />

          <h3 className="mt-8 mb-3 text-sm font-semibold">Payload</h3>
          <dl className="divide-line border-line divide-y border-y">
            <PayloadRow name="body" required>
              The notification message, up to 2,000 characters.
            </PayloadRow>
            <PayloadRow name="title">The sender name shown on the notification.</PayloadRow>
            <PayloadRow name="imageUrl">A public HTTPS avatar URL.</PayloadRow>
            <PayloadRow name="url">Opened when you tap the notification.</PayloadRow>
          </dl>

          <h3 className="mt-8 mb-3 text-sm font-semibold">Response</h3>
          <CodeBlock language="json" code={responseExample} />

          <Link className={`${textLink} mt-8 text-accent-text`} to="/docs">
            Read the full docs
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      </main>

      <footer className="text-ink-faint mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6 text-xs">
        <span>SHark · webhook → iPhone, nothing else in between.</span>
        <nav className="flex items-center gap-3" aria-label="Legal">
          <Link
            className={`rounded-md transition-colors hover:text-ink-muted ${focusRing}`}
            to="/privacy"
          >
            Privacy
          </Link>
          <Link
            className={`rounded-md transition-colors hover:text-ink-muted ${focusRing}`}
            to="/terms"
          >
            Terms
          </Link>
        </nav>
      </footer>
    </div>
  );
}

/** One webhook payload field, described. Not a form field: see `Field` in DashboardKit. */
function PayloadRow({
  name,
  required,
  children,
}: {
  name: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
      <dt className="flex shrink-0 items-baseline gap-2 sm:w-44">
        <InlineCode>{name}</InlineCode>
        {required ? (
          <span className="text-ink-faint text-[0.6875rem] uppercase">required</span>
        ) : null}
      </dt>
      <dd className="text-ink-subtle text-sm leading-relaxed">{children}</dd>
    </div>
  );
}
