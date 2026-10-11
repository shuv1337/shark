import { DOC_CONTENT, DOCS_TITLE } from "../../shared/docs/content";
import { DocsSidebar } from "../components/DocsSidebar";
import { DOCS_COLUMN } from "../components/SiteChrome";
import { DocSectionView } from "./docs/blocks";

/**
 * The docs page: the app shell's header and tab bar, its own sidebar, and a
 * wider column than the rest of the app. The shell widens its header to match
 * (`DOCS_COLUMN`) so the brand mark still lines up with the content.
 *
 * `DOCS_EYEBROW` is deliberately not rendered: the heading carries its own
 * weight. The constant stays in the shared content model, which also feeds the
 * Markdown and llms.txt views.
 */
export function Docs() {
  return (
    /* `hark-docs` scopes the smooth anchor scrolling in index.css to this page. */
    <div className="hark-docs">
      <div className={`${DOCS_COLUMN} flex flex-col lg:flex-row lg:gap-14`}>
        <DocsSidebar />

        <main className="min-w-0 flex-1 pt-8 pb-16 lg:pt-12 lg:pb-24">
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
