import type { DocBlock, DocSection as DocSectionData } from "../../../shared/docs/content";
import { CodeBlock } from "../../components/CodeBlock";
import { CopyField } from "../../components/CopyField";
import { Inlines } from "./inlines";
import {
  Bullets,
  DocSection,
  DocSub,
  FieldTable,
  Lead,
  Note,
  P,
  PlanTable,
  RouteTable,
  Steps,
  StylePreviews,
} from "./primitives";

/** Content-derived identity, so React keys do not depend on array position. */
function blockKey(block: DocBlock): string {
  switch (block.kind) {
    case "p":
    case "note":
      return `${block.kind}:${block.text}`;
    case "steps":
    case "bullets":
      return `${block.kind}:${block.items.join("|")}`;
    case "code":
      return `code:${block.code}`;
    case "copy":
      return `copy:${block.value}`;
    case "stylePreviews":
      return `stylePreviews:${block.styles.map((style) => style.name).join("|")}`;
    case "table":
      return `table:${block.caption}`;
  }
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "p":
      return (
        <P>
          <Inlines source={block.text} />
        </P>
      );
    case "note":
      return (
        <Note>
          <Inlines source={block.text} />
        </Note>
      );
    case "steps":
      return (
        <Steps>
          {block.items.map((item) => (
            <li key={item}>
              <Inlines source={item} />
            </li>
          ))}
        </Steps>
      );
    case "bullets":
      return (
        <Bullets>
          {block.items.map((item) => (
            <li key={item}>
              <Inlines source={item} />
            </li>
          ))}
        </Bullets>
      );
    case "code":
      return <CodeBlock code={block.code} language={block.language} />;
    case "copy":
      return (
        <div className="rounded-xl border border-line bg-surface px-4 py-3">
          <CopyField label={block.label} value={block.value} />
        </div>
      );
    case "stylePreviews":
      return <StylePreviews styles={block.styles} />;
    case "table":
      switch (block.variant) {
        case "field":
          return <FieldTable caption={block.caption} rows={block.rows} />;
        case "flag":
          return <FieldTable caption={block.caption} nameHeader="Flag" rows={block.rows} />;
        case "route":
          return <RouteTable caption={block.caption} rows={block.rows} />;
        case "plan":
          return <PlanTable caption={block.caption} rows={block.rows} />;
      }
  }
}

/** Renders one chapter of `DOC_CONTENT`: lead, then each linkable subsection. */
export function DocSectionView({ section }: { section: DocSectionData }) {
  return (
    <DocSection id={section.id}>
      <Lead>
        <Inlines source={section.lead} />
      </Lead>
      {section.subsections.map((subsection) => (
        <DocSub id={subsection.id} key={subsection.id}>
          {subsection.blocks.map((block) => (
            <Block block={block} key={blockKey(block)} />
          ))}
        </DocSub>
      ))}
    </DocSection>
  );
}
