import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Environment } from './Environment.js';

/** The service, as far as this panel is concerned. */
function serviceThat(answers: Record<string, unknown>, onPost?: () => void) {
  // The client builds its own Request and hands that over, rather than an address and options.
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const asked = input instanceof Request ? input : new Request(String(input), init);
    if (asked.method === 'POST') {
      onPost?.();
      return new Response(JSON.stringify({ id: 'made', state: 'queued', download: null }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      });
    }
    const path = new URL(asked.url, 'http://environment.test').pathname;
    const answer = answers[path];
    if (answer === undefined) return new Response('{}', { status: 404 });
    if (answer instanceof Response) return answer.clone();
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

const noStream = () => () => {};

afterEach(() => vi.restoreAllMocks());

describe('the environment panel', () => {
  it('says which environment this is, and offers a way in when nobody is signed in', async () => {
    render(
      <Environment
        fetch={
          serviceThat({
            '/v1/tenant': { name: 'Development' },
            '/v1/me': new Response('{"code":"unauthenticated"}', { status: 401 }),
          }) as unknown as typeof fetch
        }
        follow={noStream}
      />,
    );
    expect(await screen.findByText('Development')).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: /sign in/i });
    expect(link).toHaveAttribute('href', '/v1/sign-in/organisation');
    // The versions behind it are for a signed-in person alone.
    expect(screen.queryByText(/locale data/)).toBeNull();
  });

  it("LOC-044 says the service's locale data, its plural rules' CLDR and each collation's version to a signed-in person", async () => {
    render(
      <Environment
        fetch={
          serviceThat({
            '/v1/tenant': { name: 'Development' },
            '/v1/me': { id: 'p1', displayName: 'Ada', email: null, environment: 'Development' },
            '/v1/about': {
              localeData: {
                icu: '78.3',
                unicode: '17.0',
                cldr: '48.0',
                plurals: '48.2.0',
                collations: [{ language: 'ar-XB', collation: 'ar-x-icu', version: '153.120.42' }],
              },
            },
          }) as unknown as typeof fetch
        }
        follow={noStream}
      />,
    );
    expect(
      await screen.findByText("The service's locale data: ICU 78.3, Unicode 17.0, CLDR 48.0."),
    ).toBeInTheDocument();
    // The CLDR its plural rules were compiled from (the MF plan, MF-H).
    expect(screen.getByText('Plural rules from CLDR 48.2.0.')).toBeInTheDocument();
    expect(
      screen.getByText('Listings in ar-XB sort by ar-x-icu, version 153.120.42.'),
    ).toBeInTheDocument();
  });

  it('says who is signed in, and asks for a sample when told to', async () => {
    const asked = vi.fn();
    const fetching = serviceThat(
      {
        '/v1/tenant': { name: 'Development' },
        '/v1/me': {
          id: 'p1',
          displayName: 'Ada',
          email: 'ada@example.com',
          environment: 'Development',
        },
      },
      asked,
    );
    render(<Environment fetch={fetching as unknown as typeof fetch} follow={noStream} />);
    expect(await screen.findByText('Ada')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /sample/i }));
    await waitFor(() => expect(asked).toHaveBeenCalled());
  });

  it('shows what the stream says, as it says it', async () => {
    let announce: (sample: { kind: string; id: string; state: string }) => void = () => {};
    const follow = (options: {
      onSnapshot: (snapshot: { samples: { id: string; state: string }[] }) => void;
      onSample: (sample: { kind: string; id: string; state: string }) => void;
    }) => {
      options.onSnapshot({ samples: [{ id: 'first', state: 'queued' }] });
      announce = options.onSample;
      return () => {};
    };
    render(
      <Environment
        fetch={
          serviceThat({
            '/v1/tenant': { name: 'Development' },
            '/v1/me': { id: 'p1', displayName: 'Ada', email: null, environment: 'Development' },
          }) as unknown as typeof fetch
        }
        follow={follow as never}
      />,
    );
    expect(await screen.findByText(/first/)).toBeInTheDocument();
    expect(await screen.findByText(/queued/)).toBeInTheDocument();
    announce({ kind: 'sample', id: 'first', state: 'done' });
    expect(await screen.findByText(/done/)).toBeInTheDocument();
  });
});
