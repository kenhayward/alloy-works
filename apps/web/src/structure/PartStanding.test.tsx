import type { OutlineViewNode } from '@alloy-works/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PartStanding, type Standing } from './DocumentText.js';

const COMPONENT = '6a0c1b8e-6f3e-4d2a-9d36-2a4f1c9e7b10';
const NODE = 'n1';

const placed = (mode: unknown, component: string | null = COMPONENT): OutlineViewNode =>
  ({
    type: 'reference',
    id: NODE,
    component,
    mode,
    numbered: true,
    matter: 'body',
    pageBreak: 'none',
    values: {},
    children: [],
  }) as unknown as OutlineViewNode;

const inPanel = (node: OutlineViewNode, standing: Omit<Standing, 'names'>) =>
  render(
    <PartStanding
      node={node}
      standing={{ names: new Map([[COMPONENT, 'Install the printer']]), acts: {}, ...standing }}
    />,
  );

describe('what the Part panel says of a part (the EP plan, EP4)', () => {
  it('CNT-162 REU-050 says the version a reference resolves to, and that it follows the latest', () => {
    inPanel(placed({ kind: 'latest' }), {
      resolved: new Map([[NODE, '0.3']]) as unknown as Standing['resolved'],
    });
    expect(screen.getByText('Version 0.3, latest')).toBeInTheDocument();
  });

  it('CNT-163 REU-050 says when a reference tracks the latest approved revision, and that none is', () => {
    inPanel(placed({ kind: 'approved' }), {});
    expect(screen.getByText(/approved/i)).toBeInTheDocument();
  });

  it('LIF-018 says a part is past its review date', () => {
    inPanel(placed({ kind: 'latest' }), { pastReview: new Set([NODE]) });
    expect(screen.getByText('Past review')).toBeInTheDocument();
  });

  it('LOC-016 says the status of each translation of the component it places', () => {
    inPanel(placed({ kind: 'latest' }), {
      translated: new Map([
        [NODE, [{ language: 'fr-FR', status: 'out_of_date', reason: null }]],
      ]) as unknown as Standing['translated'],
    });
    expect(screen.getByText(/^fr-FR: /)).toBeInTheDocument();
  });

  it('LIF-046 says a part has diverged, naming the lines', () => {
    inPanel(placed({ kind: 'latest' }), { diverged: new Map([[NODE, ['US', 'EU']]]) });
    expect(screen.getByText('Main line; also US, EU')).toBeInTheDocument();
  });

  it('REU-011 REU-015 says a part is overridden here and where one no longer applies, and offers Overrides while it is open', async () => {
    const asked: string[] = [];
    inPanel(placed({ kind: 'latest' }), {
      openComponent: COMPONENT,
      overridesOf: new Map([
        [
          NODE,
          [
            { block: 'b1', text: [], stale: false },
            { block: 'b2', text: [], stale: true },
          ],
        ],
      ]) as Standing['overridesOf'],
      acts: { hasText: true, onOverride: (node) => asked.push(node) },
    });
    expect(screen.getByText('Overridden here')).toBeInTheDocument();
    expect(screen.getByText('Override no longer applies')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Overrides of Install the printer' }));
    expect(asked).toEqual([NODE]);
  });

  it('COL-069 says of a withheld part only that it moved', () => {
    inPanel(placed({ kind: 'latest' }, null), { movedParts: [NODE] });
    expect(screen.getByText(/moved/i)).toBeInTheDocument();
    expect(screen.queryByText(/Version/)).toBeNull();
  });

  it('offers Suggest changes, but not on the part being drafted, and no acts beside the text', async () => {
    const asked: string[] = [];
    const may = new Map([[NODE, { mayEdit: false, maySuggest: true, lock: null }]]);
    const { unmount } = inPanel(placed({ kind: 'latest' }), {
      editable: may,
      acts: { onSuggest: (node) => asked.push(node), drafting: null },
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Suggest changes to Install the printer' }),
    );
    expect(asked).toEqual([NODE]);
    unmount();
    const drafting = inPanel(placed({ kind: 'latest' }), {
      editable: may,
      acts: { onSuggest: () => undefined, drafting: NODE },
    });
    expect(screen.queryByRole('button')).toBeNull();
    drafting.unmount();
    render(
      <PartStanding
        node={placed({ kind: 'latest' })}
        standing={{ names: new Map([[COMPONENT, 'Install the printer']]), editable: may }}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
