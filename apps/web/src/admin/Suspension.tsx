import type { createApiClient } from '@alloy-works/api-client';
import { useState } from 'react';

import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** Stopping this environment during an incident (ADM-028, TL-D), which nobody here can undo. */
export function Suspension({ client }: { client: Client }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const suspend = async () => {
    setBusy(true);
    setSaid('');
    try {
      const { response, error } = await client.POST('/v1/suspension', { body: { reason } });
      if (response.ok) {
        window.location.reload();
        return;
      }
      const code = (error as { code?: string } | undefined)?.code;
      setSaid(
        code === 'no_organisation_to_lift'
          ? words('admin.suspend-no-organisation')
          : code === 'reauthentication_required'
            ? words('admin.suspend-sign-in-again')
            : words('admin.suspend-could-not'),
      );
    } catch {
      setSaid(words('admin.suspend-could-not'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="suspend-heading">
      <h3 id="suspend-heading">{words('admin.suspend-heading')}</h3>
      <p>{words('admin.suspend-explains')}</p>
      <label>
        {words('admin.suspend-why')}
        <input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button type="button" disabled={busy || reason.trim() === ''} onClick={() => void suspend()}>
        {words('admin.suspend-it')}
      </button>
      {said !== '' && <p role="alert">{said}</p>}
    </section>
  );
}
