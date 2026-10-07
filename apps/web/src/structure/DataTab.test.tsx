import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { bindingStatesIn, type BindingState } from './bindingContexts.js';
import { DataTab } from './DataTab.js';

const DOCUMENT = '99999999-9999-4999-8999-999999999999';
const FIRST = 'a'.repeat(26);
const SECOND = 'b'.repeat(26);
const PENDING = '33333333-3333-4333-8333-333333333333';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const text = { base: 'text' };
const value = (shown: string) => ({ value: shown, column: { name: 'name', type: text } });
const provenance = {
  parameters: {},
  ran: { sql: null },
  identity: { kind: 'service' },
  at: '2026-10-05T09:00:00.000Z',
  rowCount: 1,
  checksum: '0'.repeat(64),
};

/** One binding as the bindings view answers it: holding `shown`, or never resolved where null. */
const view = (
  node: string,
  id: string,
  shown: string | null,
  over: Record<string, unknown> = {},
) => ({
  node,
  binding: {
    type: 'binding',
    id,
    query: '44444444-4444-4444-8444-444444444441',
    parameters: {},
    mode: 'checked',
    take: { column: 'name' },
  },
  held:
    shown === null
      ? null
      : {
          dataset: '55555555-5555-4555-8555-555555555555',
          version: `held-${id}`,
          number: '0.1',
          provenance,
          name: null,
          stale: false,
          taken: value(shown),
          act: 'resolve',
          keepable: false,
          by: { id: 'p', displayName: 'Ada' },
          at: '2026-10-05T09:00:00.000Z',
        },
  waiting: null,
  definition: { title: 'Sites', version: '0.2' },
  connection: { name: 'Harbour' },
  definitionChanged: false,
  sincePublished: null,
  mayCheck: true,
  mayResolve: true,
  ...over,
});

const states = (...views: unknown[]): readonly BindingState[] =>
  bindingStatesIn({ bindings: views })!;

function drawn(
  shown: readonly BindingState[],
  options: {
    failures?: ReadonlyMap<string, string>;
    answer?: number;
    /** A resolve answered as pending, and what following it answers (the D8 plan, D8-F). */
    pending?: unknown;
    /** Answers in turn for each accept or resolve, where given, in place of `answer`. */
    answers?: (() => Response)[];
  } = {},
) {
  const asked: { path: string; body: unknown }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const body = request.method === 'GET' ? null : JSON.parse(await request.text());
    const path = new URL(request.url).pathname;
    asked.push({ path, body });
    const next = request.method === 'POST' ? options.answers?.shift() : undefined;
    if (next !== undefined) return next();
    if (options.pending !== undefined && path.endsWith('/resolve')) {
      return json(202, { results: [{ node: SECOND, binding: 'never', pending: PENDING }] });
    }
    if (options.pending !== undefined && path === `/v1/datasets/pending/${PENDING}`) {
      return json(200, options.pending);
    }
    return json(options.answer ?? 200, options.answer === 409 ? { code: 'x' } : {});
  }) as unknown as typeof fetch;
  const onChanged = vi.fn();
  const onCheckNow = vi.fn();
  const onGoTo = vi.fn();
  const onNotice = vi.fn();
  render(
    <StrictMode>
      <DataTab
        client={createApiClient({ baseUrl: 'http://data.test', fetch: fetching })}
        document={DOCUMENT}
        states={shown}
        checkFailures={options.failures ?? new Map()}
        headingOf={(node) => (node === FIRST ? '1 Readings' : '2 Sites')}
        language="en-GB"
        checking={false}
        onChanged={onChanged}
        onCheckNow={onCheckNow}
        onGoTo={onGoTo}
        onNotice={onNotice}
      />
    </StrictMode>,
  );
  return { asked, onChanged, onCheckNow, onGoTo, onNotice };
}

/** The row of one binding, by its identifier. */
const rowOf = (id: string) => document.querySelector<HTMLElement>(`li[data-binding="${id}"]`)!;

describe('the Data tab (the B4 plan, task 3)', () => {
  it("DAT-039 lists a whole document's bindings with those waiting, failed and never resolved, and filters by each", async () => {
    const user = userEvent.setup();
    drawn(
      states(
        view(FIRST, 'waits', 'North', {
          waiting: { version: 'next', provenance, taken: value('North Quay') },
        }),
        view(FIRST, 'fails', 'South', {}),
        view(SECOND, 'never', null),
        view(SECOND, 'holds', 'East'),
      ),
      { failures: new Map([[`${FIRST} fails`, 'The source refused the query.']]) },
    );
    // Grouped under each node, in the outline's order.
    expect(screen.getByRole('heading', { name: '1 Readings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 Sites' })).toBeInTheDocument();
    expect(rowOf('waits')).toHaveTextContent('Revision waiting');
    expect(rowOf('fails')).toHaveTextContent('Failed');
    expect(rowOf('fails')).toHaveTextContent('The source refused the query.');
    expect(rowOf('never')).toHaveTextContent('Never resolved');
    expect(rowOf('holds')).toHaveTextContent('Holding');

    const filter = screen.getByRole('combobox', { name: 'Show' });
    for (const [state, only] of [
      ['Revision waiting', 'waits'],
      ['Failed', 'fails'],
      ['Never resolved', 'never'],
    ] as const) {
      await user.selectOptions(filter, state);
      expect(
        screen.getAllByRole('listitem').map((each) => each.getAttribute('data-binding')),
      ).toEqual([only]);
    }
    await user.selectOptions(filter, 'All');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it("lists a bound table's binding as holding a table of its result's rows, never failed or stale for what it takes (TB1-C, TB2-H)", () => {
    const table = view(FIRST, 'table', 'unused');
    const binding = { ...table.binding } as Record<string, unknown>;
    delete binding.take;
    drawn(
      states({
        ...table,
        binding,
        held: { ...table.held, taken: { table: true } },
      }),
    );
    expect(rowOf('table')).toHaveTextContent('Holding');
    expect(rowOf('table')).toHaveTextContent('A table of 1 row');
  });

  it('DAT-070 lists a binding whose definition changed, and each binding changed since the document was last published with what differs', () => {
    drawn(
      states(
        view(FIRST, 'moved', 'North', { definitionChanged: true }),
        view(FIRST, 'added', 'South', { sincePublished: 'new' }),
        view(SECOND, 'differs', 'East', { sincePublished: ['digest', 'dataset', 'definition'] }),
      ),
    );
    expect(rowOf('moved')).toHaveTextContent('Definition changed');
    expect(rowOf('added')).toHaveTextContent('Changed since published');
    expect(rowOf('added')).toHaveTextContent('New since the last publication');
    expect(rowOf('differs')).toHaveTextContent(
      'Since the last publication: the binding, its result and its definition version',
    );
  });

  it('shows a waiting value beside the one held, and accepts it, saying where the value changed meanwhile', async () => {
    const user = userEvent.setup();
    const shown = states(
      view(FIRST, 'waits', 'North', {
        waiting: { version: 'next', provenance, taken: value('North Quay') },
      }),
    );
    const { asked, onChanged } = drawn(shown);
    expect(rowOf('waits')).toHaveTextContent('North');
    expect(rowOf('waits')).toHaveTextContent('Waiting: North Quay');
    await user.click(within(rowOf('waits')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(asked).toEqual([
      {
        path: `/v1/documents/${DOCUMENT}/bindings/accept`,
        body: { node: FIRST, binding: 'waits', version: 'next', replaces: 'held-waits' },
      },
    ]);
  });

  it('says a refused acceptance as the value changing meanwhile', async () => {
    const user = userEvent.setup();
    const { onNotice } = drawn(
      states(
        view(FIRST, 'waits', 'North', {
          waiting: { version: 'next', provenance, taken: value('North Quay') },
        }),
      ),
      { answer: 409 },
    );
    await user.click(within(rowOf('waits')).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith(
        'The value changed meanwhile. Look at it again in the Data tab.',
      ),
    );
  });

  it('says where no value could be checked for this reader, and offers them no act they may not take', () => {
    drawn(states(view(FIRST, 'never', null, { mayCheck: false, mayResolve: false })));
    expect(screen.getByText('Values were not checked for you.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(within(rowOf('never')).queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it("says it waits while a resolved value's images are checked, and stops saying so once it is held", async () => {
    const user = userEvent.setup();
    const { asked, onNotice, onChanged } = drawn(states(view(SECOND, 'never', null)), {
      pending: {
        id: PENDING,
        act: 'resolve',
        document: DOCUMENT,
        node: SECOND,
        binding: 'never',
        state: 'done',
        result: {
          node: SECOND,
          binding: 'never',
          held: { dataset: '55555555-5555-4555-8555-555555555555', version: 'v', reused: false },
        },
      },
    });
    await user.click(within(rowOf('never')).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(asked.map((each) => each.path)).toContain(`/v1/datasets/pending/${PENDING}`);
    expect(onNotice.mock.calls).toEqual([
      ['The value holds images, which are being checked. It is shown once every one is.'],
      [null],
    ]);
  });

  it('offers Check now and Go to', async () => {
    const user = userEvent.setup();
    const { onCheckNow, onGoTo } = drawn(states(view(FIRST, 'holds', 'North')));
    expect(screen.queryByText('Values were not checked for you.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check now' }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
    await user.click(within(rowOf('holds')).getByRole('button', { name: 'Go to' }));
    expect(onGoTo).toHaveBeenCalledWith(FIRST, 'holds');
  });
});

const ADA = '12121212-1212-4121-8121-121212121212';
const ownView = { ...provenance, identity: { kind: 'endUser', principal: ADA } };

describe("a person's own view in the Data tab (the D7 plan, D7.3)", () => {
  it("DAT-091 warns before accepting one's own view that everybody who may read the document sees it and it prints, and sends the acknowledgement only once given, by keyboard", async () => {
    const user = userEvent.setup();
    const { asked, onNotice } = drawn(
      states(
        view(FIRST, 'mine', 'North', {
          waiting: { version: 'next', provenance: ownView, taken: value('North Quay') },
        }),
      ),
    );
    within(rowOf('mine')).getByRole('button', { name: 'Accept' }).focus();
    await user.keyboard('{Enter}');
    const asking = await screen.findByRole('dialog', { name: 'Hold your own view?' });
    expect(asking).toHaveTextContent(
      'This value runs as you, so it is your own view of the source. Once it is held, everybody who may read this document will see it, and it prints in the publications made of the document.',
    );
    expect(asked).toEqual([]);

    // Declined: nothing is sent, and the focus goes back to Accept.
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(onNotice).toHaveBeenCalledWith(
        'Your own view was not held, so this value holds nothing new.',
      ),
    );
    expect(asked).toEqual([]);
    expect(within(rowOf('mine')).getByRole('button', { name: 'Accept' })).toHaveFocus();

    // Agreed, by Tab and Enter alone.
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Hold your own view?' });
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hold my own view' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(asked).toHaveLength(1));
    expect(asked[0]).toEqual({
      path: `/v1/documents/${DOCUMENT}/bindings/accept`,
      body: {
        node: FIRST,
        binding: 'mine',
        version: 'next',
        replaces: 'held-mine',
        sharesOwnView: true,
      },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("asks before holding one's own view resolved, and resolves it again with the acknowledgement", async () => {
    const user = userEvent.setup();
    const { asked } = drawn(states(view(SECOND, 'never', null)), {
      answers: [
        () =>
          json(409, {
            code: 'acknowledgement_required',
            message: 'The binding never runs as you.',
            traceId: 't',
          }),
        () => json(200, { results: [] }),
      ],
    });
    await user.click(within(rowOf('never')).getByRole('button', { name: 'Resolve' }));
    await user.click(await screen.findByRole('button', { name: 'Hold my own view' }));
    await waitFor(() => expect(asked).toHaveLength(2));
    expect(asked.map((each) => each.body)).toEqual([
      { bindings: [{ node: SECOND, binding: 'never' }] },
      { bindings: [{ node: SECOND, binding: 'never' }], sharesOwnView: true },
    ]);
  });

  it('DAT-022 says whose own view a binding holds beside its value', () => {
    drawn(
      states(
        view(FIRST, 'hers', 'North', {
          held: {
            ...(view(FIRST, 'hers', 'North').held as object),
            provenance: ownView,
            by: { id: ADA, displayName: 'Ada' },
          },
        }),
        view(FIRST, 'service', 'South'),
      ),
    );
    expect(rowOf('hers')).toHaveTextContent("Ada's own view");
    expect(rowOf('service')).not.toHaveTextContent('own view');
  });

  it("says in place why another person's own view could not be accepted, or why a sign-out stopped it", async () => {
    const user = userEvent.setup();
    const differs =
      "The result waiting for the binding waits is another person's own view: only they may accept it.";
    const ended =
      'You signed out while the source was answering, so it was stopped. Nothing was recorded.';
    const { onNotice } = drawn(
      states(
        view(FIRST, 'waits', 'North', {
          waiting: { version: 'next', provenance, taken: value('North Quay') },
        }),
      ),
      {
        answers: [
          () => json(403, { code: 'identity_differs', message: differs, traceId: 't' }),
          () =>
            json(401, {
              code: 'authority_ended',
              message: ended,
              traceId: 't',
              reason: 'signed_out',
            }),
        ],
      },
    );
    await user.click(within(rowOf('waits')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(differs));
    await user.click(within(rowOf('waits')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(ended));
  });
});
