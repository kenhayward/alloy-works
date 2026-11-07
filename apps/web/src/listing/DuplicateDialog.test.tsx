import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DuplicateDialog } from './DuplicateDialog.js';

const MANUAL = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TRAINING = '2b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const ALONE = 'a0000000-0000-4000-8000-000000000001';
const SHARED = 'a0000000-0000-4000-8000-000000000002';
const HIDDEN = 'a0000000-0000-4000-8000-000000000003';
const MEMBER = 'a0000000-0000-4000-8000-000000000004';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Exception = { component: string; as: 'copy' | 'reuse' };

/** Four placed: one only here, one shared, one not the reader's, a member of a placed group. */
const PLACED = [
  { component: ALONE, title: 'Safety notes', placed: 'only', others: 0, grouped: false },
  { component: SHARED, title: 'Warranty', placed: 'shared', others: 3, grouped: false },
  { component: HIDDEN, title: null, placed: 'unreadable', others: null, grouped: false },
  { component: MEMBER, title: 'Boilerplate', placed: 'only', others: 0, grouped: true },
] as const;

function service({
  inUse = false,
  hold,
  overrides = 0,
}: { inUse?: boolean; hold?: Promise<void>; overrides?: number } = {}) {
  const bodies: { path: string; body: Record<string, unknown> }[] = [];
  const fetching = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname } = new URL(request.url);
    if (pathname === '/v1/spaces') {
      return json(200, {
        items: [
          { id: GENERAL, name: 'General', mayCreate: true, mayDesign: false },
          { id: TRAINING, name: 'Training', mayCreate: true, mayDesign: true },
        ],
        next: null,
      });
    }
    const body = (await request.json()) as Record<string, unknown>;
    bodies.push({ path: pathname, body });
    if (pathname === `/v1/artifacts/${MANUAL}/copy/preview`) {
      const choice = (body['components'] as string | undefined) ?? 'own';
      const set = new Map(
        ((body['exceptions'] as Exception[] | undefined) ?? []).map((each) => [
          each.component,
          each.as,
        ]),
      );
      const components = PLACED.map((each) => ({
        ...each,
        outcome:
          set.get(each.component) ??
          (each.placed === 'unreadable' || choice === 'reuse'
            ? 'reuse'
            : choice === 'all' || each.placed === 'only'
              ? 'copy'
              : 'reuse'),
      }));
      const copied = components.filter((each) => each.outcome === 'copy').length;
      return json(200, {
        kind: 'document',
        titleInUse: inUse,
        copied,
        reused: components.length - copied,
        required: 0,
        kept: 0,
        unreadable: 1,
        approvedToLatest: 0,
        newestShown: 0,
        overrides,
        overridesDropped: overrides > 0 ? 1 : 0,
        lines: 0,
        translations: 0,
        limit: choice === 'all' ? 2 : 200,
        consequences: null,
        components,
      });
    }
    if (pathname === `/v1/artifacts/${MANUAL}/copy`) {
      await hold;
      return json(201, { id: 'new', kind: 'document' });
    }
    return json(404, {});
  });
  return { client: createApiClient({ baseUrl: 'http://localhost', fetch: fetching }), bodies };
}

const duplicate = (
  client: ReturnType<typeof createApiClient>,
  more: { kind?: 'document' | 'component' | 'template'; space?: string } = {},
  onDone = vi.fn(),
  onClose = vi.fn(),
) =>
  render(
    <DuplicateDialog
      client={client}
      kind={more.kind ?? 'document'}
      id={MANUAL}
      title="Operator manual"
      space={more.space ?? GENERAL}
      spaceName="General"
      state={{ key: 'draft', name: 'Draft' }}
      onDone={onDone}
      onClose={onClose}
    />,
  );

const lastPreview = (bodies: { path: string; body: Record<string, unknown> }[]) =>
  bodies.filter((each) => each.path.endsWith('/copy/preview')).at(-1)?.body;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('Duplicate', () => {
  it("REU-057 offers a document's three starting points, its own by default, counting what it copies first", async () => {
    const user = userEvent.setup();
    const { client, bodies } = service();
    const onDone = vi.fn();
    duplicate(client, {}, onDone);
    expect(screen.getByRole('heading', { name: 'Duplicate this document' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Copy its own, reuse shared/ })).toBeChecked();
    const toggle = await screen.findByRole('button', { name: /2 copied 2 reused/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/4 components/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /^Copy every component/ }));
    // Past the limit the service states, refused before it is asked (REU-057).
    expect(
      await screen.findByText('It would copy more than 2 components. Reuse some of them instead.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: /^Reuse every component/ }));
    expect(await screen.findByRole('button', { name: /0 copied 4 reused/ })).toBeInTheDocument();
    await waitFor(() => expect(lastPreview(bodies)).toMatchObject({ components: 'reuse' }));
    await screen.findByText('Into General, as a new Draft.');

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Duplicated as Operator manual (copy).'),
    );
    expect(bodies.at(-1)).toEqual({
      path: `/v1/artifacts/${MANUAL}/copy`,
      body: {
        to: GENERAL,
        title: 'Operator manual (copy)',
        components: 'reuse',
        exceptions: [],
        rewordings: 'keep',
      },
    });
  });

  it('REU-057 sets a component the other way as an exception, and clears every exception when the starting point changes', async () => {
    const user = userEvent.setup();
    const { client, bodies } = service();
    duplicate(client);
    await user.click(await screen.findByRole('button', { name: /Show all 4, make exceptions/ }));
    const list = screen.getByRole('list', { name: 'Components' });
    const warranty = within(list).getByRole('radiogroup', { name: 'In the copy, Warranty' });
    expect(within(warranty).getByRole('radio', { name: 'Reuse' })).toBeChecked();
    await user.click(within(warranty).getByRole('radio', { name: 'Copy' }));
    const row = warranty.closest('li')!;
    expect(row).toHaveAttribute('data-exception');
    expect(within(row).getByText('Exception')).toBeInTheDocument();
    expect(within(row).getByText('Also in 3 more')).toBeInTheDocument();
    expect(screen.getByText('1 exception')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /3 copied 1 reused/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(lastPreview(bodies)).toMatchObject({
        exceptions: [{ component: SHARED, as: 'copy' }],
      }),
    );
    // Set back, it is no longer an exception.
    await user.click(within(warranty).getByRole('radio', { name: 'Reuse' }));
    expect(row).not.toHaveAttribute('data-exception');
    await user.click(within(warranty).getByRole('radio', { name: 'Copy' }));

    await user.click(screen.getByRole('radio', { name: /^Copy every component/ }));
    expect(screen.queryByText('1 exception')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Components' }).querySelector('[data-exception]')).toBe(
      null,
    );
    await waitFor(() =>
      expect(lastPreview(bodies)).toMatchObject({ components: 'all', exceptions: [] }),
    );
  });

  it('REU-057 clears the exceptions from their chip', async () => {
    const user = userEvent.setup();
    const { client } = service();
    duplicate(client);
    await user.click(await screen.findByRole('button', { name: /Show all 4/ }));
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'In the copy, Safety notes' })).getByRole(
        'radio',
        { name: 'Reuse' },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Clear the exceptions' }));
    expect(screen.queryByText('1 exception')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('radiogroup', { name: 'In the copy, Safety notes' })).getByRole(
        'radio',
        { name: 'Copy' },
      ),
    ).toBeChecked();
  });

  it('REU-057 fixes a component its reader may not read as Reused, unnamed, and says what copying a group member does', async () => {
    const user = userEvent.setup();
    const { client } = service();
    duplicate(client);
    await user.click(await screen.findByRole('button', { name: /Show all 4/ }));
    const list = screen.getByRole('list', { name: 'Components' });
    const hidden = within(list).getByText('A component not yours to read').closest('li')!;
    expect(hidden).toHaveAttribute('data-fixed');
    expect(within(hidden).getByText('Not yours to read')).toBeInTheDocument();
    expect(within(hidden).queryByRole('radio')).not.toBeInTheDocument();
    expect(within(hidden).getByText('Reused')).toBeInTheDocument();
    const member = within(list).getByText('Boilerplate').closest('li')!;
    expect(within(member).getByText('In a placed group')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 member of a placed group is copied, so its group becomes plain references.',
      ),
    ).toBeInTheDocument();
  });

  it('REU-068 keeps local rewordings by default, says what drops, and leaves them behind when unticked', async () => {
    const user = userEvent.setup();
    const { client, bodies } = service({ overrides: 3 });
    duplicate(client);
    const keep = await screen.findByRole('checkbox', { name: /Keep local rewordings on the copy/ });
    expect(keep).toBeChecked();
    expect(
      screen.getByText(
        'The copy reads as this one does. 1 that no longer applies, as its paragraph has changed, is dropped.',
      ),
    ).toBeInTheDocument();
    await user.click(keep);
    expect(
      screen.getByText(
        "The copy shows each component's own words. They stay on this document only.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(lastPreview(bodies)).toMatchObject({ rewordings: 'drop' }));
  });

  it('REU-068 offers no rewordings where the document has none', async () => {
    const { client } = service();
    duplicate(client);
    await screen.findByRole('button', { name: /2 copied/ });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('REU-056 copies into its own space by default, warning of a title already used there, and still duplicates', async () => {
    const user = userEvent.setup();
    const { client } = service({ inUse: true });
    const onDone = vi.fn();
    duplicate(client, { kind: 'component', space: TRAINING }, onDone);
    expect(screen.getByRole('heading', { name: 'Duplicate this component' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        'Something in that space already has this title. You can still use it.',
      ),
    ).toBeInTheDocument();
    // Its own space, not the first listed (RM-F).
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue(TRAINING);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Components' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('REU-056 copies a template only into a space the caller may design in', async () => {
    const { client } = service();
    duplicate(client, { kind: 'template' });
    const where = await screen.findByRole('combobox', { name: 'Where' });
    await waitFor(() => expect(where).toHaveValue(TRAINING));
    expect(screen.getAllByRole('option').map((each) => each.textContent)).toEqual(['Training']);
  });

  it('REU-057 stays open with a progress bar until the copy is made', async () => {
    const user = userEvent.setup();
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client } = service({ hold });
    const onClose = vi.fn();
    const onDone = vi.fn();
    duplicate(client, {}, onDone, onClose);
    await screen.findByText('Into General, as a new Draft.');
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByRole('progressbar', { name: 'Copying' })).toBeInTheDocument();
    expect(
      screen.getByText('Copying 2 components. This stays open until it is done.'),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /^Reuse every component/ })).toBeDisabled();
    release();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('remembers for the session whether the components are shown', async () => {
    const user = userEvent.setup();
    const { client } = service();
    const { unmount } = duplicate(client);
    await user.click(await screen.findByRole('button', { name: /Show all 4/ }));
    unmount();
    duplicate(service().client);
    expect(await screen.findByRole('list', { name: 'Components' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Hide the components/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
