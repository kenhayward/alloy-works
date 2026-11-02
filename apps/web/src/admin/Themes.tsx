import type { createApiClient } from '@alloy-works/api-client';
import {
  explainStyle,
  projectCss,
  projectFontFaces,
  readTheme,
  type ParagraphStyle,
  type ResolvedParagraphProperties,
  type ThemeRefusal,
} from '@alloy-works/domain';
import { useId, useMemo, useState, type FormEvent } from 'react';

import { refusal } from '../account/TokenTable.js';
import { Modal } from '../layouts/Modal.js';
import { ConfirmDialog } from '../parts/ConfirmDialog.js';
import { capHeight, faceUrl } from '../theme/faces.js';
import { words, type WordKey } from '../words/words.js';
import styles from './Administration.module.css';
import own from './Themes.module.css';
import { Shown, useListing } from './listing.js';

type Client = ReturnType<typeof createApiClient>;

interface Summary {
  readonly id: string;
  readonly name: string;
  readonly version: { readonly id: string; readonly number: string };
  readonly isDefault: boolean;
}
interface ThemeView extends Summary {
  readonly content: Record<string, unknown> & { readonly catalogues: Record<string, string> };
  readonly catalogues: readonly { readonly versionId: string; readonly content: unknown }[];
}
interface ParagraphCatalogue {
  readonly kind: 'paragraph';
  readonly base: ResolvedParagraphProperties;
  readonly styles: readonly ParagraphStyle[];
}

type Key = keyof ResolvedParagraphProperties;
type Control = 'number' | 'check' | 'colour' | 'fill' | 'typeface' | 'alignment';

/** Every paragraph property, in the order the form sets them, with its control and its name. */
const PROPERTIES: readonly (readonly [Key, Control, WordKey])[] = [
  ['typeface', 'typeface', 'admin.style-typeface'],
  ['size', 'number', 'admin.style-size'],
  ['bold', 'check', 'admin.style-bold'],
  ['italic', 'check', 'admin.style-italic'],
  ['colour', 'colour', 'admin.style-colour'],
  ['background', 'fill', 'admin.style-background'],
  ['padding', 'number', 'admin.style-padding'],
  ['alignment', 'alignment', 'admin.style-alignment'],
  ['firstLineIndent', 'number', 'admin.style-first-line-indent'],
  ['startIndent', 'number', 'admin.style-start-indent'],
  ['endIndent', 'number', 'admin.style-end-indent'],
  ['spaceBefore', 'number', 'admin.style-space-before'],
  ['spaceAfter', 'number', 'admin.style-space-after'],
  ['lineSpacing', 'number', 'admin.style-line-spacing'],
  ['keepWithNext', 'check', 'admin.style-keep-with-next'],
  ['keepTogether', 'check', 'admin.style-keep-together'],
  ['widowControl', 'check', 'admin.style-widow-control'],
  ['hyphenate', 'check', 'admin.style-hyphenate'],
  ['contextualSpacing', 'check', 'admin.style-contextual-spacing'],
];
const ALIGNMENTS = ['start', 'end', 'centre', 'justify'] as const;

/** A style being edited: what it states, each value as its control holds it. */
interface Draft {
  readonly isNew: boolean;
  readonly id: string;
  readonly name: string;
  readonly basedOn: string;
  readonly appliesTo: readonly string[];
  readonly stated: Readonly<Partial<Record<Key, string | boolean>>>;
}

const asStated = (properties: ParagraphStyle['properties']): Draft['stated'] =>
  Object.fromEntries(
    Object.entries(properties)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'boolean' ? value : String(value)]),
  );

/** The draft as the catalogue holds a style: a number's text read as a number, for the reader to judge. */
function styleOf(draft: Draft): ParagraphStyle {
  const properties: Record<string, unknown> = {};
  for (const [key, control] of PROPERTIES) {
    const value = draft.stated[key];
    if (value === undefined) continue;
    properties[key] =
      control === 'number' && typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : value;
  }
  return {
    id: draft.id,
    name: draft.name,
    ...(draft.basedOn === '' ? {} : { basedOn: draft.basedOn }),
    appliesTo: draft.appliesTo,
    properties,
  } as ParagraphStyle;
}

/**
 * Administration's **Document themes** (the SY plan, SY-F): the environment's themes; a theme's
 * paragraph styles, each a form of its properties saying where each value comes from (STY-057) beside
 * a sample set by the editor's own CSS projection of the unsaved style; the documents a change reaches,
 * listed before it is saved (STY-034, STY-067); and what the theme reader refuses, said as it is set.
 */
export function Themes({ client }: { client: Client }) {
  const [load] = useState(() => async () => {
    const { data, response } = await client.GET('/v1/themes');
    return data ? { items: data.items as Summary[] } : { status: response.status };
  });
  const read = useListing<Summary>(load, true, 0);
  const [theme, setTheme] = useState<ThemeView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [said, setSaid] = useState('');

  const open = async (id: string) => {
    const { data, error } = await client.GET('/v1/themes/{id}', { params: { path: { id } } });
    if (!data) return setSaid(refusal(error, words('admin.theme-could-not-be-loaded')));
    setTheme(data as unknown as ThemeView);
    setDraft(null);
  };

  return (
    <>
      <div className={styles['lead']}>
        <p>{words('admin.themes-lead')}</p>
      </div>
      <Shown read={read} failed={words('admin.themes-could-not-be-loaded')}>
        {(rows) => (
          <table aria-label={words('admin.document-themes')} className={styles['table']}>
            <thead>
              <tr>
                <th scope="col">{words('admin.name')}</th>
                <th scope="col">{words('admin.theme-version')}</th>
                <th scope="col">
                  <span className={styles['hidden']}>{words('admin.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((each) => (
                <tr key={each.id}>
                  <th scope="row" className={styles['strong']} data-content>
                    {each.name}
                    {each.isDefault && ` (${words('admin.theme-default')})`}
                  </th>
                  <td>{each.version.number}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={words('admin.open-theme', { name: each.name })}
                      onClick={() => void open(each.id)}
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
      {theme !== null && (
        <ThemeStyles
          client={client}
          theme={theme}
          draft={draft}
          setDraft={setDraft}
          onSaved={(next, message) => {
            setTheme(next);
            setDraft(null);
            setSaid(message);
          }}
          onSaid={setSaid}
        />
      )}
      <p role="status">{said}</p>
    </>
  );
}

function ThemeStyles({
  client,
  theme,
  draft,
  setDraft,
  onSaved,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  draft: Draft | null;
  setDraft: (draft: Draft | null) => void;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const paragraphVersion = theme.content.catalogues['paragraph']!;
  const catalogue = theme.catalogues.find((each) => each.versionId === paragraphVersion)!
    .content as ParagraphCatalogue;
  const names = new Map(catalogue.styles.map((style) => [style.id, style.name]));
  return (
    <section aria-labelledby="theme-styles">
      <h2 id="theme-styles">{theme.name}</h2>
      <table aria-label={words('admin.paragraph-styles')} className={styles['table']}>
        <thead>
          <tr>
            <th scope="col">{words('admin.name')}</th>
            <th scope="col">{words('admin.style-based-on')}</th>
            <th scope="col">
              <span className={styles['hidden']}>{words('admin.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {catalogue.styles.map((style) => (
            <tr key={style.id}>
              <th scope="row" data-content>
                {style.name}
              </th>
              <td data-content>
                {style.basedOn === undefined ? '' : (names.get(style.basedOn) ?? style.basedOn)}
              </td>
              <td>
                <button
                  type="button"
                  aria-label={words('admin.edit', { name: style.name })}
                  onClick={() =>
                    setDraft({
                      isNew: false,
                      id: style.id,
                      name: style.name,
                      basedOn: style.basedOn ?? '',
                      appliesTo: style.appliesTo,
                      stated: asStated(style.properties),
                    })
                  }
                >
                  {words('admin.edit-2')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() =>
          setDraft({ isNew: true, id: '', name: '', basedOn: '', appliesTo: ['text'], stated: {} })
        }
      >
        {words('admin.add-paragraph-style')}
      </button>
      {draft !== null && (
        <StyleForm
          key={draft.isNew ? 'new' : draft.id}
          client={client}
          theme={theme}
          catalogue={catalogue}
          draft={draft}
          setDraft={setDraft}
          onSaved={onSaved}
          onSaid={onSaid}
        />
      )}
    </section>
  );
}

function StyleForm({
  client,
  theme,
  catalogue,
  draft,
  setDraft,
  onSaved,
  onSaid,
}: {
  client: Client;
  theme: ThemeView;
  catalogue: ParagraphCatalogue;
  draft: Draft;
  setDraft: (draft: Draft | null) => void;
  onSaved: (theme: ThemeView, message: string) => void;
  onSaid: (message: string) => void;
}) {
  const asking = useId();
  const [impact, setImpact] = useState<{
    documents: readonly { id: string; title: string }[];
    unreadable: number;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const style = styleOf(draft);
  const shownName = draft.name.trim() === '' ? draft.id : draft.name;

  // The catalogue as it would be, read by the reader every output reads it by.
  const proposed = useMemo(() => {
    const styles = draft.isNew
      ? [...catalogue.styles, style]
      : catalogue.styles.map((each) => (each.id === draft.id ? style : each));
    const next = { ...catalogue, styles };
    const version = theme.content.catalogues['paragraph']!;
    const read = readTheme(
      theme.content,
      new Map(
        theme.catalogues.map((each) => [
          each.versionId,
          each.versionId === version ? next : each.content,
        ]),
      ),
    );
    return { next, read, explained: explainStyle(next, draft.id) };
    // The style is derived from the draft, which is what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, theme, draft]);

  const named = draft.id !== '' && draft.name.trim() !== '';
  // Said once the style is named: a new style's empty identifier is no refusal of the reader's to say.
  const refusals: readonly ThemeRefusal[] = !named
    ? []
    : [
        ...(proposed.read.ok ? [] : proposed.read.refusals),
        ...(proposed.explained.ok || !proposed.read.ok ? [] : proposed.explained.refusals),
      ];
  const css = proposed.read.ok
    ? projectFontFaces(proposed.read.theme, faceUrl).css +
      projectCss(proposed.read.theme, { capHeight })
    : '';
  const others = catalogue.styles.filter((each) => each.id !== draft.id);
  const nameOf = (id: string | null) =>
    id === null
      ? words('admin.style-from-base')
      : words('admin.style-from', {
          name: catalogue.styles.find((each) => each.id === id)?.name ?? id,
        });
  const place = (key: Key, value: string | boolean | undefined) => {
    const stated = { ...draft.stated };
    if (value === undefined) delete stated[key];
    else stated[key] = value;
    setDraft({ ...draft, stated });
  };

  const weigh = async (event: FormEvent) => {
    event.preventDefault();
    const { data, error } = await client.POST('/v1/themes/{id}/impact', {
      params: { path: { id: theme.id } },
      body: { kind: 'paragraph', style: draft.id },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    setImpact(data);
  };
  const save = async () => {
    setImpact(null);
    const { data, error } = await client.PUT('/v1/themes/{id}/styles/{kind}/{style}', {
      params: { path: { id: theme.id, kind: 'paragraph', style: draft.id } },
      body: { openedFrom: theme.version.id, style: style as unknown as Record<string, unknown> },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-saved')));
    onSaved(
      data as unknown as ThemeView,
      words('admin.style-saved', {
        name: shownName,
        theme: data.name,
        number: data.version.number,
      }),
    );
  };
  const remove = async () => {
    setDeleting(false);
    const { data, error } = await client.DELETE('/v1/themes/{id}/styles/{kind}/{style}', {
      params: {
        path: { id: theme.id, kind: 'paragraph', style: draft.id },
        query: { openedFrom: theme.version.id },
      },
    });
    if (!data) return onSaid(refusal(error, words('admin.style-could-not-be-deleted')));
    onSaved(data as unknown as ThemeView, words('admin.style-deleted', { name: shownName }));
  };

  return (
    <form
      aria-label={
        draft.isNew
          ? words('admin.new-paragraph-style')
          : words('admin.paragraph-style-named', { name: draft.name })
      }
      onSubmit={(event) => void weigh(event)}
      noValidate
    >
      <div className={own['editor']}>
        <div>
          <div className={own['heading']}>
            <label className={own['field']}>
              {words('admin.name')}
              <input
                value={draft.name}
                onChange={(change) => setDraft({ ...draft, name: change.target.value })}
              />
            </label>
            {draft.isNew && (
              <label className={own['field']}>
                {words('admin.style-identifier')}
                <input
                  value={draft.id}
                  onChange={(change) => setDraft({ ...draft, id: change.target.value.trim() })}
                />
              </label>
            )}
            <label className={own['field']}>
              {words('admin.style-based-on')}
              <select
                value={draft.basedOn}
                onChange={(change) => setDraft({ ...draft, basedOn: change.target.value })}
              >
                <option value="">{words('admin.style-based-on-nothing')}</option>
                {others.map((each) => (
                  <option key={each.id} value={each.id}>
                    {each.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {PROPERTIES.map(([key, control, label]) => {
            const stated = draft.stated[key];
            const explained = proposed.explained.ok
              ? proposed.explained.properties[key]
              : undefined;
            const name = words(label);
            return (
              <fieldset key={key} className={own['property']}>
                <legend>{name}</legend>
                {stated === undefined ? (
                  <>
                    <span>{explained === undefined ? '' : shown(control, explained.value)}</span>
                    <span className={own['from']}>
                      {explained === undefined ? '' : nameOf(explained.from)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        place(
                          key,
                          typeof explained?.value === 'boolean'
                            ? explained.value
                            : String(explained?.value ?? ''),
                        )
                      }
                    >
                      {words('admin.style-set-here')}
                    </button>
                  </>
                ) : (
                  <>
                    <Field
                      control={control}
                      label={name}
                      value={stated}
                      typefaces={(
                        (theme.content['typefaces'] as readonly { id: string }[] | undefined) ?? []
                      ).map((each) => each.id)}
                      onChange={(value) => place(key, value)}
                    />
                    <span className={own['from']}>{words('admin.style-set-here-said')}</span>
                    <button type="button" onClick={() => place(key, undefined)}>
                      {words('admin.style-use-inherited')}
                    </button>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
        <div className={own['side']}>
          <div className={own['sample']} data-testid="style-sample">
            {css !== '' && <style>{css}</style>}
            <div className="aw-canvas">
              <p data-style={draft.id === '' ? 'body' : draft.id} data-place={draft.appliesTo[0]}>
                {words('admin.style-sample')}
              </p>
            </div>
          </div>
          {refusals.length > 0 && (
            <ul role="alert">
              {refusals.map((each) => (
                <li key={each.code + each.message}>{each.message}</li>
              ))}
            </ul>
          )}
          <div className={own['actions']}>
            <button type="submit" className="primary" disabled={!named || refusals.length > 0}>
              {words('admin.save-style')}
            </button>
            {!draft.isNew && (
              <button type="button" onClick={() => setDeleting(true)}>
                {words('admin.delete-style')}
              </button>
            )}
            <button type="button" onClick={() => setDraft(null)}>
              {words('admin.cancel')}
            </button>
          </div>
        </div>
      </div>
      {impact !== null && (
        <Modal labelledBy={asking} size="dialog" onClose={() => setImpact(null)}>
          <h2 id={asking}>{words('admin.save-style-question', { name: shownName })}</h2>
          <p>
            {impact.documents.length + impact.unreadable === 0
              ? words('admin.style-reaches-nothing')
              : words('admin.style-reaches', {
                  count: impact.documents.length + impact.unreadable,
                })}
          </p>
          {impact.documents.length > 0 && (
            // Scrolled where long, so the keyboard reaches it too.
            <ul className={own['reach']} tabIndex={0} aria-label={words('admin.style-reach')}>
              {impact.documents.map((each) => (
                <li key={each.id} data-content>
                  {each.title}
                </li>
              ))}
            </ul>
          )}
          {impact.unreadable > 0 && (
            <p>{words('admin.style-reaches-unreadable', { count: impact.unreadable })}</p>
          )}
          <div className={own['actions']}>
            <button type="button" data-autofocus onClick={() => setImpact(null)}>
              {words('admin.cancel')}
            </button>
            <button type="button" className="primary" onClick={() => void save()}>
              {words('admin.save')}
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          question={words('admin.delete-style-question', { name: shownName })}
          sentence={words('admin.delete-style-sentence')}
          keep={words('admin.cancel')}
          act={words('admin.delete')}
          onKeep={() => setDeleting(false)}
          onAct={remove}
        />
      )}
    </form>
  );
}

/** A value as a person reads it: yes or no, a length in points, an alignment's name. */
function shown(control: Control, value: unknown): string {
  if (typeof value === 'boolean') return value ? words('admin.yes') : words('admin.no');
  if (control === 'number') return words('admin.style-points', { value: String(value) });
  if (control === 'alignment') return words(`admin.style-align-${String(value)}` as WordKey);
  return String(value);
}

function Field({
  control,
  label,
  value,
  typefaces,
  onChange,
}: {
  control: Control;
  label: string;
  value: string | boolean;
  typefaces: readonly string[];
  onChange: (value: string | boolean) => void;
}) {
  if (control === 'check') {
    return (
      <input
        type="checkbox"
        aria-label={label}
        checked={value === true}
        onChange={(change) => onChange(change.target.checked)}
      />
    );
  }
  if (control === 'typeface' || control === 'alignment') {
    const options = control === 'typeface' ? typefaces : ALIGNMENTS;
    return (
      <select
        aria-label={label}
        value={String(value)}
        onChange={(change) => onChange(change.target.value)}
      >
        {options.map((each) => (
          <option key={each} value={each}>
            {control === 'alignment' ? words(`admin.style-align-${each}` as WordKey) : each}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      {...(control === 'number' ? { type: 'number', step: 'any' } : {})}
      value={String(value)}
      onChange={(change) => onChange(change.target.value)}
    />
  );
}
