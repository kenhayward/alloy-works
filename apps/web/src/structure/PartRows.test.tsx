import type { OutlineViewNode } from '@alloy-works/domain';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PartStanding, type Standing } from './DocumentText.js';
import { PartRows, type PartActs } from './PartRows.js';
import {
  approvedNow,
  menuPlace,
  type Choosing,
  type ChosenMode,
  type OfferedVersion,
} from './VersionChoice.js';

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

const NAMES = new Map([[COMPONENT, 'Install the printer']]);

const inPanel = (node: OutlineViewNode, standing: Omit<Standing, 'names'>, acts?: PartActs) =>
  render(
    <PartRows node={node} standing={{ names: NAMES, ...standing }} {...(acts ? { acts } : {})} />,
  );

const resolved = (number: string) =>
  ({ resolved: new Map([[NODE, number]]) }) as unknown as Pick<Standing, 'resolved'>;

const OLDEST: OfferedVersion = { id: 'v1', number: '0.1', createdAt: '2026-10-14T14:30:00Z' };
const APPROVED: OfferedVersion = {
  id: 'v2',
  number: '0.2',
  createdAt: '2026-10-21T09:15:00Z',
  revision: { state: { key: 'approved', name: 'Approved' }, standing: 'effective' },
};
const NEWEST: OfferedVersion = { id: 'v3', number: '0.3', createdAt: '2026-11-03T16:02:00Z' };

function choosing(chosen: ChosenMode[] = []): Choosing {
  return {
    list: async () => ({ items: [NEWEST, APPROVED, OLDEST], next: 'more' }),
    choose: async (_node, mode) => {
      chosen.push(mode);
      return true;
    },
  };
}

describe('what the Part panel says of a part (the EP plan, EP4; part-panel-2)', () => {
  it('CNT-162 REU-050 says the version a reference resolves to, and that it follows the latest', () => {
    inPanel(placed({ kind: 'latest' }), resolved('0.3'));
    expect(screen.getByText('0.3')).toBeInTheDocument();
    expect(screen.getByText('Always the latest')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('CNT-162 says a reference is pinned', () => {
    inPanel(placed({ kind: 'pinned', version: 'v1' }), resolved('0.1'));
    expect(screen.getByText('Pinned')).toBeInTheDocument();
  });

  it('CNT-163 REU-050 says which revision a reference tracking the latest approved stands at', () => {
    inPanel(placed({ kind: 'approved' }), {
      ...resolved('0.2'),
      revisions: new Map([[NODE, 3]]) as Standing['revisions'],
    });
    expect(screen.getByText('0.2')).toBeInTheDocument();
    expect(screen.getByText('Latest approved, revision 3')).toBeInTheDocument();
  });

  it('CNT-163 says none is approved, with no number', () => {
    inPanel(placed({ kind: 'approved' }), resolved('0.2'));
    expect(screen.getByText('No approved revision')).toBeInTheDocument();
    expect(screen.queryByText('0.2')).toBeNull();
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

  const OVERRIDES = new Map([
    [
      NODE,
      [
        { block: 'b1', text: [], stale: false },
        { block: 'b2', text: [], stale: true },
      ],
    ],
  ]) as Standing['overridesOf'];

  it('REU-011 REU-015 says a part is overridden here and where one no longer applies, to whoever has no Overrides icon', () => {
    inPanel(placed({ kind: 'latest' }), { overridesOf: OVERRIDES });
    expect(screen.getByText('Overridden here')).toBeInTheDocument();
    expect(screen.getByText('Override no longer applies')).toBeInTheDocument();
  });

  it('REU-015 says an override no longer applies beside the icon too, which says the rest', () => {
    inPanel(placed({ kind: 'latest' }), { overridesOf: OVERRIDES }, { overridesInHead: true });
    expect(screen.queryByText('Overridden here')).toBeNull();
    expect(screen.getByText('Override no longer applies')).toBeInTheDocument();
  });

  it('COL-069 says of a withheld part only that it moved', () => {
    inPanel(placed({ kind: 'latest' }, null), { movedParts: [NODE] });
    expect(screen.getByText(/moved/i)).toBeInTheDocument();
    expect(screen.queryByText(/Version/)).toBeNull();
  });

  it('offers Suggest changes, but not on the part being drafted, and no acts beside the text', async () => {
    const asked: string[] = [];
    const may = new Map([[NODE, { mayEdit: false, maySuggest: true, lock: null }]]);
    const { unmount } = inPanel(
      placed({ kind: 'latest' }),
      { editable: may },
      { onSuggest: (node) => asked.push(node), drafting: null },
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Suggest changes to Install the printer' }),
    );
    expect(asked).toEqual([NODE]);
    unmount();
    const drafting = inPanel(
      placed({ kind: 'latest' }),
      { editable: may },
      { onSuggest: () => undefined, drafting: NODE },
    );
    expect(screen.queryByRole('button')).toBeNull();
    drafting.unmount();
    render(
      <PartStanding node={placed({ kind: 'latest' })} standing={{ names: NAMES, editable: may }} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the version menu (part-panel-2, decision 2)', () => {
  const open = async (mode: unknown = { kind: 'latest' }, chosen: ChosenMode[] = []) => {
    inPanel(placed(mode), resolved('0.3'), { choosing: choosing(chosen) });
    const row = screen.getByRole('button', { name: /choose the version of Install the printer/ });
    expect(row).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(row);
    const menu = await screen.findByRole('menu', { name: 'Versions of Install the printer' });
    await screen.findByRole('menuitemradio', { name: /^Version 0\.3/ });
    return { row, menu };
  };

  it('CNT-158 CNT-159 stands outside the panel, so no pane clips it, and says what each choice is now', async () => {
    const { row, menu } = await open();
    expect(row.parentElement?.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole('menuitemradio', { name: 'Always the latest' })).toHaveTextContent(
      'now 0.3',
    );
    expect(
      screen.getByRole('menuitemradio', { name: 'Always the latest approved revision' }),
    ).toHaveTextContent('now 0.2');
    expect(screen.getByRole('group', { name: 'Pin to a version' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Older versions' })).toBeInTheDocument();
  });

  it('CNT-158 keeps its keys through the portal: arrows do not close it, Escape goes back to the row', async () => {
    const { row } = await open();
    const latest = screen.getByRole('menuitemradio', { name: 'Always the latest' });
    await waitFor(() => expect(latest).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(
      screen.getByRole('menuitemradio', { name: 'Always the latest approved revision' }),
    ).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Older versions' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(latest).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(row).toHaveFocus();
  });

  it('stays open on a press on its heading, and closes as the focus leaves', async () => {
    await open();
    await userEvent.click(screen.getByText('Pin to a version'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('CNT-158 pins to a version, its state said only where it still stands', async () => {
    const chosen: ChosenMode[] = [];
    await open({ kind: 'latest' }, chosen);
    const approved = screen.getByRole('menuitemradio', { name: /^Version 0\.2.*, Approved$/ });
    expect(approved).toHaveTextContent('Approved');
    expect(screen.getByRole('menuitemradio', { name: /^Version 0\.3/ })).not.toHaveTextContent(
      'Approved',
    );
    await userEvent.click(approved);
    expect(chosen).toEqual([{ kind: 'pinned', version: 'v2' }]);
  });

  it('ticks the version a pinned reference stands at', async () => {
    await open({ kind: 'pinned', version: 'v2' });
    expect(screen.getByRole('menuitemradio', { name: /^Version 0\.2/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('where the menu stands, and what it says the approved one is', () => {
  const row = { top: 300, bottom: 334, left: 900, width: 320 };

  it('stands under its row, as wide, capped by the room below', () => {
    expect(menuPlace(row, 200, 800)).toEqual({ left: 900, width: 320, top: 338, maxHeight: 454 });
  });

  it('opens above where there is no room below', () => {
    expect(menuPlace({ ...row, top: 700, bottom: 734 }, 300, 800)).toEqual({
      left: 900,
      width: 320,
      bottom: 104,
      maxHeight: 688,
    });
  });

  it('stays below where there is more room there, scrolling inside', () => {
    expect(menuPlace({ ...row, top: 200, bottom: 234 }, 900, 800)).toEqual({
      left: 900,
      width: 320,
      top: 238,
      maxHeight: 554,
    });
  });

  it('CNT-163 names the newest that stands, and a tracking reference says its own', () => {
    expect(approvedNow([NEWEST, APPROVED], 'more', undefined)).toEqual({ number: '0.2' });
    expect(approvedNow([NEWEST], 'more', '0.1')).toEqual({ number: '0.1' });
  });

  it('says nothing while a later page may hold it, and none only once all have been read', () => {
    const superseded: OfferedVersion = {
      ...APPROVED,
      revision: { state: { key: 'approved', name: 'Approved' }, standing: 'superseded' },
    };
    expect(approvedNow([NEWEST, superseded], 'more', undefined)).toBeNull();
    expect(approvedNow([NEWEST, superseded], null, undefined)).toBe('none');
  });
});
