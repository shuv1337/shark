import type {
  DocFieldRow,
  DocPlanRow,
  DocRouteRow,
  DocStylePreview,
} from "../../../shared/docs/content";
import { type DocAnchorId, type DocSectionId, docLabel } from "../../../shared/docs/nav";
import { Inlines } from "./inlines";

/** A top-level docs chapter. Its heading text comes from the sidebar nav. */
export function DocSection({ id, children }: { id: DocSectionId; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id}>
      <h2
        className="border-b border-line pb-4 text-2xl font-semibold tracking-tight"
        id={`${id}-heading`}
      >
        {docLabel(id)}
      </h2>
      {children}
    </section>
  );
}

/** A nested, individually linkable subsection. */
export function DocSub({ id, children }: { id: DocAnchorId; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10" id={id}>
      <h3 className="text-base font-semibold" id={`${id}-heading`}>
        {docLabel(id)}
      </h3>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-ink-subtle">{children}</p>;
}

export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-subtle">{children}</p>;
}

export function Steps({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-subtle">
      {children}
    </ol>
  );
}

export function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink-subtle">{children}</ul>
  );
}

/** Aside for a caveat that would otherwise get lost in a paragraph. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-l-2 border-accent bg-accent-wash py-2 pl-4 text-sm leading-relaxed text-ink-subtle">
      {children}
    </p>
  );
}

function TableShell({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-lg text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

function HeadRow({ headers }: { headers: string[] }) {
  return (
    <thead className="text-xs text-ink-faint">
      <tr>
        {headers.map((header) => (
          <th className="pb-3 font-medium" key={header} scope="col">
            {header}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function FieldTable({
  caption,
  rows,
  nameHeader = "Field",
}: {
  caption: string;
  rows: DocFieldRow[];
  nameHeader?: string;
}) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={[nameHeader, "Type", "Description"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={row.name}>
            <th
              className="py-3 pr-5 align-top font-mono text-xs font-normal whitespace-nowrap text-ink-muted"
              scope="row"
            >
              {row.name}
            </th>
            <td className="py-3 pr-5 align-top text-xs whitespace-nowrap text-ink-faint">
              {row.type}
            </td>
            <td className="py-3 align-top text-sm text-ink-subtle">
              <Inlines source={row.detail} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

export function RouteTable({ caption, rows }: { caption: string; rows: DocRouteRow[] }) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={["Route", "Purpose"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={`${row.method} ${row.path}`}>
            <th
              className="py-3 pr-5 align-top font-mono text-xs font-normal text-ink-muted"
              scope="row"
            >
              <span className="text-accent-text">{row.method}</span> {row.path}
            </th>
            <td className="py-3 align-top text-sm text-ink-subtle">
              <Inlines source={row.detail} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/* ------------------------------------------------------------------------ */
/* Live Activity style previews                                             */
/* ------------------------------------------------------------------------ */

/** Palette and sample state mirror the shipping widget; illustration only. */
const LA = {
  base: "#0B1512",
  primary: "#F4FBF9",
  secondary: "#B8C9C4",
  accent: "#5ED8B7",
  track: "rgba(255,255,255,0.16)",
  progress: 0.65,
} as const;

function LaGear({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      height={size}
      stroke={LA.accent}
      strokeLinecap="round"
      strokeWidth="2.1"
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
    </svg>
  );
}

function LaBar({ fullBleed }: { fullBleed?: boolean }) {
  return (
    <div
      className={fullBleed ? "h-[5px] w-full" : "h-1 w-full rounded-full"}
      style={{ background: LA.track }}
    >
      <div
        className={fullBleed ? "h-full" : "h-full rounded-full"}
        style={{ width: `${LA.progress * 100}%`, background: LA.accent }}
      />
    </div>
  );
}

function LaCard({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-2xl shadow-lg"
      style={{ background: LA.base, color: LA.primary }}
      role="img"
      aria-label={`The ${name} Live Activity layout`}
    >
      {children}
    </div>
  );
}

function LaPreviewCard({ name }: { name: string }) {
  switch (name) {
    case "ring": {
      const r = 18;
      const c = 2 * Math.PI * r;
      return (
        <LaCard name={name}>
          <div className="flex items-center gap-3.5 px-4 py-3.5">
            <span className="relative inline-flex shrink-0">
              <svg aria-hidden="true" width="44" height="44" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r={r} stroke={LA.track} strokeWidth="4" fill="none" />
                <circle
                  cx="22"
                  cy="22"
                  r={r}
                  stroke={LA.accent}
                  strokeWidth="4"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={c}
                  strokeDashoffset={c * (1 - LA.progress)}
                  transform="rotate(-90 22 22)"
                />
              </svg>
              <span
                className="absolute inset-0 grid place-items-center text-[10px] font-semibold"
                style={{ color: LA.accent }}
              >
                65%
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">Deploy #184</span>
              <span className="block text-xs font-medium" style={{ color: LA.accent }}>
                Building
              </span>
              <span className="block truncate text-[11px]" style={{ color: LA.secondary }}>
                apps/website · main
              </span>
            </span>
          </div>
        </LaCard>
      );
    }
    case "hero":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-0.5 px-4 pt-3 pb-2.5">
            <span className="flex items-center gap-2">
              <LaGear size={13} />
              <span
                className="text-[10px] font-semibold tracking-wider uppercase"
                style={{ color: LA.secondary }}
              >
                Deploy #184
              </span>
              <span className="flex-1" />
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                65%
              </span>
            </span>
            <span className="text-xl font-bold tracking-tight">Building</span>
          </div>
          <LaBar fullBleed />
        </LaCard>
      );
    case "terminal":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-1.5 px-4 py-3.5 font-mono">
            <span className="flex items-center gap-2">
              <span className="text-xs font-semibold">hark-deploy</span>
              <span className="flex-1" />
              <span
                className="size-[7px] rounded-full"
                style={{ background: LA.accent, boxShadow: `0 0 8px ${LA.accent}` }}
              />
            </span>
            <span className="text-xs">
              <span style={{ color: LA.accent }}>❯</span> building
            </span>
            <span className="text-[10px]" style={{ color: LA.secondary }}>
              # apps/website · main
            </span>
            <LaBar />
          </div>
        </LaCard>
      );
    case "steps":
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2.5 px-4 py-3.5">
            <span className="flex items-center gap-2.5">
              <LaGear size={18} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">Deploy #184</span>
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                Building
              </span>
            </span>
            <span className="flex gap-1.5">
              {[1, 2, 3, 4, 5].map((step) => (
                <span
                  className="h-[5px] flex-1 rounded-full"
                  key={step}
                  style={{ background: step / 5 <= LA.progress ? LA.accent : LA.track }}
                />
              ))}
            </span>
          </div>
        </LaCard>
      );
    default:
      return (
        <LaCard name={name}>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <span className="flex items-center gap-2.5">
              <LaGear size={19} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">Deploy #184</span>
                <span className="block text-xs font-medium" style={{ color: LA.accent }}>
                  Building
                </span>
              </span>
              <span className="text-xs font-semibold" style={{ color: LA.accent }}>
                65%
              </span>
            </span>
            <LaBar />
          </div>
        </LaCard>
      );
  }
}

export function StylePreviews({ styles }: { styles: DocStylePreview[] }) {
  return (
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      {styles.map((style) => (
        <figure key={style.name} className="m-0">
          <LaPreviewCard name={style.name} />
          <figcaption className="mt-2 text-xs leading-relaxed text-ink-subtle">
            <code className="font-mono text-ink-muted">{style.name}</code> — {style.description}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

export function PlanTable({ caption, rows }: { caption: string; rows: DocPlanRow[] }) {
  return (
    <TableShell caption={caption}>
      <HeadRow headers={["Limit", "Self-hosted"]} />
      <tbody className="divide-y divide-line border-y border-line">
        {rows.map((row) => (
          <tr key={row.limit}>
            <th className="py-3 pr-5 text-sm font-normal text-ink-subtle" scope="row">
              {row.limit}
            </th>
            <td className="py-3 font-mono text-xs text-ink-muted">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
