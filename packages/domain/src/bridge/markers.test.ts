import { describe, expect, it } from 'vitest';

import { noteMarkers } from './markers.js';

describe('the note markers a superscript run names', () => {
  const known = new Set(['1)', '2)', 'a']);

  it('reads one marker', () => {
    expect(noteMarkers('1)', known)).toEqual(['1)']);
    expect(noteMarkers('a', known)).toEqual(['a']);
  });

  it('splits a run of several, only when every part is a marker', () => {
    expect(noteMarkers('1)2)', known)).toEqual(['1)', '2)']);
    expect(noteMarkers('1, 2', known)).toEqual(['1)', '2)']);
    expect(noteMarkers('(1);[a]', known)).toEqual(['1)', 'a']);
  });

  it('leaves a run text when any part is not a marker', () => {
    expect(noteMarkers('1,x', known)).toBeUndefined();
    expect(noteMarkers('x', known)).toBeUndefined();
  });

  it('reads an empty run as no marker', () => {
    expect(noteMarkers('', known)).toBeUndefined();
    expect(noteMarkers(' ,; ', known)).toBeUndefined();
  });

  it('matches a marker exactly when the known set holds it as written', () => {
    expect(noteMarkers('1,2', new Set(['1', '2']))).toEqual(['1', '2']);
  });
});
