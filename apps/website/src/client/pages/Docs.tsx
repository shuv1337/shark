import { Link } from "react-router";
import { DOC_CONTENT, DOCS_EYEBROW, DOCS_TITLE } from "../../shared/docs/content";
import { BrandWordmark } from "../components/BrandWordmark";
import { DocsSidebar } from "../components/DocsSidebar";
import { DocSectionView } from "./docs/blocks";

export function Docs() {
  return (
    /* `hark-docs` scopes the smooth anchor scrolling in index.css to this page. */
    <div className="hark-docs min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
          <Link className="text-lg font-semibold" to="/">
            <BrandWordmark />
          </Link>
          <nav aria-label="Primary" className="text-sm text-ink-subtle">
            <Link className="transition hover:text-ink" to="/dashboard">
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-col px-6 lg:flex-row lg:gap-14">
        <DocsSidebar />

        <main className="min-w-0 flex-1 pt-8 pb-24 lg:pt-12">
          <p className="text-accent-text mb-3 text-xs font-medium uppercase">{DOCS_EYEBROW}</p>
          <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-balance">
            {DOCS_TITLE}
          </h1>

          <div className="mt-12 max-w-2xl space-y-20">
            {DOC_CONTENT.map((section) => (
              <DocSectionView key={section.id} section={section} />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
