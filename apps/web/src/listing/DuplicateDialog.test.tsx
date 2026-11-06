import { createApiClient } from '@alloy-works/api-client';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DuplicateDialog } from './DuplicateDialog.js';

const MANUAL = '3c1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const GENERAL = '1a1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';
const TRAINING = '2b1d2c9f-7a4f-4e3b-8e47-3b5a2dae8c21';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function service({ inUse = false, hold }: { inUse?: boolean; hold?: Promise<void> } = {}) {
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
      const copied = body['components'] === 'all' ? 12 : body['components'] === 'own' ? 4 : 0;
      return json(200, {
        kind: 'document',
        titleInUse: inUse,
        copied,
        reused: 12 - copied,
        required: body['components'] === 'reuse' ? 0 : 1,
        kept: 0,
        unreadable: 0,
        approvedToLatest: 0,
        newestShown: 0,
        overridesDropped: 0,
        lines: 0,
        translations: 0,
        limit: copied === 12 ? 10 : 200,
        consequences: null,
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

describe('Duplicate', () => {
  it("REU-057 offers a document's three choices, its own by default, counting what it copies first", async () => {
    const user = userEvent.setup();
    const { client, bodies } = service();
    const onDone = vi.fn();
    render(
      <DuplicateDialog
        client={client}
        kind="document"
        id={MANUAL}
        title="Operator manual"
        space={GENERAL}
        onDone={onDone}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Duplicate Operator manual' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^Copy only its own components/ })).toBeChecked();
    expect(await screen.findByText('It copies 4 components.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Copy every component' }));
    // Past the limit the service states, refused before it is asked (REU-057).
    expect(
      await screen.findByText('It would copy more than 10 components. Reuse some of them instead.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('list', { name: 'What the copy reuses and leaves' })).toHaveTextContent(
      '1 component its template requires is reused, never copied.',
    );
    await user.click(screen.getByRole('radio', { name: 'Reuse every component' }));
    expect(await screen.findByText('It copies no components.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('Duplicated as Operator manual (copy).'),
    );
    expect(bodies.at(-1)).toEqual({
      path: `/v1/artifacts/${MANUAL}/copy`,
      body: { to: GENERAL, title: 'Operator manual (copy)', components: 'reuse' },
    });
  });

  it('REU-056 copies into its own space by default, warning of a title already used there, and still duplicates', async () => {
    const user = userEvent.setup();
    const { client } = service({ inUse: true });
    const onDone = vi.fn();
    render(
      <DuplicateDialog
        client={client}
        kind="component"
        id={MANUAL}
        title="Operator manual"
        space={TRAINING}
        onDone={onDone}
        onClose={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(
        'Something in that space already has this title. You can still use it.',
      ),
    ).toBeInTheDocument();
    // Its own space, not the first listed (RM-F).
    expect(screen.getByRole('combobox', { name: 'Where' })).toHaveValue(TRAINING);
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('REU-056 copies a template only into a space the caller may design in', async () => {
    const { client } = service();
    render(
      <DuplicateDialog
        client={client}
        kind="template"
        id={MANUAL}
        title="Operator manual"
        space={GENERAL}
        onDone={vi.fn()}
        onClose={vi.fn()}
      />,
    );
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
    render(
      <DuplicateDialog
        client={client}
        kind="document"
        id={MANUAL}
        title="Operator manual"
        space={GENERAL}
        onDone={onDone}
        onClose={onClose}
      />,
    );
    await screen.findByText('It copies 4 components.');
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(await screen.findByRole('progressbar', { name: 'Copying' })).toBeInTheDocument();
    expect(screen.getByText('Copying 4 components')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
