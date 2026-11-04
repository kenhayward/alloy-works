import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VersionTimeline } from './VersionTimeline.js';

const DOCUMENT = 'dddddddd-0000-4000-8000-000000000001';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const day = (date: number, hour = 12) => new Date(2026, 9, date, hour).toISOString();

const version = (number: string, at: string, over: object = {}) => ({
  id: `v${number}`,
  number,
  createdAt: at,
  author: { id: 'a', name: 'Ada' },
  note: null,
  restoredFrom: null,
  current: false,
  revision: null,
  ...over,
});

const revision = (over: object) => ({
  number: 1,
  at: day(5),
  state: { key: 'approved', name: 'Approved' },
  standing: 'effective',
  scopes: [],
  supersededBy: null,
  ...over,
});

const publication = (over: object = {}) => ({
  id: 'p1',
  document: DOCUMENT,
  version: { id: 'v1.3', number: '1.3' },
  title: 'Manual',
  publisher: { id: 'g', displayName: 'Grace' },
  publishedAt: day(6),
  approval: 'approved',
  superseded: false,
  baseline: null,
  formats: ['pdf'],
  ...over,
});

const baseline = (over: object = {}) => ({
  id: 'b1',
  document: DOCUMENT,
  name: 'Revision 1',
  madeBy: { id: 'g', name: 'Grace' },
  madeAt: day(7),
  version: { id: 'v1.3', number: '1.3' },
  gate: 'approve',
  digest: 'x',
  superseded: null,
  ...over,
});

function service(
  answers: {
    versions?: readonly unknown[][];
    baselines?: readonly unknown[] | null;
    publications?: readonly unknown[][] | null;
  } = {},
) {
  const asked: string[] = [];
  const pages = answers.versions ?? [[version('1.4', day(9)), version('1.3', day(5))]];
  const published = answers.publications === undefined ? [[]] : answers.publications;
  const fetching = vi.fn(async (input: Request) => {
    const url = new URL(input.url);
    asked.push(`${url.pathname}${url.search}`);
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    if (url.pathname.endsWith('/versions')) {
      const items = pages[cursor] ?? [];
      return json(200, { items, next: pages[cursor + 1] ? String(cursor + 1) : null });
    }
    if (url.pathname === `/v1/documents/${DOCUMENT}`) {
      return json(200, { state: { key: 'draft', name: 'Draft' }, transitions: [], gates: [] });
    }
    if (url.pathname.endsWith('/baselines')) {
      return answers.baselines === null
        ? json(500, {})
        : json(200, { baselines: answers.baselines ?? [] });
    }
    if (url.pathname.endsWith('/publications')) {
      if (published === null) return json(500, {});
      return json(200, {
        items: published[cursor] ?? [],
        next: published[cursor + 1] ? String(cursor + 1) : null,
        total: 0,
        facets: { spaces: [], documents: [] },
      });
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://timeline.test', fetch: fetching }), asked };
}

const drawn = (
  client: ReturnType<typeof createApiClient>,
  changesFrom = vi.fn(async () => ({ changed: 2, added: 1, removed: 0 })),
) => {
  render(<VersionTimeline client={client} id={DOCUMENT} of="document" changesFrom={changesFrom} />);
  return changesFrom;
};
const list = () => screen.findByRole('list', { name: 'Versions' });

afterEach(() => window.localStorage.clear());

describe('the versions timeline', () => {
  it('VER-060 says of a revision its state and that it stands effective, and of any other version nothing', async () => {
    const { client } = service({
      versions: [
        [
          version('1.4', day(9)),
          version('1.3', day(5), { revision: revision({ number: 2 }) }),
          version('1.2', day(4), {
            revision: revision({ standing: 'superseded', supersededBy: 2 }),
          }),
        ],
      ],
    });
    drawn(client);
    const rows = await list();
    const row = (number: string) => rows.querySelector<HTMLElement>(`[data-version="${number}"]`)!;
    expect(within(row('1.3')).getByText('Revision 2')).toBeInTheDocument();
    expect(within(row('1.3')).getByText('Approved')).toHaveAttribute('data-kind', 'approved');
    expect(within(row('1.3')).getByText('Effective')).toHaveAttribute('data-kind', 'effective');
    expect(within(row('1.2')).getByText('Superseded by Revision 2')).toHaveAttribute(
      'data-kind',
      'superseded',
    );
    // The latest says so, and an ordinary version wears no state at all (LIF-048).
    expect(within(row('1.4')).getByText('Current')).toHaveAttribute('data-kind', 'current');
    expect(row('1.4').querySelectorAll('[data-lozenge]')).toHaveLength(1);
  });

  it("shows the artifact's state once, at the head, and not on its versions", async () => {
    const { client } = service();
    drawn(client);
    const rows = await list();
    const state = await screen.findByText('Draft');
    expect(state).toHaveAttribute('data-kind', 'draft');
    expect(rows).not.toContainElement(state);
  });

  it('VER-060 says of a revision pending, or replaced before it took effect, and names where one is in force', async () => {
    const { client } = service({
      versions: [
        [
          version('1.5', day(9), { revision: revision({ number: 3, standing: 'pending' }) }),
          version('1.4', day(8), {
            revision: revision({
              number: 2,
              scopes: [{ axis: 'market', value: 'uk' }],
            }),
          }),
          version('1.3', day(5), { revision: revision({ standing: 'neverInForce' }) }),
        ],
      ],
    });
    drawn(client);
    const rows = await list();
    const row = (number: string) => rows.querySelector<HTMLElement>(`[data-version="${number}"]`)!;
    expect(within(row('1.5')).getByText('Pending')).toHaveAttribute('data-kind', 'pending');
    expect(within(row('1.4')).getByText('market: uk')).toBeInTheDocument();
    expect(within(row('1.3')).getByText('Replaced before it took effect')).toBeInTheDocument();
    expect(within(row('1.3')).queryByText('Effective')).toBeNull();
  });

  it('VER-060 shows a document’s baselines and publications where they fall, neither of them a version', async () => {
    const { client } = service({
      baselines: [baseline()],
      publications: [[publication()]],
    });
    drawn(client);
    const rows = await list();
    const order = [...rows.querySelectorAll('[data-version], [data-baseline], [data-publication]')];
    expect(
      order.map(
        (each) =>
          (each as HTMLElement).dataset['version'] ??
          each.getAttribute('data-baseline') ??
          each.getAttribute('data-publication'),
      ),
    ).toEqual(['1.4', 'b1', 'p1', '1.3']);

    const made = rows.querySelector<HTMLElement>('[data-baseline="b1"]')!;
    expect(within(made).getByRole('link', { name: 'Revision 1' })).toHaveAttribute(
      'href',
      expect.stringContaining('b1'),
    );
    expect(within(made).getByText(/taken at a gate/)).toBeInTheDocument();
    expect(
      within(made).getByRole('link', { name: 'Compare Revision 1 with now' }),
    ).toBeInTheDocument();

    const out = rows.querySelector<HTMLElement>('[data-publication="p1"]')!;
    expect(within(out).getByText('Published')).toHaveAttribute('data-kind', 'published');
    expect(within(out).getByText('Approved')).toHaveAttribute('data-kind', 'approved');
    expect(within(out).getByRole('link', { name: 'Open the publication of 1.3' })).toHaveAttribute(
      'href',
      '#/publications/p1',
    );
    expect(
      within(out).getByRole('button', { name: 'Download the publication of 1.3' }),
    ).toBeInTheDocument();
    // Neither is counted, nor offered as a version.
    expect(screen.getByText('2 versions')).toBeInTheDocument();
    expect(within(made).queryByRole('button', { name: /^Version / })).toBeNull();
  });

  it('says a superseded baseline and publication are, and that a list it could not read was not', async () => {
    const { client } = service({
      baselines: [baseline({ superseded: { by: 'b2', principal: 'g', at: day(8) } })],
      publications: null,
    });
    drawn(client);
    const rows = await list();
    expect(
      within(rows.querySelector<HTMLElement>('[data-baseline="b1"]')!).getByText('Superseded'),
    ).toHaveAttribute('data-kind', 'superseded');
    expect(await screen.findByText('The publications could not be read')).toBeInTheDocument();
  });

  it('opens a version in place with what changed from the one before, one at a time, and closes it again', async () => {
    const { client } = service();
    const changes = drawn(client);
    const rows = await list();
    const line = within(rows).getByRole('button', { name: /^Version 1\.4,/ });
    await userEvent.click(line);
    expect(line).toHaveAttribute('aria-expanded', 'true');
    expect(changes).toHaveBeenCalledTimes(1);
    expect(
      await within(rows).findByText(
        'Changes from the version before: 2 changed, 1 added, 0 removed',
      ),
    ).toBeInTheDocument();

    await userEvent.click(within(rows).getByRole('button', { name: /^Version 1\.3,/ }));
    expect(line).toHaveAttribute('aria-expanded', 'false');
    expect(within(rows).getByText('The first version: nothing came before it')).toBeInTheDocument();
    expect(within(rows).getByRole('link', { name: 'Open 1.3' })).toBeInTheDocument();

    await userEvent.click(within(rows).getByRole('button', { name: /^Version 1\.3,/ }));
    expect(within(rows).queryByRole('link', { name: 'Open 1.3' })).toBeNull();
  });

  it('shows the latest’s actions without opening it, and copies a link', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { client } = service();
    drawn(client);
    const rows = await list();
    await userEvent.click(within(rows).getByRole('button', { name: 'Copy a link to 1.4' }));
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`#/documents/${DOCUMENT}/versions/v1.4`),
    );
    expect(await within(rows).findByText('Link copied')).toBeInTheDocument();
  });

  it('folds a day to one line saying what it held, and every day with one press, remembered for the document', async () => {
    const { client } = service({
      versions: [
        [
          version('1.4', day(9)),
          version('1.3', day(5), { revision: revision({}) }),
          version('1.2', day(5, 9)),
        ],
      ],
    });
    const { unmount } = render(
      <VersionTimeline client={client} id={DOCUMENT} changesFrom={async () => null} />,
    );
    const rows = await list();
    const header = within(rows).getByRole('button', { name: /5 Oct/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(within(rows).queryByRole('button', { name: /^Version 1\.3,/ })).toBeNull();
    expect(within(header).getByRole('img', { name: 'Approved' })).toBeInTheDocument();
    expect(within(header).getByText('2 versions')).toBeInTheDocument();

    // A day is still open, so the toolbar collapses every day; then, none open, it expands them.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse every day' }));
    expect(within(rows).queryByRole('button', { name: /^Version 1\.4,/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Expand every day' }));
    expect(within(rows).getByRole('button', { name: /^Version 1\.4,/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Collapse every day' }));
    unmount();
    render(<VersionTimeline client={client} id={DOCUMENT} changesFrom={async () => null} />);
    expect(await screen.findByRole('button', { name: 'Expand every day' })).toBeInTheDocument();
  });

  it('keeps today open however earlier days were left', async () => {
    window.localStorage.setItem(`aw.versions.${DOCUMENT}.collapsed`, 'yes');
    const { client } = service({
      versions: [[version('1.4', new Date().toISOString()), version('1.3', day(5))]],
    });
    drawn(client);
    const rows = await list();
    expect(within(rows).getByRole('button', { name: /^Version 1\.4,/ })).toBeInTheDocument();
    expect(within(rows).queryByRole('button', { name: /^Version 1\.3,/ })).toBeNull();
  });

  it('reads older versions a page at a time, showing nothing beyond what both streams have reached', async () => {
    const { client, asked } = service({
      versions: [[version('1.4', day(9))], [version('1.3', day(3))]],
      publications: [
        [publication({ publishedAt: day(6) })],
        [publication({ id: 'p0', publishedAt: day(2) })],
      ],
    });
    drawn(client);
    const rows = await list();
    // The publication is older than the last version read, and more versions are to come.
    expect(rows.querySelector('[data-publication="p1"]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show older versions' }));
    await waitFor(() => expect(rows.querySelector('[data-version="1.3"]')).not.toBeNull());
    expect(rows.querySelector('[data-publication="p1"]')).not.toBeNull();
    expect(asked.filter((each) => each.includes('versions?cursor=1'))).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show older versions' })).toBeNull();
  });

  it('VER-025 chooses two versions in compare mode, a third replacing the oldest, naming them in the bar', async () => {
    const { client } = service({
      versions: [[version('1.4', day(9)), version('1.3', day(5)), version('1.2', day(4))]],
    });
    const compareTwo = vi.fn();
    render(
      <VersionTimeline
        client={client}
        id={DOCUMENT}
        changesFrom={async () => null}
        onCompareTwo={compareTwo}
      />,
    );
    const rows = await list();
    const toggle = screen.getByRole('button', { name: 'Compare two versions' });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Choose two versions to compare');
    await userEvent.click(within(rows).getByRole('checkbox', { name: 'Choose 1.2' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Choose one more version to compare with 1.2',
    );
    await userEvent.click(within(rows).getByRole('checkbox', { name: 'Choose 1.3' }));
    await userEvent.click(within(rows).getByRole('checkbox', { name: 'Choose 1.4' }));
    expect(within(rows).getByRole('checkbox', { name: 'Choose 1.2' })).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Compare 1.3 → 1.4');
    await userEvent.click(screen.getByRole('button', { name: 'Swap' }));
    expect(screen.getByRole('status')).toHaveTextContent('Compare 1.4 → 1.3');
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(compareTwo.mock.calls[0]?.[0]).toMatchObject({ number: '1.4' });
    expect(compareTwo.mock.calls[0]?.[1]).toMatchObject({ number: '1.3' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('status')).toHaveTextContent('Choose two versions to compare');
  });
});
