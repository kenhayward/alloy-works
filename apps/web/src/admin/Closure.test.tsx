import { TENANT_STATE_EFFECTS } from '@alloy-works/domain';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import enGB from '../words/en-GB.json';
import { CloseEnvironment, ClosingEnvironment } from './Closure.js';

afterEach(cleanup);

const VIEW = {
  state: 'active',
  name: 'Production',
  since: '2026-11-04T10:00:00.000Z',
  graceEndsAt: null,
  closedBy: null,
  holds: 0,
  graceDays: 30,
  deletionDays: 1,
  effects: TENANT_STATE_EFFECTS.closing,
  mayCancel: false,
};

/** A hand-written client: what each address answers. */
const fake = (answers: Record<string, unknown>, post = vi.fn(), remove = post) =>
  ({
    GET: (url: string) => Promise.resolve({ data: answers[url] }),
    POST: post,
    DELETE: remove,
  }) as never;

describe('closing an environment in Administration', () => {
  it('has words for every effect closing has', () => {
    for (const capability of Object.keys(TENANT_STATE_EFFECTS.closing)) {
      expect(enGB).toHaveProperty([`admin.closure-effect-${capability}`]);
    }
  });

  it('says nothing to somebody who may not close it', async () => {
    const { container } = render(
      <CloseEnvironment client={fake({ '/v1/exports': { items: [] } })} />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('ADM-029 will not close until the export is answered for and the name is typed', async () => {
    const post = vi.fn().mockResolvedValue({ error: { code: 'closure_name_mismatch' } });
    render(
      <CloseEnvironment
        client={fake({ '/v1/closure': VIEW, '/v1/exports': { items: [] } }, post)}
      />,
    );
    const button = await screen.findByRole('button', { name: 'Close this environment' });
    expect(button).toBeDisabled();
    expect(screen.getByLabelText(/No whole export/)).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/without taking an export/));
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Type Production/), 'Production');
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(post).toHaveBeenCalledWith('/v1/closure', {
      body: { name: 'Production', declined: true },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent("not this environment's name");
  });

  it('ADM-029 offers a whole export finished in the last 24 hours, and not a partial one', async () => {
    const post = vi.fn().mockResolvedValue({ error: {} });
    const requestedAt = new Date().toISOString();
    render(
      <CloseEnvironment
        client={fake(
          {
            '/v1/closure': VIEW,
            '/v1/exports': {
              items: [
                { id: 'a-space', scope: 'space', state: 'done', requestedAt },
                { id: 'whole', scope: 'tenant', state: 'done', requestedAt },
              ],
            },
          },
          post,
        )}
      />,
    );
    await userEvent.click(await screen.findByLabelText(/Use the whole export/));
    await userEvent.type(screen.getByLabelText(/Type Production/), 'Production');
    await userEvent.click(screen.getByRole('button', { name: 'Close this environment' }));
    expect(post).toHaveBeenCalledWith('/v1/closure', {
      body: { name: 'Production', export: 'whole' },
    });
  });

  it('ADM-029 notices an export finishing, with no reload', async () => {
    const answers: Record<string, unknown> = { '/v1/closure': VIEW, '/v1/exports': { items: [] } };
    render(<CloseEnvironment client={fake(answers)} followMs={5} />);
    expect(await screen.findByLabelText(/No whole export/)).toBeDisabled();
    answers['/v1/exports'] = {
      items: [{ id: 'w', scope: 'tenant', state: 'done', requestedAt: new Date().toISOString() }],
    };
    expect(await screen.findByLabelText(/Use the whole export/)).toBeEnabled();
  });

  it('ADM-030 offers to sign in again when closing asks for a recent sign-in', async () => {
    const post = vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/closure'
          ? { error: { code: 'reauthentication_required' } }
          : { data: { url: '/elsewhere' } },
      ),
    );
    const assign = vi.fn();
    render(
      <CloseEnvironment
        client={fake({ '/v1/closure': VIEW, '/v1/exports': { items: [] } }, post)}
        go={assign}
      />,
    );
    await userEvent.click(await screen.findByLabelText(/without taking an export/));
    await userEvent.type(screen.getByLabelText(/Type Production/), 'Production');
    await userEvent.click(screen.getByRole('button', { name: 'Close this environment' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    expect(post).toHaveBeenCalledWith('/v1/sessions/current/reauthentication', {
      body: { to: 'admin/export' },
    });
    expect(assign).toHaveBeenCalledWith('/elsewhere');
  });

  it('warns that a hold keeps everything', async () => {
    render(
      <CloseEnvironment
        client={fake({ '/v1/closure': { ...VIEW, holds: 2 }, '/v1/exports': { items: [] } })}
      />,
    );
    expect(await screen.findByRole('note')).toHaveTextContent('2 legal holds');
  });
});

describe('what a closing environment shows', () => {
  const base = {
    '/v1/exports': { items: [] },
    '/v1/holds': { items: [] },
    '/v1/spaces': { items: [] },
  };

  it('offers a holder the way back, and says when it goes', async () => {
    render(
      <ClosingEnvironment
        client={fake({
          ...base,
          '/v1/closure': {
            ...VIEW,
            state: 'closing',
            closedBy: 'person',
            mayCancel: true,
            graceEndsAt: '2026-12-04T10:00:00.000Z',
          },
        })}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Give up closing it' })).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('closing');
    expect(screen.getByText(/will be deleted after/)).toBeInTheDocument();
  });

  it("offers no way back from the operator's closure", async () => {
    render(
      <ClosingEnvironment
        client={fake({
          ...base,
          '/v1/closure': { ...VIEW, state: 'closing', closedBy: 'operator' },
        })}
      />,
    );
    expect(await screen.findByText(/only the operator can give it up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Give up closing it' })).toBeNull();
  });

  it('says a hold is what keeps a retained environment', async () => {
    render(
      <ClosingEnvironment
        client={fake({
          ...base,
          '/v1/closure': { ...VIEW, state: 'retained', closedBy: 'person', holds: 1 },
        })}
      />,
    );
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('held');
    expect(screen.getByText(/1 legal hold keeps everything/)).toBeInTheDocument();
    expect(screen.queryByText(/Place one from its page/)).toBeNull();
  });

  it('ADM-030 lets somebody with an old sign-in give it up, and always leave', async () => {
    const post = vi.fn(() => Promise.resolve({ data: { url: '/elsewhere' } }));
    const remove = vi.fn(() => Promise.resolve({ error: { code: 'reauthentication_required' } }));
    const go = vi.fn();
    render(
      <ClosingEnvironment
        client={fake(
          {
            ...base,
            '/v1/closure': { ...VIEW, state: 'closing', closedBy: 'person', mayCancel: true },
          },
          post,
          remove,
        )}
        go={go}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Give up closing it' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    expect(post).toHaveBeenCalledWith('/v1/sessions/current/reauthentication', { body: {} });
    expect(go).toHaveBeenCalledWith('/elsewhere');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(post).toHaveBeenCalledWith('/v1/sign-out');
  });
});
