import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { nextChoice, shortHash, VersionCompare, VersionView } from './VersionViews.js';
import type { TimelineVersion } from './VersionTimeline.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const iso = (day: number, hour = 12) => new Date(2026, 9, day, hour, 5, 9).toISOString();

const version = (
  number: string,
  day: number,
  over: Partial<TimelineVersion> = {},
): TimelineVersion => ({
  id: `v${number}`,
  number,
  createdAt: iso(day),
  at: new Date(iso(day)),
  author: 'Ada',
  authorId: 'a',
  note: null,
  restoredFrom: null,
  revision: null,
  ...over,
});

const SHA = '31f4a8e200000000000000000000000000000000000000000000000000007c228c';

function service(answers: Record<string, unknown> = {}) {
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    for (const [path, body] of Object.entries(answers)) {
      if (url.pathname.endsWith(path)) return json(200, body);
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return createApiClient({ baseUrl: 'http://views.test', fetch: fetching });
}

describe('choosing two versions to compare', () => {
  it('takes the first as A and the second as B, a third replacing the oldest choice', () => {
    expect(nextChoice([], 'one')).toEqual(['one']);
    expect(nextChoice(['one'], 'two')).toEqual(['one', 'two']);
    expect(nextChoice(['one', 'two'], 'three')).toEqual(['two', 'three']);
    expect(nextChoice(['one', 'two'], 'one')).toEqual(['two']);
  });

  it('shortens a hash in the middle, so nothing scrolls sideways', () => {
    expect(shortHash(SHA)).toBe('sha256 31f4a8e2…7c228c');
  });
});

describe('the Compare view', () => {
  const versions = [
    version('1.5', 9, { author: 'Grace', authorId: 'g' }),
    version('1.4', 8),
    version('1.3', 7, {
      revision: {
        number: 1,
        state: { key: 'approved', name: 'Approved' },
        standing: 'effective',
        scopes: [],
        supersededBy: null,
      },
    }),
    version('1.2', 6),
  ];

  it('VER-025 compares the two chosen, swaps them, and says how far apart they are', async () => {
    const compare = vi.fn();
    render(
      <VersionCompare
        client={service()}
        id={DOCUMENT}
        versions={versions}
        a={versions[3]!}
        b={versions[0]!}
        onCompare={compare}
        onClose={() => undefined}
      />,
    );
    expect(compare).toHaveBeenLastCalledWith(versions[3], versions[0]);
    expect(screen.getByText(/^3 versions apart · 2 people · /)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(compare).toHaveBeenLastCalledWith(versions[0], versions[3]);
    expect(screen.getByRole('combobox', { name: 'Version A' })).toHaveValue('v1.5');
  });

  it('offers quick choices: the version before, the revision in force, and my changes', async () => {
    const compare = vi.fn();
    const mine = vi.fn();
    render(
      <VersionCompare
        client={service()}
        id={DOCUMENT}
        versions={versions}
        a={versions[3]!}
        b={versions[0]!}
        onCompare={compare}
        onMine={mine}
        onClose={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'With the version before' }));
    expect(compare).toHaveBeenLastCalledWith(versions[1], versions[0]);
    await userEvent.click(screen.getByRole('button', { name: 'With approved 1.3' }));
    expect(compare).toHaveBeenLastCalledWith(versions[2], versions[0]);
    await userEvent.click(screen.getByRole('button', { name: 'With my changes' }));
    expect(mine).toHaveBeenCalledTimes(1);
  });

  it("offers a document's baselines to compare with, each by its own comparison", async () => {
    render(
      <VersionCompare
        client={service({
          '/baselines': { baselines: [{ id: 'b1', name: 'Submission' }] },
        })}
        id={DOCUMENT}
        of="document"
        versions={versions}
        a={versions[3]!}
        b={versions[0]!}
        onCompare={() => undefined}
        onClose={() => undefined}
      />,
    );
    const link = await screen.findByRole('link', { name: 'With a baseline: Submission' });
    expect(link).toHaveAttribute('href', expect.stringContaining('b1'));
  });

  it('reaches a version beyond those loaded by asking for it', async () => {
    const found = {
      '/versions': {
        items: [
          {
            id: 'v0.9',
            number: '0.9',
            createdAt: iso(1),
            author: { id: 'a', name: 'Ada' },
            note: 'The first draft',
            restoredFrom: null,
            current: false,
            revision: null,
          },
        ],
        next: null,
      },
    };
    const compare = vi.fn();
    render(
      <VersionCompare
        client={service(found)}
        id={DOCUMENT}
        of="document"
        versions={versions}
        a={versions[3]!}
        b={versions[0]!}
        onCompare={compare}
        onClose={() => undefined}
      />,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a version' }), 'first{Enter}');
    await waitFor(() =>
      expect(
        within(screen.getByRole('combobox', { name: 'Version A' })).getByRole('option', {
          name: /^0\.9/,
        }),
      ).toBeInTheDocument(),
    );
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Version A' }), 'v0.9');
    expect(compare.mock.lastCall?.[0]).toMatchObject({ id: 'v0.9' });
  });
});

describe('one version, taking the panel', () => {
  const versions = [
    version('1.5', 9),
    version('1.4', 8, { note: 'Second thoughts' }),
    version('1.3', 7),
  ];

  it('says its facts to the second, its own approvals, what changed, and goes to the next either way', async () => {
    const go = vi.fn();
    render(
      <VersionView
        client={service({
          '/approvals': {
            approvals: [
              {
                transition: 'approve',
                decision: 'approved',
                reason: null,
                by: { id: 'g', name: 'Grace' },
                at: iso(8),
                versionId: 'v1.4',
              },
              {
                transition: 'approve',
                decision: 'rejected',
                reason: 'Elsewhere',
                by: { id: 'g', name: 'Grace' },
                at: iso(7),
                versionId: 'v1.3',
              },
            ],
          },
          '/versions/v1.4': { delivery: null },
        })}
        id={DOCUMENT}
        versions={versions}
        version={versions[1]!}
        changesFrom={async () => ({ changed: 1, added: 2, removed: 3 })}
        onGo={go}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: /1\.4/ })).toBeInTheDocument();
    expect(screen.getByText(/8 Oct 2026, 12:05:09/)).toBeInTheDocument();
    expect(screen.getByText('Second thoughts')).toBeInTheDocument();
    expect(await screen.findByText('1 changed, 2 added, 3 removed')).toBeInTheDocument();
    const approvals = await screen.findByRole('list', { name: 'Approvals of this version' });
    expect(within(approvals).getAllByRole('listitem')).toHaveLength(1);
    expect(within(approvals).getByText(/Grace/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Newer version' }));
    expect(go).toHaveBeenLastCalledWith(versions[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Older version' }));
    expect(go).toHaveBeenLastCalledWith(versions[2]);
  });

  it("offers the list's actions: opens it, compares it with the latest, and restores it", async () => {
    const compare = vi.fn();
    const restore = vi.fn();
    render(
      <VersionView
        client={service()}
        id={DOCUMENT}
        of="document"
        versions={versions}
        version={versions[1]!}
        changesFrom={async () => null}
        onCompare={compare}
        onRestore={restore}
        onGo={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(screen.getByRole('link', { name: 'Open 1.4' })).toHaveAttribute(
      'href',
      `#/documents/${DOCUMENT}/versions/v1.4`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Compare 1.4 with 1.5' }));
    expect(compare).toHaveBeenCalledWith(versions[1], versions[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Restore 1.4' }));
    expect(restore).toHaveBeenCalledWith(versions[1], versions[0]);
  });

  it('goes back on Esc, and offers no newer from the latest', async () => {
    const back = vi.fn();
    render(
      <VersionView
        client={service()}
        id={DOCUMENT}
        versions={versions}
        version={versions[0]!}
        changesFrom={async () => null}
        onGo={() => undefined}
        onBack={back}
      />,
    );
    expect(screen.getByRole('button', { name: 'Newer version' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows a delivery by its fields, a hash shortened and copied in full', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <VersionView
        client={service({
          '/versions/v1.5': {
            delivery: {
              from: 'CT Studio',
              source: 'trial.docx',
              sourceSha256: SHA,
              askedBy: 'Grace',
              key: 'delivery-1',
              at: iso(9),
            },
          },
        })}
        id={DOCUMENT}
        versions={versions}
        version={versions[0]!}
        changesFrom={async () => null}
        onGo={() => undefined}
        onBack={() => undefined}
      />,
    );
    const hash = await screen.findByText('sha256 31f4a8e2…7c228c');
    expect(hash).toHaveAttribute('title', SHA);
    expect(screen.getByText('CT Studio')).toBeInTheDocument();
    expect(screen.getByText('delivery-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy in full' }));
    expect(writeText).toHaveBeenCalledWith(SHA);
  });

  it('lists a document’s baselines naming this version, each linking to it', async () => {
    render(
      <VersionView
        client={service({
          '/baselines': {
            baselines: [
              { id: 'b1', name: 'Submission', version: { id: 'v1.4', number: '1.4' } },
              { id: 'b2', name: 'Other', version: { id: 'v1.3', number: '1.3' } },
            ],
          },
        })}
        id={DOCUMENT}
        of="document"
        versions={versions}
        version={versions[1]!}
        changesFrom={async () => null}
        onGo={() => undefined}
        onBack={() => undefined}
      />,
    );
    const link = await screen.findByRole('link', { name: 'Submission' });
    expect(link).toHaveAttribute('href', expect.stringContaining('b1'));
    expect(screen.queryByRole('link', { name: 'Other' })).toBeNull();
  });
});
