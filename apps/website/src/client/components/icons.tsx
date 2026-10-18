/**
 * The app's icon set, authored here rather than pulled from a library so the
 * whole UI shares one geometry: a 24 box, 1.5px strokes, round caps and joins,
 * no fills. Icons size with `className` (default `size-5`) and take their
 * colour from `currentColor`.
 */

type IconProps = {
  className?: string;
  /** Set only when an icon carries meaning no nearby text repeats. */
  title?: string;
};

function Icon({
  className = "size-5",
  title,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden={title ? undefined : "true"}
      aria-label={title}
      className={className}
      fill="none"
      role={title ? "img" : "presentation"}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      {children}
    </svg>
  );
}

/** Board: three lanes of work. */
export function IconBoard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="16" rx="1.75" width="4" x="3.5" y="4" />
      <rect height="11" rx="1.75" width="4" x="10" y="4" />
      <rect height="7" rx="1.75" width="4" x="16.5" y="4" />
    </Icon>
  );
}

/** Inbox: a tray that collects what arrived. */
export function IconInbox(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 13.5 6 5.25A1.75 1.75 0 0 1 7.67 4h8.66a1.75 1.75 0 0 1 1.67 1.25l2.5 8.25" />
      <path d="M3.5 13.5v4.75A1.75 1.75 0 0 0 5.25 20h13.5a1.75 1.75 0 0 0 1.75-1.75V13.5h-4.25l-1.25 2.5h-3.5l-1.25-2.5H3.5Z" />
    </Icon>
  );
}

/** Teams: two people. */
export function IconTeams(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="9.25" cy="8.25" r="3.25" />
      <path d="M3.5 19.5a5.75 5.75 0 0 1 11.5 0" />
      <path d="M16 5.4a3.25 3.25 0 0 1 0 6.2" />
      <path d="M17.5 14.4a5.75 5.75 0 0 1 3 5.1" />
    </Icon>
  );
}

/** Settings: sliders, the one place values are tuned. */
export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7.5h5.5M14.5 7.5H20M4 16.5h9.5M18.5 16.5H20" />
      <circle cx="12" cy="7.5" r="2.5" />
      <circle cx="16" cy="16.5" r="2.5" />
    </Icon>
  );
}

/** Docs: a page of prose. */
export function IconDocs(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 3.75h5.25L18 9v9.25A1.75 1.75 0 0 1 16.25 20h-8.75A1.75 1.75 0 0 1 5.75 18.25V5.5A1.75 1.75 0 0 1 7.5 3.75Z" />
      <path d="M12.5 4V8.5a.75.75 0 0 0 .75.75h4.5" />
      <path d="M8.75 13h6.5M8.75 16.5h4.5" />
    </Icon>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

/** Also the close affordance: one cross, used for both dismiss and "no". */
export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Icon>
  );
}

export function IconExternalLink(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 4.5H19.5V10.5" />
      <path d="M19.5 4.5 11 13" />
      <path d="M17 14v4.25A1.75 1.75 0 0 1 15.25 20H5.75A1.75 1.75 0 0 1 4 18.25V8.75A1.75 1.75 0 0 1 5.75 7H10" />
    </Icon>
  );
}

export function IconSignOut(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14.5 4.5H6.75A1.75 1.75 0 0 0 5 6.25v11.5A1.75 1.75 0 0 0 6.75 19.5h7.75" />
      <path d="M11 12h9M16.5 8.25 20 12l-3.5 3.75" />
    </Icon>
  );
}

/** No route to the server: the signal arcs, struck through. */
export function IconOffline(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8.5a15 15 0 0 1 18 0" />
      <path d="M6.5 12.25a10 10 0 0 1 11 0" />
      <path d="M10 15.9a5 5 0 0 1 4 0" />
      <circle cx="12" cy="19" r="0.9" />
      <path d="M4 20 20 4" />
    </Icon>
  );
}

/** iOS and macOS Safari share control: a box with the arrow leaving it. */
export function IconShare(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.75v10" />
      <path d="M8.5 7.25 12 3.75l3.5 3.5" />
      <path d="M7.5 10.5H6.25A1.75 1.75 0 0 0 4.5 12.25v6A1.75 1.75 0 0 0 6.25 20h11.5a1.75 1.75 0 0 0 1.75-1.75v-6a1.75 1.75 0 0 0-1.75-1.75H16.5" />
    </Icon>
  );
}

/** The "Add to Home Screen" row's mark: a plus inside a rounded square. */
export function IconPlusSquare(props: IconProps) {
  return (
    <Icon {...props}>
      <rect height="15" rx="3.25" width="15" x="4.5" y="4.5" />
      <path d="M12 8.75v6.5M8.75 12h6.5" />
    </Icon>
  );
}

/** Points down; rotate with a utility class for the other three directions. */
export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.5 9.5 12 15l5.5-5.5" />
    </Icon>
  );
}
