import { parseInline } from "../../../shared/docs/inline";

/**
 * Renders the markdown subset used inside docs content strings.
 *
 * The same strings are emitted verbatim by the markdown serialiser, so prose,
 * inline code, and links exist in exactly one place.
 */
export function Inlines({ source }: { source: string }) {
  const nodes: React.ReactNode[] = [];
  // Character offset doubles as a stable, unique key, as in CodeBlock.
  let offset = 0;

  for (const node of parseInline(source)) {
    if (node.kind === "code") {
      nodes.push(
        <code
          className="rounded-md bg-white/8 px-1 py-px font-mono text-[0.86em] text-white"
          key={offset}
        >
          {node.text}
        </code>,
      );
    } else if (node.kind === "link") {
      nodes.push(
        <a className="hark-link" href={node.href} key={offset}>
          {node.text}
        </a>,
      );
    } else {
      // Plain runs stay bare text nodes, so the markup matches hand-written JSX.
      nodes.push(node.text);
    }
    offset += node.text.length;
  }

  return <>{nodes}</>;
}
