import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LiveActivityDemo } from "../components/LiveActivityDemo";
import { NotificationStack } from "../components/NotificationStack";
import { APP_STORE_URL, PAGE_COLUMN, SiteFooter, SiteHeader } from "../components/SiteChrome";
import { primaryButton, textLink } from "../components/ui";

const SAMPLE_APPS = [
  { name: "Releases", glyph: "▲", bg: "#171713", fg: "#fff" },
  { name: "Evals", glyph: "E", bg: "#2F55D4", fg: "#fff" },
  { name: "Pantry", glyph: "P", bg: "#F3C53C", fg: "#171713" },
  { name: "Ops Log", glyph: "O", bg: "#fff", fg: "#035B49" },
  { name: "Invoices", glyph: "I", bg: "#E7F0ED", fg: "#035B49" },
];

const AGENTS = [
  { name: "Claude Code", src: "/agents/claude.png" },
  { name: "Codex", src: "/agents/codex.png" },
  { name: "OpenCode", src: "/agents/opencode.png" },
];

/**
 * Liquid-glass lens map: per pixel, how far the backdrop bends (R = x,
 * G = y). Nothing in the middle, a strong inward pull in a band along the
 * rounded edge, matching the notification card's 24px radius.
 */
function buildLensMap(width = 392, height = 96, radius = 24, band = 16): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(width, height);
  const sdf = (x: number, y: number) => {
    const qx = Math.abs(x - width / 2) - (width / 2 - radius);
    const qy = Math.abs(y - height / 2) - (height / 2 - radius);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = -sdf(x + 0.5, y + 0.5);
      let dx = 0;
      let dy = 0;
      if (d > 0 && d < band) {
        const nx = sdf(x + 1.5, y + 0.5) - sdf(x - 0.5, y + 0.5);
        const ny = sdf(x + 0.5, y + 1.5) - sdf(x + 0.5, y - 0.5);
        const len = Math.hypot(nx, ny) || 1;
        const k = (1 - d / band) ** 2;
        dx = (nx / len) * k;
        dy = (ny / len) * k;
      }
      const i = (y * width + x) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

interface NavigatorUAData {
  brands?: { brand: string }[];
}

/** Chromium can refract the backdrop through an SVG filter; others keep the blur. */
function useLensMap(): string | null {
  const [map, setMap] = useState<string | null>(null);
  useEffect(() => {
    const data = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
    if (!(data?.brands ?? []).some((b) => /Chromium/.test(b.brand))) return;
    setMap(buildLensMap());
  }, []);
  return map;
}

function AppleGlyph() {
  return (
    <svg aria-hidden="true" fill="currentColor" height="17" viewBox="0 0 17 19" width="15">
      <path d="M13.97 10.08c-.02-2.23 1.82-3.32 1.9-3.37a4.08 4.08 0 0 0-3.2-1.73c-1.35-.14-2.66.81-3.35.81-.7 0-1.77-.8-2.92-.77a4.25 4.25 0 0 0-3.58 2.19c-1.55 2.68-.4 6.62 1.09 8.8.74 1.07 1.6 2.26 2.75 2.22 1.12-.05 1.54-.71 2.89-.71 1.34 0 1.74.71 2.9.68 1.2-.02 1.95-1.07 2.66-2.15a8.8 8.8 0 0 0 1.22-2.48 3.86 3.86 0 0 1-2.36-3.5ZM11.8 3.55A3.9 3.9 0 0 0 12.7.7a4 4 0 0 0-2.6 1.35 3.72 3.72 0 0 0-.92 2.74 3.3 3.3 0 0 0 2.62-1.24Z" />
    </svg>
  );
}

function Feature({
  id,
  title,
  badge,
  children,
  lede,
}: {
  id: string;
  title: string;
  badge?: string;
  lede: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="border-t border-line py-8" id={id}>
      <h2
        className="text-[clamp(24px,3.2vw,28px)] leading-[1.15] font-medium tracking-[-0.015em] text-white"
        id={`${id}-heading`}
      >
        {title}
        {badge ? (
          <span className="ml-2.5 inline-block rounded-[11px] bg-white/12 px-[9px] py-0.5 align-[5px] text-[13px] font-normal tracking-normal text-white">
            {badge}
          </span>
        ) : null}
      </h2>
      <p className="mt-1.5 max-w-[30rem] text-pretty text-ink-muted">{lede}</p>
      {children}
    </section>
  );
}

export function Landing() {
  const lensMap = useLensMap();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className={`${PAGE_COLUMN} flex-1`}>
        <section className="pt-7 pb-9 sm:pt-10 sm:pb-12">
          <a
            className="group mb-[22px] inline-flex items-center gap-2.5 rounded-2xl bg-white/8 py-1 pr-3 pl-1 text-sm leading-[1.4] text-ink shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] transition-colors hover:bg-white/13"
            href="#apps"
          >
            <span className="rounded-xl bg-white px-[9px] py-0.5 text-[13px] font-medium text-paper">
              New
            </span>
            <span>Open your web apps in Hark, already signed in</span>
            <span
              aria-hidden="true"
              className="text-ink-muted transition-transform group-hover:translate-x-0.5"
            >
              →
            </span>
          </a>
          <h1 className="max-w-[16ch] text-[clamp(38px,6vw,54px)] leading-[1.08] font-medium tracking-[-0.02em] text-white">
            From webhook to lock screen.
          </h1>
          <p className="mt-3 max-w-[30rem] text-lg leading-[1.55] text-pretty text-ink-muted">
            Notifications, Live Activities and signed-in apps for your iPhone, from any webhook or
            agent.
          </p>
          <div className="mt-[22px] flex flex-wrap items-center gap-[22px]">
            <a
              className={primaryButton}
              href={APP_STORE_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              <AppleGlyph />
              Download for iPhone
            </a>
            <Link className={textLink} to="/docs">
              Read the docs <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <Feature
          id="notifications"
          lede="Send JSON, get a message from that sender. Ask for approvals and replies too."
          title="One request. Your lock screen."
        >
          <div
            aria-hidden="true"
            className={`mt-[18px] max-w-[24.5rem] ${lensMap ? "hark-refract" : ""}`}
          >
            <NotificationStack />
          </div>
        </Feature>

        <Feature
          id="live-activities"
          lede="Builds, deploys and agent runs on your Lock Screen and Dynamic Island."
          title="Progress you can glance at."
        >
          <LiveActivityDemo />
        </Feature>

        <Feature
          badge="New"
          id="apps"
          lede="Your sites open full screen in Hark with a signed pass. No login screens to build."
          title="Your web apps, already signed in."
        >
          <div aria-hidden="true" className="mt-[18px] flex flex-wrap gap-[18px]">
            {SAMPLE_APPS.map((app) => (
              <div
                className="flex w-[60px] flex-col items-center gap-[7px] text-xs text-ink-muted"
                key={app.name}
              >
                <div
                  className="grid size-14 place-items-center rounded-[15px] font-ios text-[22px] font-medium"
                  style={{ background: app.bg, color: app.fg }}
                >
                  {app.glyph}
                </div>
                {app.name}
              </div>
            ))}
          </div>
        </Feature>

        <Feature
          id="agents"
          lede="Pings when done, approvals before risky commands, progress as it works."
          title="Built for coding agents."
        >
          <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            {AGENTS.map((agent) => (
              <img
                alt={agent.name}
                className="size-[26px] rounded-[7px]"
                height={26}
                key={agent.name}
                src={agent.src}
                width={26}
              />
            ))}
            <code className="font-mono text-[0.9em]">
              npx skills add R44VC0RP/hark --skill hark
            </code>
          </div>
        </Feature>
      </main>

      <SiteFooter />

      <svg aria-hidden="true" className="absolute" height="0" width="0">
        <filter
          colorInterpolationFilters="sRGB"
          height="100%"
          id="hark-glass-lens"
          width="100%"
          x="0"
          y="0"
        >
          {lensMap ? (
            <feImage
              height="100%"
              href={lensMap}
              preserveAspectRatio="none"
              result="map"
              width="100%"
              x="0"
              y="0"
            />
          ) : null}
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="26"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </svg>
    </div>
  );
}
