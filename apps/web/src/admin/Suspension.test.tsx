import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Suspension } from './Suspension.js';

afterEach(cleanup);

const refusing = (code: string) =>
  ({
    POST: vi.fn(() => Promise.resolve({ response: { ok: false }, error: { code } })),
  }) as never;

const askTo = async () => {
  await userEvent.type(screen.getByLabelText('Why'), 'An incident');
  await userEvent.click(screen.getByRole('button', { name: 'Suspend this environment' }));
};

describe('suspending this environment', () => {
  it('ADM-028 asks why, and says who can start it again', () => {
    render(<Suspension client={refusing('x')} />);
    expect(screen.getByText(/only your organisation or the operator/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Suspend this environment' })).toBeDisabled();
  });

  it('ADM-028 says nobody could lift it where no organisation administers it', async () => {
    render(<Suspension client={refusing('no_organisation_to_lift')} />);
    await askTo();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no organisation administering/);
  });

  it('says to sign in again where the sign-in is too old', async () => {
    render(<Suspension client={refusing('reauthentication_required')} />);
    await askTo();
    expect(await screen.findByRole('button', { name: /sign in again/i })).toBeInTheDocument();
  });
});
