import { IOS_DOWNLOAD_URL } from "./SiteChrome";

export function AppDownloadBanner() {
  return (
    <a
      href={IOS_DOWNLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="hark-glass group mb-8 flex items-center gap-3.5 rounded-3xl p-4 transition-[filter] hover:brightness-110"
    >
      <img
        src="/app-store-icon.png"
        alt=""
        width={40}
        height={40}
        className="size-10 shrink-0 rounded-[10px]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium text-white">
          Hark for iPhone is now available
        </span>
        <span className="mt-0.5 block truncate text-sm text-ink-muted">
          Download it from the App Store to receive notifications.
        </span>
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 text-white transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </a>
  );
}
