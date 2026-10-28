import {
  createApiClient,
  followStream,
  type FollowOptions,
  type paths,
} from '@alloy-works/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { words } from './words/words.js';

type LocaleData =
  paths['/v1/tenant']['get']['responses']['200']['content']['application/json']['localeData'];

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
  const [localeData, setLocaleData] = useState<LocaleData | undefined>();
  const [who, setWho] = useState<{ readonly name: string } | 'nobody' | undefined>();
  const [samples, setSamples] = useState<readonly Sample[]>([]);

  useEffect(() => {
    let current = true;
    void client.GET('/v1/tenant').then(({ data }) => {
      if (!current || !data) return;
      setEnvironment(data.name);
      // Absent from a service before TEc.
      const given = (data as { localeData?: LocaleData }).localeData;
      if (given) setLocaleData(given);
    });
    void client.GET('/v1/me').then(({ data }) => {
      if (!current) return;
      setWho(
        data ? { name: data.displayName ?? data.email ?? words('shell.signed-in') } : 'nobody',
      );
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
      <h2>{words('shell.environment')}</h2>
      {environment === undefined ? (
        <p>{words('shell.asking')}</p>
      ) : (
        <p data-content>{environment}</p>
      )}
      {/* The service's own locale data and its database's collations (TE-F; LOC-044). */}
      {localeData && (
        <>
          <p>
            {words('shell.locale-data', {
              icu: localeData.icu,
              unicode: localeData.unicode,
              cldr: localeData.cldr,
            })}
          </p>
          {localeData.collations.map((each) => (
            <p key={each.language}>
              {each.version === null
                ? words('shell.collation-unversioned', each)
                : words('shell.collation', { ...each, version: each.version })}
            </p>
          ))}
        </>
      )}
      {who === 'nobody' && <a href="/v1/sign-in/organisation">{words('shell.signIn')}</a>}
      {who !== undefined && who !== 'nobody' && (
        <>
          <p data-content>{who.name}</p>
          <button type="button" onClick={() => void ask()}>
            {words('shell.make-a-sample')}
          </button>
          <ul>
            {samples.map((sample) => (
              <li key={sample.id} data-content>
                {sample.id}: {sample.state}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
