import { sendSupportRead } from '@alloy-works/api-client';
import { useId, useSyncExternalStore } from 'react';

import { Notice } from '../states/Notice.js';
import { formats, words } from '../words/words.js';

/** The support access the signed-in person holds, as `/v1/me` answers it (support.md). */
export interface MySupport {
  readonly scope: 'diagnostics' | 'metadata' | 'content';
  readonly spaces: readonly { readonly id: string; readonly name: string }[];
  readonly purpose: string;
  readonly expiresAt: string;
}

/** `/v1/me`'s `support`, checked rather than trusted, or null. */
export function supportOf(me: unknown): MySupport | null {
  const support = (me as { support?: unknown } | null | undefined)?.support;
  if (typeof support !== 'object' || support === null) return null;
  const { scope, spaces, purpose, expiresAt } = support as Record<string, unknown>;
  if (scope !== 'diagnostics' && scope !== 'metadata' && scope !== 'content') return null;
  if (!Array.isArray(spaces) || typeof purpose !== 'string' || typeof expiresAt !== 'string') {
    return null;
  }
  return { scope, spaces: spaces as MySupport['spaces'], purpose, expiresAt };
}

/**
 * The grant a content read was chosen under, for the window (ADM-026): once chosen, every client says
 * `Support-Read` with its purpose; a reload asks again.
 */
let chosen: string | null = null;
const listeners = new Set<() => void>();
const keyOf = (support: MySupport) => `${support.expiresAt} ${support.purpose}`;

/** Chooses to read content under this grant: from now on every request says why. */
export function chooseSupportRead(support: MySupport): void {
  chosen = keyOf(support);
  sendSupportRead(support.purpose);
  for (const listener of listeners) listener();
}

/** Forgets the choice and stops saying it: for tests, and signing out. */
export function forgetSupportRead(): void {
  chosen = null;
  sendSupportRead(undefined);
  for (const listener of listeners) listener();
}

/** Whether content was chosen to be read under this grant. */
export function useSupportReadChosen(support: MySupport | null): boolean {
  const key = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => chosen,
  );
  return support !== null && key === keyOf(support);
}

const until = (support: MySupport) =>
  formats().date(new Date(support.expiresAt), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** On every page while it lasts: what the person's support access reaches, and until when. */
export function SupportBanner({ support }: { support: MySupport }) {
  return (
    <section aria-label={words('admin.support-access')}>
      <Notice tone="support">
        <p>
          {support.scope === 'diagnostics'
            ? words('shell.support-banner-diagnostics', { until: until(support) })
            : words('shell.support-banner', {
                scope:
                  support.scope === 'content'
                    ? words('shell.support-scope.content')
                    : words('shell.support-scope.metadata'),
                spaces: formats().list(support.spaces.map((space) => space.name)),
                until: until(support),
              })}
        </p>
      </Notice>
    </section>
  );
}

/**
 * Asked before any content is opened under a content grant (ADM-026): nothing of it is read until the
 * person says yes, and then every read says why.
 */
export function SupportReadAsk({ support }: { support: MySupport }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h1 id={id}>{words('shell.support-read-question')}</h1>
      <p>{words('shell.support-read-sentence', { purpose: support.purpose })}</p>
      <p>
        <button type="button" className="primary" onClick={() => chooseSupportRead(support)}>
          {words('shell.support-read-yes')}
        </button>{' '}
        <a href="#/">{words('shell.support-read-no')}</a>
      </p>
    </section>
  );
}

/** What a page of content shows a support person whose access does not reach content. */
export function SupportWithheld({ support }: { support: MySupport }) {
  return (
    <Notice tone="readOnly">
      <p>
        {support.scope === 'diagnostics'
          ? words('shell.support-withheld-diagnostics')
          : words('shell.support-withheld-metadata')}
      </p>
    </Notice>
  );
}
