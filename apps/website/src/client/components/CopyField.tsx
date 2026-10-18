import { useEffect, useState } from "react";

interface Props {
  label?: string;
  value: string;
}

export function CopyField({ label, value }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable over plain http; select-all still works.
    }
  };

  return (
    <div className="min-w-0">
      {label ? (
        <div className="mb-1 text-xs font-medium text-ink-subtle uppercase">{label}</div>
      ) : null}
      <div className="flex items-center gap-2">
        <code
          className="block min-w-0 flex-1 truncate font-mono text-[13px] leading-relaxed text-ink-muted"
          title={value}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="grid size-9 shrink-0 place-items-center rounded-lg text-ink-subtle transition hover:bg-surface-hover hover:text-ink"
          aria-label={copied ? "Webhook URL copied" : "Copy webhook URL"}
          title={copied ? "Copied" : "Copy webhook URL"}
        >
          {copied ? (
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
              <path
                d="m3 8.5 3.1 3L13 4.8"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.5"
              />
            </svg>
          ) : (
            <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 16 16">
              <rect
                height="7"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.25"
                width="7"
                x="5.5"
                y="5.5"
              />
              <path
                d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="1.25"
              />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
