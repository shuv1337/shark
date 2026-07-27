import { Link } from "react-router";
import { AppleButton } from "../components/AppleButton";
import { BrandWordmark } from "../components/BrandWordmark";
import { CodeBlock } from "../components/CodeBlock";
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
        <Link to="/" className="text-lg font-semibold">
          <BrandWordmark />
        </Link>
        <nav className="flex items-center gap-4" aria-label="Primary">
          <Link className="text-ink-subtle hover:text-ink text-sm transition" to="/docs">
            Docs
          </Link>
          {session ? (
            <Link
              to="/dashboard"
              className="bg-accent hover:bg-accent-hover text-on-accent rounded-full px-4 py-2 text-sm font-medium transition"
            >
              Open dashboard
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
              <Link
                to="/dashboard"
                className="bg-accent hover:bg-accent-hover text-on-accent rounded-full px-6 py-3 text-sm font-medium transition"
              >
                Go to your services
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
            <Field name="body" required>
              The notification message, up to 2,000 characters.
            </Field>
            <Field name="title">The sender name shown on the notification.</Field>
            <Field name="imageUrl">A public HTTPS avatar URL.</Field>
            <Field name="url">Opened when you tap the notification.</Field>
          </dl>

          <h3 className="mt-8 mb-3 text-sm font-semibold">Response</h3>
          <CodeBlock language="json" code={responseExample} />

          <Link
            to="/docs"
            className="text-accent-text mt-8 inline-flex items-center gap-1.5 text-sm font-medium transition hover:gap-2.5"
          >
            Read the full docs
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </section>
      </main>

      <footer className="text-ink-faint mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-6 text-xs">
        <span>SHark · webhook → iPhone, nothing else in between.</span>
        <nav className="flex items-center gap-3" aria-label="Legal">
          <Link className="hover:text-ink-muted transition" to="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-ink-muted transition" to="/terms">
            Terms
          </Link>
        </nav>
      </footer>
    </div>
  );
}

function Field({
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

function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="text-ink-muted font-mono text-xs">{children}</code>;
}
