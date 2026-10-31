import type { createApiClient } from '@alloy-works/api-client';
import {
  isVocabularyKey,
  valueLabel,
  valuesInOrder,
  vocabularyDefinitionSchema,
  type Vocabulary,
  type VocabularyValue,
} from '@alloy-works/domain';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { permitsAt } from '../data/places.js';
import { isRecord } from '../data/shapes.js';
import { saveText } from '../terms/shape.js';
import styles from './Administration.module.css';
import { Shown, useListing } from './listing.js';
import { formats, words } from '../words/words.js';

type Client = ReturnType<typeof createApiClient>;

/** A vocabulary as the page lists it (the VO plan, VO-K). */
interface Listed {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly values: number;
}

interface Held {
  readonly version: { readonly id: string; readonly number: string };
  readonly vocabulary: Vocabulary;
}

type Text = { readonly language: string; readonly text: string };
type State = VocabularyValue['state'];
const STATES: readonly State[] = ['active', 'deprecated', 'retired'];

/** The reader's language as a vocabulary labels by it: the interface's, by its base subtag. */
const reader = (): string => formats().language.formats.split('-')[0]!;

/** "where: why", a value named by its id where the problem is one of its own. */
function problemLine(vocabulary: Vocabulary, path: readonly PropertyKey[], message: string) {
  const at = path[0] === 'values' && typeof path[1] === 'number' ? path[1] : undefined;
  const field =
    at === undefined ? path.map(String).join('.') : (vocabulary.values[at]?.id ?? String(at));
  return words('admin.failure-of', { field: field === '' ? '-' : field, detail: message });
}

/** What a refusal's body names: the service's failures, and an import's problems. */
function refusalLines(error: unknown): string[] {
  if (!isRecord(error)) return [];
  const lines: string[] = [];
  for (const each of Array.isArray(error['failures']) ? error['failures'] : []) {
    if (isRecord(each) && typeof each['field'] === 'string' && typeof each['detail'] === 'string') {
      lines.push(words('admin.failure-of', { field: each['field'], detail: each['detail'] }));
    }
  }
  for (const each of Array.isArray(error['problems']) ? error['problems'] : []) {
    if (isRecord(each) && typeof each['path'] === 'string' && typeof each['message'] === 'string') {
      lines.push(words('admin.failure-of', { field: each['path'], detail: each['message'] }));
    }
  }
  return lines;
}

const Why = ({ lines }: { lines: readonly string[] }) =>
  lines.length === 0 ? null : (
    <ul aria-label={words('admin.why-it-was-not-saved')}>
      {lines.map((line) => (
        <li key={line} data-content>
          {line}
        </li>
      ))}
    </ul>
  );

/**
 * Administration's **Vocabularies** (vocabularies.md; the VO plan, VO-K): every vocabulary, made,
 * imported and exported as SKOS, and one opened with its values in its order, each labelled and
 * described by language, active, deprecated naming its replacement, or retired. Anybody signed in
 * reads them; only `manage_definitions` at the environment changes one, and the service decides again.
 */
export function Vocabularies({ client }: { client: Client }) {
  const [manages, setManages] = useState(false);
  useEffect(() => {
    let current = true;
    void permitsAt(client, 'tenant', ['manage_definitions']).then((answer) => {
      if (current) setManages(answer);
    });
    return () => {
      current = false;
    };
  }, [client]);
  const [generation, setGeneration] = useState(0);
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/vocabularies');
    return data ? { items: data.items as Listed[] } : { status: response.status };
  });
  const read = useListing<Listed>(load, true, generation);
  const [making, setMaking] = useState<'new' | 'import' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const changed = () => setGeneration((was) => was + 1);

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.vocabularies-are-the-values')}</p>
      </div>
      {manages && (
        <div className={styles['toolbar']}>
          <button
            type="button"
            aria-expanded={making === 'new'}
            onClick={() => setMaking(making === 'new' ? null : 'new')}
          >
            {words('admin.new-vocabulary')}
          </button>
          <button
            type="button"
            aria-expanded={making === 'import'}
            onClick={() => setMaking(making === 'import' ? null : 'import')}
          >
            {words('admin.import')}
          </button>
        </div>
      )}
      {manages && making === 'new' && (
        <MakeVocabulary
          client={client}
          onMade={(id) => {
            changed();
            setMaking(null);
            setOpen(id);
          }}
        />
      )}
      {manages && making === 'import' && <ImportVocabulary client={client} onImported={changed} />}
      <Shown read={read} failed={words('admin.the-vocabularies-could-not-be-read')}>
        {(rows) => (
          <table aria-label={words('admin.vocabularies')} className={styles['table']}>
            <thead>
              <tr>
                <th scope="col">{words('admin.name')}</th>
                <th scope="col">{words('admin.key')}</th>
                <th scope="col">{words('admin.values')}</th>
                <th scope="col">{words('admin.version-2')}</th>
                <th scope="col">
                  <span className={styles['hidden']}>{words('admin.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((each) => (
                <tr key={each.id}>
                  <td className={styles['strong']} data-content>
                    {each.name}
                  </td>
                  <td>
                    <code data-content>{each.key}</code>
                  </td>
                  <td>{formats().number(each.values)}</td>
                  <td>{each.version.number}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={words('admin.open-the-vocabulary', { name: each.name })}
                      onClick={() => setOpen(each.id)}
                    >
                      {words('admin.open')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Shown>
      {open !== null && (
        <Opened key={open} client={client} id={open} manages={manages} onSaved={changed} />
      )}
    </>
  );
}

/** A new vocabulary: its name, key, base language and order, with no values yet. */
function MakeVocabulary({ client, onMade }: { client: Client; onMade: (id: string) => void }) {
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [base, setBase] = useState('en');
  const [order, setOrder] = useState<Vocabulary['order']>('declared');
  const [said, setSaid] = useState('');
  const [why, setWhy] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const make = async (event: FormEvent) => {
    event.preventDefault();
    setSaid('');
    setWhy([]);
    if (!isVocabularyKey(key)) {
      setSaid(words('admin.a-key-is-a-lower-case-letter'));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/definitions', {
        body: {
          kind: 'vocabulary',
          definition: {
            schemaVersion: 1,
            name: name.trim(),
            key,
            base: base.trim(),
            order,
            values: [],
          },
        },
      });
      if (data) onMade(data.id);
      else {
        setSaid(refusal(error, words('admin.the-vocabulary-could-not-be-made')));
        setWhy(refusalLines(error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles['toolbar']}
      aria-label={words('admin.new-vocabulary')}
      onSubmit={(event) => void make(event)}
      noValidate
    >
      <label className={styles['filter']}>
        {words('admin.name')}
        <input value={name} onChange={(change) => setName(change.target.value)} />
      </label>
      <label className={styles['filter']}>
        {words('admin.key')}
        <input value={key} onChange={(change) => setKey(change.target.value)} />
      </label>
      <label className={styles['filter']}>
        {words('admin.base-language')}
        <input value={base} onChange={(change) => setBase(change.target.value)} />
      </label>
      <OrderChoice order={order} onChange={setOrder} />
      <button
        type="submit"
        className="primary"
        disabled={busy || name.trim() === '' || key === '' || base.trim() === ''}
      >
        {words('admin.make-vocabulary')}
      </button>
      <p role="status">{said}</p>
      <Why lines={why} />
    </form>
  );
}

function OrderChoice({
  order,
  onChange,
}: {
  order: Vocabulary['order'];
  onChange: (order: Vocabulary['order']) => void;
}) {
  return (
    <label className={styles['filter']}>
      {words('admin.order')}
      <select
        value={order}
        onChange={(change) => onChange(change.target.value as Vocabulary['order'])}
      >
        <option value="declared">{words('admin.as-declared')}</option>
        <option value="label">{words('admin.by-label')}</option>
      </select>
    </label>
  );
}

/** SKOS chosen as a file or pasted, as JSON-LD or Turtle, and what the import came to. */
function ImportVocabulary({ client, onImported }: { client: Client; onImported: () => void }) {
  const [format, setFormat] = useState<'json-ld' | 'turtle'>('json-ld');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [why, setWhy] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{
    readonly answer: 'created' | 'recorded' | 'unchanged';
    readonly name: string;
    readonly number: string;
    readonly kept: readonly string[];
    readonly notRepresented: readonly string[];
    readonly total: number;
  } | null>(null);

  const chosen = async (change: ChangeEvent<HTMLInputElement>) => {
    const file = change.target.files?.[0];
    if (!file) return;
    setFormat(/\.(ttl|turtle)$/i.test(file.name) ? 'turtle' : 'json-ld');
    setText(await file.text());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setSaid('');
    setWhy([]);
    setAnswer(null);
    try {
      const { data, error } = await client.POST('/v1/vocabularies/import', {
        body: { format, text },
      });
      if (!data) {
        setSaid(refusal(error, words('admin.the-vocabulary-could-not-be-imported')));
        setWhy(refusalLines(error));
        return;
      }
      setAnswer({
        answer: data.answer,
        name: data.vocabulary.vocabulary.name,
        number: data.vocabulary.version.number,
        kept: data.kept,
        notRepresented: data.notRepresented,
        total: data.notRepresentedTotal,
      });
      onImported();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      aria-label={words('admin.import-a-vocabulary')}
      onSubmit={(event) => void submit(event)}
      noValidate
    >
      <div className={styles['toolbar']}>
        <label className={styles['filter']}>
          {words('admin.format')}
          <select
            value={format}
            onChange={(change) => setFormat(change.target.value as typeof format)}
          >
            <option value="json-ld">{words('terms.skos-json-ld')}</option>
            <option value="turtle">{words('terms.skos-turtle')}</option>
          </select>
        </label>
        <label className={styles['filter']}>
          {words('admin.skos-file')}
          <input
            type="file"
            accept=".jsonld,.json,.ttl"
            onChange={(change) => void chosen(change)}
          />
        </label>
      </div>
      <label className={styles['filter']}>
        {words('terms.skos')}
        <textarea rows={8} value={text} onChange={(change) => setText(change.target.value)} />
      </label>
      <button type="submit" className="primary" disabled={busy || text.trim() === ''}>
        {words('admin.import-vocabulary')}
      </button>
      <p role="status">{said}</p>
      <Why lines={why} />
      {answer !== null && (
        <section aria-label={words('admin.imported')} className={styles['notes']}>
          <p>
            {words('admin.vocabulary-imported', {
              answer: answer.answer,
              name: answer.name,
              number: answer.number,
            })}
          </p>
          {answer.kept.length > 0 && (
            <p>{words('admin.kept-as-every-value-is', { ids: formats().list(answer.kept) })}</p>
          )}
          {answer.total > 0 && (
            <>
              <p>{words('admin.things-not-represented', { count: answer.total })}</p>
              <ul>
                {answer.notRepresented.map((each, at) => (
                  <li key={at} data-content>
                    {each}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </form>
  );
}

/**
 * One vocabulary at its latest version, changed in place and saved as its next version from the one
 * opened (API-037): a value is moved, relabelled, deprecated, retired or reactivated, never deleted.
 */
function Opened({
  client,
  id,
  manages,
  onSaved,
}: {
  client: Client;
  id: string;
  manages: boolean;
  onSaved: () => void;
}) {
  const [held, setHeld] = useState<Held | 'failed' | null>(null);
  const [draft, setDraft] = useState<Vocabulary | null>(null);
  const [reads, setReads] = useState(0);
  const [said, setSaid] = useState('');
  const [why, setWhy] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    let current = true;
    client
      .GET('/v1/vocabularies/{id}', { params: { path: { id } } })
      .then(({ data }) => {
        if (!current) return;
        if (!data) {
          setHeld('failed');
          return;
        }
        const vocabulary = data.vocabulary as Vocabulary;
        setHeld({ version: data.version, vocabulary });
        setDraft(vocabulary);
      })
      .catch(() => {
        if (current) setHeld('failed');
      });
    return () => {
      current = false;
    };
  }, [client, id, reads]);

  if (held === null) return <p>{words('admin.loading')}</p>;
  if (held === 'failed' || draft === null) {
    return <p role="status">{words('admin.the-vocabulary-could-not-be-read')}</p>;
  }

  const language = reader();
  const labelOf = (value: VocabularyValue) => valueLabel(draft, value, language);
  const change = (valueId: string, to: (value: VocabularyValue) => VocabularyValue) =>
    setDraft(
      (was) =>
        was && {
          ...was,
          values: was.values.map((each) => (each.id === valueId ? to(each) : each)),
        },
    );
  const move = (valueId: string, by: -1 | 1) =>
    setDraft((was) => {
      if (!was) return was;
      const at = was.values.findIndex((each) => each.id === valueId);
      const to = at + by;
      if (at < 0 || to < 0 || to >= was.values.length) return was;
      const values = [...was.values];
      [values[at], values[to]] = [values[to]!, values[at]!];
      return { ...was, values };
    });
  const withState = (value: VocabularyValue, state: State): VocabularyValue => {
    const next: VocabularyValue = { ...value, state };
    if (state !== 'deprecated') delete next.replacedBy;
    return next;
  };
  const withReplacement = (value: VocabularyValue, replacedBy: string): VocabularyValue => {
    const next: VocabularyValue = { ...value };
    if (replacedBy === '') delete next.replacedBy;
    else next.replacedBy = replacedBy;
    return next;
  };

  const save = async () => {
    setSaid('');
    setWhy([]);
    setConflict(false);
    const checked = vocabularyDefinitionSchema.safeParse(draft);
    if (!checked.success) {
      setSaid(words('admin.the-vocabulary-is-not-saved'));
      setWhy(checked.error.issues.map((issue) => problemLine(draft, issue.path, issue.message)));
      return;
    }
    // The service identifies a definition; its payload names no id.
    const definition: Record<string, unknown> = { ...draft };
    delete definition['id'];
    setBusy(true);
    try {
      const { data, error } = await client.POST('/v1/definitions/{id}/versions', {
        params: { path: { id } },
        body: { openedFrom: held.version.id, definition },
      });
      if (data) {
        const vocabulary = { ...(data.definition as Vocabulary), id };
        setHeld({ version: data.version, vocabulary });
        setDraft(vocabulary);
        setSaid(words('admin.saved-at', { number: data.version.number }));
        onSaved();
      } else if (isRecord(error) && error['code'] === 'version_precondition') {
        setConflict(true);
        setSaid(words('admin.somebody-else-saved-this-vocabulary'));
      } else {
        setSaid(refusal(error, words('admin.the-vocabulary-is-not-saved')));
        setWhy(refusalLines(error));
      }
    } finally {
      setBusy(false);
    }
  };

  const exportSkos = async () => {
    const { data } = await client.GET('/v1/vocabularies/{id}/export', {
      params: { path: { id } },
    });
    if (data) saveText(`${draft.key}.jsonld`, data.text, 'application/ld+json');
    else setSaid(words('admin.the-vocabulary-could-not-be-exported'));
  };

  const shown = valuesInOrder(draft, language);
  const declared = draft.order === 'declared';

  return (
    <section aria-label={held.vocabulary.name} className={styles['notes']}>
      <h2 data-content>{held.vocabulary.name}</h2>
      <p>
        {words('admin.vocabulary-facts', {
          key: draft.key,
          base: draft.base,
          number: held.version.number,
        })}
      </p>
      <div className={styles['toolbar']}>
        <button type="button" onClick={() => void exportSkos()}>
          {words('admin.export-as-skos')}
        </button>
      </div>
      {manages && (
        <div className={styles['toolbar']}>
          <label className={styles['filter']}>
            {words('admin.name')}
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <OrderChoice order={draft.order} onChange={(order) => setDraft({ ...draft, order })} />
        </div>
      )}
      {!manages && (
        <p>{declared ? words('admin.ordered-as-declared') : words('admin.ordered-by-label')}</p>
      )}
      <p className={styles['muted']}>{words('admin.a-value-is-never-deleted')}</p>
      <ol aria-label={words('admin.values')}>
        {shown.map((value) => {
          const name = words('admin.vocabulary-value', { label: labelOf(value), id: value.id });
          const at = draft.values.indexOf(value);
          return (
            <li key={value.id}>
              <fieldset aria-label={name}>
                <legend data-content>{name}</legend>
                {manages && declared && (
                  <div className={styles['toolbar']}>
                    <button
                      type="button"
                      aria-label={words('admin.move-value-up', { label: labelOf(value) })}
                      disabled={at === 0}
                      onClick={() => move(value.id, -1)}
                    >
                      {words('admin.up')}
                    </button>
                    <button
                      type="button"
                      aria-label={words('admin.move-value-down', { label: labelOf(value) })}
                      disabled={at === draft.values.length - 1}
                      onClick={() => move(value.id, 1)}
                    >
                      {words('admin.down')}
                    </button>
                  </div>
                )}
                <ByLanguage
                  what="label"
                  items={value.labels}
                  base={draft.base}
                  editable={manages}
                  onChange={(labels) => change(value.id, (was) => ({ ...was, labels }))}
                />
                <ByLanguage
                  what="description"
                  items={value.descriptions}
                  base={draft.base}
                  editable={manages}
                  onChange={(descriptions) => change(value.id, (was) => ({ ...was, descriptions }))}
                />
                {manages ? (
                  <div className={styles['toolbar']}>
                    <label className={styles['filter']}>
                      {words('admin.state')}
                      <select
                        value={value.state}
                        onChange={(event) =>
                          change(value.id, (was) => withState(was, event.target.value as State))
                        }
                      >
                        {STATES.map((state) => (
                          <option key={state} value={state}>
                            {words('admin.value-state', { state })}
                          </option>
                        ))}
                      </select>
                    </label>
                    {value.state === 'deprecated' && (
                      <label className={styles['filter']}>
                        {words('admin.replaced-by')}
                        <select
                          value={value.replacedBy ?? ''}
                          onChange={(event) =>
                            change(value.id, (was) => withReplacement(was, event.target.value))
                          }
                        >
                          <option value="">{words('admin.no-replacement')}</option>
                          {shown
                            .filter(
                              (other) =>
                                other.id !== value.id &&
                                (other.state !== 'retired' || other.id === value.replacedBy),
                            )
                            .map((other) => (
                              <option key={other.id} value={other.id}>
                                {labelOf(other)}
                              </option>
                            ))}
                        </select>
                      </label>
                    )}
                  </div>
                ) : (
                  <p>
                    {value.replacedBy === undefined
                      ? words('admin.value-state', { state: value.state })
                      : words('admin.deprecated-replaced-by', {
                          label: labelOf(
                            draft.values.find((each) => each.id === value.replacedBy) ?? value,
                          ),
                        })}
                  </p>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
      {manages && (
        <>
          <AddValue
            vocabulary={draft}
            onAdd={(value) => setDraft({ ...draft, values: [...draft.values, value] })}
          />
          <div className={styles['toolbar']}>
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
              {words('admin.save')}
            </button>
            {conflict && (
              <button type="button" onClick={() => setReads((was) => was + 1)}>
                {words('admin.open-it-again')}
              </button>
            )}
          </div>
        </>
      )}
      <p role="status">{said}</p>
      <Why lines={why} />
    </section>
  );
}

/** A new value: its id, allocated once in key form, and its label in the base language. */
function AddValue({
  vocabulary,
  onAdd,
}: {
  vocabulary: Vocabulary;
  onAdd: (value: VocabularyValue) => void;
}) {
  const [valueId, setValueId] = useState('');
  const [label, setLabel] = useState('');
  const [said, setSaid] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    if (!isVocabularyKey(valueId) || vocabulary.values.some((each) => each.id === valueId)) {
      setSaid(words('admin.an-id-is-a-key-of-its-own'));
      return;
    }
    setSaid('');
    onAdd({
      id: valueId,
      labels: [{ language: vocabulary.base, text: label.trim() }],
      descriptions: [],
      state: 'active',
    });
    setValueId('');
    setLabel('');
  };
  return (
    <form
      className={styles['toolbar']}
      aria-label={words('admin.add-a-value')}
      onSubmit={add}
      noValidate
    >
      <label className={styles['filter']}>
        {words('admin.id-of-the-new-value')}
        <input value={valueId} onChange={(event) => setValueId(event.target.value)} />
      </label>
      <label className={styles['filter']}>
        {words('admin.label-of-the-new-value')}
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button type="submit" disabled={valueId === '' || label.trim() === ''}>
        {words('admin.add-value')}
      </button>
      <p className={styles['muted']}>
        {words('admin.in-the-base-language', { base: vocabulary.base })}
      </p>
      <p role="status">{said}</p>
    </form>
  );
}

/** A value's labels or descriptions, one per language; the base language's label stays. */
function ByLanguage({
  what,
  items,
  base,
  editable,
  onChange,
}: {
  what: 'label' | 'description';
  items: readonly Text[];
  base: string;
  editable: boolean;
  onChange: (items: Text[]) => void;
}) {
  const [language, setLanguage] = useState('');
  const [text, setText] = useState('');
  const heading = words('admin.labels-or-descriptions', { what });
  if (!editable) {
    return items.length === 0 ? null : (
      <ul aria-label={heading}>
        {items.map((each) => (
          <li key={each.language} data-content>
            {words('admin.text-in-language', { text: each.text, language: each.language })}
          </li>
        ))}
      </ul>
    );
  }
  const set = (at: number, value: string) =>
    onChange(items.map((each, n) => (n === at ? { ...each, text: value } : each)));
  const taken = items.some((each) => each.language === language.trim());
  return (
    <div>
      <p className={styles['muted']}>{heading}</p>
      {items.map((each, at) => (
        <div key={each.language} className={styles['toolbar']}>
          <label className={styles['filter']}>
            {words('admin.text-in', { what, language: each.language })}
            {what === 'label' ? (
              <input value={each.text} onChange={(event) => set(at, event.target.value)} />
            ) : (
              <textarea
                rows={2}
                value={each.text}
                onChange={(event) => set(at, event.target.value)}
              />
            )}
          </label>
          {(what === 'description' || each.language !== base) && (
            <button
              type="button"
              aria-label={words('admin.remove-the-text-in', { what, language: each.language })}
              onClick={() => onChange(items.filter((_, n) => n !== at))}
            >
              {words('admin.remove-text')}
            </button>
          )}
        </div>
      ))}
      <div className={styles['toolbar']}>
        <label className={styles['filter']}>
          {words('admin.language-of-a-new', { what })}
          <input value={language} onChange={(event) => setLanguage(event.target.value)} />
        </label>
        <label className={styles['filter']}>
          {words('admin.new-text', { what })}
          <input value={text} onChange={(event) => setText(event.target.value)} />
        </label>
        <button
          type="button"
          disabled={language.trim() === '' || text.trim() === '' || taken}
          onClick={() => {
            onChange([...items, { language: language.trim(), text: text.trim() }]);
            setLanguage('');
            setText('');
          }}
        >
          {words('admin.add-text', { what })}
        </button>
      </div>
    </div>
  );
}
