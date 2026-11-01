/** The least a dock is given, so a window too short still shows its toolbar and composer. */
const LEAST = 240;

/**
 * The height the panels beside the text may take (issue #868): from where the dock stands now to a
 * gap above the status bar. Sticky, it stands lower than its sticky top until the page scrolls it up,
 * so a height reckoned from that top runs under the status bar.
 */
export function dockRoom({
  top,
  viewport,
  status,
  gap,
}: {
  top: number;
  viewport: number;
  status: number;
  gap: number;
}): number {
  return Math.max(LEAST, Math.round(viewport - top - status - gap));
}
