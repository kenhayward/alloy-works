// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { chordListener } from './chords.js';

/** A key press with what `keydownHandler` reads, and AltGraph held or not. */
const press = (init: KeyboardEventInit & { keyCode?: number }, altGraph = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', init);
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode });
  Object.defineProperty(event, 'getModifierState', {
    value: (name: string) => name === 'AltGraph' && altGraph,
  });
  return event;
};

describe('chords', () => {
  it('runs what a chord is bound to, and answers that it did', () => {
    let ran = 0;
    const listen = chordListener({
      'Ctrl-j': () => {
        ran += 1;
        return true;
      },
    });
    expect(listen(press({ key: 'j', ctrlKey: true }))).toBe(true);
    expect(ran).toBe(1);
    expect(listen(press({ key: 'k', ctrlKey: true }))).toBe(false);
  });

  it('fires on a Cyrillic layout, as the editor keymap does', () => {
    let ran = 0;
    const listen = chordListener({
      'Ctrl-j': () => {
        ran += 1;
        return true;
      },
    });
    listen(press({ key: 'о', ctrlKey: true, keyCode: 74 }));
    expect(ran).toBe(1);
  });

  it('never fires with AltGraph held, so AltGr still types its character', () => {
    let ran = 0;
    const listen = chordListener({
      'Ctrl-Alt-e': () => {
        ran += 1;
        return true;
      },
    });
    expect(listen(press({ key: 'e', ctrlKey: true, altKey: true }, true))).toBe(false);
    expect(ran).toBe(0);
  });
});
