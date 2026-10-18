import { Component, type ReactNode } from "react";
import { primaryButton } from "./ui";

type Props = { children: ReactNode };
type State = { name: string | null };

/**
 * Last line of defence around the whole app. A render crash shows a page the
 * operator can act on instead of a blank document.
 *
 * It reports the error's *name* only. Messages from this app can carry a
 * notification body, an agent's text, or a service title, and none of that
 * belongs in an error screen; the full error still reaches the console.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { name: null };

  static getDerivedStateFromError(error: unknown): State {
    return { name: error instanceof Error && error.name ? error.name : "Error" };
  }

  componentDidCatch(error: unknown): void {
    console.error("SHark crashed while rendering", error);
  }

  render(): ReactNode {
    if (this.state.name === null) return this.props.children;
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 py-16">
        <div className="w-full max-w-md text-center">
          <h1 className="text-[26px] leading-[1.15] font-medium tracking-[-0.015em] text-ink">
            SHark stopped unexpectedly
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            Reloading usually clears it. Your notifications and answers are stored on the server, so
            nothing was lost.
          </p>
          <p className="mt-4 font-mono text-[13px] text-ink-faint">{this.state.name}</p>
          <button
            className={`${primaryButton} mt-7`}
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload SHark
          </button>
        </div>
      </div>
    );
  }
}
