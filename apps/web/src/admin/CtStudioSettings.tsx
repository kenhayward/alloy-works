import type { createApiClient, paths } from '@alloy-works/api-client';
import { useEffect, useState } from 'react';

import { refusal } from '../account/TokenTable.js';
import { everyPage } from '../paging.js';
import styles from './Administration.module.css';
import { formats, words as say } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;
type SettingsRoute = paths['/v1/spaces/{space}/bridge-settings'];
/** A space's settings as the service takes them. */
export type BridgeSettingsBody = SettingsRoute['put']['requestBody']['content']['application/json'];
type BridgeSettingsView = SettingsRoute['get']['responses']['200']['content']['application/json'];

/** One row of the field mapping: a CT Studio property and the field it fills, null for ignore. */
interface Row {
  readonly name: string;
  readonly field: string | null;
}

interface Named {
  readonly id: string;
  readonly name: string;
}

const when = (at: string) =>
  formats().date(new Date(at), { day: 'numeric', month: 'short', year: 'numeric' });

/** The id `<select>` gives ignore, which no field id can be. */
const IGNORE = '';

/** The body the service takes, from the form. */
function bodyOf(
  componentType: string,
  template: string,
  rows: readonly Row[],
  data: boolean,
): BridgeSettingsBody {
  return {
    componentType: componentType === '' ? null : componentType,
    template: template === '' ? null : template,
    propertyMap: Object.fromEntries(
      rows.filter((row) => row.name.trim() !== '').map((row) => [row.name.trim(), row.field]),
    ),
    data,
  };
}

/**
 * The document fields a template gives, by name: its document-level schemas' entries, named from the
 * environment's definitions. The service is the judge of what a mapping may name; this is the list to
 * choose from.
 */
async function documentFields(
  client: Client,
  template: string,
  names: ReadonlyMap<string, string>,
): Promise<Named[]> {
  const { data } = await client.GET('/v1/templates/{id}', { params: { path: { id: template } } });
  const schemas = ((data?.definition as { schemas?: unknown } | undefined)?.schemas ?? []) as {
    schema?: unknown;
    level?: unknown;
  }[];
  const fields: Named[] = [];
  for (const { schema, level } of schemas) {
    if (level !== 'document' || typeof schema !== 'string') continue;
    const read = await client.GET('/v1/definitions/{id}', { params: { path: { id: schema } } });
    const entries = ((read.data?.definition as { entries?: unknown } | undefined)?.entries ??
      []) as { field?: unknown }[];
    for (const { field } of entries) {
      if (typeof field !== 'string' || fields.some((each) => each.id === field)) continue;
      fields.push({ id: field, name: names.get(field) ?? field });
    }
  }
  return fields;
}

/**
 * A space's CT Studio settings (docs/design/ct-studio-connect.md, "The space's CT Studio section";
 * API-076): the component type and template deliveries take, the field each CT Studio property fills
 * or **ignore**, data tables on or off, and the unlisted properties deliveries have carried, each with
 * **Map to a field** and **Ignore**. In `section` mode it saves; in `flow` mode, inside Connect CT
 * Studio, it saves nothing and gives its settings to `onChange` as they change.
 */
export function CtStudioSettings({
  client,
  space,
  mode = 'section',
  onChange,
}: {
  client: Client;
  space: string;
  mode?: 'section' | 'flow';
  onChange?: (body: BridgeSettingsBody) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [componentType, setComponentType] = useState('');
  const [template, setTemplate] = useState('');
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [data, setData] = useState(false);
  const [unlisted, setUnlisted] = useState<BridgeSettingsView['unlisted']>([]);
  const [templates, setTemplates] = useState<readonly Named[]>([]);
  const [types, setTypes] = useState<readonly Named[]>([]);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [fields, setFields] = useState<readonly Named[]>([]);
  const [problems, setProblems] = useState<ReadonlyMap<string, string>>(new Map());
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);

  const show = (view: BridgeSettingsView) => {
    setComponentType(view.componentType ?? '');
    setTemplate(view.template ?? '');
    setRows(
      Object.entries(view.propertyMap).map(([name, field]) => ({
        name,
        field: typeof field === 'string' ? field : null,
      })),
    );
    setData(view.data);
    setUnlisted(view.unlisted);
  };

  useEffect(() => {
    let current = true;
    void (async () => {
      const [settings, listed, defined] = await Promise.all([
        client.GET('/v1/spaces/{space}/bridge-settings', { params: { path: { space } } }),
        everyPage<Named>((cursor) =>
          client.GET('/v1/templates', {
            params: { query: { limit: '100', ...(cursor === undefined ? {} : { cursor }) } },
          }),
        ),
        everyPage<Named & { kind: string }>((cursor) =>
          client.GET('/v1/definitions', {
            params: { query: cursor === undefined ? {} : { cursor } },
          }),
        ),
      ]);
      if (!current) return;
      if (settings.data) show(settings.data);
      if ('items' in listed) setTemplates(listed.items);
      if ('items' in defined) {
        setTypes(defined.items.filter((each) => each.kind === 'componentType'));
        setNames(new Map(defined.items.map((each) => [each.id, each.name])));
      }
      setLoaded(true);
    })().catch(() => {
      if (current) setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [client, space]);

  useEffect(() => {
    if (template === '') {
      setFields([]);
      return undefined;
    }
    let current = true;
    documentFields(client, template, names)
      .then((found) => {
        if (current) setFields(found);
      })
      .catch(() => {
        if (current) setFields([]);
      });
    return () => {
      current = false;
    };
  }, [client, template, names]);

  // Inside the flow, every change is the flow's to keep.
  useEffect(() => {
    if (mode === 'flow' && loaded) onChange?.(bodyOf(componentType, template, rows, data));
  }, [mode, loaded, onChange, componentType, template, rows, data]);

  const mapped = new Set(rows.map((row) => row.name.trim()));
  const waiting = unlisted.filter((each) => !mapped.has(each.name));
  const setRow = (index: number, row: Row) =>
    setRows((before) => before.map((each, at) => (at === index ? row : each)));

  async function save() {
    setBusy(true);
    setSaid('');
    setProblems(new Map());
    try {
      const { data: saved, error } = await client.PUT('/v1/spaces/{space}/bridge-settings', {
        params: { path: { space } },
        body: bodyOf(componentType, template, rows, data),
      });
      if (saved) {
        show(saved);
        setSaid(say('admin.saved'));
        return;
      }
      const listed = (error as { problems?: { path: string; reason: string }[] } | undefined)
        ?.problems;
      if (listed !== undefined && listed.length > 0) {
        setProblems(
          new Map(
            listed.map((problem) => {
              const property = problem.path.replace(/^propertyMap\./, '');
              return [
                problem.path.startsWith('propertyMap.') ? property : problem.path,
                problem.reason === 'field_not_in_template'
                  ? say('admin.names-a-field-this-template-does-not-give', { property })
                  : say('admin.ct-studio-setting-refused', { setting: problem.path }),
              ];
            }),
          ),
        );
      }
      setSaid(refusal(error, say('admin.the-ct-studio-settings-could-not-be-saved')));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p role="status">{say('admin.loading')}</p>;
  return (
    <div className={styles['settings']}>
      <label className={styles['filter']}>
        {say('admin.component-type-of-delivered-components')}
        <select value={componentType} onChange={(change) => setComponentType(change.target.value)}>
          <option value="">{say('admin.the-environment-default')}</option>
          {types.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles['filter']}>
        {say('admin.template-of-delivered-documents')}
        <select value={template} onChange={(change) => setTemplate(change.target.value)}>
          <option value="">{say('admin.a-blank-document')}</option>
          {templates.map((each) => (
            <option key={each.id} value={each.id}>
              {each.name}
            </option>
          ))}
        </select>
      </label>
      {problems.has('template') && <p role="alert">{problems.get('template')}</p>}

      <fieldset>
        <legend>{say('admin.which-field-each-ct-studio-property-fills')}</legend>
        {rows.map((row, index) => (
          <div key={index} className={styles['toolbar']}>
            <label className={styles['filter']}>
              {say('admin.ct-studio-property', { number: index + 1 })}
              <input
                value={row.name}
                onChange={(change) => setRow(index, { ...row, name: change.target.value })}
              />
            </label>
            <label className={styles['filter']}>
              {say('admin.fills', { number: index + 1 })}
              <select
                value={row.field ?? IGNORE}
                onChange={(change) =>
                  setRow(index, {
                    ...row,
                    field: change.target.value === IGNORE ? null : change.target.value,
                  })
                }
              >
                <option value={IGNORE}>{say('admin.ignore')}</option>
                {fields.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => setRows((before) => before.filter((_, at) => at !== index))}
            >
              {say('admin.remove-the-property', { number: index + 1 })}
            </button>
            {problems.has(row.name.trim()) && <p role="alert">{problems.get(row.name.trim())}</p>}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setRows((before) => [...before, { name: '', field: null }])}
        >
          {say('admin.add-a-property')}
        </button>
      </fieldset>

      <label className={styles['check']}>
        <input
          type="checkbox"
          checked={data}
          onChange={(change) => setData(change.target.checked)}
        />
        {say('admin.deliver-data-tables-to-this-space')}
      </label>

      {mode === 'section' && waiting.length > 0 && (
        <table aria-label={say('admin.unlisted-properties')} className={styles['table']}>
          <thead>
            <tr>
              <th scope="col">{say('admin.ct-studio-property-name')}</th>
              <th scope="col">{say('admin.last-delivered')}</th>
              <th scope="col">{say('admin.deliveries')}</th>
              <th scope="col">
                <span className={styles['hidden']}>{say('admin.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {waiting.map((each) => (
              <tr key={each.name}>
                <td>{each.name}</td>
                <td>{when(each.lastDelivered)}</td>
                <td>{each.deliveries}</td>
                <td className={styles['actions']}>
                  <button
                    type="button"
                    disabled={fields.length === 0}
                    onClick={() =>
                      setRows((before) => [...before, { name: each.name, field: fields[0]!.id }])
                    }
                  >
                    {say('admin.map-to-a-field', { property: each.name })}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((before) => [...before, { name: each.name, field: null }])
                    }
                  >
                    {say('admin.ignore-the-property', { property: each.name })}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {mode === 'section' && (
        <>
          <button type="button" disabled={busy} onClick={() => void save()}>
            {say('admin.save')}
          </button>
          <p role="status">{said}</p>
        </>
      )}
    </div>
  );
}
