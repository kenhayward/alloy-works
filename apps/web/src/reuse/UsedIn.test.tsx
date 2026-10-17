import { createApiClient } from '@alloy-works/api-client';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  ReachDialog,
  reachesAny,
  readRelated,
  UsedInButton,
  type Related,
  type Uses,
} from './UsedIn.js';

const STEP = 'cccccccc-0000-4000-8000-000000000001';
const REPORT = 'dddddddd-0000-4000-8000-000000000001';
const MANUAL = 'dddddddd-0000-4000-8000-000000000002';
const NOTES = 'dddddddd-0000-4000-8000-000000000003';
const ISSUE = 'bbbbbbbb-0000-4000-8000-000000000001';
const PUBLICATION = 'eeeeeeee-0000-4000-8000-000000000001';

const draft = { key: 'draft', name: 'Draft', approved: false };
const approved = { key: 'approved', name: 'Approved', approved: true };

const uses: Uses = {
  documents: [
    {
      id: MANUAL,
      title: 'Pump manual',
      state: approved,
      references: [{ node: 'n1', mode: 'latest', version: null, overridden: false }],
    },
    {
      id: NOTES,
      title: 'Pump notes',
      state: draft,
      references: [
        { node: 'n2', mode: 'pinned', version: { id: 'v1', number: '0.1' }, overridden: false },
      ],
    },
    {
      id: REPORT,
      title: 'Pump report',
      state: draft,
      references: [
        { node: 'n3', mode: 'latest', version: null, overridden: false },
        { node: 'n4', mode: 'approved', version: null, overridden: false },
      ],
    },
  ],
  unreadableDocuments: true,
  baselines: { named: [{ id: ISSUE, name: 'Issue 1', document: REPORT }], unreadable: false },
  publications: { named: [{ id: PUBLICATION, title: 'Pump report' }], unreadable: false },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const clientAnswering = (answer: () => Response) =>
  createApiClient({
    baseUrl: 'http://uses.test',
    fetch: vi.fn(async () => answer()) as unknown as typeof fetch,
  });

describe('where a component is used', () => {
  it('REU-007 lists each document placing it, each reference saying how it follows the component, and what pins it apart', async () => {
    render(
      <UsedInButton client={clientAnswering(() => json(200, uses))} id={STEP} title="Calibrate" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Used in' }));
    const dialog = await screen.findByRole('dialog', { name: 'Where Calibrate is used' });

    const documents = within(dialog).getByRole('region', { name: 'Documents' });
    // Each document and, within it, each of its references.
    const items = within(documents).getAllByRole('listitem');
    expect(within(documents).getByRole('link', { name: 'Pump report' })).toHaveAttribute(
      'href',
      `#/documents/${REPORT}`,
    );
    expect(items.map((each) => each.textContent)).toEqual(
      expect.arrayContaining([
        'Follows the latest version',
        'Follows approved revisions',
        'Pinned to version 0.1',
      ]),
    );
    expect(within(documents).getByText('Documents you may not read place it too.')).toBeVisible();

    const pinned = within(dialog).getByRole('region', {
      name: 'Pinned, so no change reaches them',
    });
    expect(within(pinned).getByRole('link', { name: 'Baseline Issue 1' })).toHaveAttribute(
      'href',
      `#/documents/${REPORT}/baselines/${ISSUE}`,
    );
    expect(
      within(pinned).getByRole('link', { name: 'Publication of Pump report' }),
    ).toHaveAttribute('href', `#/publications/${PUBLICATION}`);
  });

  it('says so where nothing uses it, and where it could not be read', async () => {
    const none: Uses = {
      documents: [],
      unreadableDocuments: false,
      baselines: { named: [], unreadable: false },
      publications: { named: [], unreadable: false },
    };
    const { unmount } = render(
      <UsedInButton client={clientAnswering(() => json(200, none))} id={STEP} title="Calibrate" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Used in' }));
    expect(await screen.findByText('No document places it.')).toBeVisible();
    expect(screen.getByText('No baseline or publication pins it.')).toBeVisible();
    unmount();

    render(
      <UsedInButton client={clientAnswering(() => json(500, {}))} id={STEP} title="Calibrate" />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Used in' }));
    expect(await screen.findByText('Where it is used could not be read.')).toBeVisible();
  });
});

describe('the warning before a version reaches other documents', () => {
  it('REU-008 REU-009 lists each document a version reaches, approved ones apart from drafts, and none only pinned', async () => {
    const confirmed = vi.fn();
    render(
      <ReachDialog
        uses={uses}
        title="Calibrate"
        act="Save version"
        onConfirm={confirmed}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Save a version of Calibrate?' });
    expect(within(dialog).getByText(/^It reaches 2 documents/)).toBeVisible();
    const approvedOnes = within(dialog).getByRole('region', { name: 'Approved documents' });
    expect(
      within(approvedOnes)
        .getAllByRole('link')
        .map((each) => each.textContent),
    ).toEqual(['Pump manual']);
    const drafts = within(dialog).getByRole('region', { name: 'Drafts' });
    expect(
      within(drafts)
        .getAllByRole('link')
        .map((each) => each.textContent),
    ).toEqual(['Pump report']);
    // Pinned, it is reached by nothing.
    expect(within(dialog).queryByRole('link', { name: 'Pump notes' })).toBeNull();
    expect(within(dialog).getByText('Documents you may not read place it too.')).toBeVisible();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save version' }));
    expect(confirmed).toHaveBeenCalledOnce();
  });

  it('asks nothing where only pins hold it, since no version reaches a pin', () => {
    const pinnedOnly: Uses = {
      ...uses,
      documents: [uses.documents[1]!],
      unreadableDocuments: false,
    };
    expect(reachesAny(pinnedOnly)).toBe(false);
    expect(reachesAny({ ...pinnedOnly, unreadableDocuments: true })).toBe(true);
    expect(reachesAny(uses)).toBe(true);
  });

  it('REL-024 says, before a change is made, what reaches the component through relationships, apart from the documents a version reaches, and asks wherever only they do', async () => {
    const related: Related[] = [
      { id: ISSUE, kind: 'document', title: 'Change request 14', depth: 1 },
      { id: PUBLICATION, kind: 'publication', title: 'Pump manual, issue 3', depth: 2 },
    ];
    const pinnedOnly: Uses = {
      ...uses,
      documents: [uses.documents[1]!],
      unreadableDocuments: false,
    };
    expect(reachesAny(pinnedOnly, related)).toBe(true);
    expect(reachesAny(pinnedOnly, [])).toBe(false);
    render(
      <ReachDialog
        uses={pinnedOnly}
        related={related}
        title="Calibrate"
        act="Approve"
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Approve Calibrate?' });
    const region = within(dialog).getByRole('region', { name: 'Related through relationships' });
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((each) => each.textContent),
    ).toEqual(['Change request 14 (document)', 'Pump manual, issue 3 (publication)']);

    // Read from the impact walk: what a declared relationship reaches, three hops out, never a
    // reference's, which the documents above already say.
    const asked: string[] = [];
    const client = createApiClient({
      baseUrl: 'http://acme.test',
      fetch: (async (input: Request) => {
        asked.push(input.url);
        return json(200, {
          reached: [
            { id: REPORT, kind: 'document', title: 'Pump report', depth: 1, via: STEP, hard: true },
            { ...related[0]!, via: STEP, hard: false },
          ],
          cut: false,
          more: false,
        });
      }) as unknown as typeof fetch,
    });
    expect(await readRelated(client, STEP)).toEqual([related[0]]);
    expect(new URL(asked[0]!).search).toBe('?depth=3');
  });
});
