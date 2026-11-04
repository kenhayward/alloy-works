import { describe, expect, it } from 'vitest';

import { panelsFor, type PanelContext, panelLabel, selectionMayTake } from './panels.js';

const document = (over: Partial<PanelContext> = {}): PanelContext => ({
  kind: 'document',
  mode: 'authoring',
  holdsOwn: false,
  selectionHeld: false,
  tableHolds: false,
  ...over,
});
const keys = (context: PanelContext) => panelsFor(context).map((each) => each.key);

describe('the panels beside the text (the CE plan, CE2)', () => {
  it('offers a document in Reading its own panels', () => {
    expect(keys(document({ mode: 'reading' }))).toEqual([
      'part',
      'lists',
      'versions',
      'publishing',
    ]);
  });

  it('adds the Assistant and Threads while authoring', () => {
    expect(keys(document())).toEqual([
      'part',
      'lists',
      'assistant',
      'versions',
      'publishing',
      'threads',
    ]);
  });

  it("adds Review's panels in Review, and no Assistant", () => {
    expect(keys(document({ mode: 'review' }))).toEqual([
      'part',
      'lists',
      'versions',
      'publishing',
      'threads',
      'suggestions',
      'rounds',
      'sources',
    ]);
  });

  it('offers Document, Selection and Table only while they have something to say', () => {
    expect(
      keys(document({ mode: 'reading', holdsOwn: true, selectionHeld: true, tableHolds: true })),
    ).toEqual(['selection', 'table', 'part', 'document', 'lists', 'versions', 'publishing']);
  });

  it('offers a component only what applies to one', () => {
    const component = (mode: PanelContext['mode']) =>
      keys(document({ kind: 'component', mode, holdsOwn: true }));
    expect(component('authoring')).toEqual(['part', 'versions']);
    expect(component('reading')).toEqual(['part', 'versions']);
    expect(keys(document({ kind: 'component', selectionHeld: true, tableHolds: true }))).toEqual([
      'selection',
      'table',
      'part',
      'versions',
    ]);
  });

  it('names the part panel for the kind', () => {
    const part = panelsFor(document()).find((each) => each.key === 'part')!;
    expect(panelLabel(part, 'document')).toBe('Part');
    expect(panelLabel(part, 'component')).toBe('Attributes');
  });

  it('lets a selection take the panels from anything but the Assistant and Threads', () => {
    expect(selectionMayTake('part')).toBe(true);
    expect(selectionMayTake('assistant')).toBe(false);
    expect(selectionMayTake('threads')).toBe(false);
    expect(selectionMayTake('selection')).toBe(false);
  });
});
