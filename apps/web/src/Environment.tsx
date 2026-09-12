import { createApiClient, followStream, type FollowOptions } from '@alloy-works/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';

interface Sample {
  readonly id: string;
  readonly state: string;
}

export interface EnvironmentProps {
  /** Given in tests; the browser's own otherwise. */
  readonly fetch?: typeof fetch;
  readonly follow?: (options: FollowOptions) => () => void;
}

/**
 * What the scaffolding can show of an environment: which one this is, who is signed in, and the
 * samples it has made - the last of those arriving on the stream rather than by asking again.
 * Everything here goes through the generated client (API-001).
 */
export function Environment({ fetch: given, follow = followStream }: EnvironmentProps) {
  // The address the page itself came from, which is the address it may call: the service serves
  // both. Named rather than left relative because a request is built before it is sent, and
  // outside a browser there is no document for a relative address to be resolved against.
  const origin = window.location.origin;
  const client = useMemo(
    () => createApiClient({ baseUrl: origin, ...(given ? { fetch: given } : {}) }),
    [origin, given],
  );
  const [environment, setEnvironment] = useState<string | undefined>();
  const [who, setWho] = useState<{ readonly name: string } | 'nobody' | undefined>();
  const [samples, setSamples] = useState<readonly Sample[]>([]);

  useEffect(() => {
    let current = true;
    void client.GET('/v1/tenant').then(({ data }) => {
      if (current && data) setEnvironment(data.name);
    });
    void client.GET('/v1/me').then(({ data }) => {
      if (!current) return;
      setWho(data ? { name: data.displayName ?? data.email ?? 'signed in' } : 'nobody');
    });
    return () => {
      current = false;
    };
  }, [client]);

  useEffect(() => {
    if (who === undefined || who === 'nobody') return undefined;
    return follow({
      url: `${origin}/v1/stream`,
      onSnapshot: (snapshot) => setSamples(snapshot.samples.map((sample) => ({ ...sample }))),
      onSample: (sample) =>
        setSamples((held) => {
          const rest = held.filter((one) => one.id !== sample.id);
          return [{ id: sample.id, state: sample.state }, ...rest];
        }),
      ...(given ? { fetch: given } : {}),
    });
  }, [who, follow, given, origin]);

  const ask = useCallback(async () => {
    const { data } = await client.POST('/v1/samples');
    if (data) setSamples((held) => [{ id: data.id, state: data.state }, ...held]);
  }, [client]);

  return (
    <section>
      <h2>Environment</h2>
      <p>{environment ?? 'asking...'}</p>
      {who === 'nobody' && <a href="/v1/sign-in/organisation">Sign in</a>}
      {who !== undefined && who !== 'nobody' && (
        <>
          <p>{who.name}</p>
          <button type="button" onClick={() => void ask()}>
            Make a sample
          </button>
          <ul>
            {samples.map((sample) => (
              <li key={sample.id}>
                {sample.id}: {sample.state}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
