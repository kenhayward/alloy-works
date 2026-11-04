import { createApiClient, onEnvironmentRefused } from '@alloy-works/api-client';
import { useEffect, useMemo, useState } from 'react';

import { ClosingEnvironment } from '../admin/Closure.js';
import { useWords } from '../words/words.js';
import styles from './Connect.module.css';
import { WaysIn } from './WaysIn.js';

interface Environment {
  readonly state?: string;
  readonly name: string;
  readonly signIn: readonly string[];
  readonly providers: readonly { id: string; name: string }[];
}

/** The screen a page opened with nobody signed in meets: the environment's ways in, and nothing else. */
function SignInScreen({ here }: { here: string }): React.JSX.Element {
  const { words } = useWords();
  const client = useMemo(() => createApiClient({ baseUrl: window.location.origin }), []);
  const [environment, setEnvironment] = useState<Environment | 'failed' | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/tenant')
      .then(({ data }) => {
        if (current) setEnvironment(data ?? 'failed');
      })
      .catch(() => {
        if (current) setEnvironment('failed');
      });
    return () => {
      current = false;
    };
  }, [client, attempt]);

  return (
    <main className={styles['connect']} data-app-region>
      <div className={styles['card']}>
        <h1>{words('signin.title')}</h1>
        {environment === 'failed' && (
          <>
            <p role="alert">{words('signin.could-not-read')}</p>
            <button
              type="button"
              onClick={() => {
                setEnvironment(undefined);
                setAttempt((count) => count + 1);
              }}
            >
              {words('editor.try-again')}
            </button>
          </>
        )}
        {environment !== undefined && environment !== 'failed' && (
          <>
            <p data-content>{environment.name}</p>
            {(environment.state === 'closing' || environment.state === 'retained') && (
              <p role="status">{words('environment.closing-signin')}</p>
            )}
            {environment.signIn.length === 0 ? (
              <p>{words('signin.no-way-in')}</p>
            ) : (
              <div className={styles['ways']}>
                <WaysIn
                  here={here}
                  ways={environment.signIn}
                  providers={environment.providers}
                  className={styles['way']}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/** All a person can be told of an environment that is suspended: never the reason (TL-B). */
function EnvironmentSuspended(): React.JSX.Element {
  const { words } = useWords();
  return (
    <main className={styles['connect']} data-app-region>
      <div className={styles['card']}>
        <h1>{words('environment.suspended-title')}</h1>
        <p>{words('environment.suspended-body')}</p>
      </div>
    </main>
  );
}

/** Deletion has begun: there is no way in for anybody, and nothing left to offer them (TL-A). */
function EnvironmentClosed(): React.JSX.Element {
  const { words } = useWords();
  return (
    <main className={styles['connect']} data-app-region>
      <div className={styles['card']}>
        <h1>{words('environment.closed-title')}</h1>
        <p>{words('environment.closed-body')}</p>
      </div>
    </main>
  );
}

/**
 * Asks once, as a page loads, who is signed in, and shows nothing until the service answers. Only its
 * 401 is signed out: with no answer, or any other, the shell opens and the page says what it could not
 * do. A session that ends later is left to the page, whose notices keep what was being written.
 */
export function SignInGate({
  here,
  children,
}: {
  here: string;
  children: React.ReactNode;
}): React.ReactNode {
  const { words } = useWords();
  const [answer, setAnswer] = useState<
    'nobody' | 'open' | 'suspended' | 'closing' | 'closed' | undefined
  >();
  const [refusedSince, setRefusedSince] = useState<
    'environment_suspended' | 'environment_closing' | undefined
  >();
  const client = useMemo(() => createApiClient({ baseUrl: window.location.origin }), []);
  useEffect(() => {
    let current = true;
    client
      .GET('/v1/me')
      .then(({ response, error, data }) => {
        if (!current) return;
        // Those a closing environment still lets in meet what is left of it (TL-A).
        const state = data?.environmentState;
        if (state === 'closing' || state === 'retained') {
          setAnswer('closing');
          return;
        }
        // Nobody may enter whoever they are, so nothing behind it could say anything (ADM-028).
        const code = (error as { code?: unknown } | undefined)?.code;
        if (code === 'environment_suspended') setAnswer('suspended');
        // `/v1/me` stays open while it closes, so this is past that.
        else if (code === 'environment_closing') setAnswer('closed');
        else setAnswer(response.status === 401 ? 'nobody' : 'open');
      })
      .catch(() => {
        if (current) setAnswer('open');
      });
    return () => {
      current = false;
    };
  }, [client]);

  // Beside the page rather than in place of it, which may hold what somebody was writing.
  useEffect(() => onEnvironmentRefused(setRefusedSince), []);

  if (answer === undefined) return null;
  if (answer === 'suspended') return <EnvironmentSuspended />;
  if (answer === 'closed') return <EnvironmentClosed />;
  if (answer === 'closing') return <ClosingEnvironment client={client} />;
  if (answer === 'open' && refusedSince !== undefined) {
    return (
      <>
        <p role="alert" className={styles['suspended']}>
          {refusedSince === 'environment_closing'
            ? words('environment.closing-notice')
            : words('environment.suspended-notice')}
        </p>
        {children}
      </>
    );
  }
  return answer === 'nobody' ? <SignInScreen here={here} /> : children;
}
