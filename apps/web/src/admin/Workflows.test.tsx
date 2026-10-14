import { createApiClient } from '@alloy-works/api-client';
import { SEED_WORKFLOW } from '@alloy-works/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Workflows } from './Workflows.js';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const IVY = { id: '11111111-1111-4111-8111-111111111111', name: 'Ivy' };

type Kind = 'component' | 'document';
type Body = typeof SEED_WORKFLOW;

/** Each kind's workflow in force, a save making the next version; `refuse` answers a save instead. */
function service(refuse?: () => Response) {
  const versions: Record<Kind, { version: number; body: Body; by: typeof IVY | null; at: string }> =
    {
      component: { version: 1, body: SEED_WORKFLOW, by: null, at: '2026-10-13T09:00:00.000Z' },
      document: { version: 2, body: SEED_WORKFLOW, by: IVY, at: '2026-10-13T09:00:00.000Z' },
    };
  const sent: unknown[] = [];
  const fetching = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (request.method === 'POST') {
      const { kind, ...body } = (await request.json()) as Body & { kind: Kind };
      sent.push({ kind, ...body });
      if (refuse) return refuse();
      versions[kind] = {
        version: versions[kind].version + 1,
        body,
        by: IVY,
        at: '2026-10-14T10:00:00.000Z',
      };
      return json(200, { kind, ...versions[kind] });
    }
    return json(200, {
      workflows: (['component', 'document'] as const).map((kind) => ({
        definition: { kind, ...versions[kind] },
        counts: kind === 'component' ? { draft: 12, in_review: 3, approved: 40 } : { draft: 2 },
      })),
    });
  }) as typeof fetch;
  return { client: createApiClient({ baseUrl: 'http://admin.test', fetch: fetching }), sent };
}

const components = () => screen.getByRole('region', { name: 'Components' });

describe("Administration's Workflows", () => {
  it('LIF-001 LIF-002 shows each kind’s states, how many are in each, and its transitions with what each needs', async () => {
    const { client } = service();
    render(<Workflows client={client} />);
    const states = await within(
      await screen.findByRole('region', { name: 'Components' }),
    ).findByRole('table', { name: 'Component states' });
    const rows = within(states).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByRole('textbox', { name: 'Name of Draft' })).toHaveValue('Draft');
    expect(
      within(rows[0]!).getByRole('radio', { name: 'Draft is where one starts' }),
    ).toBeChecked();
    expect(rows[0]).toHaveTextContent('12');
    expect(rows[2]).toHaveTextContent('40');
    expect(
      within(rows[2]!).getByRole('checkbox', { name: 'Approved counts as approved' }),
    ).toBeChecked();
    expect(within(components()).getByText('Version 1, as seeded')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Documents' })).getByText(
        'Version 2, saved by Ivy on 13 Oct 2026',
      ),
    ).toBeInTheDocument();

    const transitions = within(components()).getByRole('table', { name: 'Component transitions' });
    const returning = within(transitions).getAllByRole('row')[2]!;
    expect(within(returning).getByRole('textbox', { name: 'Name of Return' })).toHaveValue(
      'Return',
    );
    expect(within(returning).getByRole('combobox', { name: 'Return moves from' })).toHaveValue(
      'in_review',
    );
    expect(within(returning).getByRole('combobox', { name: 'Return moves to' })).toHaveValue(
      'draft',
    );
    expect(within(returning).getByRole('combobox', { name: 'Return needs' })).toHaveValue(
      'approve',
    );
    expect(
      within(returning).getByRole('checkbox', { name: 'Return asks for a reason' }),
    ).toBeChecked();
  });

  it('LIF-001 LIF-002 saves an edit as the next version: a state added and renamed, a transition added and removed', async () => {
    const { client, sent } = service();
    render(<Workflows client={client} />);
    await within(await screen.findByRole('region', { name: 'Components' })).findByRole('table', {
      name: 'Component states',
    });
    const region = components();
    await userEvent.type(within(region).getByRole('textbox', { name: 'New state' }), 'Withdrawn');
    await userEvent.click(within(region).getByRole('button', { name: 'Add state' }));
    const renamed = within(region).getByRole('textbox', { name: 'Name of In review' });
    await userEvent.clear(renamed);
    await userEvent.type(renamed, 'Reviewing');
    await userEvent.click(
      within(region).getByRole('button', { name: 'Remove the transition Reopen' }),
    );
    await userEvent.type(
      within(region).getByRole('textbox', { name: 'New transition' }),
      'Withdraw',
    );
    await userEvent.click(within(region).getByRole('button', { name: 'Add transition' }));
    await userEvent.selectOptions(
      within(region).getByRole('combobox', { name: 'Withdraw moves from' }),
      'approved',
    );
    await userEvent.selectOptions(
      within(region).getByRole('combobox', { name: 'Withdraw moves to' }),
      'withdrawn',
    );
    await userEvent.selectOptions(
      within(region).getByRole('combobox', { name: 'Withdraw needs' }),
      'approve',
    );
    await userEvent.click(
      within(region).getByRole('checkbox', { name: 'Withdraw asks for a reason' }),
    );
    await userEvent.click(within(region).getByRole('button', { name: 'Save as version 2' }));

    expect(await within(region).findByText('Saved as version 2.')).toBeInTheDocument();
    expect(sent).toEqual([
      {
        kind: 'component',
        states: [
          { key: 'draft', name: 'Draft', initial: true, approved: false },
          { key: 'in_review', name: 'Reviewing', initial: false, approved: false },
          { key: 'approved', name: 'Approved', initial: false, approved: true },
          { key: 'withdrawn', name: 'Withdrawn', initial: false, approved: false },
        ],
        transitions: [
          ...SEED_WORKFLOW.transitions.filter((each) => each.key !== 'reopen'),
          {
            key: 'withdraw',
            name: 'Withdraw',
            from: 'approved',
            to: 'withdrawn',
            permission: 'approve',
            reasonRequired: true,
          },
        ],
      },
    ]);
    await waitFor(() =>
      expect(
        within(region).getByText('Version 2, saved by Ivy on 14 Oct 2026'),
      ).toBeInTheDocument(),
    );
  });

  it('removes a state with the transitions to and from it, and says each problem the service finds', async () => {
    const { client, sent } = service(() =>
      json(400, {
        code: 'workflow_invalid',
        message: 'The workflow is not valid.',
        traceId: 't',
        problems: [
          {
            rule: 'reachable',
            path: 'states.1',
            message: 'No transition reaches approved from the initial state',
          },
        ],
      }),
    );
    render(<Workflows client={client} />);
    await within(await screen.findByRole('region', { name: 'Components' })).findByRole('table', {
      name: 'Component states',
    });
    const region = components();
    await userEvent.click(
      within(region).getByRole('button', { name: 'Remove the state In review' }),
    );
    expect(within(region).queryByRole('textbox', { name: 'Name of Submit' })).toBeNull();
    expect(within(region).getByRole('textbox', { name: 'Name of Reopen' })).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Save as version 2' }));
    expect(
      await within(region).findByText('No transition reaches approved from the initial state'),
    ).toBeInTheDocument();
    expect(
      (sent[0] as { transitions: { key: string }[] }).transitions.map((each) => each.key),
    ).toEqual(['reopen']);
  });

  it('says so to somebody who may not administer the environment', async () => {
    const fetching = (async () =>
      json(403, { code: 'forbidden', message: 'x', traceId: 't' })) as unknown as typeof fetch;
    render(
      <Workflows client={createApiClient({ baseUrl: 'http://admin.test', fetch: fetching })} />,
    );
    expect(await screen.findByText('You may not manage access here.')).toBeInTheDocument();
  });
});
