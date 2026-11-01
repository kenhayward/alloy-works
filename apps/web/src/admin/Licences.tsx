import type { createApiClient } from '@alloy-works/api-client';
import { useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

type Use = 'internal' | 'publication' | 'redistribution' | 'modification';

/** A licence as `/v1/licences` gives it (the AL plan, AL-B). */
interface Licence {
  readonly id: string;
  readonly name: string;
  readonly key: string;
  readonly base: string;
  readonly names: readonly { readonly language: string; readonly text: string }[];
  readonly permits: readonly Use[];
  readonly attribution: { readonly required: boolean; readonly wording?: string };
  readonly url?: string;
}
interface Held {
  readonly id: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly licence: Licence;
}

const USES: readonly Use[] = ['internal', 'publication', 'redistribution', 'modification'];
const USE_NAMES: Readonly<Record<Use, () => string>> = {
  internal: () => words('admin.licence-internal'),
  publication: () => words('admin.licence-publication'),
  redistribution: () => words('admin.licence-redistribution'),
  modification: () => words('admin.licence-modification'),
};

const BLANK = { name: '', key: '', permits: [] as Use[], required: false, wording: '', url: '' };

/**
 * Administration's **Licences** (assets.md; the AL plan, AL-B): the licences an image may be held
 * under, each with what it permits (AST-022) and the credit it needs (AST-045); **Add licence**, and
 * **Edit**, which saves a version with its key kept. Written through `/v1/definitions`, so refused to
 * whoever does not manage definitions.
 */
export function Licences({ client }: { client: Client }) {
  const [generation, setGeneration] = useState(0);
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/licences');
    return data ? { items: data.items as Held[] } : { status: response.status };
  });
  const read = useListing<Held>(load, true, generation);
  const [editing, setEditing] = useState<Held | null>(null);
  const [form, setForm] = useState(BLANK);
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const edit = (held: Held) => {
    setEditing(held);
    setForm({
      name: held.licence.name,
      key: held.licence.key,
      permits: [...held.licence.permits],
      required: held.licence.attribution.required,
      wording: held.licence.attribution.wording ?? '',
      url: held.licence.url ?? '',
    });
  };
  const cancel = () => {
    setEditing(null);
    setForm(BLANK);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const base = editing?.licence.base ?? 'en';
    const definition = {
      schemaVersion: 1 as const,
      name,
      key: form.key.trim(),
      base,
      // The name in the base language; other languages' kept as they were.
      names: [
        { language: base, text: name },
        ...(editing?.licence.names.filter((each) => each.language !== base) ?? []),
      ],
      permits: USES.filter((use) => form.permits.includes(use)),
      attribution: form.required
        ? { required: true, ...(form.wording.trim() === '' ? {} : { wording: form.wording.trim() }) }
        : { required: false },
      ...(form.url.trim() === '' ? {} : { url: form.url.trim() }),
    };
    setBusy(true);
    try {
      if (editing === null) {
        const { data, error } = await client.POST('/v1/definitions', {
          body: { kind: 'licence', definition },
        });
        if (data) setSaid(words('admin.licence-added', { name }));
        else return setSaid(refusal(error, words('admin.licence-could-not-be-saved')));
      } else {
        const { data, error } = await client.POST('/v1/definitions/{id}/versions', {
          params: { path: { id: editing.id } },
          body: { openedFrom: editing.version.id, definition },
        });
        if (data) setSaid(words('admin.licence-saved', { name, number: data.version.number }));
        else return setSaid(refusal(error, words('admin.licence-could-not-be-saved')));
      }
      cancel();
      setGeneration((was) => was + 1);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (use: Use) =>
    setForm((was) => ({
      ...was,
      permits: was.permits.includes(use)
        ? was.permits.filter((each) => each !== use)
        : [...was.permits, use],
    }));

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.licences-lead')}</p>
      </div>
      <Shown read={read} failed={words('admin.licences-could-not-be-loaded')}>
        {(rows) =>
          rows.length === 0 ? (
            <p className={styles['muted']}>{words('admin.no-licence')}</p>
          ) : (
            <table aria-label={words('admin.licences')} className={styles['table']}>
              <thead>
                <tr>
                  <th scope="col">{words('admin.name')}</th>
                  <th scope="col">{words('admin.permits')}</th>
                  <th scope="col">{words('admin.attribution')}</th>
                  <th scope="col">
                    <span className={styles['hidden']}>{words('admin.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((held) => (
                  <tr key={held.id}>
                    <th scope="row" className={styles['strong']} data-content>
                      {held.licence.name}
                    </th>
                    <td>
                      {held.licence.permits.length === 0
                        ? words('admin.permits-nothing')
                        : held.licence.permits.map((use) => USE_NAMES[use]()).join(', ')}
                    </td>
                    <td data-content>
                      {held.licence.attribution.required
                        ? (held.licence.attribution.wording ?? words('admin.attribution-required'))
                        : words('admin.attribution-none')}
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={words('admin.edit', { name: held.licence.name })}
                        onClick={() => edit(held)}
                      >
                        {words('admin.edit-2')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </Shown>
      <form
        className={styles['toolbar']}
        onSubmit={(event) => void save(event)}
        aria-label={words('admin.a-licence')}
        noValidate
      >
        <label className={styles['filter']}>
          {words('admin.name')}
          <input
            value={form.name}
            onChange={(change) => setForm({ ...form, name: change.target.value })}
          />
        </label>
        <label className={styles['filter']}>
          {words('admin.key')}
          <input
            value={form.key}
            readOnly={editing !== null}
            onChange={(change) => setForm({ ...form, key: change.target.value })}
          />
        </label>
        <fieldset>
          <legend>{words('admin.permits')}</legend>
          {USES.map((use) => (
            <label key={use}>
              <input
                type="checkbox"
                checked={form.permits.includes(use)}
                onChange={() => toggle(use)}
              />
              {USE_NAMES[use]()}
            </label>
          ))}
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={form.required}
            onChange={(change) => setForm({ ...form, required: change.target.checked })}
          />
          {words('admin.requires-attribution')}
        </label>
        {form.required && (
          <label className={styles['filter']}>
            {words('admin.attribution')}
            <input
              value={form.wording}
              onChange={(change) => setForm({ ...form, wording: change.target.value })}
            />
          </label>
        )}
        <label className={styles['filter']}>
          {words('admin.licence-terms')}
          <input
            type="url"
            value={form.url}
            onChange={(change) => setForm({ ...form, url: change.target.value })}
          />
        </label>
        <div>
          <button
            type="submit"
            className="primary"
            disabled={busy || form.name.trim() === '' || form.key.trim() === ''}
          >
            {editing === null ? words('admin.add-licence') : words('admin.save-licence')}
          </button>
          {editing !== null && (
            <button type="button" onClick={cancel}>
              {words('admin.cancel')}
            </button>
          )}
        </div>
      </form>
      <p role="status">{said}</p>
    </>
  );
}
