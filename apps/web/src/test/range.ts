/**
 * jsdom has no layout, and a `Range` there has neither of the two methods ProseMirror calls when it
 * scrolls the selection into view - which every mark step asks it to do, and which it only does
 * while the surface has the focus. Both answer nothing rather than pretending to measure, which
 * leaves the scroll a no-op instead of an uncaught `TypeError` from inside a click.
 *
 * **Called by a suite that mounts a surface, never put into `setup.ts`.** It turns "this path needs
 * layout" from a loud `TypeError` into a silently wrong zero, which would matter for anything
 * coordinate-driven, and the suites that never mount a surface should not inherit that. Each test
 * file gets its own jsdom, so a call here reaches no other suite.
 */
const NOTHING = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0 };

export function shimRangeMeasurement(): void {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => NOTHING as DOMRect;
}
