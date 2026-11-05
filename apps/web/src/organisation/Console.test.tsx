import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Console } from './Console.js';

afterEach(cleanup);

const tenant = (over: object) => ({
  id: 'prod',
  name: 'Production',
  state: 'active',
  since: '2026-11-04T10:00:00.000Z',
  closedBy: null,
  graceEndsAt: null,
  hostnames: ['prod.acme.test'],
  ...over,
});

const ok = () => Promise.resolve({ response: { ok: true } as Response });
const fake = (items: object[], post = vi.fn(ok), remove = vi.fn(ok)) =>
  ({
    GET: () => Promise.resolve({ data: { items }, response: { status: 200 } }),
    POST: post,
    DELETE: remove,
  }) as never;

const withSuffix = (post: ReturnType<typeof vi.fn>, requests: object[] = []) =>
  ({
    GET: () =>
      Promise.resolve({
        data: { items: [], requests, hostnameSuffix: '.acme.test' },
        response: { status: 200 },
      }),
    POST: post,
    DELETE: vi.fn(ok),
  }) as never;

describe('creating a tenant from the console', () => {
  const fill = async () => {
    await userEvent.type(await screen.findByLabelText('Name'), 'Legal');
    await userEvent.type(screen.getByLabelText('Address'), 'Legal');
    await userEvent.type(screen.getByLabelText(/First administrator/), 'ada@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create the tenant' }));
  };

  it("IAM-068 asks for a tenant under the organisation's addresses, naming who is invited", async () => {
    const post = vi.fn(ok);
    render(<Console client={withSuffix(post)} />);
    expect(await screen.findByText('.acme.test')).toBeInTheDocument();
    await fill();
    expect(post).toHaveBeenCalledWith('/v1/organisation/tenants', {
      body: { name: 'Legal', label: 'legal', firstAdministrator: 'ada@example.test' },
    });
  });

  it('IAM-059 says to share a provider first where nobody could sign in to it', async () => {
    const post = vi.fn(() =>
      Promise.resolve({
        response: { ok: false } as Response,
        error: { code: 'no_shared_provider' },
      }),
    );
    render(<Console client={withSuffix(post)} />);
    await fill();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Share a provider/);
  });

  it('IAM-068 shows what is being made, and what could not be', async () => {
    render(
      <Console
        client={withSuffix(vi.fn(ok), [
          { id: 'a', name: 'Legal', hostname: 'legal.acme.test', state: 'waiting' },
          { id: 'b', name: 'Sales', hostname: 'sales.acme.test', state: 'failed' },
        ])}
      />,
    );
    expect(await screen.findByText(/Legal \(legal.acme.test\): Being made/)).toBeInTheDocument();
    expect(screen.getByText(/Sales \(sales.acme.test\): Could not be made/)).toBeInTheDocument();
  });

  it('says the operator has yet to give it addresses, and offers no form', async () => {
    render(<Console client={fake([])} />);
    expect(await screen.findByText(/which the operator sets up/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create the tenant' })).toBeNull();
  });
});

describe("an organisation's console", () => {
  it('IAM-069 shows its tenants by state and address, with nothing of what is in them', async () => {
    render(<Console client={fake([tenant({})])} />);
    const row = await screen.findByRole('row', { name: /Production/ });
    expect(within(row).getByText('prod.acme.test')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
  });

  it('IAM-068 asks why before stopping a tenant', async () => {
    const post = vi.fn(ok);
    render(<Console client={fake([tenant({})], post)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    const go = screen.getByRole('button', { name: 'Suspend Production' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why'), 'An incident');
    await userEvent.click(go);
    expect(post).toHaveBeenCalledWith('/v1/organisation/tenants/{id}/suspension', {
      params: { path: { id: 'prod' } },
      body: { reason: 'An incident' },
    });
  });

  it('ADM-028 offers to lift a suspension', async () => {
    const remove = vi.fn(ok);
    render(<Console client={fake([tenant({ state: 'suspended' })], undefined, remove)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lift the suspension' }));
    expect(remove).toHaveBeenCalledWith('/v1/organisation/tenants/{id}/suspension', {
      params: { path: { id: 'prod' } },
    });
  });

  it("offers to give up a person's closure, and not the operator's", async () => {
    render(
      <Console
        client={fake([
          tenant({ state: 'closing', closedBy: 'person' }),
          tenant({ id: 'old', name: 'Old', state: 'closing', closedBy: 'operator' }),
        ])}
      />,
    );
    expect(await screen.findAllByRole('button', { name: 'Give up closing it' })).toHaveLength(1);
    expect(screen.getByText(/operator began this/)).toBeInTheDocument();
  });

  it('ADM-028 offers no lifting of what the operator suspended', async () => {
    render(<Console client={fake([tenant({ state: 'suspended', suspendedBy: 'operator' })])} />);
    expect(await screen.findByText(/operator suspended this/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lift the suspension' })).toBeNull();
  });

  it('offers to sign in again where the sign-in is too old to do this', async () => {
    const remove = vi.fn(() =>
      Promise.resolve({
        response: { ok: false } as Response,
        error: { code: 'reauthentication_required' },
      }),
    );
    render(<Console client={fake([tenant({ state: 'suspended' })], undefined, remove as never)} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Lift the suspension' }));
    expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument();
  });

  it('has words for every state a tenant can be in', async () => {
    const { TENANT_STATES } = await import('@alloy-works/domain');
    const { default: enGB } = await import('../words/en-GB.json');
    for (const state of TENANT_STATES) {
      expect(enGB).toHaveProperty([`organisation.state-${state}`]);
    }
  });
});
