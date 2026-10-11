/**
 * Which section of a long page the reader is looking at, from
 * `IntersectionObserver` callbacks.
 *
 * The decision is split out from the observer because an observer only reports
 * the sections whose visibility *changed*: the running set has to be kept
 * across callbacks, and that is exactly the part worth testing without a
 * browser. `order` is document order, so when a band catches two neighbouring
 * sections the upper one wins — the same "last heading scrolled past" answer
 * the docs sidebar gives, without the flicker a bare "most visible" rule has
 * on short sections.
 */
export interface SectionIntersection {
  isIntersecting: boolean;
  target: { id: string };
}

/** The sections currently in the band, in document order. */
export function visibleSections(
  current: readonly string[],
  entries: readonly SectionIntersection[],
  order: readonly string[],
): string[] {
  const visible = new Set(current);
  for (const entry of entries) {
    if (entry.isIntersecting) visible.add(entry.target.id);
    else visible.delete(entry.target.id);
  }
  return order.filter((id) => visible.has(id));
}

/** The first visible section, or `fallback` when the band caught none. */
export function activeSection(visible: readonly string[], fallback: string): string {
  return visible[0] ?? fallback;
}
