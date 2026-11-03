import { createApiClient } from '@alloy-works/api-client';
import { useEffect, useMemo, useState } from 'react';

import { useWords } from '../words/words.js';
import styles from './Connect.module.css';
import { WaysIn } from './WaysIn.js';

interface Environment {
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
  const [answer, setAnswer] = useState<'nobody' | 'open' | undefined>();
  useEffect(() => {
    let current = true;
    createApiClient({ baseUrl: window.location.origin })
      .GET('/v1/me')
      .then(({ response }) => {
        if (current) setAnswer(response.status === 401 ? 'nobody' : 'open');
      })
      .catch(() => {
        if (current) setAnswer('open');
      });
    return () => {
      current = false;
    };
  }, []);

  if (answer === undefined) return null;
  return answer === 'nobody' ? <SignInScreen here={here} /> : children;
}
