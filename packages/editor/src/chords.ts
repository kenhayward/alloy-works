import { keydownHandler } from 'prosemirror-keymap';
import type { EditorView } from 'prosemirror-view';

/**
 * A page's own keys, matched by the keymap the editor's are (ADR-0076), its fallback for a layout whose
 * letters differ included, so a page's key and an editor's cannot disagree on a layout. Never with
 * AltGraph held: there, the chord is a character the author is typing.
 */
export function chordListener(
  bindings: Readonly<Record<string, () => boolean>>,
): (event: KeyboardEvent) => boolean {
  const handle = keydownHandler(
    Object.fromEntries(Object.entries(bindings).map(([chord, run]) => [chord, () => run()])),
  );
  // None of the bindings reads a view: each closes over what it acts on.
  const noView = {} as EditorView;
  return (event) => !event.getModifierState('AltGraph') && handle(noView, event);
}
