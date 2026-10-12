import { describe, expect, it } from 'vitest';

import { compareResolved, type ResolvedNode, type ResolvedSide } from './resolved.js';

const node = (
  version: string,
  values: Record<string, [string, string]> = {},
  definitions: string[] = ['type-1'],
): ResolvedNode => ({
  component: 'c1',
  version,
  definitions,
  values: new Map(
    Object.entries(values).map(([binding, [dataset, printed]]) => [binding, { dataset, printed }]),
  ),
});
const side = (
  nodes: Record<string, ResolvedNode>,
  over: Partial<ResolvedSide> = {},
): ResolvedSide => ({
  layout: 'layout-1',
  theme: 'theme-1',
  template: 'template-1',
  definitions: ['schema-1'],
  parameters: '{}',
  nodes: new Map(Object.entries(nodes)),
  ...over,
});

describe('resolved output compared', () => {
  it('VER-031 calls a binding the edit added the edit’s, never the data’s, and names a parameter changed', () => {
    const compared = compareResolved(
      side({ n1: node('v1') }),
      side({ n1: node('v2', { depth: ['d1', '3.5'] }) }, { parameters: '{"site":"north"}' }),
    );
    expect(compared.document).toEqual(['parameters']);
    expect(compared.nodes).toEqual([
      { node: 'n1', causes: ['edited'], values: [{ binding: 'depth', older: null, newer: '3.5' }] },
    ]);
  });

  it('VER-031 names a difference nobody typed: the same component version printing a new value because its data changed', () => {
    const compared = compareResolved(
      side({ n1: node('v1', { depth: ['d1', '3.5'] }) }),
      side({ n1: node('v1', { depth: ['d2', '3.75'] }) }),
    );
    expect(compared).toEqual({
      document: [],
      nodes: [
        {
          node: 'n1',
          causes: ['data'],
          values: [{ binding: 'depth', older: '3.5', newer: '3.75' }],
        },
      ],
    });
  });

  it('VER-045 tells a template’s definitions changing from an edit, for the document and each node', () => {
    const compared = compareResolved(
      side({ n1: node('v1'), n2: node('v1') }),
      side(
        { n1: node('v1', {}, ['type-2']), n2: node('v2') },
        { template: 'template-2', definitions: ['schema-2'] },
      ),
    );
    expect(compared.document).toEqual(['template', 'definition']);
    expect(compared.nodes).toEqual([
      { node: 'n1', causes: ['definition'], values: [] },
      { node: 'n2', causes: ['edited'], values: [] },
    ]);
  });

  it('VER-031 names the layout and the theme as the document’s, and says nothing where nothing differs', () => {
    expect(compareResolved(side({ n1: node('v1') }), side({ n1: node('v1') }))).toEqual({
      document: [],
      nodes: [],
    });
    expect(
      compareResolved(side({}), side({}, { layout: 'layout-2', theme: 'theme-2' })).document,
    ).toEqual(['layout', 'theme']);
  });
});
