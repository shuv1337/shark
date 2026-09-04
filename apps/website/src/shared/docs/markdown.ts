/**
 * Serialises the docs content model to markdown for `/docs.md` and `/agents.md`,
 * and writes the `/llms.txt` pointer file.
 *
 * There is no prose in this module: every sentence comes from `./content.ts` and
 * every heading from `./nav.ts`, which is what keeps the markdown and the HTML
 * page from drifting.
 */
import {
  DOC_CONTENT,
  DOCS_MARKDOWN_URL,
  DOCS_TITLE,
  DOCS_URL,
  type DocBlock,
  type DocTableBlock,
} from "./content";
import { docLabel } from "./nav";

/** Pipe tables cannot contain a raw `|` or a newline. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").replaceAll("|", "\\|");
}

function table(headers: string[], rows: string[][]): string {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ];
  return lines.join("\n");
}

function tableBlock(block: DocTableBlock): string {
  switch (block.variant) {
    case "field":
      return table(
        ["Field", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "flag":
      return table(
        ["Flag", "Type", "Description"],
        block.rows.map((row) => [`\`${row.name}\``, row.type, row.detail]),
      );
    case "route":
      return table(
        ["Route", "Purpose"],
        block.rows.map((row) => [`\`${row.method} ${row.path}\``, row.detail]),
      );
    case "plan":
      return table(
        ["Limit", "Self-hosted"],
        block.rows.map((row) => [row.limit, row.value]),
      );
  }
}

function blockToMarkdown(block: DocBlock): string {
  switch (block.kind) {
    case "p":
      return block.text;
    case "note":
      return `> ${block.text}`;
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item}`).join("\n");
    case "bullets":
      return block.items.map((item) => `- ${item}`).join("\n");
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "copy":
      return `${block.label}:\n\n\`\`\`text\n${block.value}\n\`\`\``;
    case "stylePreviews":
      return block.styles.map((style) => `- \`${style.name}\` — ${style.description}`).join("\n");
    case "table":
      return tableBlock(block);
  }
}

/** The full documentation as markdown, mirroring the `/docs` page exactly. */
export function docsMarkdown(): string {
  const parts: string[] = [
    `# SHark — ${DOCS_TITLE}`,
    `SHark documentation. HTML version: ${DOCS_URL}`,
  ];

  for (const section of DOC_CONTENT) {
    parts.push(`## ${docLabel(section.id)}`);
    parts.push(section.lead);

    for (const subsection of section.subsections) {
      parts.push(`### ${docLabel(subsection.id)}`);
      for (const block of subsection.blocks) parts.push(blockToMarkdown(block));
    }
  }

  return `${parts.join("\n\n")}\n`;
}

/** The /llms.txt pointer file: what SHark is, and where the docs live. */
export function llmsTxt(): string {
  return `# SHark

> SHark turns an HTTP request into a source-branded iPhone notification. Create a service in the
> dashboard, then POST JSON to its secret webhook URL. A Notification API sends one-shot pushes and
> optional approval prompts; an Activity API drives a stateful Live Activity on the Lock Screen and
> in the Dynamic Island.

## Docs

- [Documentation](${DOCS_URL}): ${DOCS_TITLE} — quickstart, Notification API, Activity API.
- [Documentation as markdown](${DOCS_MARKDOWN_URL}): the same content as plain markdown.

## Private product

- [Home](https://shark.shuv.dev/): authenticated private application.
- [Source](https://github.com/shuv1337/shark): SHark website, iOS app, CLI, and agent skill.

## Agent tools

- SHark agent skill: install directly from the reviewed operator checkout.
- \`sharkctl\`: CLI for notifications, approvals, replies, Live Activities, permission bridges, and webhook services.

## Notes

- Every request is authenticated by the webhook token in the URL; treat it as a credential.
- Device routing, interactive responses, and Live Activities are enabled in self-hosted mode.
`;
}
